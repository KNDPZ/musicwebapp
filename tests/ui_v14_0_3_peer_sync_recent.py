"""Browser checks for WASP 14.0.3: admin peer sync and Recently listened."""
import re
from pathlib import Path
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1]/'public'
css=(P/'style.css').read_text()
admin=(P/'admin.html').read_text().replace('<link rel="stylesheet" href="/style.css">',f'<style>{css}</style>')
admin=re.sub(r'<script[^>]*src="/admin.js(?:\?v=[^"]+)?"[^>]*></script>','',admin)
admin_js=re.sub(r'^import .*?;\n','',(P/'admin.js').read_text(),flags=re.M)
front=(P/'index.html').read_text().replace('<head>','<head><base href="https://wasp-demo.invalid/">').replace('<link rel="stylesheet" href="/style.css">',f'<style>{css}</style>')
front=re.sub(r'<script[^>]*src="/app.js(?:\?v=[^"]+)?"[^>]*></script>','',front)
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app_js=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=3,flags=re.M)
bbcode_js=re.sub(r'^export function ', 'function ', (P/'sidebar-bbcode.js').read_text(), flags=re.M)
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1280,'height':850});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank');page.set_content(admin)
 page.evaluate('location.hash="#network"')
 page.evaluate('''window.__phases=[];window.__saved=null;
 window.fetch=async(url,opts={})=>{
  url=String(url);let data=[];
  if(url==='/api/me')data={admin:true,authenticated:true};
  else if(url==='/api/admin/version')data={version:'14.0.3',label:'Peer Sync & Recently Listened'};
  else if(url==='/api/admin/network')data={share:true,peers:[{id:'p1',name:'WASP Bridge',url:'http://100.107.221.71:8081',track_count:1467,last_ok:Date.now()}]};
  else if(url==='/api/admin/crons'){
   if(opts.method==='PUT'){window.__saved=JSON.parse(opts.body);data={ok:true,config:window.__saved};}
   else data={timezone:'Asia/Manila',jobs:{peers:{enabled:false,frequency:'daily',time:'02:00',weekday:0,monthday:1,sync_catalogue:false},artwork:{enabled:false},biography:{enabled:false}}};
  }
  else if(url==='/api/admin/network/peers/p1/refresh')data={ok:true,name:'WASP Bridge',track_count:1468};
  else if(url==='/api/admin/network/peers/p1/sync'){
    const p=JSON.parse(opts.body).phase;window.__phases.push(p);
    data={ok:true,phase:p,count:({tracks:1468,playlists:20,users:4,finish:0})[p]};
  }
  else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,ad:{enabled:false,html:'',height:340}};
  return Response.json(data);
 };''')
 page.evaluate('(script)=>(0,eval)(script)',bbcode_js+'\n'+admin_js)
 page.get_by_role('button',name='Cloud sync metadata').wait_for(timeout=12000)
 page.get_by_role('button',name='Cloud sync metadata').click()
 page.get_by_text('Complete: 1468 songs, 20 server playlists, 4 user playlists.').wait_for()
 assert page.locator('#netSyncBar').evaluate('(el)=>el.value')==100
 assert page.evaluate('window.__phases')==['tracks','playlists','users','finish']
 assert page.locator('#adminBuild').inner_text().startswith('WASP v14.0.3')
 page.get_by_role('tab',name='Crons').click()
 page.locator('[data-cron="peers"][data-field="sync_catalogue"]').check()
 page.locator('[data-cron="peers"][data-field="enabled"]').check()
 page.get_by_role('button',name='Save schedules').click()
 page.get_by_text('Schedules saved successfully.').wait_for()
 assert page.evaluate('window.__saved.jobs.peers.sync_catalogue') is True
 assert not errors,errors

 front_page=browser.new_page(viewport={'width':1300,'height':850});front_errors=[]
 front_page.on('pageerror',lambda e:front_errors.append(str(e)))
 front_page.goto('about:blank');front_page.set_content(front)
 front_page.evaluate('location.hash="#listened"')
 front_page.evaluate('''window.__requests=[];window.__peer='http://100.107.221.71:8081';window.__peerRev='aaaaaaaa';
 window.fetch=async(url,opts={})=>{
   url=String(url);window.__requests.push(url);
   const rev='aaaaaaaa';let data=[],status=200;
   if(url==='/api/catalog-version')data={revision:rev};
   else if(url.startsWith('/api/tracks'))data=[];
   else if(url.startsWith('/api/playlists'))data=[];
   else if(url==='/api/network/peers')data=[{id:'p1',name:'Bridge',url:window.__peer,relay_base:'/_peer/p1',origin_aliases:['https://music.playy.online']}];
   else if(url==='/api/peer-catalogue')data=[{origin:window.__peer,revision:'aaaaaaaa',synced_at:Date.now(),tracks:[{id:'r1',title:'Synced peer song',artist:'Peer Artist',artists:['Peer Artist'],album:'Album',duration:180,created_at:1}],playlists:[{id:'pl1',name:'Newly synced playlist',tracks:['r1']}],users:[]}];
   else if(url==='/api/user-playlists')data=[];
   else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,show_brand_icon:false,ad:{enabled:false,html:'',height:340}};
   else if(url==='/api/entity-reactions')data={artist:{},playlist:{}};
   else if(url==='/api/me')data={authenticated:false,admin:false};
   else if(url==='/api/user/peer-tracks'){status=401;data={error:'Sign in required'};}
   else if(url==='/api/recent-listens')data=[];
   else if(url==='/_peer/p1/api/recent-listens')data=[{track_id:'r1',remote_id:'r1',title:'Synced peer song',artist:'Peer Artist',album:'Album',played_at:Date.now(),plays:5}];
   else if(url==='/_peer/p1/api/peer-plays')data=[];
   else if(url==='/_peer/p1/api/catalog-version')data={revision:window.__peerRev};
   else if(url.startsWith('/_peer/p1/api/tracks?'))data=[{id:'r2',title:'Newest live song',artist:'Peer Artist',artists:['Peer Artist'],album:'Album',duration:160,created_at:10}];
   else if(url.startsWith('/_peer/p1/api/playlists?'))data=[{id:'pl2',name:'Newest live playlist',tracks:['r2']}];
   else if(url.startsWith('/_peer/p1/api/user-playlists?'))data=[];
   else if(url==='/api/peer-plays')data=[];
   else data=[];
   return Response.json(data,{status});
 };''')
 front_page.evaluate('(script)=>(0,eval)(script)',art+'\n'+radio+'\n'+app_js)
 front_page.get_by_text('Synced peer song',exact=True).first.wait_for(timeout=12000)
 front_page.get_by_text('Recently listened',exact=True).first.wait_for()
 assert '5 plays' in front_page.locator('#list').inner_text()
 assert '/_peer/p1/api/recent-listens' in front_page.evaluate('window.__requests')
 front_page.evaluate('location.hash="#playlists/peer"')
 front_page.get_by_text('Newly synced playlist',exact=True).wait_for(timeout=12000)
 assert not any('/_peer/p1/api/tracks' in x for x in front_page.evaluate('window.__requests')), 'Synced tracks should load from the local snapshot'
 front_page.evaluate('window.__peerRev="bbbbbbbb";window.dispatchEvent(new StorageEvent("storage",{key:"wasp_peer_sync"}))')
 front_page.get_by_text('Newest live playlist',exact=True).wait_for(timeout=12000)
 assert any('/_peer/p1/api/tracks?v=bbbbbbbb' in x for x in front_page.evaluate('window.__requests')), 'Changed peer revision must bypass the stale local snapshot'
 assert not front_errors,front_errors
 browser.close()
print('PASS WASP 14.0.3 browser: cloud sync progress, admin version, cron sync checkbox, local snapshot playlist, federated Recently listened')
