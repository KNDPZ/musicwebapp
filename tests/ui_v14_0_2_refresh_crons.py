"""WASP 14.0.2 browser checks: live catalogue revalidation and admin cron settings."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
P=Path(__file__).resolve().parents[1]/'public'
style=(P/'style.css').read_text()
admin_html=(P/'admin.html').read_text().replace('<link rel="stylesheet" href="/style.css">',f'<style>{style}</style>')
admin_html=re.sub(r'<script[^>]*src="/admin.js(?:\?v=[^"]+)?"[^>]*></script>','',admin_html)
admin_script=re.sub(r'^import .*?;\n','',(P/'admin.js').read_text(),flags=re.M)
app_html=(P/'index.html').read_text().replace('<head>','<head><base href="https://wasp-test.invalid/">').replace('<link rel="stylesheet" href="/style.css">',f'<style>{style}</style>')
app_html=re.sub(r'<script[^>]*src="/app.js(?:\?v=[^"]+)?"[^>]*></script>','',app_html)
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
app_js=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=2,flags=re.M)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
 p=b.new_page(viewport={'width':1220,'height':820})
 errors=[];p.on('pageerror',lambda e:errors.append(str(e)))
 p.goto('about:blank');p.set_content(admin_html)
 p.evaluate('location.hash="#network/crons"')
 p.evaluate('''window.__cronSaved=null;
 window.fetch=async(u,opts={})=>{
  let data=[];const url=String(u);
  if(url==='/api/me')data={admin:true,authenticated:true};
  else if(url==='/api/admin/version')data={version:'14.0.2',label:'Library Refresh & Peer Listening'};
  else if(url==='/api/admin/network')data={share:true,peers:[]};
  else if(url==='/api/admin/crons'){
   if(opts.method==='PUT'){window.__cronSaved=JSON.parse(opts.body);data={ok:true,config:window.__cronSaved};}
   else data={timezone:'Asia/Manila',jobs:Object.fromEntries(['peers','artwork','biography'].map(x=>[x,{enabled:false,frequency:'daily',time:'02:00',weekday:0,monthday:1}]))};
  }
  else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,ad:{enabled:false,html:'',height:340}};
  return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
 };''')
 p.evaluate('(s)=>(0,eval)(s)',admin_script)
 p.get_by_role('tab',name='Crons').wait_for()
 p.wait_for_function('document.querySelector("#cronTimezone").value==="Asia/Manila"')
 assert p.locator('#netCronsPanel').is_visible()
 assert p.locator('#adminBuild').inner_text().startswith('WASP v14.0.2')
 p.locator('[data-cron="artwork"][data-field="enabled"]').check()
 p.locator('[data-cron="artwork"][data-field="frequency"]').select_option('monthly')
 p.locator('[data-cron="artwork"][data-field="monthday"]').select_option('30')
 p.get_by_role('button',name='Save schedules').click()
 p.get_by_text('Schedules saved successfully.').wait_for()
 v=p.evaluate('window.__cronSaved')
 assert v['jobs']['artwork']['enabled'] and v['jobs']['artwork']['monthday']==30,v
 assert p.locator('#netPeersPanel').is_hidden()
 p.get_by_role('tab',name='Connected peers').click()
 assert p.locator('#netPeersPanel').is_visible()
 assert not errors,errors
 p.close()
 page=b.new_page(viewport={'width':1260,'height':820})
 errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto('about:blank');page.set_content(app_html)
 page.evaluate('location.hash="#recent"')
 page.evaluate('''window.__rev='aaaaaaaa';window.__calls=[];
 window.fetch=async(u,opts={})=>{
  const url=String(u);window.__calls.push(url);let data=[],status=200;
  if(url==='/api/catalog-version')data={revision:window.__rev};
  else if(url.startsWith('/api/tracks?v='))data=[{id:window.__rev==='aaaaaaaa'?'s1':'s2',title:window.__rev==='aaaaaaaa'?'Old song':'Freshly uploaded song',artist:'WASP Band',artists:['WASP Band'],album:'Album',created_at:5,duration:120}];
  else if(url.startsWith('/api/playlists?v='))data=[];
  else if(url.startsWith('/api/user-playlists?v='))data=[];
  else if(url==='/api/network/peers')data=[];
  else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,ad:{enabled:false,html:'',height:340}};
  else if(url==='/api/entity-reactions')data={artist:{},playlist:{}};
  else if(url==='/api/me')data={authenticated:false,admin:false};
  else if(url==='/api/user/peer-tracks'){status=401;data={error:'sign in required'};}
  return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
 };''')
 page.evaluate('(s)=>(0,eval)(s)',art+'\n'+radio+'\n'+app_js)
 page.get_by_text('Old song',exact=True).wait_for(timeout=12000)
 page.evaluate('window.__rev="bbbbbbbb"')
 page.evaluate('pollCatalogueChanges()')
 page.get_by_text('Freshly uploaded song',exact=True).wait_for(timeout=12000)
 assert any('/api/tracks?v=bbbbbbbb' in u for u in page.evaluate('window.__calls'))
 assert not errors,errors
 b.close()
 print('PASS v14.0.2 browser: admin Crons UI, saved schedule, version label, revision-based new track visibility')
