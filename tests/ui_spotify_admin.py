"""Isolated WASP admin UI test: requests subtab, theme, masked secret, save/remove."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import re
import json

ROOT=Path(__file__).resolve().parents[1]/'public'
html=(ROOT/'admin.html').read_text()
html=re.sub(r'<script[^>]*src="/admin\.js"[^>]*></script>', '', html)
html=html.replace('<link rel="stylesheet" href="/style.css">',f'<style>{(ROOT/"style.css").read_text()}</style>')
admin_js=re.sub(r'^import .*?;\n','',(ROOT/'admin.js').read_text(),flags=re.M)

bbcode_js=re.sub(r'^export function ', 'function ', (ROOT/'sidebar-bbcode.js').read_text(), flags=re.M)
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page(viewport={'width':1260,'height':830})
    page.on('dialog',lambda dialog:dialog.accept())
    errors=[];calls=[];page.on('pageerror',lambda error:errors.append(str(error)))
    saved={'client_id':'', 'secret_configured':False,'saved_in_admin':False,'source':'none','storage_ready':True,'locked':False}
    mock_js = """
    window.fetch=async(input,opts={})=>{
      const uri=String(input), method=opts.method||'GET';
      let data={};
      if(uri==='/api/me')data={admin:true,authenticated:true};
      else if(uri==='/api/admin/spotify-config') {
        if(method==='PUT'){
          const v=JSON.parse(opts.body);window.__calls.push(['save',v]);
          Object.assign(window.__saved,{client_id:v.client_id,secret_configured:true,saved_in_admin:true,source:'admin'});
        }
        if(method==='DELETE'){
          window.__calls.push(['delete',null]);
          Object.assign(window.__saved,{client_id:'',secret_configured:false,saved_in_admin:false,source:'none'});
        }
        data={...window.__saved};
      }
      else if(uri==='/api/site')data={name:'WASP',title:'WASP',ad:{enabled:false,html:'',height:340},favicon:0};
      else if(uri==='/api/admin/network')data={share:false,peers:[]};
      else if(['/api/tracks','/api/admin/playlists','/api/admin/requests'].includes(uri))data=[];
      else data=[];
      return new Response(JSON.stringify(data),{status:200,headers:{'content-type':'application/json'}});
    };
    """
    page.goto('about:blank')
    page.set_content(html)
    page.evaluate('location.hash="#requests/spotify"')
    page.evaluate('window.__calls=[]; window.__saved={client_id:"",secret_configured:false,saved_in_admin:false,source:"none",storage_ready:true,locked:false}')
    page.evaluate('(src)=>(0,eval)(src)',mock_js)
    page.evaluate('(src)=>(0,eval)(src)',bbcode_js+'\n'+admin_js)
    page.get_by_role('tab',name='Spotify settings').wait_for()
    page.wait_for_function('document.querySelector("#reqTabSpotify").getAttribute("aria-selected")==="true"')
    assert page.locator('#s-requests').is_visible()
    assert page.locator('#reqSpotifyPanel').is_visible()
    assert not page.locator('#reqQueuePanel').is_visible()
    assert page.locator('#spotifyClientId').evaluate('(el)=>getComputedStyle(el).borderRadius')=='24px'
    page.locator('#spotifyClientId').fill('validclient123')
    page.locator('#spotifyClientSecret').fill('verysecret123')
    assert page.locator('#spotifyClientSecret').get_attribute('type')=='password'
    page.get_by_role('button',name='Save credentials').click()
    page.get_by_text('Spotify credentials saved. Playlist search will use them if Spotify grants API access.').wait_for()
    assert page.evaluate("window.__calls.at(-1)")==['save',{'client_id':'validclient123','client_secret':'verysecret123'}]
    assert page.locator('#spotifyClientSecret').input_value()==''
    assert page.get_by_text('A secret is saved.',exact=False).is_visible()
    page.get_by_role('tab',name='Request queue').click()
    assert page.locator('#reqQueuePanel').is_visible()
    assert page.url.endswith('#requests')
    page.get_by_role('tab',name='Spotify settings').click()
    assert page.locator('#reqSpotifyPanel').is_visible()
    page.get_by_role('button',name='Remove saved credentials').click()
    page.get_by_text('Saved Spotify credentials removed.').wait_for()
    assert page.evaluate("window.__calls.at(-1)")==['delete',None]
    assert not errors,errors
    print('PASS: themed Requests subtabs, deeplink, masked secret, save, delete, status notifications')
    browser.close()
