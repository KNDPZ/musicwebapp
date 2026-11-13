"""Offline UI smoke: guest sign-in label, Spotify search, locally stored peer reactions, artwork fallback."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1]/'public'
html=(P/'index.html').read_text().replace('<head>','<head><base href="https://wasp-test.invalid/">')
html=re.sub(r'<script[^>]*src="/app\.js"[^>]*></script>','',html)
html=html.replace('<link rel="stylesheet" href="/style.css">',f'<style>{(P/"style.css").read_text()}</style>')
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=3,flags=re.M)
bundle=art+'\n'+radio+'\n'+app
mock='''
window.__calls=[];
window.fetch=async (input,opts={})=>{
 const url=String(input);window.__calls.push({url,method:opts.method||'GET',body:opts.body||''});
 const origin='http://100.107.221.71:8081';let data={},status=200;
 if(url==='/api/tracks'||url==='/api/playlists'||url==='/api/user-playlists')data=[];
 else if(url==='/api/network/peers')data=[{id:'p1',url:origin,relay_base:'/_peer/p1',name:'WASP peer'}];
 else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,show_brand_icon:false,ad:{enabled:false,html:'',height:340}};
 else if(url==='/api/entity-reactions')data={};
 else if(url==='/api/peer-reactions')data=[];
 else if(url==='/api/me')data={authenticated:false,admin:false};
 else if(url==='/api/user/peer-tracks') {data={error:'unauthorized'};status=401;}
 else if(url==='/_peer/p1/api/tracks')data=[{id:'r1',title:'Remote Song',artist:'Artist with no photo',artists:['Artist with no photo'],album:'Remote Album',created_at:3,duration:123}];
 else if(url==='/_peer/p1/api/playlists'||url==='/_peer/p1/api/user-playlists')data=[];
 else if(url==='/api/peer-react')data={origin,remote_id:'r1',hearts:1,likes:0,dislikes:0};
 else if(url.startsWith('/api/spotify/search-playlists?'))data=[{id:'1234567890abcdefghij',title:'Metal Mix',sub:'Curator · 50 songs',image:'',url:'https://open.spotify.com/playlist/1234567890abcdefghij'}];
 else if(url.startsWith('/api/request'))data={ok:true,position:1};
 return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};
'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1200,'height':850})
 errs=[];page.on('pageerror',lambda e:errs.append(str(e)))
 page.goto('about:blank');page.set_content(html)
 page.evaluate('location.hash="#recent"')
 page.evaluate('(s)=>(0,eval)(s)',mock)
 page.evaluate('(s)=>(0,eval)(s)',bundle)
 page.locator('.song').first.wait_for(timeout=15000)
 assert page.locator('#whoami').inner_text()=='Sign In'
 page.locator('.song').first.click()
 page.locator('#bh').click()
 page.wait_for_function('window.__calls.some(x=>x.url==="/api/peer-react")')
 call=page.evaluate('window.__calls.find(x=>x.url==="/api/peer-react")')
 assert '"remote_id":"r1"' in call['body'] and '"kind":"heart"' in call['body'],call
 assert page.locator('#bh').get_attribute('aria-pressed')=='true'
 page.evaluate('location.hash="#artist/Artist%20with%20no%20photo"')
 page.locator('.hero .art img').wait_for()
 # Force image-load error to verify the image falls back to album/track artwork on the peer.
 page.locator('.hero .art img').evaluate('(img)=>img.dispatchEvent(new Event("error"))')
 assert '/_peer/p1/art/album?' in page.locator('.hero .art img').get_attribute('src'),page.locator('.hero .art img').get_attribute('src')
 page.locator('.hero .art img').evaluate('(img)=>img.dispatchEvent(new Event("error"))')
 assert '/_peer/p1/art/track?id=r1' in page.locator('.hero .art img').get_attribute('src'),page.locator('.hero .art img').get_attribute('src')
 page.evaluate('location.hash="#request/new"')
 page.get_by_role('button',name='Playlist',exact=True).first.click()
 page.locator('#spotifyPlaylistSearch').fill('Metal')
 page.get_by_text('Metal Mix',exact=True).wait_for(timeout=8000)
 page.locator('.spotify-result').first.click()
 assert page.locator('#rq').input_value()=='https://open.spotify.com/playlist/1234567890abcdefghij'
 assert page.locator('#rqGo').is_enabled()
 assert not errs, errs
 print('PASS: guest Sign In; peer reactions posted locally; peer artist artwork fallback; Spotify playlist search and link selection')
 browser.close()
