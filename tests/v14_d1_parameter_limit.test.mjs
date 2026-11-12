// Regression for WASP v14 launch failure on Cloudflare D1:
// D1 supports <=100 bound parameters per statement; 35 artist rows * 3 = 105.
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const sql = new DatabaseSync(':memory:');
let maxBinds=0;
class Prepared {
  constructor(query, args=[]) { this.query=query; this.args=args; }
  bind(...args) {
    maxBinds=Math.max(maxBinds,args.length);
    if(args.length>100) throw new Error(`D1_ERROR: too many SQL variables (${args.length})`);
    return new Prepared(this.query,args);
  }
  async run(){const v=sql.prepare(this.query).run(...this.args);return {meta:{changes:v.changes}};}
  async first(){return sql.prepare(this.query).get(...this.args)||null;}
  async all(){return {results:sql.prepare(this.query).all(...this.args)};}
}
const DB={prepare:q=>new Prepared(q),batch:async batch=>{
  sql.exec('BEGIN');
  try{const result=[];for (const st of batch)result.push(await st.run());sql.exec('COMMIT');return result;}
  catch(e){sql.exec('ROLLBACK');throw e;}
}};
sql.exec(`CREATE TABLE tracks(id TEXT PRIMARY KEY,title TEXT NOT NULL,artist TEXT NOT NULL,artists TEXT,album TEXT NOT NULL,track_no INTEGER DEFAULT 0,duration REAL DEFAULT 0,size INTEGER DEFAULT 0,plays INTEGER DEFAULT 0,created_at INTEGER NOT NULL,hash TEXT)`);
// >100 artist mappings force several backfill statements and would fail on
// the original 35-row batch even though a permissive local SQLite accepts it.
const ins=sql.prepare('INSERT INTO tracks(id,title,artist,artists,album,created_at) VALUES(?,?,?,?,?,?)');
for(let i=0;i<155;i++) ins.run(`t-${i}`,`Track ${i}`,'Singer A',JSON.stringify(['Singer A','Singer B']),`Album ${i%4}`,i);
const env={DB,MUSIC:{get:async()=>null,put:async()=>{},delete:async()=>{},list:async()=>({objects:[],truncated:false})},ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
const {default:worker}=await import('../src/index.js?test=d1limit');
const response=await worker.fetch(new Request('https://wasp.test/api/tracks'),env,{waitUntil(){}});
assert.equal(response.status,200,await response.text().catch(()=>''));
assert.equal(sql.prepare('SELECT COUNT(*) AS n FROM track_artist_map').get().n,310);
assert.equal(sql.prepare("SELECT value FROM settings WHERE key='wasp_schema_version'").get().value,'14.3');
assert.ok(maxBinds<=100,`exceeded D1 parameter limit: ${maxBinds}`);
const after=await worker.fetch(new Request('https://wasp.test/api/peer'),env,{waitUntil(){}});
assert.notEqual(after.status,500, "peer endpoint should not fail from repeated migration");
console.log(`PASS v14 D1 parameter limit: 155 tracks, 310 mappings, max ${maxBinds} bind variables`);
