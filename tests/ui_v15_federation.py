"""WASP v15 UI regression: primary peer locally represented, admin docs/branding/storage."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1]/'public'
css=(P/'style.css').read_text()
admin=(P/'admin.html').read_text().replace('<link rel="stylesheet" href="/style.css">',f'<style>{css}</style>')
admin=re.sub(r'<script[^>]*src="/admin.js(?:\?v=[^"]+)?"[^>]*></script>','',admin)
admin_js=re.sub(r'^import .*?;\n','',(P/'admin.js').read_text(),flags=re.M)
front=(P/'index.html').read_text().replace('<head>','<head><base href="https://wasp-v15.invalid/">').replace('<link rel="stylesheet" href="/style.css">',f'<style>{css}</style>')
front=re.sub(r'<script[^>]*src="/app.js(?:\?v=[^"]+)?"[^>]*></script>','',front)
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app_js=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=2,flags=re.M)
with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1350,'height':900});errors=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('about:blank');page.set_content(admin)
  page.evaluate('location.hash="#network"')
  page.evaluate('''window.__primarySaved='';window.fetch=async(url,opts={})=>{
    url=String(url);let data={},status=200;
    if(url==='/api/me')data={admin:true,authenticated:true};
    else if(url==='/api/admin/version')data={version:'15.0.1',label:'Federated Library & Storage Tools'};
    else if(url==='/api/admin/network')data={share:true,primary_peer_id:window.__primarySaved,peers:[{id:'p1',url:'https://peer.example',name:'Primary',last_ok:Date.now(),is_primary:window.__primarySaved==='p1'}]};
    else if(url==='/api/admin/network/primary') {window.__primarySaved=JSON.parse(opts.body).peer_id;data={ok:true};}
    else if(url==='/api/admin/duplicates')data={duplicate_count:1,groups:[{sha:'abc',qty:2,items:[{id:'u1',title:'One',size:100,source:'upload'},{id:'folder-abc',title:'One',size:100,source:'folder'}]}],status:{state:'complete',total:5,scanned:5,changed:5}};
    else if(url==='/api/admin/docs')data=[{name:'V15-UPDATE.md'}];
    else if(url.startsWith('/api/admin/docs?'))data={name:'V15-UPDATE.md',content:'# WASP v15\\n\\n## Upgrade\\n\\n- Migration repair\\n- Primary peer'};
    else if(url==='/api/site')data={name:'WASP',title:'WASP',brand_mode:'text',brand_v:0,sidebar:{enabled:false,html:''},ad:{enabled:false,html:'',height:340}};
    else if(url==='/api/admin/crons')data={timezone:'UTC',jobs:{}};
    else if(url==='/api/admin/settings')data={name:'WASP',title:'WASP',brand_mode:'image',brand_v:0,sidebar:{enabled:true,html:'<p>Credits</p>'},ad:{enabled:false,html:'',height:340}};
    else if(url==='/api/tracks'||url==='/api/playlists'||url==='/api/admin/requests')data=[];
    else data=[];
    return Response.json(data,{status});
  };''')
  page.evaluate('(s)=>(0,eval)(s)',admin_js)
  page.locator('input[data-primary="p1"]').wait_for()
  page.locator('input[data-primary="p1"]').check()
  page.get_by_text('Primary peer selected.',exact=False).wait_for()
  assert page.evaluate('window.__primarySaved')=='p1'
  page.evaluate('location.hash="#duplicates"')
  page.get_by_text('SHA-256 folder scan').wait_for()
  page.get_by_text('Original /music files are never deleted.',exact=False).wait_for()
  page.evaluate('location.hash="#settings"')
  page.locator('#brandMode').select_option('image')
  page.locator('#sidebarCode').fill('<p>Credits</p>')
  page.locator('#sidebarOn').check()
  page.locator('#sidebarSave').click()
  page.locator('#sidebarMsg').get_by_text('Saved.').wait_for()
  page.evaluate('location.hash="#docs"')
  page.get_by_role('heading',name='Update documentations').wait_for()
  page.get_by_role('heading',name='WASP v15').wait_for()
  assert page.locator('#docsNav').count()==1
  assert not errors,errors

  f=browser.new_page(viewport={'width':1440,'height':950});front_errors=[]
  f.on('pageerror',lambda e:front_errors.append(str(e)))
  f.goto('about:blank');f.set_content(front);f.evaluate('location.hash="#playlists"')
  f.evaluate('''window.fetch=async(url,opts={})=>{
    url=String(url);let data=[],status=200;
    const peer='https://peer.example';
    if(url==='/api/catalog-version'||url==='/_peer/p1/api/catalog-version')data={revision:window.__forcePeerOffline && url.startsWith('/_peer/')?'revision-two':'aabbcc'};
    else if(window.__forcePeerOffline && url.startsWith('/_peer/p1/api/'))throw Error('peer temporarily unreachable');
    else if(url.startsWith('/api/tracks'))data=[{id:'local-a1',title:'Federated track',artist:'Remote Band',album:'Album',duration:130,plays:5}];
    else if(url.startsWith('/api/playlists'))data=[];
    else if(url==='/api/site')data={name:'WASP',title:'WASP',brand_mode:'image',brand_v:42,sidebar:{enabled:true,html:'<p>Powered by Docker</p>'},ad:{enabled:false,html:'',height:340}};
    else if(url==='/api/entity-reactions')data={artist:{},playlist:{}};
    else if(url==='/api/peer-catalogue')data=[{origin:peer,synced_at:Date.now(),revision:'aabbcc',tracks:[{id:'a1',title:'Federated track',artist:'Remote Band',album:'Album',duration:130}],playlists:[{id:'pl1',name:'Remote Server Playlist',tracks:['a1']}],users:[{id:'up1',name:'Public User Playlist',username:'Listener',tracks:['a1']}]}];
    else if(url==='/api/network/peers')data=[{id:'p1',url:peer,relay_base:'/_peer/p1',is_primary:true,track_count:1}];
    else if(url==='/api/user-playlists')data=[];
    else if(url==='/api/peer-plays'||url==='/_peer/p1/api/peer-plays')data=[];
    else if(url==='/api/user/peer-tracks'){status=401;data={error:'not signed in'};}
    else if(url==='/api/me')data={authenticated:false,admin:false};
    else if(url==='/api/recent-listens'||url==='/_peer/p1/api/recent-listens')data=[{origin:peer,remote_id:'a1',title:'Federated track',artist:'Remote Band',album:'Album',played_at:1700000000000,plays:2}];
    else data=[];
    return Response.json(data,{status});
  };''')
  f.evaluate('(s)=>(0,eval)(s)',art+'\n'+radio+'\n'+app_js+'\nwindow.__getCatalogue=()=>tracks;window.__reloadCatalogue=()=>load();window.__loading=()=>loadingCatalogue;')
  f.get_by_text('Remote Server Playlist',exact=True).wait_for(timeout=12000)
  assert f.evaluate('window.__getCatalogue().find(t=>t.title==="Federated track")?.origin')=='https://peer.example', 'primary peer should be preferred over R2 copy'
  f.evaluate('location.hash="#playlist/"+encodeURIComponent("https://peer.example|pl1")')
  assert f.get_by_role('link',name='← Playlists').get_attribute('href')=='#playlists/server', 'primary server playlist should return to local server list'
  f.evaluate('location.hash="#playlists"')
  assert f.locator('#brand .brand-image').get_attribute('src')=='/site/brand?v=42'
  assert f.locator('#sidebarCredits iframe').count()==1
  # A stale snapshot must still be usable if the peer's newer catalogue cannot
  # be retrieved; no remote audio is copied as part of this fallback.
  f.evaluate('window.__forcePeerOffline=true')
  f.wait_for_function('window.__loading()===false')
  f.evaluate('window.__reloadCatalogue()')
  assert f.evaluate('window.__getCatalogue().find(t=>t.title==="Federated track")?.id')=='local-a1', 'offline primary should not hide playable local copy'
  # The cached remote entry must still be usable for playlist discovery.
  f.get_by_text('Remote Server Playlist',exact=True).wait_for()
  f.evaluate('location.hash="#playlists/peer"')
  f.get_by_text('No peer playlists yet.').wait_for()
  f.evaluate('location.hash="#artist/Remote%20Band"')
  f.get_by_text('Remote Band',exact=True).first.wait_for()
  f.evaluate('location.hash="#listened"')
  f.get_by_text('2 plays',exact=True).first.wait_for()
  assert '11/14/' not in f.locator('#list').inner_text()
  assert not front_errors,front_errors
  browser.close()
  print('PASS v15 UI: primary peer server playlists, admin docs/duplicates, branding, lower sidebar and recent listen display')
