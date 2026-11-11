import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createPeerRelay, allowedResource} from '../docker/peer-relay.mjs';

async function listen(server) {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
async function close(server) { await new Promise(resolve=>server.close(resolve)); }
const track = {id:'song-1', title:'Remote Music',artist:'Example'};
const AUDIO=Buffer.from('abcdef0123456789');

test('same-origin relay: discovery, artwork, range, copy metadata, and security checks',async()=>{
  let requestCount=0, leakedCredentials=false;
  const peer=http.createServer((req,res)=>{
    requestCount++;
    if(req.headers.cookie || req.headers.authorization) leakedCredentials=true;
    if(req.url==='/api/tracks') {
      res.writeHead(200,{'content-type':'application/json'});
      return res.end(JSON.stringify([track]));
    }
    if(req.url==='/api/playlists')return res.end(JSON.stringify([{id:'playlist-1',name:'Remote mix',tracks:['song-1']}])) ;
    if(req.url==='/api/user-playlists')return res.end(JSON.stringify([{id:'pub-1',username:'tester',tracks:['song-1'],cover_url:'/art/user-playlist/pub-1'}]));
    if(req.url==='/art/user-playlist/pub-1') {
      res.writeHead(200,{'content-type':'image/png','content-length':4});return res.end('ART!');
    }
    if(req.url==='/art/album?artist=Example&album=Music') {
      res.writeHead(200,{'content-type':'image/jpeg'});return res.end('IMG');
    }
    if(req.url==='/audio/song-1') {
      if(req.headers.range==='bytes=2-6') {
        res.writeHead(206,{'content-type':'audio/mpeg','accept-ranges':'bytes','content-range':`bytes 2-6/${AUDIO.length}`,'content-length':5});
        return res.end(AUDIO.subarray(2,7));
      }
      res.writeHead(200,{'content-type':'audio/mpeg','accept-ranges':'bytes','content-length':AUDIO.length});
      return res.end(AUDIO);
    }
    if(req.url==='/audio/redirect') {res.writeHead(302,{location:'https://untrusted.example/private'});return res.end();}
    res.writeHead(404);res.end();
  });
  const peerBase=await listen(peer);
  const worker=http.createServer((req,res)=>{
    if(req.url==='/api/network/peers'){
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify([{id:'federation-1',url:peerBase,name:'Cloudflare via bridge',track_count:1328}]));
      return;
    }
    res.writeHead(404);res.end();
  });
  const workerBase=await listen(worker);
  const relay=createPeerRelay({worker:workerBase,ttlMs:100,originAliases:{'https://music.playy.online':peerBase}});
  const gateway=http.createServer(async(req,res)=>{
    if(!(await relay.handle(req,res))){res.writeHead(418);res.end('Not a relay URL');}
  });
  const gatewayBase=await listen(gateway);
  try {
    const registry=await (await fetch(gatewayBase+'/api/network/peers')).json();
    assert.equal(registry.length,1);
    assert.equal(registry[0].relay_base,'/_peer/federation-1');
    assert.deepEqual(registry[0].origin_aliases,['https://music.playy.online']);
    const base=gatewayBase+registry[0].relay_base;
    let r=await fetch(base+'/api/tracks',{headers:{cookie:'riffvault_session=secret',authorization:'Bearer no'}});
    assert.equal(r.status,200);
    assert.deepEqual(await r.json(),[track]);
    r=await fetch(base+'/api/playlists');assert.equal((await r.json())[0].tracks[0],'song-1');
    r=await fetch(base+'/api/user-playlists');assert.equal((await r.json())[0].username,'tester');
    r=await fetch(base+'/art/user-playlist/pub-1');assert.equal(await r.text(),'ART!');
    r=await fetch(base+'/art/album?artist=Example&album=Music');assert.equal(await r.text(),'IMG');
    r=await fetch(base+'/audio/song-1',{headers:{range:'bytes=2-6'}});
    assert.equal(r.status,206);assert.equal(r.headers.get('content-range'),`bytes 2-6/${AUDIO.length}`);
    assert.equal(r.headers.get('accept-ranges'),'bytes');assert.equal(await r.text(),'cdef0');
    r=await fetch(base+'/audio/song-1',{method:'HEAD'});assert.equal(r.status,200);assert.equal(await r.text(),'');
    r=await fetch(base+'/audio/redirect');assert.equal(r.status,502);
    assert.equal((await r.json()).error,'Peer redirected outside its allowed origin');
    const before=requestCount;
    for(const url of [base+'/api/admin/tracks',base+'/api/secret',base+'/audio/%2Fetc%2Fpasswd',gatewayBase+'/_peer/unknown/api/tracks']) {
      r=await fetch(url);assert.equal(r.status,404,url);
    }
    assert.equal(requestCount,before,'Disallowed resources must never contact peer');
    r=await fetch(base+'/api/tracks',{method:'POST'});assert.equal(r.status,405);
    assert.equal(leakedCredentials,false,'Never leak browser session to remote peer');
    r=await fetch(gatewayBase+'/api/network/peers',{method:'POST'});assert.equal(r.status,405);
    assert.equal((await fetch(gatewayBase+'/normal-path')).status,418);
  } finally {await close(gateway);await close(worker);await close(peer);}
});

test('allowlisted endpoints exclude administrative, mutating, and arbitrary resources',()=>{
  assert(allowedResource('/art/artist'));
  assert(allowedResource('/art/user-playlist/my-id'));
  assert(!allowedResource('/api/admin/network/peers'));
  assert(!allowedResource('/api/user/playlists'));
  assert(!allowedResource('/audio/../../etc/passwd'));
  assert(!allowedResource('/api/tracks/anything'));
});
