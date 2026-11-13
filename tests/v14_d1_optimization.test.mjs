// WASP v14: non-destructive schema migration, indexed artist membership,
// public-only edge caching and invalidation. Requires Node >= 22.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const sql = new DatabaseSync(':memory:');
let statements=[];
class Prepared {
  constructor(text,args=[]){this.text=text;this.args=args;}
  bind(...args){return new Prepared(this.text,args);}
  async run(){statements.push(this.text);const a=sql.prepare(this.text).run(...this.args);return {meta:{changes:a.changes}};}
  async first(){statements.push(this.text);return sql.prepare(this.text).get(...this.args)||null;}
  async all(){statements.push(this.text);return {results:sql.prepare(this.text).all(...this.args)};}
}
const DB={prepare:text=>new Prepared(text),batch:async(stmts)=>{
  sql.exec('BEGIN');try{const result=[];for(const x of stmts)result.push(await x.run());sql.exec('COMMIT');return result;}
  catch(e){sql.exec('ROLLBACK');throw e;}
}};
// Pre-existing v13 catalogue: no artist map, no schema marker, no modifications
// to the original tracks are permitted during migration.
sql.exec(`CREATE TABLE tracks (id TEXT PRIMARY KEY,title TEXT NOT NULL,artist TEXT NOT NULL,artists TEXT,album TEXT NOT NULL,track_no INTEGER DEFAULT 0,duration REAL DEFAULT 0,size INTEGER DEFAULT 0,plays INTEGER DEFAULT 0,created_at INTEGER NOT NULL,hash TEXT);
INSERT INTO tracks(id,title,artist,artists,album,created_at) VALUES
 ('t-ac','Thunderstruck','AC/DC',NULL,'The Razors Edge',1),
 ('t-feat','Collaboration','Alpha feat. Beta', '["Alpha","Beta"]','Collaborations',2),
 ('t-both','Together','Tyler, The Creator','["Tyler, The Creator"]','Record',3);`);
