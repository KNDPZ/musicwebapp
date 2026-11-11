// Regression: guest/user reactions remain local, update immediately and
// are queryable without requiring authentication (including remote songs).
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
const sqlite=new DatabaseSync(':memory:');
class Stmt {
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Stmt(this.sql,args);}
  async run(){return sqlite.prepare(this.sql).run(...this.args);}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
}
const DB={prepare:s=>new Stmt(s),batch:async commands=>{sqlite.exec('BEGIN');try{for(const c of commands)await c.run();sqlite.exec('COMMIT')}catch(e){sqlite.exec('ROLLBACK');throw e}}};
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{}},ASSETS:{fetch:async()=>new Response('not found')}};
async function call(path,{method='GET',body,visitor='guest-123456789',cookie}={}){
 const headers={'X-Visitor':visitor};if(body)headers['content-type']='application/json';if(cookie)headers.cookie='sid='+cookie;
 const r=await worker.fetch(new Request('https://wasp.local'+path,{method,headers,body:body?JSON.stringify(body):undefined}),env,{});
 return {code:r.status,data:await r.json()};
}
await call('/api/tracks');
await DB.prepare('INSERT INTO peers(id,url,name,added_at) VALUES(?,?,?,?)').bind('peer-a','http://100.107.221.71:8081','Bridge',Date.now()).run();
await DB.prepare('INSERT INTO tracks(id,title,artist,album,created_at) VALUES(?,?,?,?,?)').bind('local-1','Track One','Local Artist','Album',Date.now()).run();
const origin='http://100.107.221.71:8081',remote_id='remote-1';
let r=await call('/api/reaction-state?origin='+encodeURIComponent(origin)+'&remote_id='+remote_id);
assert.equal(r.code,200);assert.deepEqual([r.data.hearts,r.data.likes,r.data.dislikes],[0,0,0]);
r=await call('/api/peer-react',{method:'POST',body:{origin,remote_id,kind:'heart',on:true}});assert.equal(r.code,200);assert.equal(r.data.hearts,1);
r=await call('/api/reaction-state?origin='+encodeURIComponent(origin)+'&remote_id='+remote_id);
assert.equal(r.data.hearts,1);assert.equal(r.data.my_heart,1);
r=await call('/api/reaction-state?origin='+encodeURIComponent(origin)+'&remote_id='+remote_id,{visitor:'another-guest-123'});
assert.equal(r.data.hearts,1);assert.equal(r.data.my_heart,0);
r=await call('/api/peer-react',{method:'POST',visitor:'another-guest-123',body:{origin,remote_id,kind:'like',on:true}});
assert.equal(r.data.likes,1);
r=await call('/api/react/local-1',{method:'POST',visitor:'another-guest-123',body:{kind:'heart',on:true}});
assert.equal(r.data.hearts,1);
r=await call('/api/reaction-state?id=local-1',{visitor:'another-guest-123'});
assert.equal(r.data.hearts,1);assert.equal(r.data.my_heart,1);
assert.equal((await call('/api/reaction-state?id=nonexistent')).code,404);
assert.equal((await call('/api/reaction-state?origin=https://unapproved.test&remote_id=remote-1')).code,404);
// Signed-in visitors are equally able to vote on peer songs.
const token='signed_in_session_token', digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(b=>b.toString(16).padStart(2,'0')).join('');
await DB.prepare('INSERT INTO user_accounts(id,username,salt,hash,created_at) VALUES(?,?,?,?,?)').bind('user1','alice','salt','hash',Date.now()).run();
await DB.prepare('INSERT INTO sessions(token,expires,role,user_id) VALUES(?,?,?,?)').bind(digest,Date.now()+3600000,'user','user1').run();
r=await call('/api/peer-react',{method:'POST',cookie:token,visitor:'signed-in-visitor-123',body:{origin,remote_id,kind:'heart',on:true}});
assert.equal(r.code,200);assert.equal(r.data.hearts,2);
const linked=await DB.prepare("SELECT COUNT(*) AS n FROM user_song_reactions WHERE user_id='user1' AND kind='heart'").first();assert.equal(linked.n,1);
console.log('PASS: local and peer reaction-state, anonymous and signed-in votes, immediate counts, unknown-peer rejection');
