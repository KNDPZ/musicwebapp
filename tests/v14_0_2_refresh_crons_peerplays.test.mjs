// WASP 14.0.2: revision-based catalogue freshness, admin cron permissions,
// non-destructive v14 upgrade, local peer-listen counting.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
const sqlite=new DatabaseSync(':memory:');
class Q{
 constructor(text,args=[]){this.text=text;this.args=args;}
 bind(...args){return new Q(this.text,args);}
 async run(){const x=sqlite.prepare(this.text).run(...this.args);return {meta:{changes:x.changes}};}
 async first(){return sqlite.prepare(this.text).get(...this.args)||null;}
 async all(){return {results:sqlite.prepare(this.text).all(...this.args)};}
}
const DB={prepare:text=>new Q(text),batch:async stmts=>{
 sqlite.exec('BEGIN');try{const out=[];for(const stmt of stmts)out.push(await stmt.run());sqlite.exec('COMMIT');return out;}
 catch(e){sqlite.exec('ROLLBACK');throw e;}
}};
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{},list:async()=>({objects:[],truncated:false})},
 ASSETS:{fetch:async()=>new Response('not found',{status:404})},SCANNER_SECRET:'secret',
 PEER_ORIGIN_ALIASES:JSON.stringify({'https://music.playy.online':'http://100.107.221.71:8081'})};
