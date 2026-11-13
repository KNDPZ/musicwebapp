"""Run: python tests/ui_v13_similar_reactions.py (Chromium + Playwright installed)."""
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
mock=r'''
window.__calls=[];
window.__remoteOrigin='http://100.107.221.71:8081';
window.fetch=async (input,opts={})=>{
 const url=String(input);window.__calls.push({url,method:opts.method||'GET',body:opts.body||''});
 let data={}, status=200;
 if(url==='/api/tracks')data=[{id:'local-1',title:'Local Tune',artist:'Aerosmith',artists:['Aerosmith'],album:'Rocks',duration:90,created_at:1}];
 else if(url==='/api/playlists'||url==='/api/user-playlists')data=[];
 else if(url==='/api/network/peers')data=[{id:'p1',url:window.__remoteOrigin,relay_base:'/_peer/p1',name:'Bridge'}];
 else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,show_brand_icon:false,ad:{enabled:false,html:'',height:340}};
 else if(url==='/api/entity-reactions')data={};
 else if(url==='/api/peer-reactions')data=[];
 else if(url==='/api/me')data={authenticated:false,admin:false};
 else if(url==='/api/user/peer-tracks') {data={error:'unauthorized'};status=401;}
 else if(url==='/_peer/p1/api/tracks')data=[
  {id:'remote-1',title:'Night Metal',artist:'3TEETH',artists:['3TEETH'],album:'Dark',duration:160,created_at:4},
  {id:'remote-2',title:'Remote Tune',artist:'Drowning Pool',artists:['Drowning Pool'],album:'Sinner',duration:240,created_at:3}];
 else if(url==='/_peer/p1/api/playlists'||url==='/_peer/p1/api/user-playlists')data=[];
 else if(url.startsWith('/_peer/p1/api/similar?'))data={artists:[
   {name:'Aerosmith',image:'https://example.org/a.jpg'},
   {name:'Drowning Pool',image:'https://example.org/d.jpg'},
   {name:'KoRn',image:'https://example.org/k.jpg'}]};
 else if(url.startsWith('/api/similar?')){status=404;data={error:'none'};}
 else if(url==='/api/peer-react'){const b=JSON.parse(opts.body);data={hearts:b.kind==='heart'&&b.on?1:0,likes:0,dislikes:0};}
 else if(url.startsWith('/api/reaction-state?'))data={hearts:3,likes:2,dislikes:1,my_heart:1,my_like:0,my_dislike:0};
 else if(url.startsWith('/api/bio?')||url.startsWith('/_peer/p1/api/bio?')){data={kind:'band',text:'Test bio',members:[],genres:[]};}
 return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};
'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1200,'height':850});errs=[]
 page.on('pageerror',lambda e: errs.append(str(e)))
 page.goto('about:blank');page.set_content(html)
 page.evaluate('location.hash="#recent"')
 page.evaluate('(s)=>(0,eval)(s)',mock)
 page.evaluate('(s)=>(0,eval)(s)',bundle)
 page.locator('.song').first.wait_for(timeout=15000)
 # The full page (not only the artist-detail panel) uses the peer relay.
 page.evaluate('location.hash="#similar/3TEETH"')
 page.get_by_text('Similar to 3TEETH').wait_for(timeout=15000)
 page.get_by_text('Aerosmith',exact=True).wait_for()
 full=page.locator('#list').inner_text()
 assert 'In your library' in full,full
 assert 'Peer Library' in full,full
 assert 'Not in the library' in full,full
 assert page.locator('a[href="#artist/Drowning%20Pool"]').count()==1,page.locator('#list').inner_html()
 assert page.locator('[data-req="KoRn"]').count()==1
 calls=page.evaluate('window.__calls.map(x=>x.url)')
 assert '/_peer/p1/api/similar?name=3TEETH' in calls,calls
 page.evaluate('location.hash="#artist/Drowning%20Pool"')
 page.get_by_text('Remote Tune').first.wait_for(timeout=8000)
 # A guest's vote updates immediately, while the Worker save is in flight.
 page.evaluate('location.hash="#recent"')
 page.locator('.song').filter(has_text='Night Metal').click()
 page.locator('#bh').click()
 assert page.locator('#ch').inner_text()=='1',page.locator('#ch').inner_text()
 page.wait_for_function('window.__calls.some(x=>x.url==="/api/peer-react")')
 # A later state refresh brings in reactions from other listeners.
 page.evaluate('refreshCurrentReaction()')
 page.wait_for_function('document.querySelector("#ch").textContent==="3"')
 assert page.locator('#bl').is_enabled() and page.locator('#bd').is_enabled()
 assert not errs,errs
 print('PASS: similar page uses relay; local/peer/absent labels and links; guest vote immediately displays; peer count refresh')
 browser.close()
