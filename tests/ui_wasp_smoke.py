"""WASP v13 frontend smoke: peer artist biography/lineup + guest add modal + branding.
No external calls, no Cloudflare deployment.
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
P=Path(__file__).resolve().parents[1]/'public'
html=(P/'index.html').read_text().replace('<head>','<head><base href="https://wasp-test.invalid/">')
html=re.sub(r'<script[^>]*src="/app\.js"[^>]*></script>','',html)
html=html.replace('<link rel="stylesheet" href="/style.css">',f'<style>{(P/"style.css").read_text()}</style>')
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=2,flags=re.M)
bundle=art+'\n'+radio+'\n'+app
mock='''
window.__calls=[];
window.fetch=async(input,opts={})=>{
  const url=String(input);window.__calls.push(url);
  let data={};let status=200;
  if(url==='/api/tracks'||url==='/api/playlists'||url==='/api/user-playlists')data=[];
  else if(url==='/api/network/peers')data=[{id:'peer1',url:'http://100.107.221.71:8081',relay_base:'/_peer/peer1',name:'WASP remote'}];
  else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,show_brand_icon:true,ad:{enabled:false,html:'',height:340}};
  else if(url==='/api/entity-reactions')data={};
  else if(url==='/api/me')data={authenticated:false,admin:false};
  else if(url==='/api/user/peer-tracks') {data={error:'Sign in required'};status=401;}
  else if(url==='/_peer/peer1/api/tracks')data=[{id:'s1',title:'Thunderstruck',artist:'AC/DC',artists:['AC/DC'],album:'The Razors Edge',created_at:1,duration:195}];
  else if(url==='/_peer/peer1/api/playlists'||url==='/_peer/peer1/api/user-playlists')data=[];
  else if(url.startsWith('/_peer/peer1/api/bio'))data={text:'AC/DC is a rock band.',kind:'band',members:[{name:'Angus Young',role:'guitar'}],source:'Wikipedia',url:'https://en.wikipedia.org/wiki/AC/DC',genres:['rock']};
  else if(url.startsWith('/_peer/peer1/api/lineup'))data={members:[{name:'Angus Young',role:'guitar',image:''}]};
  else if(url.startsWith('/_peer/peer1/api/similar'))data={artists:[]};
  else if(url.startsWith('/api/bio')||url.startsWith('/api/lineup'))status=404;
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
};
'''
with sync_playwright() as pw:
  browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':1250,'height':800})
  errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto('about:blank');page.set_content(html)
  page.evaluate('location.hash="#artist/AC%2FDC"')
  page.evaluate('(s)=>(0,eval)(s)',mock)
  page.evaluate('(s)=>(0,eval)(s)',bundle)
  page.get_by_text('AC/DC is a rock band.',exact=False).wait_for(timeout=12000)
  assert page.locator('#brand').inner_text()=='WASP'
  assert page.locator('#brand .brand-icon').get_attribute('src')=='/wasp-icon.png'
  assert any('/_peer/peer1/api/bio' in x for x in page.evaluate('window.__calls'))
  page.get_by_role('button',name='Lineup').click()
  page.get_by_text('Angus Young').wait_for()
  assert any('/_peer/peer1/api/lineup' in x for x in page.evaluate('window.__calls'))
  # Album '+' opens the authorization popup, not the playlist editor.
  page.locator('.album-add').first.click()
  assert page.locator('#signinRequiredDlg').evaluate('(el)=>el.open')
  page.locator('#signinRequiredRegister').click()
  assert not page.locator('#signinRequiredDlg').evaluate('(el)=>el.open')
  assert page.locator('#registerDlg').evaluate('(el)=>el.open')
  register_style=page.locator('#regUser').evaluate('(el)=>getComputedStyle(el).borderRadius')
  password_style=page.locator('#regPw').evaluate('(el)=>getComputedStyle(el).borderRadius')
  assert register_style==password_style, (register_style,password_style)
  assert not errors,errors
  print('PASS: WASP branding, signup inputs, peer biography/lineup through same-origin relay, guest + popup with Register')
  browser.close()
