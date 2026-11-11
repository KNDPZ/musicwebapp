// WASP v13 regression: peer playlist, user playlist and artist votes rank locally.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';
const sql=new DatabaseSync(':memory:');
class Statement { constructor(q,values=[]){this.q=q;this.values=values} bind(...v){return new Statement(this.q,v)} async run(){return sql.prepare(this.q).run(...this.values)} async first(){return sql.prepare(this.q).get(...this.values)||null} async all(){return {results:sql.prepare(this.q).all(...this.values)}} }
const DB={prepare:q=>new Statement(q),batch:async list=>{sql.exec('BEGIN');try{for(const q of list)await q.run();sql.exec('COMMIT')}catch(e){sql.exec('ROLLBACK');throw e}}};
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{}},ASSETS:{fetch:async()=>new Response('404',{status:404})}};
async function request(path,{method='GET',body,visitor='vis-abcdef123456',cookie=''}={}){
 const res=await worker.fetch(new Request('https://wasp.test'+path,{method,headers:{'X-Visitor':visitor,...(body?{'content-type':'application/json'}:{}),...(cookie?{cookie:`sid=${cookie}`}:{})},body:body?JSON.stringify(body):undefined}),env,{});
 return {status:res.status,data:await res.json()};
}
// Simulate an installation upgrading from v12 with previously stored playlist hearts.
sql.exec("CREATE TABLE playlist_hearts (playlist_id TEXT NOT NULL, voter TEXT NOT NULL, PRIMARY KEY(playlist_id,voter))");
sql.prepare('INSERT INTO playlist_hearts(playlist_id,voter) VALUES (?,?)').run('local-1','legacy-old-visitor');
await request('/api/tracks');
const origin='http://100.107.221.71:8081', remoteId='pl-12345',key=origin+'|'+remoteId;
await DB.prepare('INSERT INTO peers(id,url,name,added_at) VALUES (?,?,?,?)').bind('bridge',origin,'Bridge',Date.now()).run();
await DB.prepare('INSERT INTO playlists(id,name,created_at) VALUES (?,?,?)').bind('local-1','Local Mix',1).run();
await DB.prepare('INSERT INTO user_accounts(id,username,salt,hash,created_at) VALUES (?,?,?,?,?)').bind('u1','Jane','salt','hash',2).run();
await DB.prepare('INSERT INTO user_playlists(id,user_id,name,is_public,created_at) VALUES (?,?,?,?,?)').bind('public-1','u1','Public Mix',1,3).run();
await DB.prepare('INSERT INTO user_playlists(id,user_id,name,is_public,created_at) VALUES (?,?,?,?,?)').bind('private-1','u1','Private Mix',0,3).run();
await DB.prepare('INSERT INTO tracks(id,title,artist,album,created_at) VALUES (?,?,?,?,?)').bind('tr-1','Local Song','Local Band','Album',3).run();
// Existing old hearts must survive a non-destructive data migration; the new
// endpoint must not create or remove actual track records.
const local=await request('/api/react-entity',{method:'POST',body:{type:'playlist',key:'local-1',kind:'like',on:true}});
assert.equal(local.status,200);
assert.equal(local.data.likes,1);
const pub=await request('/api/react-entity',{method:'POST',body:{type:'playlist',key:'public-1',kind:'dislike',on:true}});
assert.equal(pub.status,200);
assert.equal(pub.data.dislikes,1);
const peer=await request('/api/react-entity',{method:'POST',body:{type:'playlist',key,origin,name:'Bruno Mars Radio',kind:'heart',on:true,cover_url:origin+'/art/playlist?id=pl-12345',track_count:50}});
assert.equal(peer.status,200);
assert.equal(peer.data.hearts,1);
const other=await request('/api/react-entity',{method:'POST',visitor:'vis-other123456',body:{type:'playlist',key,origin,name:'Bruno Mars Radio',kind:'like',on:true,track_count:50}});
assert.equal(other.status,200);
assert.deepEqual([other.data.hearts,other.data.likes],[1,1]);
const artist=await request('/api/react-entity',{method:'POST',body:{type:'artist',key:'Peer Band',origin,kind:'heart',on:true}});
assert.equal(artist.status,200);
const got=await request('/api/entity-reactions');
assert.equal(got.data.artist['Peer Band'].hearts,1);
assert.equal(got.data.playlist[key].hearts,1);
assert.equal(got.data.playlist[key].likes,1);
assert.equal(got.data.playlist['public-1'].dislikes,1);
assert.equal(got.data.playlist['local-1'].hearts,1,'legacy heart still counted');
const cached=got.data.playlist_meta.find(p=>p.id===key);
assert.equal(cached.name,'Bruno Mars Radio');assert.equal(cached.track_count,50);
assert.equal(cached.cover_url,origin+'/art/playlist?id=pl-12345');
// Toggling remote votes must not remove peer music or modify remote server.
const removed=await request('/api/react-entity',{method:'POST',body:{type:'playlist',key,origin,kind:'heart',on:false}});
assert.equal(removed.status,200);assert.equal(removed.data.hearts,0);
assert.equal((await request('/api/tracks')).data.length,1);
// Source origins must be configured, not arbitrary targets.
assert.equal((await request('/api/react-entity',{method:'POST',body:{type:'playlist',key:'https://evil.example|x',origin:'https://evil.example',kind:'heart',on:true}})).status,404);
assert.equal((await request('/api/react-entity',{method:'POST',body:{type:'playlist',key:'private-1',kind:'heart',on:true}})).status,404);
assert.equal((await request('/api/react-entity',{method:'POST',body:{type:'artist',key:'Fabricated Artist',kind:'heart',on:true}})).status,404);
console.log('PASS: peer/local/public playlists and remote artists vote locally, legacy hearts preserved, private and unknown peers restricted');
