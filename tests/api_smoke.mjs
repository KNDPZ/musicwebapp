// Test actual Worker API with Node's built-in SQLite adapter (no Cloudflare credentials).
// Run: node tests/api_smoke.mjs (Node >= 22, experimental node:sqlite).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const sqlite = new DatabaseSync(':memory:');
class DbStatement {
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new DbStatement(this.sql,args);}
  async run(){const info=sqlite.prepare(this.sql).run(...this.args);return {meta:{changes:info.changes}};}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
}
const DB={
  prepare:(sql)=>new DbStatement(sql),
  batch:async(statements)=>{
    sqlite.exec('BEGIN TRANSACTION');
    try{const out=[];for(const stmt of statements)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}
    catch(e){sqlite.exec('ROLLBACK');throw e;}
  }
};
const stored=new Map();
const MUSIC={
  get:async key=>stored.get(key)||null,
  put:async(key,body,options)=>{stored.set(key,{body,options});},
  delete:async key=>{stored.delete(key)}
};
const env={DB,MUSIC,ASSETS:{fetch:async()=>new Response('Not found',{status:404})}};
const crypto=globalThis.crypto;
const cookieToken='test_session_123';
const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(cookieToken))))
  .map(x=>x.toString(16).padStart(2,'0')).join('');
const http=async(path,method='GET',body,authenticated=true)=>{
  const headers=authenticated?{'cookie':`sid=${cookieToken}`}:{ };
  if(body)headers['content-type']='application/json';
  const r=await worker.fetch(new Request('https://local.test'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,{});
  return {status:r.status, data:await r.json(),headers:r.headers};
};
const start=await http('/api/tracks');assert.equal(start.status,200,'Worker initializes DB');
await DB.prepare('INSERT INTO user_accounts (id,username,salt,hash,created_at) VALUES (?,?,?,?,?)').bind('u1','tester','salt','hash',Date.now()).run();
await DB.prepare('INSERT INTO sessions (token,expires,role,user_id) VALUES (?,?,?,?)').bind(sha,Date.now()+86400000,'user','u1').run();
for (const [id,title] of [['t1','Song One'],['t2','Song Two']])
  await DB.prepare('INSERT INTO tracks (id,title,artist,album,created_at) VALUES (?,?,?,?,?)').bind(id,title,'Artist','Album',Date.now()).run();
await DB.prepare('INSERT INTO peers (id,url,name,added_at) VALUES (?,?,?,?)').bind('peer1','https://peer.example','Peer',Date.now()).run();
const ref='peer:'+'a'.repeat(64);
await DB.prepare('INSERT INTO peer_track_refs (ref,origin,remote_id,title,artist,album,duration) VALUES (?,?,?,?,?,?,?)').bind(ref,'https://peer.example','abc','Other Song','Peer Artist','Album',180).run();
await DB.prepare('INSERT INTO user_playlists (id,user_id,name,is_public,created_at,cover_mode) VALUES (?,?,?,?,?,?)').bind('public1','u1','Shared Songs',1,Date.now(),'mosaic').run();
await DB.prepare('INSERT INTO user_playlist_tracks (playlist_id,track_id,added_at) VALUES (?,?,?)').bind('public1',ref,Date.now()).run();
await DB.prepare("INSERT INTO settings (key,value) VALUES ('network_share','1')").run();
const shared=await http('/api/user-playlists', 'GET',null,false);
assert.equal(shared.status,200);
assert.equal(shared.headers.get('access-control-allow-origin'),'*');
assert.deepEqual(shared.data[0].track_sources[ref].remote_id,'abc','public peer track includes playback location');
assert.equal(shared.data[0].track_sources[ref].origin,'https://peer.example');
const copied=await http('/api/user/playlists/copy','POST',{name:'My Copy',tracks:['t1',ref,'t2']});
assert.equal(copied.status,201,JSON.stringify(copied.data));
const id=copied.data.id;
const mine=await http('/api/user/playlists');
const pl=mine.data.find(x=>x.id===id);
assert.equal(pl.cover_mode,'mosaic');
assert.equal(pl.cover_url,null);
assert.deepEqual(pl.tracks,['t1',ref,'t2']);
const append=await http(`/api/user/playlists/${id}/tracks/batch`,'POST',{tracks:['t2','t1']});
assert.equal(append.status,200);assert.equal(append.data.added,0);
const updated=await http(`/api/user/playlists/${id}/tracks`,'PUT',{tracks:[ref,'t2']});
assert.equal(updated.status,200);
const after=await http('/api/user/playlists');
assert.deepEqual(after.data.find(x=>x.id===id).tracks,[ref,'t2'],'PUT respects new order and removals');
const invalid=await http(`/api/user/playlists/${id}/tracks`,'PUT',{tracks:['not-existing']});
assert.equal(invalid.status,409,'Invalid track list rejected atomically');
assert.deepEqual((await http('/api/user/playlists')).data.find(x=>x.id===id).tracks,[ref,'t2']);
const unauthorized=await http(`/api/user/playlists/${id}`,'DELETE',null,false);
assert.notEqual(unauthorized.status,200,'Logged out users cannot delete');
const deleted=await http(`/api/user/playlists/${id}`,'DELETE');assert.equal(deleted.status,200);
assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM tracks').first()).n,2,'Delete playlist never deletes songs');
assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM peer_track_refs').first()).n,1,'Delete playlist preserves peer references');
assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM user_playlists WHERE id = ?').bind(id).first()).n,0);
console.log('PASS: Worker D1 init, public source maps/CORS, 3×3-copy default, track order, atomic replace/append, validation, authentication, playlist-only deletion');
