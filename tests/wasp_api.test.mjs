// WASP v13: branding defaults, account-linked reaction statistics, and admin-only visibility.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
const sqlite = new DatabaseSync(':memory:');
class Stmt {
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Stmt(this.sql,args);}
  async run(){return sqlite.prepare(this.sql).run(...this.args);}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
}
const DB={prepare:s=>new Stmt(s),batch:async statements=>{sqlite.exec('BEGIN');try{for(const s of statements)await s.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{}},ASSETS:{fetch:async()=>new Response('no')}};
const sha=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const req=async(path,{method='GET',body,cookie='',headers={}}={})=>{
  const r=await worker.fetch(new Request('https://wasp.example'+path,{method,body:body?JSON.stringify(body):undefined,headers:{...headers,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie:`sid=${cookie}`}:{})}}),env,{});
  return {code:r.status,json:await r.json()};
};
assert.equal((await req('/api/site')).json.name,'WASP','Fresh installs default to WASP');
const userToken='user-v13-test',adminToken='admin-v13-test';
await DB.prepare('INSERT INTO user_accounts (id,username,salt,hash,created_at) VALUES (?,?,?,?,?)').bind('u1','reviewer','salt','hash',100).run();
for (const [token,role,id] of [[userToken,'user','u1'],[adminToken,'admin',null]])await DB.prepare('INSERT INTO sessions (token,expires,role,user_id) VALUES (?,?,?,?)').bind(await sha(token),Date.now()+600000,role,id).run();
await DB.prepare('INSERT INTO tracks(id,title,artist,album,created_at) VALUES (?,?,?,?,?)').bind('t1','Song','Artist','Album',200).run();
await DB.prepare('INSERT INTO user_playlists(id,user_id,name,is_public,created_at) VALUES (?,?,?,?,?)').bind('p1','u1','Private Mix',0,100).run();
await DB.prepare('INSERT INTO user_playlists(id,user_id,name,is_public,created_at) VALUES (?,?,?,?,?)').bind('p2','u1','Public Mix',1,100).run();
assert.equal((await req('/api/admin/users')).code,403,'Unauthenticated users denied');
assert.equal((await req('/api/admin/users',{cookie:userToken})).code,403,'Regular users denied');
const vote=(kind,on=true)=>req('/api/react/t1',{method:'POST',cookie:userToken,headers:{'X-Visitor':'visitor123'},body:{kind,on}});
assert.equal((await vote('heart')).code,200);
assert.equal((await vote('like')).code,200);
let users=await req('/api/admin/users',{cookie:adminToken});
assert.equal(users.code,200);
assert.deepEqual({name:users.json[0].username,hearts:users.json[0].heart_songs,likes:users.json[0].like_songs,private:users.json[0].private_playlists,public:users.json[0].public_playlists},
 {name:'reviewer',hearts:1,likes:1,private:1,public:1});
await vote('like',false);users=await req('/api/admin/users',{cookie:adminToken});assert.equal(users.json[0].like_songs,0);
assert.equal((await req('/api/admin/settings',{method:'PUT',cookie:adminToken,body:{site_name:'WASP',show_brand_icon:true}})).json.show_brand_icon,true);
assert.equal((await req('/api/site')).json.show_brand_icon,true);
assert.equal((await req('/api/admin/settings',{method:'PUT',cookie:userToken,body:{site_name:'Fake'}})).code,403);
console.log('PASS: WASP branding, admin-only user stats, counts, reaction updates and settings');