const MEDIA={get:async()=>null,delete:async()=>{},put:async()=>{},list:async()=>({objects:[],truncated:false})};
const env={DB,MUSIC:MEDIA,ASSETS:{fetch:async()=>new Response('404',{status:404})},SCANNER_SECRET:'scanner-test'};
const entry=pathToFileURL(new URL('../src/index.js',import.meta.url).pathname).href;
const worker=(await import(entry+'?v14-test=first')).default;
const waitFor=[];
const ctx={waitUntil(p){waitFor.push(p)}};
const call=async (w,path,method='GET',body,headers={}) => {
  const res=await w.fetch(new Request('https://wasp.test'+path,{method,headers:{...headers,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env,ctx);
  return {res,json:await res.clone().json().catch(()=>null)};
};
let first=await call(worker,'/api/tracks');
assert.equal(first.res.status,200,JSON.stringify(first.json));
assert.equal(first.json.length,3);
assert.equal(sql.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'15');
assert.equal(sql.prepare('SELECT count(*) AS n FROM track_artist_map').get().n,4,'multi-artist backfill preserves all contributors');
assert.equal(sql.prepare('SELECT artist FROM tracks WHERE id=?').get('t-ac').artist,'AC/DC','migration never rewrites tracks');
const indexPlan=sql.prepare("EXPLAIN QUERY PLAN SELECT 1 FROM track_artist_map WHERE artist_key='ac dc' LIMIT 1").all();
assert.ok(indexPlan.some(x=>x.detail.includes('USING') && x.detail.includes('INDEX')),'artist lookup must use index');
// Probe expensive high-level API endpoints that gate on libraryHasArtist. A hit
// must no longer execute the old full-table instr(artist,...) expression.
statements=[];
const q1=await call(worker,'/api/bio?name=Nobody');
assert.equal(q1.res.status,404);
assert.ok(statements.some(x=>x.includes('FROM track_artist_map WHERE artist_key')));
assert.ok(!statements.some(x=>x.includes('instr(artist')),'old substring scan must be removed');
// New Worker isolate should read only one schema marker, not repeat ALTER TABLE.
statements=[];
const worker2=(await import(entry+'?v14-test=second')).default;
await call(worker2,'/api/tracks');
assert.equal(statements.filter(x=>/^ALTER TABLE/i.test(x)).length,0,'normal startup must not retry schema upgrades');
assert.equal(statements.filter(x=>/CREATE TABLE/i.test(x)).length,0,'normal startup must not retry CREATE TABLE');
// The local folder scanner must maintain the index without music file changes.
const scan=await call(worker,'/api/internal/folder-index','POST',{
  tracks:[{id:'folder-'+ 'a'.repeat(40),title:'From folder',artist:'Artist A feat. Artist B',album:'Test Album'}]
},{'x-scanner-secret':'scanner-test'});
assert.equal(scan.res.status,200,JSON.stringify(scan.json));
const scannerNames=sql.prepare('SELECT artist_key FROM track_artist_map WHERE track_id = ? ORDER BY artist_key').all('folder-'+ 'a'.repeat(40)).map(r=>r.artist_key);
assert.deepEqual(scannerNames,['artist a','artist b']);
// Cloudflare-like cache mock. The actual Cache API preserves TTL; here we check
// that public JSON avoids D1 while private/admin pages never enter the cache.
const records=new Map();let readHits=0;
globalThis.caches={default:{
  async match(request){const r=records.get(request.url);if(r){readHits++;return r.clone();}return null;},
  async put(request,response){records.set(request.url,response.clone());},
  async delete(request){return records.delete(request.url);}
}};
const worker3=(await import(entry+'?v14-test=third')).default;
statements=[];
const miss=await call(worker3,'/api/tracks');await Promise.all(waitFor.splice(0));
assert.equal(miss.res.headers.get('x-wasp-cache'),'MISS');
assert.ok(statements.some(x=>x.includes('FROM tracks t')));
statements=[];
const hit=await call(worker3,'/api/tracks');
assert.equal(hit.res.headers.get('x-wasp-cache'),'HIT');
assert.ok(readHits>=1);
assert.equal(statements.length,0,'cache hit must bypass all D1 work, including network sharing');
const privateRes=await call(worker3,'/api/me');
assert.notEqual(privateRes.res.headers.get('x-wasp-cache'),'HIT');
assert.ok(!records.has('https://wasp.test/api/me?__wasp_cache=wasp-v15-0&v='));
// Real administrative writes must invalidate corresponding public responses.
const token='testv14';
const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))].map(v=>v.toString(16).padStart(2,'0')).join('');
sql.prepare('INSERT INTO sessions(token,expires,role,user_id) VALUES (?,?,?,?)').run(hash,Date.now()+100000,'admin',null);
const priorSite=await call(worker3,'/api/site');await Promise.all(waitFor.splice(0));
const changed=await call(worker3,'/api/admin/settings','PUT',{site_name:'WASP v14 Test'},{cookie:'sid='+token});
assert.equal(changed.res.status,200,JSON.stringify(changed.json));await Promise.all(waitFor.splice(0));
const after=await call(worker3,'/api/site');
assert.equal(after.json.name,'WASP v14 Test','updated site name must bypass stale public cache');
assert.equal(after.res.headers.get('x-wasp-cache'),'MISS');
assert.ok(records.has('https://wasp.test/api/tracks?__wasp_cache=wasp-v15-0&v='));
// New reactions summary, which avoids fetching the entire tracks catalogue.
sql.prepare('INSERT INTO reactions(track_id,voter,kind) VALUES (?,?,?)').run('t-ac','someone','like');
const totals=await call(worker3,'/api/track-reaction-counts');
assert.ok(totals.json.some(t=>t.id==='t-ac'&&t.likes===1));
console.log('PASS v14: old-data backfill, indexed artist lookup, multi-artist support, scanner maintenance, one-time schema, public cache HIT without D1, private cache exclusion, site invalidation, compact reaction totals');
// Admin track edits and deletes keep the artist map in sync and invalidate
// cached catalogues, while leaving all unrelated music and user data intact.
const edit=await call(worker3,'/api/admin/tracks/t-feat','PATCH',{
  title:'Replaced',artist:'Gamma; Delta',album:'Other Album'
},{cookie:'sid='+token});
assert.equal(edit.res.status,200,JSON.stringify(edit.json));await Promise.all(waitFor.splice(0));
assert.deepEqual(sql.prepare('SELECT artist_key FROM track_artist_map WHERE track_id=? ORDER BY artist_key').all('t-feat').map(r=>r.artist_key),['delta','gamma']);
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM track_artist_map WHERE artist_key='alpha'").get().n,0);
assert.equal(records.has('https://wasp.test/api/tracks?__wasp_cache=wasp-v15-0&v='),false,'admin track edit invalidates cached public catalogue');
const removing=await call(worker3,'/api/admin/tracks/t-feat','DELETE',null,{cookie:'sid='+token});
assert.equal(removing.res.status,200,JSON.stringify(removing.json));
assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM track_artist_map WHERE artist_key='gamma'").get().n,0);
console.log('PASS v14: admin track updates/deletes synchronize the index, and mutations invalidate cached catalogues');
