// WASP v15.0.3: real MP3 APIC fallback, without modifying original audio.
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {extractEmbeddedArt} from '../src/embedded-art.js';
import worker from '../src/index.js';
const sqlite=new DatabaseSync(':memory:');
class Stmt {
 constructor(sql,args=[]){this.sql=sql;this.args=args;}
 bind(...args){return new Stmt(this.sql,args);}
 async run(){return sqlite.prepare(this.sql).run(...this.args);}
 async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
 async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
}
const DB={prepare:s=>new Stmt(s),batch:async ss=>{sqlite.exec('BEGIN');try{for(const q of ss)await q.run();sqlite.exec('COMMIT');}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const files=new Map();
const MUSIC={
 get:async (key,opts)=>{
  const f=files.get(key);if(!f)return null;
  const bytes=opts?.range?f.bytes.subarray(opts.range.offset||0,(opts.range.offset||0)+opts.range.length):f.bytes;
  return {customMetadata:f.customMetadata,httpMetadata:f.httpMetadata,
   body:new Response(bytes).body,arrayBuffer:async()=>bytes.slice().buffer,
   writeHttpMetadata:headers=>{if(f.httpMetadata?.contentType)headers.set('content-type',f.httpMetadata.contentType);}};
 },
 put:async(key,data,opts={})=>{files.set(key,{bytes:data instanceof Uint8Array?data:new Uint8Array(typeof data==='string'?new TextEncoder().encode(data):data),...opts});},
 delete:async(key)=>files.delete(key),list:async()=>({objects:[],truncated:false}),
};
function syncInt(n){return [n>>21&127,n>>14&127,n>>7&127,n&127];}
function mp3WithCover(image,kind=3){
 const mime=new TextEncoder().encode('image/jpeg');
 const apic=new Uint8Array([0,...mime,0,kind,0,...image]);
 const frame=new Uint8Array([65,80,73,67,apic.length>>>24,(apic.length>>>16)&255,(apic.length>>>8)&255,apic.length&255,0,0,...apic]);
 return new Uint8Array([73,68,51,3,0,0,...syncInt(frame.length),...frame,...new Uint8Array(200)]);
}
const image=new Uint8Array([255,216,255,224,...Array.from({length:44},(_,i)=>i+2),255,217]);
const audio=mp3WithCover(image);
assert.deepEqual(extractEmbeddedArt(audio)?.bytes,image);
assert.equal(extractEmbeddedArt(new Uint8Array(100)),null);
const withoutArt=new Uint8Array([73,68,51,3,0,0,0,0,0,10,...new Uint8Array(40)]);
assert.equal(extractEmbeddedArt(withoutArt),null);
// v2.4 uses synchsafe frame lengths.
const v4=audio.slice();v4[3]=4;const size=image.length+('image/jpeg'.length+4);
v4.set(syncInt(size),14);assert.deepEqual(extractEmbeddedArt(v4)?.bytes,image);
const id='86a5b219-e491-42fa-9b22-1f711533c7e2';
const env={DB,MUSIC,DEEZER_API:'https://stub-deezer.invalid',ASSETS:{fetch:async()=>new Response('not found',{status:404})}};
const nativeFetch=globalThis.fetch;
let onlineSearches=0;
globalThis.fetch=async(input,...args)=>{
 const url=String(input);if(url.startsWith('https://stub-deezer.invalid/')){
  onlineSearches++;return Response.json({data:[]});
 }
 return nativeFetch(input,...args);
};
try{
 const request=path=>worker.fetch(new Request('https://wasp.test'+path),env,{});
 assert.equal((await request('/api/tracks')).status,200);
 await MUSIC.put(id,audio,{httpMetadata:{contentType:'audio/mpeg'}});
 await DB.prepare('INSERT INTO tracks(id,title,artist,album,created_at) VALUES (?,?,?,?,?)').bind(id,'Song One','Test Artist','Test Album',100).run();
 await DB.prepare('INSERT INTO track_artist_map(track_id,artist_key,album) VALUES (?,?,?)').bind(id,'test artist','Test Album').run();
 // Existing "no art" cache entries must not prevent discovery of APIC covers.
 const albumKey='art/album/'+Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('test artist|test album')))).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24);
 await MUSIC.put(albumKey,'',{customMetadata:{source:'none',at:String(Date.now())}});
 const album=await request('/art/album?artist=Test%20Artist&album=Test%20Album');
 assert.equal(album.status,200);assert.equal(album.headers.get('content-type'),'image/jpeg');
 assert.deepEqual(new Uint8Array(await album.arrayBuffer()),image);
 assert.equal(files.get(albumKey).customMetadata.source,'embedded');
 assert.deepEqual(files.get(id).bytes,audio,'the original R2 MP3 must remain untouched');
 const single=await request('/art/track?id='+id);
 assert.equal(single.status,200);assert.deepEqual(new Uint8Array(await single.arrayBuffer()),image);
 const artist=await request('/art/artist?name=Test%20Artist');
 assert.equal(artist.status,200);assert.deepEqual(new Uint8Array(await artist.arrayBuffer()),image);
 const noSrc='c887f2e1-921b-4e1a-bb9a-d591c8056f70';
 await MUSIC.put(noSrc,withoutArt,{httpMetadata:{contentType:'audio/mpeg'}});
 await DB.prepare('INSERT INTO tracks(id,title,artist,album,created_at) VALUES (?,?,?,?,?)').bind(noSrc,'No art','Other Artist','',110).run();
 assert.equal((await request('/art/track?id='+noSrc)).status,404,'a file without embedded art may still need the placeholder');
 assert.ok(onlineSearches>0);
 console.log('PASS v15.0.3: track, album, artist APIC fallback, recovered negative cache, unchanged MP3 bytes, no-cover handling');
} finally {globalThis.fetch=nativeFetch;}
