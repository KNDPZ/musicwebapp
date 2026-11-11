import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import zlib from 'node:zlib';
import { proxyToWorker } from '../docker/proxy.mjs';
async function open(s) { await new Promise(resolve=>s.listen(0,'127.0.0.1',resolve)); return s.address().port; }
async function close(s) { await new Promise(resolve=>s.close(resolve)); }

test('Wrangler proxy preserves compressed HTML content-length and binary data',async()=>{
  const html=Buffer.from('<!doctype html><html><body>RiffVault v13</body></html>');
  const gz=zlib.gzipSync(html);
  let seenUpload='';
  const worker=http.createServer((req,res)=>{
    if(req.url==='/'){
      res.writeHead(200,{'content-type':'text/html','content-encoding':'gzip','content-length':gz.length});
      return res.end(gz);
    }
    if(req.url==='/upload' && req.method==='POST') {
      const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
        seenUpload=Buffer.concat(chunks).toString();
        res.writeHead(200,{'content-type':'text/plain'});res.end('saved');
      });return;
    }
    res.writeHead(404);res.end('Not found');
  });
  const workerPort=await open(worker);
  const proxy=http.createServer((req,res)=>proxyToWorker(req,res,{port:workerPort}));
  const proxyPort=await open(proxy);
  try{
    // Inspect raw bytes with http.get. Node fetch() transparently decompresses.
    const result=await new Promise((resolve,reject)=>http.get(`http://127.0.0.1:${proxyPort}/`,res=>{
      const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,data:Buffer.concat(chunks)}));
    }).on('error',reject));
    assert.equal(result.status,200);
    assert.equal(result.headers['content-length'],String(gz.length));
    assert.equal(result.headers['content-encoding'],'gzip');
    assert.deepEqual(result.data,gz);
    assert.deepEqual(zlib.gunzipSync(result.data),html);
    const uploaded=await fetch(`http://127.0.0.1:${proxyPort}/upload`,{method:'POST',body:'hello-upload'});
    assert.equal(uploaded.status,200);assert.equal(await uploaded.text(),'saved');
    assert.equal(seenUpload,'hello-upload');
  }finally{await close(proxy);await close(worker);}
});
