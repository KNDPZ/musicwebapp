// WASP v15: upgrade repair + primary peer, private docs, exact-file hashes and
// conservative deletion. All operations use an in-memory database and fake R2.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
const sqlite=new DatabaseSync(':memory:');
class Q{
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){assert.ok(args.length<=100);return new Q(this.sql,args);}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
  async run(){const r=sqlite.prepare(this.sql).run(...this.args);return {meta:{changes:r.changes}};}
}
const DB={prepare:sql=>new Q(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const result=[];for(const q of statements)result.push(await q.run());sqlite.exec('COMMIT');return result;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const files=new Map(),removed=[];
const env={DB,SCANNER_SECRET:'secret',MUSIC:{put:async(key,body,opts)=>{files.set(key,{body,opts});},get:async key=>files.get(key)||null,delete:async key=>{removed.push(key);files.delete(key);},list:async()=>({objects:[],truncated:false})},ASSETS:{fetch:async()=>new Response('Not found',{status:404})}};
const ctx={waitUntil:p=>{p.catch(()=>{});}};
async function call(w,path,method='GET',data,headers={}){
 const init={method,headers:{...headers}};
 if(data!==undefined){init.headers['content-type']='application/json';init.body=JSON.stringify(data);}
 const r=await w.fetch(new Request('https://wasp.test'+path,init),env,ctx);
 return {status:r.status,data:await r.json().catch(()=>null)};
}
assert.equal((await call(worker,'/api/tracks')).status,200);
assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'15.1');
assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='peer_catalogue_chunks'").get());
const folder='folder-'+'a'.repeat(40),hash='1'.repeat(64),fileid='00112233-4455-6677-8899-aabbccddeeff';
sqlite.prepare('INSERT INTO tracks(id,title,artist,album,created_at,size) VALUES(?,?,?,?,?,?)').run(folder,'Original folder','Example','',1,123);
sqlite.prepare('INSERT INTO tracks(id,title,artist,album,created_at,size,hash) VALUES(?,?,?,?,?,?,?)').run(fileid,'Uploaded duplicate','Example','',2,123,hash);
// Emulate v14.0.3 production: schema says 14.3, but chunks table was missing.
sqlite.exec("DROP TABLE peer_catalogue_chunks; UPDATE settings SET value='14.3' WHERE key='wasp_schema_version'");
const {default:upgraded}=await import('../src/index.js?upgrade-v15-test');
assert.equal((await call(upgraded,'/api/tracks')).status,200);
assert.equal(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='peer_catalogue_chunks'").get()?.name,'peer_catalogue_chunks');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tracks').get().n,2,'upgrade never removes tracks');
assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'15.1');
// A half-upgraded v15 database may also report success while the shard table is
// missing. The v15.0.1 fix must self-heal it rather than trusting that marker.
sqlite.exec("DROP TABLE peer_catalogue_chunks; UPDATE settings SET value='15' WHERE key='wasp_schema_version'");
const {default:repaired15}=await import('../src/index.js?repair-already-marked-v15');
assert.equal((await call(repaired15,'/api/tracks')).status,200);
assert.ok(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='peer_catalogue_chunks'").get());
assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'15.1');
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tracks').get().n,2);
const token='v15-admin-token';
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
sqlite.prepare('INSERT INTO sessions(token,expires,role) VALUES(?,?,?)').run(digest,Date.now()+200000,'admin');
const admin={cookie:'sid='+token};
assert.equal((await call(upgraded,'/api/admin/docs')).status,403);
const docs=await call(upgraded,'/api/admin/docs','GET',undefined,admin);
assert.equal(docs.status,200);assert.ok(docs.data.length>=10);
const doc=await call(upgraded,'/api/admin/docs?name='+encodeURIComponent(docs.data[0].name),'GET',undefined,admin);
assert.equal(doc.status,200);assert.ok(doc.data.content.startsWith('#'));
const bad=await call(upgraded,'/api/admin/docs?name=../../.env','GET',undefined,admin);
assert.equal(bad.status,404);
sqlite.prepare('INSERT INTO peers(id,url,name,added_at) VALUES(?,?,?,?)').run('p1','https://peer1.test','One',1);
sqlite.prepare('INSERT INTO peers(id,url,name,added_at) VALUES(?,?,?,?)').run('p2','https://peer2.test','Two',2);
assert.equal((await call(upgraded,'/api/admin/network/primary','PUT',{peer_id:'bad'},admin)).status,404);
assert.equal((await call(upgraded,'/api/admin/network/primary','PUT',{peer_id:'p1'},admin)).status,200);
assert.equal((await call(upgraded,'/api/network/peers')).data.filter(x=>x.is_primary).length,1);
assert.equal((await call(upgraded,'/api/admin/network/primary','PUT',{peer_id:'p2'},admin)).status,200);
assert.equal((await call(upgraded,'/api/network/peers')).data.find(x=>x.is_primary).id,'p2');
assert.equal((await call(upgraded,'/api/admin/network/primary','PUT',{peer_id:''},admin)).status,200);
assert.equal((await call(upgraded,'/api/network/peers')).data.filter(x=>x.is_primary).length,0);
// Every folder hash is metadata only; all the actual file contents remain untouched.
assert.equal((await call(upgraded,'/api/internal/fingerprint-index','POST',{items:[{id:folder,sha256:hash,size:123,mtime:100,path:'/music/Example/Track.mp3'}],status:{state:'complete',total:1,scanned:1,changed:1}}, {'x-scanner-secret':'wrong'})).status,403);
assert.equal((await call(upgraded,'/api/internal/fingerprint-index','POST',{items:[{id:folder,sha256:hash,size:123,mtime:100,path:'/music/Example/Track.mp3'}],status:{state:'complete',total:1,scanned:1,changed:1}}, {'x-scanner-secret':'secret'})).status,200);
assert.equal(sqlite.prepare('SELECT sha256 FROM file_fingerprints WHERE track_id=?').get(folder).sha256,hash);
assert.equal((await call(upgraded,'/api/admin/duplicates')).status,403);
const groups=await call(upgraded,'/api/admin/duplicates','GET',undefined,admin);
assert.equal(groups.status,200,JSON.stringify(groups.data));
assert.equal(groups.data.duplicate_count,1);
assert.equal(groups.data.groups[0].items.length,2);
assert.equal((await call(upgraded,'/api/admin/check','POST',{hash},admin)).data.id,fileid);
// The original folder file can never be removed through this API.
assert.equal((await call(upgraded,'/api/admin/duplicates/'+folder,'DELETE',{confirm:'delete duplicate'},admin)).status,404);
assert.equal((await call(upgraded,'/api/admin/duplicates/'+fileid,'DELETE',{confirm:'wrong'},admin)).status,400);
// A playlist reference blocks deletion even though the file is redundant.
sqlite.prepare('INSERT INTO playlists(id,name,created_at) VALUES(?,?,?)').run('pl','Important',1);
sqlite.prepare('INSERT INTO playlist_tracks(playlist_id,track_id,added_at) VALUES(?,?,?)').run('pl',fileid,1);
assert.equal((await call(upgraded,'/api/admin/duplicates/'+fileid,'DELETE',{confirm:'delete duplicate'},admin)).status,409);
sqlite.prepare('DELETE FROM playlist_tracks WHERE track_id=?').run(fileid);
assert.equal((await call(upgraded,'/api/admin/duplicates/'+fileid,'DELETE',{confirm:'delete duplicate'},admin)).status,200);
assert.ok(removed.includes(fileid));
assert.ok(sqlite.prepare('SELECT id FROM tracks WHERE id=?').get(folder));
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM tracks').get().n,1);
// Removing a file from /music clears only stale fingerprint metadata. The
// original file is never remotely deleted by this Docker scanner endpoint.
assert.equal((await call(upgraded,'/api/internal/fingerprint-prune','POST',{ids:[folder]},{'x-scanner-secret':'wrong'})).status,403);
assert.equal((await call(upgraded,'/api/internal/fingerprint-prune','POST',{ids:[folder]},{'x-scanner-secret':'secret'})).status,200);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM file_fingerprints').get().n,0);
assert.ok(sqlite.prepare('SELECT id FROM tracks WHERE id=?').get(folder));
assert.ok(!removed.includes(folder));
const site=await call(upgraded,'/api/admin/settings','PUT',{brand_mode:'image',sidebar_enabled:true,sidebar_html:'<p>Powered by Docker</p>'},admin);
assert.equal(site.status,200);assert.equal(site.data.brand_mode,'image');assert.equal(site.data.sidebar.enabled,true);
assert.equal((await call(upgraded,'/api/site')).data.sidebar.html,'<p>Powered by Docker</p>');
const config=await call(upgraded,'/api/admin/crons','PUT',{timezone:'UTC',jobs:{hash:{enabled:true,frequency:'daily',time:'02:00',weekday:0,monthday:1}}},admin);
assert.equal(config.status,200,JSON.stringify(config.data));
assert.equal((await call(upgraded,'/api/admin/crons','GET',undefined,admin)).data.jobs.hash.enabled,true);
console.log('PASS v15: v14.3 repair, private docs, exclusive primary peer, read-only hash index, duplicate review + safe delete, branding & cron');
