import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker from '../src/index.js';

const sqlite = new DatabaseSync(':memory:');
class Stmt {
  constructor(sql, args = []) { this.sql = sql; this.args = args; }
  bind(...args) { return new Stmt(this.sql, args); }
  async run() { return sqlite.prepare(this.sql).run(...this.args); }
  async first() { return sqlite.prepare(this.sql).get(...this.args) || null; }
  async all() { return { results: sqlite.prepare(this.sql).all(...this.args) }; }
}
const DB = { prepare: sql => new Stmt(sql), batch: async statements => {
  sqlite.exec('BEGIN'); try { for (const s of statements) await s.run(); sqlite.exec('COMMIT'); }
  catch (e) { sqlite.exec('ROLLBACK'); throw e; }
}};
const env = { DB, MUSIC: {get: async()=>null,put:async()=>{},delete:async()=>{}}, ASSETS:{fetch:async()=>new Response('no')} };
const sha = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');
const adminToken='admin-spotify-test', userToken='user-spotify-test';
async function send(path, { method='GET', body, token, headers } = {}) {
  const r = await worker.fetch(new Request('https://wasp.example'+path, {method, headers: {
    ...(body?{'Content-Type':'application/json'}:{}), ...(token?{cookie:'sid='+token}:{}), ...headers
  }, body:body?JSON.stringify(body):undefined}), env, {});
  const raw = await r.text(); return { code:r.status, data:JSON.parse(raw), raw, headers:r.headers };
}
await send('/api/site');
for(const [token,role] of [[adminToken,'admin'],[userToken,'user']])
  await DB.prepare('INSERT INTO sessions(token,expires,role) VALUES (?,?,?)').bind(await sha(token),Date.now()+600000,role).run();
assert.equal((await send('/api/admin/spotify-config')).code,403);
assert.equal((await send('/api/admin/spotify-config',{token:userToken})).code,403);
assert.equal((await send('/api/admin/spotify-config',{method:'PUT',token:userToken,body:{client_id:'validclient123',client_secret:'validsecret123'}})).code,403);
const value = { client_id:'validclient123', client_secret:'validsecret123' };
let r=await send('/api/admin/spotify-config',{method:'PUT',token:adminToken,body:value});
assert.equal(r.code,503,'Cannot save without an encryption key');
assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM spotify_credentials').first()).n,0);
env.SCANNER_SECRET='very-long-persistent-server-secret-do-not-print';
r=await send('/api/admin/spotify-config',{method:'PUT',token:adminToken,body:value});
assert.equal(r.code,200,JSON.stringify(r));
assert.equal(r.data.saved_in_admin,true);
assert.equal(r.raw.includes(value.client_secret),false,'Never echo secret to client');
const saved = await DB.prepare('SELECT * FROM spotify_credentials WHERE id=1').first();
assert.equal(saved.client_id,value.client_id);
assert.match(saved.secret_cipher,/^v1:/);
assert.equal(saved.secret_cipher.includes(value.client_secret),false,'Never store plaintext secret');
r=await send('/api/admin/spotify-config',{token:adminToken});
assert.equal(r.code,200); assert.equal(r.data.secret_configured,true); assert.equal(r.data.client_id,value.client_id);
assert.equal(r.raw.includes(value.client_secret),false);
assert.equal(r.headers.get('cache-control'),'no-store');
let tokenCount=0; const oldFetch=globalThis.fetch;
globalThis.fetch=async(uri, opts)=>{
 if(String(uri).includes('accounts.spotify.com')) {
   tokenCount++;
   const encoded=opts.headers.authorization.split(' ')[1];
   assert.equal(atob(encoded),`${value.client_id}:${tokenCount===1?'validsecret123':'changedsecret456'}`);
   return new Response(JSON.stringify({access_token:'test-token'+tokenCount,expires_in:3600}),{status:200});
 }
 if(String(uri).includes('api.spotify.com/v1/search'))return new Response(JSON.stringify({playlists:{items:[]}}),{status:200});
 return oldFetch(uri,opts);
};
try {
 r=await send('/api/spotify/search-playlists?q=rock');assert.equal(r.code,200);
 r=await send('/api/spotify/search-playlists?q=pop');assert.equal(r.code,200);assert.equal(tokenCount,1);
 r=await send('/api/admin/spotify-config',{method:'PUT',token:adminToken,body:{client_id:value.client_id,client_secret:'changedsecret456'}});
 assert.equal(r.code,200);
 r=await send('/api/spotify/search-playlists?q=jazz');assert.equal(r.code,200);assert.equal(tokenCount,2,'Changing secret invalidates cached token');
}finally {globalThis.fetch=oldFetch;}
// Changing ID while omitting secret must preserve existing encrypted secret.
const oldCipher = (await DB.prepare('SELECT secret_cipher FROM spotify_credentials').first()).secret_cipher;
r=await send('/api/admin/spotify-config',{method:'PUT',token:adminToken,body:{client_id:'updatedclient123',client_secret:''}});
assert.equal(r.code,200);assert.equal((await DB.prepare('SELECT secret_cipher FROM spotify_credentials').first()).secret_cipher,oldCipher);
const originalKey=env.SCANNER_SECRET;env.SCANNER_SECRET='another-persistent-key-should-not-decrypt';
r=await send('/api/admin/spotify-config',{token:adminToken});assert.equal(r.data.locked,true);
assert.equal((await send('/api/spotify/search-playlists?q=rock')).code,503);
env.SCANNER_SECRET=originalKey;
r=await send('/api/admin/spotify-config',{method:'DELETE',token:adminToken});assert.equal(r.code,200);
assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM spotify_credentials').first()).n,0);
assert.equal((await send('/api/admin/spotify-config',{token:adminToken})).data.secret_configured,false);
// Environment configuration remains supported as a fallback.
env.SPOTIFY_CLIENT_ID='environmentclient123';env.SPOTIFY_CLIENT_SECRET='environmentsecret123';
r=await send('/api/admin/spotify-config',{token:adminToken});assert.equal(r.data.source,'environment');
assert.equal(r.raw.includes(env.SPOTIFY_CLIENT_SECRET),false);
console.log('PASS: admin-only Spotify settings, encrypted persistence, masked secret, search integration, key rotation failure, delete and environment fallback');
