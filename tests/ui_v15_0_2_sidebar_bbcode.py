"""WASP v15.0.2 BBCode sidebar: bottom alignment, dynamic height, preview, safe links and legacy conversion."""
from pathlib import Path
import re
from playwright.sync_api import sync_playwright

P = Path(__file__).resolve().parents[1] / 'public'
css = (P / 'style.css').read_text()
raw_bb = (P / 'sidebar-bbcode.js').read_text()
bb = re.sub(r'^export function ', 'function ', raw_bb, flags=re.M)
admin = (P / 'admin.html').read_text().replace('<link rel="stylesheet" href="/style.css">', f'<style>{css}</style>')
admin = re.sub(r'<script[^>]*src="/admin.js(?:\?v=[^"]+)?"[^>]*></script>', '', admin)
admin_js = re.sub(r'^import .*?;\n', '', (P / 'admin.js').read_text(), flags=re.M)

with sync_playwright() as pw:
    browser = pw.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda err: errors.append(str(err)))
    # Use the actual sidebar/player CSS, not a mocked absolute-position footer.
    page.set_content(f'''<!doctype html><style>{css}</style>
    <div class="app"><aside class="side"><a class="brand">WASP</a>
    <nav id="nav"><a class="nav-item">Recently added</a><a class="nav-item">Most listened</a></nav>
    <div id="sidebarCredits" class="sidebar-credits"><div class="sidebar-credits-content" id="credits"></div></div>
    </aside><main class="main"></main></div>
    <div class="player" style="height:120px">Not playing</div>''')
    page.evaluate('(s) => (0,eval)(s)', bb + '\nwindow.__render=renderSidebarBBCode;window.__legacy=legacySidebarToBBCode;')
    page.evaluate('window.__render(document.querySelector("#credits"),"[b]Powered by WASP[/b]")')
    small = page.evaluate('''()=>({sidebar:document.querySelector('.side').getBoundingClientRect().toJSON(),
       credits:document.querySelector('#sidebarCredits').getBoundingClientRect().toJSON(),
       bold:document.querySelector('#credits strong')?.textContent})''')
    assert small['bold'] == 'Powered by WASP', small
    assert small['credits']['height'] < 65, 'single line should not reserve a 170px iframe'
    assert abs(small['sidebar']['bottom'] - small['credits']['bottom']) < 25, 'footer should reach the bottom of the sidebar'
    page.evaluate('window.__render(document.querySelector("#credits"),Array.from({length:8},(_,i)=>"Line "+(i+1)).join("\\n"))')
    large = page.evaluate('''()=>({top:document.querySelector('#sidebarCredits').getBoundingClientRect().top,
      bottom:document.querySelector('#sidebarCredits').getBoundingClientRect().bottom})''')
    assert large['top'] < small['credits']['top'] - 70, 'longer credits should expand upward'
    assert abs(large['bottom'] - small['credits']['bottom']) < 2, 'bottom position should remain anchored'
    page.evaluate('''window.__render(document.querySelector('#credits'),
       '[url=https://github.com/example]Repo[/url]\\n[img]https://example.com/logo.png[/img]\\n[url=javascript:alert(1)]bad[/url]\\n<script>window.pwned=1</script>')''')
    assert page.locator('#credits a').count() == 1
    assert page.locator('#credits a').get_attribute('rel') == 'noopener noreferrer'
    assert page.locator('#credits img').count() == 1
    assert page.locator('#credits script').count() == 0
    assert not page.evaluate('window.pwned || false')
    assert page.locator('#credits').inner_text().find('<script>') >= 0
    legacy = page.evaluate('window.__legacy("<p>Hello <b>world</b></p><script>window.pwned=1</script>")')
    assert legacy == 'Hello [b]world[/b]', legacy
    assert not errors, errors

    panel = browser.new_page(viewport={'width': 1400, 'height': 950})
    admin_errors=[]
    panel.on('pageerror', lambda err: admin_errors.append(str(err)))
    panel.goto('about:blank'); panel.set_content(admin)
    panel.evaluate('location.hash="#settings"')
    panel.evaluate('''window.__submit=null;
    window.fetch=async(url,opts={})=>{
      url=String(url);let data={};
      if(url==='/api/me')data={authenticated:true,admin:true};
      else if(url==='/api/site')data={name:'WASP',title:'WASP',favicon:0,brand_mode:'text',brand_v:0,
          sidebar:{enabled:true,bbcode:null,html:'<p>Legacy credits</p>'},ad:{enabled:false,html:'',height:340}};
      else if(url==='/api/admin/settings'){
        window.__submit=JSON.parse(opts.body);
        data={name:'WASP',title:'WASP',sidebar:{enabled:true,bbcode:window.__submit.sidebar_bbcode,html:'<p>Legacy credits</p>'}};
      }else if(url==='/api/admin/version')data={version:'15.0.2'};
      else if(url==='/api/admin/crons')data={timezone:'UTC',jobs:{}};
      else if(url==='/api/admin/requests'||url==='/api/tracks'||url==='/api/playlists')data=[];
      return Response.json(data);
    };''')
    panel.evaluate('(s)=>(0,eval)(s)', bb+'\n'+admin_js)
    panel.locator('#sidebarCode').wait_for()
    assert panel.locator('#sidebarCode').input_value()=='Legacy credits', 'old saved HTML should convert in editor'
    panel.locator('#sidebarCode').fill('[b]WASP[/b] [url=https://github.com/]GitHub[/url]')
    panel.get_by_text('Live preview').wait_for()
    assert panel.locator('#sidebarPreview strong').inner_text()=='WASP'
    assert panel.locator('#sidebarPreview a').get_attribute('href')=='https://github.com/'
    panel.locator('#sidebarSave').click()
    panel.locator('#sidebarMsg').get_by_text('Saved.').wait_for()
    assert panel.evaluate('window.__submit.sidebar_bbcode')=='[b]WASP[/b] [url=https://github.com/]GitHub[/url]'
    assert 'sidebar_html' not in panel.evaluate('window.__submit'), 'new editor must not save HTML'
    assert not admin_errors, admin_errors
    browser.close()
print('PASS WASP v15.0.2: credits bottom alignment, upward growth, safe BBCode and admin preview/save')
