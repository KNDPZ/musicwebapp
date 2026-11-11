import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import worker from '../src/index.js';
const sqlite = new DatabaseSync(':memory:');
class Stmt { constructor(sql,args=[]){this.sql=sql;this.args=args;} bind(...args){return new Stmt(this.sql,args)} async run(){return sqlite.prepare(this.sql).run(...this.args)} async first(){return sqlite.prepare(this.sql).get(...this.args)||null} async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}} }
const DB={prepare:s=>new Stmt(s),batch:async stmts=>{sqlite.exec('BEGIN');try{for(const s of stmts)await s.run();sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{}},ASSETS:{fetch:async()=>new Response('not found')}};
async function req(path,{method='GET',body,visitor='visitor-123456789',cookie}={}){
 const r=await worker.fetch(new Request('https://wasp.example'+path,{method,headers:{'content-type':'application/json','X-Visitor':visitor,...(cookie?{cookie:`sid=${cookie}`}:{})},body:body?JSON.stringify(body):undefined}),env,{});
 return {code:r.status,data:await r.json()};
}
await req('/api/site');
await DB.prepare('INSERT INTO peers(id,url,name,added_at) VALUES(?,?,?,?)').bind('p1','http://100.107.221.71:8081','Bridge',Date.now()).run();
assert.equal((await req('/api/peer-react',{method:'POST',body:{origin:'https://unknown.example',remote_id:'x',kind:'heart',on:true}})).code,404,'Unknown peers rejected');
const input={origin:'http://100.107.221.71:8081',remote_id:'song-a',kind:'heart',on:true};
let r=await req('/api/peer-react',{method:'POST',body:input});
assert.equal(r.code,200);assert.equal(r.data.hearts,1);
let list=await req('/api/peer-reactions');
assert.equal(list.code,200);assert.equal(list.data.length,1);assert.equal(list.data[0].hearts,1);assert.equal(list.data[0].my_heart,1);
assert.equal((await req('/api/peer-reactions',{visitor:'different-visitor'})).data[0].my_heart,0);
r=await req('/api/peer-react',{method:'POST',body:{...input,kind:'like'}});assert.equal(r.data.likes,1);
r=await req('/api/peer-react',{method:'POST',body:{...input,kind:'dislike'}});
assert.equal(r.data.dislikes,1);assert.equal(r.data.likes,0,'Like and dislike exclude each other');
r=await req('/api/peer-react',{method:'POST',body:{...input,on:false}});assert.equal(r.data.hearts,0);
let snapshot=await DB.prepare('SELECT COUNT(*) AS n FROM tracks').first();assert.equal(snapshot.n,0,'Remote votes never create local songs');
assert.equal((await req('/api/spotify/search-playlists?q=rock')).code,503,'No credentials produce a clear actionable response');
const oldFetch=globalThis.fetch;let searchCount=0, tokenCount=0;
globalThis.fetch=async (url,options={})=>{
 if(String(url).includes('accounts.spotify.com')){tokenCount++;assert.match(options.headers.authorization,/^Basic /);return new Response(JSON.stringify({access_token:'test-token',expires_in:3600}),{status:200});}
 if(String(url).includes('api.spotify.com/v1/search')){searchCount++;assert.match(String(url),/type=playlist/);return new Response(JSON.stringify({playlists:{items:[{id:'1234567890abcdefghij',name:'Rock Mix',owner:{display_name:'test'},items:{total:50},images:[{url:'https://i.scdn.co/image/demo'}]}]}}),{status:200});}
 return oldFetch(url,options);
};
try{
 env.SPOTIFY_CLIENT_ID='test-client';env.SPOTIFY_CLIENT_SECRET='test-secret';
 r=await req('/api/spotify/search-playlists?q=rock');assert.equal(r.code,200);assert.equal(r.data.length,1);assert.equal(r.data[0].title,'Rock Mix');assert.match(r.data[0].url,/open.spotify.com\/playlist/);
 r=await req('/api/spotify/search-playlists?q=pop');assert.equal(r.code,200);assert.equal(tokenCount,1,'Tokens cached for short interval');assert.equal(searchCount,2);
}finally{globalThis.fetch=oldFetch;}
console.log('PASS: local-only peer reactions, votes persisted, peer validation, user state, Spotify credential errors and search');
