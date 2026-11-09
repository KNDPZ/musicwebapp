"""Self-contained RiffVault browser smoke test; no network or production resources used.
Requires Python Playwright and a Chromium binary. Run: python tests/ui_smoke.py
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json,re,base64

ROOT=Path(__file__).resolve().parents[1]
PUBLIC=ROOT/'public'
html=(PUBLIC/'index.html').read_text().replace('<head>','<head><base href="https://riffvault-test.invalid/">')
html=re.sub(r'<script[^>]*src="/app\.js"[^>]*></script>','',html)
html=html.replace('<link rel="stylesheet" href="/style.css">',f'<style>{(PUBLIC/"style.css").read_text()}</style>')
art=(PUBLIC/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(PUBLIC/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app=(PUBLIC/'app.js').read_text()
app=re.sub(r'^import .*?;\n','',app,count=2,flags=re.M)
bundle=art+'\n'+radio+'\n'+app
tracks=[dict(id=f't{i}',title=f'Song {i}',artist=f'Artist {i}',artists=[f'Artist {i}'],album=f'Album {i}',duration=194,created_at=1) for i in range(1,13)]

bootstrap='''
window.__mock={
  tracks:TRACKS,
  user:[{id:'pl1',name:'My playlist',is_public:false,cover_mode:'mosaic',cover_url:null,tracks:TRACKS.map(t=>t.id)}],
  server:[{id:'server1',name:'Radio compilation',tracks:['t1','t2','t3'],cover_v:0}],
  peers:[],
  operations:[]
};
window.fetch=async function(input,opts={}){
  const u=String(input), path=u.split('?')[0],m=(opts.method||'GET').toUpperCase();
  const mock=window.__mock, body=opts.body?JSON.parse(opts.body):{};
  if(m!=='GET')mock.operations.push([m,path,body]);
  let data,status=200;
  if(m==='GET'){
    if(u.startsWith('https://peer.example/api/tracks'))data=[{id:'t1',title:'Remote Same-ID Song',artist:'Remote Artist',artists:['Remote Artist'],album:'Remote Album',duration:222,created_at:2}];
    else if(u.startsWith('https://peer.example/api/playlists'))data=[{id:'remote1',name:'Remote Radio',tracks:['t1'],cover_v:123}];
    else if(u.startsWith('https://peer.example/api/user-playlists'))data=[{id:'remote-user',name:'Remote User Mix',tracks:['peer:'+'b'.repeat(64)],username:'peer-user',cover_url:'/art/user-playlist/remote-user?v=77',track_sources:{['peer:'+'b'.repeat(64)]:{origin:'https://other.example',remote_id:'abc',title:'Nested Peer Song',artist:'Third Artist',album:'Third Album',duration:154}}}];
    else if(path==='/api/tracks')data=mock.tracks;
    else if(path==='/api/playlists')data=mock.server;
    else if(path==='/api/user-playlists')data=[{id:'pub1',name:'Tester public songs',tracks:['t1','t2'],username:'tester',cover_mode:'mosaic'}];
    else if(path==='/api/user/playlists')data=mock.user;
    else if(path==='/api/network/peers')data=mock.peers;
    else if(path==='/api/entity-reactions')data={};
    else if(path==='/api/site')data={name:'RiffVault',title:'RiffVault'};
    else if(path==='/api/me')data={authenticated:true,username:'tester',role:'user',admin:false};
    else if(path==='/api/user/peer-tracks')data=[];
    else data={};
  }else if(path==='/api/user/playlists/copy'){
    data={id:'new1',copied:body.tracks.length,skipped:0};
    mock.user.push({id:'new1',name:body.name,cover_mode:'mosaic',cover_url:null,is_public:false,tracks:body.tracks});
    status=201;
  }else if(path.endsWith('/tracks/batch')){
    const id=path.split('/')[4],pl=mock.user.find(x=>x.id===id);
    const initial=pl.tracks.length;pl.tracks=[...new Set([...pl.tracks,...body.tracks])];data={ok:true,added:pl.tracks.length-initial};
  }else if(path.endsWith('/tracks')&&m==='PUT'){
    const id=path.split('/')[4];mock.user.find(x=>x.id===id).tracks=body.tracks;data={ok:true};
  }else if(m==='DELETE'){
    mock.user=mock.user.filter(x=>x.id!==path.split('/').at(-1));data={ok:true};
  }else if(path==='/api/peer-track-ref')data={ref:'peer:'+('0'.repeat(64))};
  else data={ok:true};
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};
'''

with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1360,'height':850})
  tiny_png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLytQAAAABJRU5ErkJggg==')
  page.route('https://peer.example/art/**',lambda route:route.fulfill(status=200,body=tiny_png,content_type='image/png'))
  errors=[];page.on('pageerror',lambda err:errors.append(str(err)))
  page.goto('about:blank')
  page.set_content(html)
  page.evaluate('location.hash="#userplaylist/pl1"')
  page.evaluate('(code)=>{(0,eval)(code)}',bootstrap.replace('TRACKS',json.dumps(tracks)))
  page.evaluate('(code)=>{(0,eval)(code)}',bundle)
  page.locator('.owned-track-line').first.wait_for(timeout=15000)
  assert page.locator('.owned-track-line').count()==12
  assert page.locator('.playlist-detail-cover .playlist-album-collage img').count()==9
  assert len(page.locator('.playlist-album-collage').first.evaluate('(el)=>getComputedStyle(el).gridTemplateColumns.split(" ")'))==3
  page.locator('.owned-remove').first.click()
  assert page.locator('.owned-track-line').count()==11
  assert page.locator('#playlistDraftToolbar').is_visible()
  assert not page.evaluate('window.__mock.operations.filter(x=>x[0]==="PUT").length')
  page.locator('#playlistUndo').click()
  assert page.locator('.owned-track-line').count()==12
  assert not page.locator('#playlistDraftToolbar').is_visible()
  # Only the last five of six removals may be undone.
  for _ in range(6):page.locator('.owned-remove').first.click()
  assert page.locator('.owned-track-line').count()==6
  for _ in range(5):page.locator('#playlistUndo').click()
  assert page.locator('.owned-track-line').count()==11
  assert page.locator('#playlistUndo').is_disabled()
  if __import__('os').getenv('RIFFVAULT_QA_SHOT'):page.screenshot(path='/mnt/data/riffvault_next/qa_playlist.png',full_page=True)
  page.evaluate('location.hash="#home"');page.wait_for_timeout(100)
  page.evaluate('location.hash="#userplaylist/pl1"')
  page.locator('.owned-track-line').first.wait_for()
  assert page.locator('.owned-track-line').count()==12,'unsaved removal survived navigation'
  page.locator('.owned-remove').first.click();page.locator('#playlistCommit').click()
  page.locator('#msgDlg').wait_for(state='visible')
  assert page.evaluate('window.__mock.operations.filter(x=>x[0]==="PUT").length')==1
  assert page.evaluate('window.__mock.user[0].tracks.length')==11
  page.locator('#msgOk').click()
  page.locator('#playlistCog').click()
  page.locator('#editOwnedPlaylistDlg').wait_for(state='visible')
  assert page.locator('#useAlbumGrid').is_visible()
  page.locator('#deleteOwnedPlaylist').click()
  assert not page.evaluate('window.__mock.operations.filter(x=>x[0]==="DELETE").length')
  page.locator('#deleteOwnedPlaylist').click()
  page.locator('#msgDlg').wait_for(state='visible')
  assert page.evaluate('window.__mock.operations.filter(x=>x[0]==="DELETE").length')==1
  page.locator('#msgOk').click()
  page.evaluate('location.hash="#playlist/server1"')
  page.locator('[data-copy-playlist]').wait_for()
  page.locator('[data-copy-playlist]').click()
  page.locator('#copyPlaylistDlg').wait_for(state='visible')
  assert 'Copy to a new playlist' in page.locator('#copyPlaylistDlg').inner_text()
  page.locator('#copySave').click()
  page.locator('#msgDlg').wait_for(state='visible')
  assert page.evaluate('window.__mock.user.at(-1).tracks.join()')=='t1,t2,t3'
  page.locator('#msgOk').click()
  page.evaluate("window.__mock.peers=[{url:'https://peer.example',name:'Peer'}]")
  page.evaluate('load()')
  page.evaluate('location.hash="#playlists/users"')
  page.get_by_text('by tester · 2 songs').wait_for()
  page.evaluate('location.hash="#playlists/peer"')
  page.locator('a[href*="remote1"]').first.wait_for()
  assert page.locator('.pltile').count()==2
  assert page.locator('.pltile').first.locator('img.playlist-cover').get_attribute('src')=='https://peer.example/art/playlist?id=remote1&v=123', 'remote server playlist custom cover missing from card'
  assert page.locator('.pltile').nth(1).locator('img.playlist-cover').get_attribute('src')=='https://peer.example/art/user-playlist/remote-user?v=77', 'remote user playlist cover missing from peer card'
  assert page.evaluate("playlistCoverUrl({id:'https://peer.example|remote1',origin:'https://peer.example',kind:'server',cover_v:123})")=='https://peer.example/art/playlist?id=remote1&v=123', 'peer server custom cover URL did not resolve to source host'
  assert page.evaluate("playlistCoverUrl({id:'https://peer.example|remote-user',origin:'https://peer.example',kind:'user',cover_url:'/art/user-playlist/remote-user?v=77'})")=='https://peer.example/art/user-playlist/remote-user?v=77', 'peer user custom cover URL did not resolve to source host'
  image=page.locator('.pltile').first
  image.hover()
  page.wait_for_timeout(250) # CSS opacity transition
  assert float(image.locator('.fab').evaluate('(el)=>getComputedStyle(el).opacity'))>0.9, 'peer playlist play button did not appear on hover'
  image.locator('.fab').click()
  assert page.locator('#audio').get_attribute('src')=='https://peer.example/audio/t1', 'peer playlist play did not stream from peer host'
  page.evaluate("location.hash='#playlist/'+encodeURIComponent('https://peer.example|remote1')")
  page.locator('button.row[data-id="https://peer.example|t1"]').wait_for(timeout=7000)
  page.locator('button.row[data-id="https://peer.example|t1"]').click()
  assert page.locator('#audio').get_attribute('src')=='https://peer.example/audio/t1','peer stream must use remote origin + original ID'
  page.evaluate('location.hash="#playlists/peer"')
  page.locator('a[href*="remote-user"]').first.wait_for()
  page.evaluate("location.hash='#playlist/'+encodeURIComponent('https://peer.example|remote-user')")
  page.get_by_text('Nested Peer Song').wait_for()
  page.locator('[data-id="peer:'+('b'*64)+'"]').click()
  assert page.locator('#audio').get_attribute('src')=='https://other.example/audio/abc','peer-of-peer track must retain actual hosting origin'
  assert not errors,f'JavaScript errors: {errors}'
  print('PASS: 9-tile cover; staged removal; playlist-only delete; themed copy; public-user counts; remote custom cover resolution; peer hover Play; remote streaming; peer-of-peer playback')
  browser.close()
