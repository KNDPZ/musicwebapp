"""Browser regression for cross-server votes displayed in song popularity charts."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright
P=Path(__file__).resolve().parents[1]/'public'
html=(P/'index.html').read_text().replace('<head>','<head><base href="https://wasp-test.invalid/">')
html=re.sub(r'<script[^>]*src="/app\.js"[^>]*></script>','',html)
html=html.replace('<link rel="stylesheet" href="/style.css">',f'<style>{(P/"style.css").read_text()}</style>')
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=2,flags=re.M)
bundle=art+'\n'+radio+'\n'+app
mock=r'''
window.__calls=[];
window.__peerOrigin='http://100.107.221.71:8081';
window.__offline=false;
window.__votes={hearts:0,likes:2,dislikes:0};
window.fetch=async (input,opts={})=>{
 const url=String(input);window.__calls.push(url);
 let data={},status=200;
 if(url==='/api/tracks') data=window.__localDuplicate?[{id:'local-song',title:'Peer Tune',artist:'Peer Artist',artists:['Peer Artist'],album:'Album',duration:160,created_at:1,hearts:0,likes:0,dislikes:0}]:[];
 else if(url==='/api/playlists'||url==='/api/user-playlists')data=[];
 else if(url==='/api/network/peers')data=[{id:'p1',url:window.__peerOrigin,relay_base:'/_peer/p1',name:'Bridge'}];
 else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,show_brand_icon:false,ad:{enabled:false,html:'',height:340}};
 else if(url==='/api/entity-reactions')data={};
 else if(url==='/api/peer-reactions')data=[{id:'peer-stored',origin:window.__peerOrigin,remote_id:'remote-song',title:'Peer Tune',artist:'Peer Artist',album:'Album',duration:160,created_at:1,...window.__votes,my_heart:0,my_like:0,my_dislike:0}];
 else if(url==='/api/me')data={authenticated:false,admin:false};
 else if(url==='/api/user/peer-tracks'){status=401;data={error:'login required'};}
 else if(url==='/_peer/p1/api/tracks')data=window.__offline?[]:[{id:'remote-song',title:'Peer Tune',artist:'Peer Artist',artists:['Peer Artist'],album:'Album',duration:160,created_at:1,hearts:0,likes:0,dislikes:0}];
 else if(url==='/_peer/p1/api/playlists'||url==='/_peer/p1/api/user-playlists')data=[];
 else if(url==='/api/peer-react') {const b=JSON.parse(opts.body);window.__votes[b.kind+'s']=b.on?1:0;data={...window.__votes};}
 else if(url.startsWith('/api/reaction-state?'))data={...window.__votes,my_heart:0,my_like:0,my_dislike:0};
 return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};
'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox']);errors=[]
 page=browser.new_page(viewport={'width':1100,'height':750})
 page.on('pageerror',lambda err: errors.append(str(err)))
 page.goto('about:blank');page.set_content(html)
 page.evaluate('location.hash="#likes"')
 page.evaluate('(s)=>(0,eval)(s)',mock)
 page.evaluate('(s)=>(0,eval)(s)',bundle)
 page.get_by_text('Peer Tune',exact=True).first.wait_for(timeout=15000)
 assert '2 likes' in page.locator('#list').inner_text(),page.locator('#list').inner_text()
 # A peer track received a local heart and appears on the local heart chart.
 page.locator('.song').filter(has_text='Peer Tune').click()
 page.locator('#bh').click()
 page.wait_for_function('window.__calls.includes("/api/peer-react")')
 page.evaluate('location.hash="#hearts"')
 page.get_by_text('Peer Tune',exact=True).first.wait_for(timeout=15000)
 assert '1 heart' in page.locator('#list').inner_text(),page.locator('#list').inner_text()
 assert page.locator('.song').count()==1
 # Simulate a peer temporarily offline: locally cached metadata remains in chart.
 page.evaluate('window.__offline=true; location.hash="#recent"')
 page.evaluate('load()')
 page.evaluate('location.hash="#likes"')
 page.get_by_text('Peer Tune',exact=True).first.wait_for(timeout=15000)
 page.wait_for_function('document.querySelector("#list")?.textContent.includes("2 likes")',timeout=10000)
 assert '2 likes' in page.locator('#list').inner_text()
 assert page.locator('.song').count()==1
 # A dislike of a peer song also appears in the local disliked chart.
 page.locator('.song').first.click()
 page.locator('#bd').click()
 page.wait_for_function('window.__votes.dislikes===1')
 page.evaluate('location.hash="#dislikes"')
 page.wait_for_function('document.querySelector("#list")?.textContent.includes("1 dislike")')
 assert page.locator('.song').count()==1
 # An identical track available locally and on a peer must not duplicate cards.
 page.evaluate('window.__offline=false; location.hash="#recent"')
 page.evaluate('window.__localDuplicate=true')
 page.evaluate('load()')
 page.evaluate('location.hash="#likes"')
 page.wait_for_function('document.querySelector("#list")?.textContent.includes("2 likes")')
 assert page.locator('.song').count()==1
 assert not errors,errors
 print('PASS: peer-only song appears in liked/hearted charts, guest vote refreshes rankings, offline metadata still available')
 browser.close()
