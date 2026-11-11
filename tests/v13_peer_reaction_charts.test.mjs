// Peer songs voted on this instance appear in local popularity charts with
// enough cached metadata to survive a temporarily unavailable peer.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
const sqlite=new DatabaseSync(':memory:');
class Stmt {constructor(sql,args=[]){this.sql=sql;this.args=args}bind(...args){return new Stmt(this.sql,args)}async run(){return sqlite.prepare(this.sql).run(...this.args)}async first(){return sqlite.prepare(this.sql).get(...this.args)||null}async all(){return {results:sqlite.prepare(this.sql).all(...this.args)}}}
const DB={prepare:s=>new Stmt(s),batch:async ss=>{sqlite.exec('BEGIN');try{for(const s of ss)await s.run();sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{}},ASSETS:{fetch:async()=>new Response('not found')}};
async function call(path,{method='GET',body,visitor='visitor-reaction-test-1'}={}){
 const r=await worker.fetch(new Request('https://wasp.local'+path,{method,headers:{'x-visitor':visitor,'content-type':'application/json'},body:body?JSON.stringify(body):undefined}),env,{});
 return {code:r.status,data:await r.json()};
}
await call('/api/tracks');
const origin='http://100.107.221.71:8081',remote_id='peer-track-123';
await DB.prepare('INSERT INTO peers(id,url,name,added_at) VALUES(?,?,?,?)').bind('p1',origin,'Bridge',Date.now()).run();
let result=await call('/api/peer-react',{method:'POST',body:{origin,remote_id,kind:'heart',on:true,title:'Peer Hearted Song',artist:'Peer Artist',album:'Peer Album',duration:214,cover_url:'https://music.example/art.png'}});
assert.equal(result.code,200);assert.equal(result.data.hearts,1);
result=await call('/api/peer-react',{method:'POST',body:{origin,remote_id,kind:'like',on:true,title:'Peer Hearted Song',artist:'Peer Artist',album:'Peer Album',duration:214}});
assert.equal(result.code,200);assert.equal(result.data.likes,1);
result=await call('/api/peer-reactions');assert.equal(result.code,200);
const saved=result.data[0];
assert.deepEqual([saved.title,saved.artist,saved.album,saved.duration],['Peer Hearted Song','Peer Artist','Peer Album',214]);
assert.deepEqual([saved.hearts,saved.likes,saved.dislikes],[1,1,0]);
// Voters from another browser should see those same local chart counts.
const other=await call('/api/peer-reactions',{visitor:'visitor-2-check-123'});
assert.equal(other.data[0].hearts,1);assert.equal(other.data[0].my_heart,0);
// Updating a reaction must not overwrite cached metadata with blank fields.
result=await call('/api/peer-react',{method:'POST',body:{origin,remote_id,kind:'dislike',on:true}});
assert.equal(result.code,200);assert.equal(result.data.likes,0);assert.equal(result.data.dislikes,1);
const rows=await call('/api/peer-reactions');
assert.equal(rows.data[0].title,'Peer Hearted Song');
assert.equal(rows.data[0].cover_url,'https://music.example/art.png');
assert.equal((await call('/api/tracks')).data.length,0,'voting must not copy peer audio into the local library');
assert.equal((await call('/api/peer-react',{method:'POST',body:{origin:'https://untrusted.example',remote_id,kind:'heart',on:true}})).code,404);
console.log('PASS: peer vote metadata cached safely; anonymous counts persist; remote audio not imported; unknown peer denied');
