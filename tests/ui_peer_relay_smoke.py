"""Browser regression for Docker v13 same-origin Tailscale relay.
No external network calls or real peer/Cloudflare services are used.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re, json

PUBLIC=Path(__file__).resolve().parents[1]/'public'
html=(PUBLIC/'index.html').read_text().replace('<head>','<head><base href="https://riffvault-test.invalid/">')
html=re.sub(r'<script[^>]*src="/app\.js"[^>]*></script>','',html)
html=html.replace('<link rel="stylesheet" href="/style.css">',f'<style>{(PUBLIC/"style.css").read_text()}</style>')
art=(PUBLIC/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(PUBLIC/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app=(PUBLIC/'app.js').read_text()
app=re.sub(r'^import .*?;\n','',app,count=3,flags=re.M)
bundle=art+'\n'+radio+'\n'+app
mock='''
window.__calls=[];
window.fetch=async (input,opts={})=>{
 const url=String(input);window.__calls.push(url);
 const source='http://100.107.221.71:8081';
 const canonical='https://music.playy.online';
 let data=[];
 if(url==='/api/tracks')data=[];
 else if(url==='/api/playlists')data=[];
 else if(url==='/api/network/peers')data=[{id:'connected-1',url:source,relay_base:'/_peer/connected-1',origin_aliases:[canonical],name:'RiffVault bridge'}];
 else if(url==='/api/user-playlists')data=[];
 else if(url==='/api/site')data={name:'RiffVault'};
 else if(url==='/api/entity-reactions')data={};
 else if(url==='/api/me')data={authenticated:false,admin:false};
 else if(url==='/api/user/peer-tracks')data=[];
 else if(url.startsWith('/_peer/connected-1/api/tracks'))data=[{id:'s1',title:'Bridged Song',artist:'Peer Artist',artists:['Peer Artist'],album:'Peer Album',duration:194,created_at:2}];
 else if(url==='/_peer/connected-1/api/playlists')data=[{id:'mix',name:'Remote Radio',tracks:['s1'],cover_v:1}];
 else if(url==='/_peer/connected-1/api/user-playlists')data=[{id:'pub',name:'Public Peer Mix',username:'test',kind:'user',tracks:['peer:'+'f'.repeat(64)],cover_url:canonical+'/art/user-playlist/pub?v=1',track_sources:{['peer:'+'f'.repeat(64)]:{origin:canonical,remote_id:'s1',title:'Nested Peer Song',artist:'Third Artist',duration:130}}}];
 else data={};
 return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
};
'''
with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1360,'height':850})
  errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
  page.goto('about:blank');page.set_content(html)
  page.evaluate('location.hash="#playlists/peer"')
  page.evaluate('(s)=>(0,eval)(s)',mock)
  page.evaluate('(s)=>(0,eval)(s)',bundle)
  page.locator('.pltile').first.wait_for(timeout=12000)
  assert page.locator('.pltile').count()==2, 'Expected server + user peer playlists'
  calls=page.evaluate('window.__calls')
  for suffix in ['api/tracks','api/playlists','api/user-playlists']:
    assert '/_peer/connected-1/'+suffix in calls, f'{suffix} did not pass through AWS relay'
  assert not any(x.startswith('http://100.') or x.startswith('https://music.playy.online') for x in calls), 'Browser directly fetched blocked peer URL'
  assert page.locator('.pltile').first.locator('img.playlist-cover').get_attribute('src')=='/_peer/connected-1/art/playlist?id=mix&v=1'
  assert page.locator('.pltile').nth(1).locator('img.playlist-cover').get_attribute('src')=='/_peer/connected-1/art/user-playlist/pub?v=1'
  page.locator('.pltile').first.hover()
  page.locator('.pltile').first.locator('.fab').click()
  assert page.locator('#audio').get_attribute('src')=='/_peer/connected-1/audio/s1', 'Peer song failed to use local relay'
  assert page.locator('#sList').is_enabled(),'Playlist shuffle failed through relay'
  page.evaluate("location.hash='#playlist/'+encodeURIComponent('http://100.107.221.71:8081|pub')")
  page.get_by_text('Nested Peer Song').wait_for()
  page.locator('[data-id="peer:'+('f'*64)+'"]').click()
  assert page.locator('#audio').get_attribute('src')=='/_peer/connected-1/audio/s1', 'Canonical Cloudflare origin alias not rewritten to bridge'
  assert page.evaluate("registeredPeerOrigin('https://music.playy.online')")=='http://100.107.221.71:8081', 'Saving an aliased song must retain the approved connected peer origin'
  assert not errors, errors
  print('PASS: browser fetches peer catalogue via same-origin relay; server+user playlist cover relays; audio playback, shuffle, and canonical Cloudflare source alias')
  browser.close()
