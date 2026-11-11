import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {parseFile} from 'music-metadata';
import {proxyToWorker} from './proxy.mjs';
import {createPeerRelay} from './peer-relay.mjs';

const roots=(process.env.MUSIC_SCAN_PATHS||'/music').split(',').map(x=>x.trim()).filter(Boolean);
const port=Number(process.env.GATEWAY_PORT||8788), worker='http://127.0.0.1:8787';
const secret=process.env.SCANNER_SECRET;
const scanInterval=Math.max(60,Number(process.env.MUSIC_SCAN_INTERVAL||300))*1000;
const catalogue=new Map(), covers=new Map();
const peerRelay=createPeerRelay({worker});
const supported=/\.(mp3|flac|m4a|mp4|ogg|opus|wav|aac)$/i;
function fileId(p){return 'folder-'+crypto.createHash('sha1').update(p).digest('hex');}
async function walk(root,found){
 let entries;try{entries=await fs.promises.readdir(root,{withFileTypes:true});}catch{return;}
 for(const e of entries){
  const full=path.join(root,e.name);
  if(e.isSymbolicLink())continue;
  if(e.isDirectory()){await walk(full,found);continue;}
  if(!e.isFile()||!supported.test(e.name))continue;
  try{
   const stat=await fs.promises.stat(full),id=fileId(full);
   const previous=catalogue.get(id);
   if(previous&&previous.mtime===stat.mtimeMs&&previous.size===stat.size){found.set(id,previous);continue;}
   const meta=await parseFile(full,{duration:true,skipCovers:false});
   const pic=meta.common.picture?.[0];
   if(pic&&pic.data?.length<5e6)covers.set(id,{data:Buffer.from(pic.data),type:pic.format||'image/jpeg'});
   found.set(id,{id,path:full,mtime:stat.mtimeMs,size:stat.size,title:meta.common.title||path.parse(full).name,
    artist:meta.common.artist||meta.common.albumartist||'Unknown Artist',album:meta.common.album||'Unknown Album',
    duration:meta.format.duration||0,track_no:meta.common.track?.no||0});
  }catch(e){console.warn('Skipping unreadable file',full,e.message);}
 }
}
let scanning=false;
async function scan(){
 if(scanning)return;scanning=true;
 try{
  const found=new Map();for(const root of roots)await walk(root,found);
  for(const id of catalogue.keys())if(!found.has(id))covers.delete(id);
  catalogue.clear();for(const [id,t] of found)catalogue.set(id,t);
  const all=[...catalogue.values()];
  for(let i=0;i<all.length;i+=250){
   const response=await fetch(worker+'/api/internal/folder-index',{method:'POST',headers:{'content-type':'application/json','x-scanner-secret':secret},body:JSON.stringify({tracks:all.slice(i,i+250)})});
   if(!response.ok)throw Error('Index update failed: '+response.status+' '+await response.text());
  }
  console.log('Indexed',all.length,'server-folder songs');
 }catch(e){console.error('Scanner error',e);}finally{scanning=false;}
}
function streamFile(req,res,t){
 let start=0,end=t.size-1;const match=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range||'');
 if(match){start=match[1]?Number(match[1]):0;end=match[2]?Number(match[2]):end;
  if(!match[1]&&match[2]){start=Math.max(0,t.size-Number(match[2]));end=t.size-1;}}
 if(start>end||end>=t.size){res.writeHead(416,{'content-range':`bytes */${t.size}`});res.end();return;}
 const ext=path.extname(t.path).toLowerCase();const types={'.mp3':'audio/mpeg','.flac':'audio/flac','.m4a':'audio/mp4','.mp4':'audio/mp4','.ogg':'audio/ogg','.opus':'audio/ogg','.wav':'audio/wav','.aac':'audio/aac'};
 res.writeHead(match?206:200,{'content-type':types[ext]||'application/octet-stream','accept-ranges':'bytes','content-length':end-start+1,...(match?{'content-range':`bytes ${start}-${end}/${t.size}`}:{})});
 if(req.method==='HEAD'){res.end();return;}fs.createReadStream(t.path,{start,end}).on('error',()=>res.destroy()).pipe(res);
}
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://localhost');
 if(u.pathname==='/api/local/scan'&&req.method==='POST'){res.writeHead(404);res.end();return;}
 if(u.pathname.startsWith('/audio/folder-')){
  const t=catalogue.get(u.pathname.slice(7));if(!t){res.writeHead(404);res.end();return;}streamFile(req,res,t);return;
 }
 if(u.pathname==='/art/track'&&u.searchParams.get('id')?.startsWith('folder-')){
  const cover=covers.get(u.searchParams.get('id'));if(!cover){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'content-type':cover.type,'cache-control':'public, max-age=3600'});res.end(cover.data);return;
 }
 try { if (await peerRelay.handle(req,res)) return; }
 catch (error) { console.error('Peer relay error',error.message); if(!res.headersSent)res.writeHead(502);res.end();return; }
 // Wrangler HTML, audio and assets must be streamed without decompression.
 proxyToWorker(req,res);
});
server.listen(port,'127.0.0.1',()=>console.log('RiffVault gateway listening on',port));
setTimeout(scan,7000);setInterval(scan,scanInterval);
