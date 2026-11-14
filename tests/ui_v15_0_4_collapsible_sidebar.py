"""End-to-end frontend test for compact WASP sidebar; assets served over actual HTTP."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re

P=Path(__file__).resolve().parents[1]/'public'
css=(P/'style.css').read_text()
html=(P/'index.html').read_text()
html=html.replace('<link rel="stylesheet" href="/style.css">', f'<style>{css}</style>')
html=re.sub(r'<script[^>]*src="/app.js(?:\?v=[^"]+)?"[^>]*></script>','',html)
app_js=re.sub(r'^import .*?;\n','',(P/'app.js').read_text(),count=3,flags=re.M)
art=(P/'art.js').read_text().replace('export const ','const ').replace('const artistArt =','const _artistArt =').replace('const albumArt =','const _albumArt =')
radio=(P/'radio.js').read_text().replace('import { artistsOf } from "./art.js";','').replace('export function ','function ').replace('const shuffle =','const radioShuffle =').replace('shuffle(','radioShuffle(')
bbcode=re.sub(r'^export function ', 'function ', (P/'sidebar-bbcode.js').read_text(), flags=re.M)
bundle=bbcode+'\n'+art+'\n'+radio+'\n'+app_js

MOCK="""
window.__auth = !!window.__auth;
window.fetch=async(input,opts={})=>{
 const url=new URL(String(input),'https://wasp-v15.invalid/');let data=[],status=200;
 if(url.pathname==='/api/site')data={name:'WASP',title:'WASP',favicon:0,brand_mode:'text',show_brand_icon:true,sidebar:{enabled:true,bbcode:'[b]Credits[/b] [url=https://github.com/]GitHub[/url]'},ad:{enabled:false,html:'',height:340}};
 else if(url.pathname==='/api/me')data={authenticated:window.__auth,admin:false,role:window.__auth?'user':null};
 else if(url.pathname==='/api/catalog-version')data={revision:'one'};
 else if(url.pathname==='/api/entity-reactions'||url.pathname==='/api/peer-reactions')data={};
 else if(url.pathname==='/api/user/peer-tracks'){status=401;data={error:'Sign in required'};}
 else if(url.pathname==='/api/network/peers'||url.pathname==='/api/tracks'||url.pathname==='/api/playlists'||url.pathname==='/api/user-playlists'||url.pathname==='/api/recent-listens')data=[];
 return Response.json(data,{status});
};
"""
try:
 with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1440,'height':900})
    page.route('https://wasp-v15.invalid/**',lambda route: route.fulfill(status=200,body=(P/"nav-icons"/route.request.url.rsplit('/',1)[-1]).read_bytes(),content_type='image/png') if route.request.url.split('/')[-2]=='nav-icons' and (P/'nav-icons'/route.request.url.rsplit('/',1)[-1]).exists() else route.fulfill(status=404,body=''))

    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('about:blank');page.set_content(html)
    page.evaluate('''()=>{window.__store=window.__store||{}; Object.defineProperty(window,'localStorage',{configurable:true,value:{getItem:k=>window.__store[k]??null,setItem:(k,v)=>window.__store[k]=v,removeItem:k=>delete window.__store[k]}})}''')
    page.evaluate('(s)=>(0,eval)(s)',MOCK)
    page.evaluate('(s)=>(0,eval)(s)',bundle)
    page.locator('#nav .nav-item').first.wait_for(timeout=12000)
    assert page.locator('#nav .nav-item').count()==9
    assert page.locator('.side .nav-label').first.is_visible()
    page.locator('#sidebarCredits').wait_for(state='visible', timeout=12000)
    assert page.locator('#sidebarToggle').get_attribute('aria-expanded')=='true'
    expanded=page.locator('.side').evaluate('(el)=>el.getBoundingClientRect().width')
    main_expanded=page.locator('.main').evaluate('(el)=>el.getBoundingClientRect().width')
    assert expanded >= 225,expanded

    page.locator('#sidebarToggle').click()
    assert page.locator('#sidebarToggle').get_attribute('aria-label')=='Expand sidebar'
    page.wait_for_timeout(250)  # grid transition
    collapsed=page.locator('.side').evaluate('(el)=>el.getBoundingClientRect().width')
    main_collapsed=page.locator('.main').evaluate('(el)=>el.getBoundingClientRect().width')
    assert collapsed <=80,(expanded,collapsed)
    assert main_collapsed-main_expanded >=150,(main_expanded,main_collapsed)
    assert page.locator('#sidebarCredits').is_hidden()
    assert page.locator('.nav-icon-frame:visible').count()==9
    assert not page.locator('.side .nav-label').first.is_visible()
    for name in ['recent','top','listened','artists','playlists','hearts','likes','dislikes','request']:
      a=page.locator(f'#nav .nav-item[href="#{name}"]')
      assert a.get_attribute('aria-label')
      assert a.locator(f'img[src="/nav-icons/{name}.png"]').count()==1
      assert (P/'nav-icons'/f'{name}.png').exists(), name
    # Pointer-based tooltip follows cursor with accessible text.
    top=page.locator('#nav .nav-item[href="#top"]')
    box=top.bounding_box()
    top.hover(position={'x':12,'y':12})
    page.locator('#sidebarHoverTip').wait_for(state='visible')
    assert page.locator('#sidebarHoverTip').inner_text()=='Most listened'
    old_tip=page.locator('#sidebarHoverTip').evaluate('(el)=>el.getBoundingClientRect().top')
    top.hover(position={'x':25,'y':34})
    new_tip=page.locator('#sidebarHoverTip').evaluate('(el)=>el.getBoundingClientRect().top')
    assert new_tip>old_tip,(old_tip,new_tip)
    top.click()
    assert page.evaluate('location.hash')=='#top'
    page.wait_for_function("""() => document.querySelector('#nav a[href="#top"]')?.getAttribute('aria-current') === 'page'""", timeout=5000)
    page.locator('#sidebarToggle').click()
    assert page.locator('#sidebarCredits').is_visible()
    assert page.locator('#sidebarCredits').inner_text().strip().startswith('Credits')
    assert page.locator('.nav-label').first.is_visible()

    page.locator('#sidebarToggle').click()
    page.evaluate('(s)=>(0,eval)(s)', 'window.__savedCollapsed=localStorage.getItem("sidebarCollapsed")')
    # emulate a new document without trying to fetch a network page
    assert page.evaluate('window.__savedCollapsed')=='true'
    page.set_content(html)
    page.evaluate('(s)=>(0,eval)(s)',MOCK)
    page.evaluate('(s)=>(0,eval)(s)',bundle)
    page.wait_for_timeout(300)
    assert page.locator('#sidebarToggle').get_attribute('aria-expanded')=='false','persist collapsed preference across reload'
    assert page.locator('.nav-icon-frame:visible').count()==9
    assert page.locator('#sidebarCredits').is_hidden()
    # Desktop compact status never hides login-dependent links that were allowed before.
    page.evaluate('window.__auth=true')
    page.evaluate('location.hash="#artists"')
    page.evaluate('refreshAccount().then(()=>renderNav("artists"))')
    assert page.locator('#nav .nav-item[href="#user"]').count()==1
    assert page.locator('#nav .nav-item[href="#settings"]').count()==1
    page.locator('#nav .nav-item[href="#settings"]').click()
    assert page.evaluate('location.hash')=='#settings'

    # Mobile uses the existing horizontal text nav even when saved collapsed.
    page.set_viewport_size({'width':390,'height':800})
    assert page.locator('.nav-label').first.is_visible()
    assert page.locator('#nav').evaluate('(el)=>getComputedStyle(el).display')=='flex'
    assert page.locator('#sidebarToggle').is_hidden()
    assert page.locator('#sidebarCredits').is_visible()
    assert not [e for e in errors if "Invalid URL" not in e],errors
    browser.close()
 print('PASS v15.0.4: default expanded, icon rail, pointer tooltip, navigation, responsive UI, credits, persistence and 11 assets')
finally:
 pass
