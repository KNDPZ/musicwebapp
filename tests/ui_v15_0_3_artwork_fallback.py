"""Browser regression: missing online artwork recovers embedded MP3 covers locally and through a peer relay."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64
P=Path(__file__).resolve().parents[1]/'public'
app=(P/'app.js').read_text()
start=app.index('// If external album/artist art is missing')
end=app.index('\nlet loadError =',start)
js='''
const enc=encodeURIComponent;
const tracks=[
 {id:'missing',title:'No Own Cover',artist:'Test',artists:['Test'],album:'Collection'},
 {id:'embedded',title:'Cover Present',artist:'Test',artists:['Test'],album:'Collection'},
 {id:'peer|remote',remote_id:'remote',origin:'https://peer.test',title:'Remote',artist:'Peers',artists:['Peers'],album:'Peer Album'},
 {id:'peer|other',remote_id:'other',origin:'https://peer.test',title:'Remote With Cover',artist:'Peers',artists:['Peers'],album:'Peer Album'}
];
const artistsOf=(t)=>t.artists||[t.artist];
const albumName=(t)=>t.album||'';
const primaryArtist=(t)=>artistsOf(t)[0];
const peerResourceUrl=(origin,part)=>'/_peer/peer1'+part;
'''+app[start:end].replace('location.href','document.baseURI').replace('location.origin','new URL(document.baseURI).origin')
png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/cXcAAAAASUVORK5CYII=')
seen=[]
def route_handler(route):
    url=route.request.url
    seen.append(url)
    if '/art/track' in url and ('id=embedded' in url or 'id=other' in url):
        route.fulfill(status=200,body=png,headers={'content-type':'image/png'})
    elif '/art/' in url:
        route.fulfill(status=404,body='')
    else:route.fulfill(status=200,content_type='text/html',body='<!doctype html><html><body></body></html>')
with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    page=browser.new_page()
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/*',route_handler)
    page.goto('about:blank')
    page.set_content('<!doctype html><html><head><base href="https://wasp-test.invalid/"></head><body></body></html>')
    page.add_script_tag(content=js)
    for label,url,expected in [
      ('album','/art/album?artist=Test&album=Collection','id=embedded'),
      ('artist','/art/artist?name=Test','id=embedded'),
      ('direct track','/art/track?id=missing','id=embedded'),
      ('remote album','/_peer/peer1/art/album?artist=Peers&album=Peer%20Album','/_peer/peer1/art/track?id=other'),
    ]:
        seen.clear()
        page.evaluate('url => { document.body.innerHTML=`<span class="art"><img src="${url}"></span>` }',url)
        try: page.wait_for_function('''(query)=>{
          const img=document.querySelector('img');return img && img.complete && img.naturalWidth>0 && img.src.includes(query);
        }''',arg=expected,timeout=4000)
        except Exception:
            print('DEBUG',label,seen,errors,page.evaluate('''()=>({base:document.baseURI,href:location.href,images:[...document.querySelectorAll('img')].map(x=>({src:x.src,complete:x.complete,nat:x.naturalWidth}))})'''))
            raise
        assert any('art/track' in req for req in seen), (label,seen)
    assert not errors,errors
    browser.close()
print('PASS v15.0.3: browser resolves album, artist, direct-track and private-peer missing art through MP3 covers')
