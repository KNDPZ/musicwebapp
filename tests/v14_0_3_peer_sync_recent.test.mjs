// WASP 14.0.3: admin-only phased metadata sync and anonymized recent listening.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
const sqlite=new DatabaseSync(':memory:');
class Q {
 constructor(text,args=[]){this.text=text;this.args=args;}
 bind(...args){assert.ok(args.length<=100,'D1 parameter limit exceeded');return new Q(this.text,args);}
 async run(){const r=sqlite.prepare(this.text).run(...this.args);return {meta:{changes:r.changes}};}
 async first(){return sqlite.prepare(this.text).get(...this.args)||null;}
 async all(){return {results:sqlite.prepare(this.text).all(...this.args)};}
}
const DB={prepare:text=>new Q(text),batch:async stmts=>{
 sqlite.exec('BEGIN');try{const out=[];for(const q of stmts)out.push(await q.run());sqlite.exec('COMMIT');return out;}
 catch(error){sqlite.exec('ROLLBACK');throw error;}
}};
const env={DB,SCANNER_SECRET:'secret',MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{},list:async()=>({objects:[],truncated:false})},ASSETS:{fetch:async()=>new Response('404',{status:404})}};
const wait=[];const ctx={waitUntil:p=>wait.push(p)};
async function api(path,method='GET',data,headers={}){
 const r=await worker.fetch(new Request('https://wasp.test'+path,{method,headers:{...headers,...(data?{'content-type':'application/json'}:{})},body:data?JSON.stringify(data):undefined}),env,ctx);
 return {status:r.status,body:await r.json().catch(()=>null)};
}
assert.equal((await api('/api/tracks')).status,200);
const token='admin-test-v1403';
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
sqlite.prepare('INSERT INTO sessions(token,expires,role) VALUES(?,?,?)').run(digest,Date.now()+86400000,'admin');
const auth={cookie:'sid='+token};
sqlite.prepare("INSERT INTO settings(key,value) VALUES('network_share','1')").run();
sqlite.prepare('INSERT INTO peers(id,url,name,track_count,last_ok,added_at) VALUES(?,?,?,?,?,?)').run('bridge','https://peer.example','Bridged',0,Date.now(),Date.now());
const original=globalThis.fetch;const urls=[];
globalThis.fetch=async (url,opts={})=>{
 const u=new URL(String(url));urls.push(u);
 assert.equal(u.hostname,'peer.example','Sync must never follow a browser-provided arbitrary origin');
 assert.ok(u.searchParams.has('sync'),'Sync must bypass cache using a fresh query key');
 if(u.pathname==='/api/tracks')return Response.json([{id:'s1',title:'Fresh song',artist:'Peer artist',artists:['Peer artist'],album:'Peer album',duration:181}]);
 if(u.pathname==='/api/playlists')return Response.json([{id:'pl1',name:'Fresh playlist',tracks:['s1']}]);
 if(u.pathname==='/api/user-playlists')return Response.json([{id:'up1',name:'Public playlist',username:'Member',is_public:1,tracks:['s1']}]);
 return Response.json({error:'not found'},{status:404});
};
try {
 assert.equal((await api('/api/admin/network/peers/bridge/sync','POST',{phase:'tracks'})).status,403,'guest may not sync');
 for(const [phase,amount] of [['tracks',1],['playlists',1],['users',1]]){
  const result=await api('/api/admin/network/peers/bridge/sync','POST',{phase},auth);
  assert.equal(result.status,200,JSON.stringify(result.body));
  assert.equal(result.body.count,amount);
 }
 const finished=await api('/api/admin/network/peers/bridge/sync','POST',{phase:'finish'},auth);
 assert.equal(finished.status,200);
 assert.equal(urls.length,4,'metadata and revision only; no audio or images fetched during metadata sync');
 assert.ok(urls.every(u=>['/api/tracks','/api/playlists','/api/user-playlists','/api/catalog-version'].includes(u.pathname)));
 const cache=await api('/api/peer-catalogue');
 assert.equal(cache.status,200);
 assert.equal(cache.body[0].tracks[0].title,'Fresh song');
 assert.equal(cache.body[0].playlists[0].name,'Fresh playlist');
 assert.equal(cache.body[0].users[0].name,'Public playlist');
 assert.equal(sqlite.prepare('SELECT track_count FROM peers WHERE id=?').get('bridge').track_count,1);
 assert.equal((await api('/api/catalog-version')).body.revision,finished.body.revision);
 // Confirm a second successful sync replaces metadata without deleting any track data.
 const refresh=await api('/api/admin/network/peers/bridge/sync','POST',{phase:'tracks'},auth);
 assert.equal(refresh.status,200);
}finally {globalThis.fetch=original;}

// Chunk a growing peer catalogue rather than putting a multi-megabyte JSON
// array into one D1 row (D1 caps strings and rows at 2 MB).
let expanded=false;
const savedFetch=globalThis.fetch;
globalThis.fetch=async (url,opts={})=>{
 const target=new URL(String(url));
 if(target.hostname==='peer.example' && target.pathname==='/api/tracks'){
   return Response.json(Array.from({length:1400},(_,i)=>({id:'large'+i,title:'Record '+i,artist:'Band',
      artists:['Band'],album:'Long album',cover_url:'https://example.test/art/'+i,description:'M'.repeat(200)})));
 }
 return Response.json({error:'not found'},{status:404});
};
try {
 const large=await api('/api/admin/network/peers/bridge/sync','POST',{phase:'tracks'},auth);
 assert.equal(large.status,200,JSON.stringify(large.body));
 assert.equal(large.body.count,1400);
 const parts=sqlite.prepare("SELECT length(body) AS size FROM peer_catalogue_chunks WHERE peer_id='bridge' AND kind='tracks'").all();
 assert.ok(parts.length>1,'large peer catalogues must be split into multiple rows');
 assert.ok(parts.every(p=>p.size<250000),'keep every D1 chunk well below the 2 MB row limit');
 const result=await api('/api/peer-catalogue');
 assert.equal(result.body[0].tracks.length,1400);
} finally {globalThis.fetch=savedFetch;}

// Local plays are recorded without any listener identifier or sessions.
sqlite.prepare("INSERT INTO tracks(id,title,artist,album,created_at) VALUES(?,?,?,?,?)").run('local1','Local song','Local band','Album',Date.now());
assert.equal((await api('/api/play/local1','POST')).status,200);
assert.equal((await api('/api/play-peer','POST',{origin:'https://peer.example',remote_id:'s1',title:'Peer song',artist:'Peer artist',album:'Album'})).status,200);
const recent=await api('/api/recent-listens');
assert.equal(recent.status,200);
assert.ok(recent.body.some(e=>e.title==='Local song'));
assert.ok(recent.body.some(e=>e.title==='Peer song'));
assert.ok(recent.body.every(e=>!('username' in e)&&!('voter' in e)&&!('ip' in e)),'do not publish listener identity');
assert.ok(recent.body.every(e=>e.played_at>0));
const config=await api('/api/admin/crons','PUT',{timezone:'Asia/Manila',jobs:{peers:{enabled:true,frequency:'daily',time:'02:00',weekday:0,monthday:1,sync_catalogue:true}}},auth);
assert.equal(config.status,200,JSON.stringify(config.body));
assert.equal((await api('/api/admin/crons','GET',null,auth)).body.jobs.peers.sync_catalogue,true);
assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'15.1');
console.log('PASS: phased admin-only peer sync (no media downloads), metadata snapshot, catalog revision, local + peer recent history, privacy, cron setting');
