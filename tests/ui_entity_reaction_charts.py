"""Browser regression: reacted artist charts, and all local/peer playlist controls."""
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
window.__requests=[];
window.__origin='http://100.107.221.71:8081';
window.__peerKey=window.__origin+'|remote-pl1';
window.__entities={artist:{'AC/DC':{hearts:3,likes:0,dislikes:0},'Peer Band':{hearts:2,likes:0,dislikes:0}},playlist:{'local-pl':{hearts:1,likes:0,dislikes:0}}};
window.fetch=async (input,options={})=>{
 const url=String(input);let data={},status=200;
 if(url==='/api/tracks')data=[{id:'local-song',title:'Local Song',artist:'AC/DC',artists:['AC/DC'],album:'Local',duration:200,hearts:0,likes:0,dislikes:0}];
 else if(url==='/api/playlists')data=[{id:'local-pl',name:'Local Mix',tracks:['local-song'],cover_v:0}];
 else if(url==='/api/user-playlists')data=[{id:'public-pl',name:'Public Mix',username:'Guest',is_public:1,tracks:['local-song']}];
 else if(url==='/api/network/peers')data=[{id:'p1',url:window.__origin,relay_base:'/_peer/p1',name:'Bridge'}];
 else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,show_brand_icon:false,ad:{enabled:false,html:'',height:340}};
 else if(url==='/api/entity-reactions')data={...window.__entities,playlist_meta:[]};
 else if(url==='/api/peer-reactions')data=[];
 else if(url==='/api/me')data={authenticated:false};
 else if(url==='/api/user/peer-tracks'){status=401;data={error:'not signed in'};}
 else if(url==='/api/requests')data=[];
 else if(url==='/_peer/p1/api/tracks')data=[{id:'peer-song',title:'Peer Song',artist:'Peer Band',artists:['Peer Band'],album:'Remote',duration:203}];
 else if(url==='/_peer/p1/api/playlists')data=[{id:'remote-pl1',name:'Remote Mix',tracks:['peer-song'],cover_v:0}];
 else if(url==='/_peer/p1/api/user-playlists')data=[];
 else if(url==='/api/react-entity') {
   const b=JSON.parse(options.body);window.__requests.push(b);
   const c=(window.__entities[b.type][b.key]||={hearts:0,likes:0,dislikes:0});
   c[b.kind+'s']=Math.max(0,(c[b.kind+'s']||0)+(b.on?1:-1));
   if(b.on&&b.kind==='like')c.dislikes=0;
   if(b.on&&b.kind==='dislike')c.likes=0;
   data={...c};
 }
 else if(url.startsWith('/api/'))data=[];
 return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};
'''
with sync_playwright() as pw:
 browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 page=browser.new_page(viewport={'width':1300,'height':830});errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank');page.set_content(html)
 page.evaluate('location.hash="#hearts/artists"')
 page.evaluate('(s)=>(0,eval)(s)',mock)
 page.evaluate('(s)=>(0,eval)(s)',bundle)
 page.get_by_text('Peer Band',exact=True).first.wait_for(timeout=15000)
 assert 'AC/DC' in page.locator('#list').inner_text(),page.locator('#list').inner_text()
 assert 'Peer Band' in page.locator('#list').inner_text()
 assert not errors,errors
 # Heart the peer playlist, and see it in the local Most hearted playlist chart.
 page.evaluate('location.hash="#playlist/"+encodeURIComponent(window.__peerKey)')
 page.get_by_role('button',name='Heart playlist').wait_for()
 assert page.locator('.playlist-ratings').count()==1
 assert page.locator('.playlist-ratings [data-r="like"]').count()==1
 assert page.locator('.playlist-ratings [data-r="dislike"]').count()==1
 assert page.locator('.playlist-ratings').inner_text().count('Heart')==1
 page.get_by_role('button',name='Heart playlist').click()
 page.wait_for_function('window.__requests.length === 1')
 request=page.evaluate('window.__requests[0]')
 assert request['origin']=='http://100.107.221.71:8081',request
 assert request['type']=='playlist' and request['kind']=='heart' and request['key'].endswith('|remote-pl1')
 page.wait_for_function('window.__entities.playlist[window.__peerKey]?.hearts===1',timeout=3500)
 page.evaluate('location.hash="#hearts/playlists"')
 page.get_by_text('Remote Mix',exact=True).first.wait_for()
 assert 'Remote Mix' in page.locator('#list').inner_text()
 # The same peer playlist can be liked and disliked locally.
 page.evaluate('location.hash="#playlist/"+encodeURIComponent(window.__peerKey)')
 page.get_by_role('button',name='Like playlist',exact=True).click()
 page.wait_for_function('window.__entities.playlist[window.__peerKey]?.likes===1')
 page.evaluate('location.hash="#likes/playlists"')
 page.get_by_text('Remote Mix',exact=True).first.wait_for()
 page.evaluate('location.hash="#playlist/"+encodeURIComponent(window.__peerKey)')
 page.get_by_role('button',name='Dislike playlist',exact=True).click()
 page.wait_for_function('window.__entities.playlist[window.__peerKey]?.dislikes===1')
 page.evaluate('location.hash="#dislikes/playlists"')
 page.get_by_text('Remote Mix',exact=True).first.wait_for()
 # Local server-managed and public user playlist pages have the same controls.
 page.evaluate('location.hash="#playlist/local-pl"')
 page.get_by_role('button',name='Heart playlist').wait_for()
 assert page.locator('#list .playlist-ratings').count()==1
 page.get_by_role('button',name='Like playlist',exact=True).click()
 page.wait_for_function('window.__entities.playlist["local-pl"]?.likes===1')
 page.evaluate('location.hash="#playlist/public-pl"')
 page.get_by_role('button',name='Dislike playlist',exact=True).click()
 page.wait_for_function('window.__entities.playlist["public-pl"]?.dislikes===1')
 assert not errors,errors
 browser.close()
 print('PASS: artist charts render; peer/local/public playlist heart, like, dislike update and appear in rankings')