const tasks=[];const ctx={waitUntil(p){tasks.push(p)}};
async function req(path,method='GET',payload,headers={}){
 const options={method,headers:{...headers,...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined};
 const response=await worker.fetch(new Request('https://wasp.test'+path,options),env,ctx);
 return {response,data:await response.clone().json().catch(()=>null)};
}
// Init then insert pre-existing data (no music or user tables are reset).
assert.equal((await req('/api/tracks')).response.status,200);
const token='admin-session-123';const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(x=>x.toString(16).padStart(2,'0')).join('');
sqlite.prepare('INSERT INTO sessions(token,expires,role) VALUES(?,?,?)').run(hash,Date.now()+86400000,'admin');
const admin={cookie:'sid='+token};
sqlite.prepare("INSERT INTO settings(key,value) VALUES('network_share','1')").run();
sqlite.prepare('INSERT INTO peers(id,url,name,added_at) VALUES(?,?,?,?)').run('p','http://100.107.221.71:8081','Bridge',Date.now());
const before=(await req('/api/catalog-version')).data.revision;
const created=await req('/api/admin/playlists','POST',{name:'New playlist'},admin);
assert.equal(created.response.status,200,JSON.stringify(created.data));
const after=(await req('/api/catalog-version')).data.revision;
assert.notEqual(after,before,'new admin playlist advances revision');
assert.equal((await req('/api/playlists?v='+after)).data.length,1,'new playlist visible through revision URL');
const stats=await req('/api/play-peer','POST',{origin:'http://100.107.221.71:8081',remote_id:'song123'});
assert.equal(stats.response.status,200,JSON.stringify(stats.data));
const stats2=await req('/api/play-peer','POST',{origin:'http://100.107.221.71:8081',remote_id:'song123'});
assert.equal(stats2.response.status,200);
const counts=await req('/api/peer-plays');
assert.equal(counts.data[0].plays,2);
assert.equal(counts.data[0].origin,'https://music.playy.online','bridge origin is canonicalized');
assert.notEqual((await req('/api/play-peer','POST',{origin:'https://evil.test',remote_id:'song123'})).response.status,200);
// Docker source-play synchronization: a confirmed source POST increments the
// Cloudflare source directly, while only unsynced local listens are federated.
const originalFetch=globalThis.fetch;
const calls=[];
env.PEER_PLAY_SYNC='1';
globalThis.fetch=async (url, options={})=>{
  if(String(url)==='http://100.107.221.71:8081/api/play/song123'){
    calls.push({url:String(url),method:options.method});
    return new Response(JSON.stringify({ok:true}),{status:200,headers:{'content-type':'application/json'}});
  }
  return originalFetch(url,options);
};
try {
  assert.equal((await req('/api/play-peer','POST',{origin:'http://100.107.221.71:8081',remote_id:'song123'})).response.status,200);
  await Promise.allSettled(tasks.splice(0));
  assert.equal(calls.length,1,'a successful Docker peer listen is sent once to its source');
  assert.equal(calls[0].method,'POST');
  const state=sqlite.prepare('SELECT plays,synced_plays FROM peer_listens WHERE remote_id=?').get('song123');
  assert.equal(state.plays,3);
  assert.equal(state.synced_plays,1);
  assert.equal((await req('/api/peer-plays')).data[0].plays,2,'synced listens are not double-counted');
  globalThis.fetch=async(url,options={})=>{
    if(String(url)==='http://100.107.221.71:8081/api/play/song123')return new Response('Not Found',{status:404});
    return originalFetch(url,options);
  };
  await req('/api/play-peer','POST',{origin:'http://100.107.221.71:8081',remote_id:'song123'});
  await Promise.allSettled(tasks.splice(0));
  assert.equal((await req('/api/peer-plays')).data[0].plays,3,'unsynced listens remain counted locally');
} finally {globalThis.fetch=originalFetch;delete env.PEER_PLAY_SYNC;}

assert.equal((await req('/api/admin/crons')).response.status,403,'cron settings admin-only');
const cronGet=await req('/api/admin/crons','GET',null,admin);
assert.equal(cronGet.response.status,200);
assert.equal(cronGet.data.jobs.peers.enabled,false,'scheduled network checks off by default');
const changed={...cronGet.data,timezone:'Asia/Manila',jobs:{...cronGet.data.jobs,
 peers:{enabled:true,frequency:'weekly',time:'02:00',weekday:0,monthday:1},
 artwork:{enabled:false,frequency:'monthly',time:'02:00',weekday:0,monthday:30}}};
assert.equal((await req('/api/admin/crons','PUT',changed,admin)).response.status,200);
assert.equal((await req('/api/admin/crons','PUT',{timezone:'INVALID/TZ',jobs:{}},admin)).response.status,400);
// Worker cron is invoked each minute in UTC but checks the configured
// local timezone. It must run only at a scheduled local minute, and once.
const realCronFetch=globalThis.fetch;
let peerCronCalls=0;
globalThis.fetch=async(url,opts={})=>{
  if(String(url)==='http://100.107.221.71:8081/api/peer'){
    peerCronCalls++;
    return new Response(JSON.stringify({ok:true,name:'Bridge library',tracks:1328}),{status:200});
  }
  return realCronFetch(url,opts);
};
try {
  const sundayMidnightManila=Date.parse('2026-11-14T16:00:00Z');
  await worker.scheduled({scheduledTime:sundayMidnightManila-60000},env,ctx);
  assert.equal(peerCronCalls,0,'weekly peer check does not run before local midnight');
  await worker.scheduled({scheduledTime:sundayMidnightManila},env,ctx);
  assert.equal(peerCronCalls,1,'Sunday 00:00 Asia/Manila runs the weekly check');
  await worker.scheduled({scheduledTime:sundayMidnightManila},env,ctx);
  assert.equal(peerCronCalls,1,'same-minute cron tick does not run twice');
  const m={...changed,jobs:{...changed.jobs,peers:{...changed.jobs.peers,frequency:'monthly',monthday:16}}};
  assert.equal((await req('/api/admin/crons','PUT',m,admin)).response.status,200);
  const monthDayMidnight=Date.parse('2026-11-15T16:00:00Z');
  await worker.scheduled({scheduledTime:monthDayMidnight},env,ctx);
  assert.equal(peerCronCalls,2,'monthly day 16 runs at local midnight');
} finally {globalThis.fetch=realCronFetch;}

assert.equal((await req('/api/admin/version','GET',null,admin)).data.version,'14.0.2');
assert.equal((await req('/api/internal/cron-tick','POST',null,{'x-scanner-secret':'invalid'})).response.status,403);
// v14.0.1 -> v14.0.2 fast upgrade must not delete playlist/music.
sqlite.prepare("UPDATE settings SET value='14' WHERE key='wasp_schema_version'").run();
const {default:second}=await import('../src/index.js?test=upgrade14.2');
const secondResponse=await second.fetch(new Request('https://wasp.test/api/playlists'),env,ctx);
assert.equal(secondResponse.status,200);
assert.equal(sqlite.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'14.2');
assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM playlists').get().n,1);
console.log('PASS v14.0.2: catalogue revision, playlist visibility, canonical peer plays, admin-only cron settings, fast non-destructive migration');
