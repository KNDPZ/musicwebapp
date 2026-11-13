// Safe, small-footprint BBCode for the public-site credits footer.
// Only a small set of tags is recognized; no raw HTML or JavaScript is executed.
const SAFE_COLORS = new Set(['white', 'gray', 'grey', 'silver', 'green', 'yellow', 'orange', 'red', 'blue']);
function safeSidebarUrl(value) {
  const raw=String(value || '').trim();
  // Disallow data:, javascript:, protocol-relative URLs and off-origin HTTP.
  if (/^\/(?!\/)[^\s<>]*$/.test(raw)) return raw;
  if (!/^https:\/\//i.test(raw)) return '';
  try { const u=new URL(raw); return u.protocol==='https:' && !u.username && !u.password ? u.href : ''; }
  catch { return ''; }
}
function safeColor(value) {
  const s=String(value||'').trim().toLowerCase();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(s) || SAFE_COLORS.has(s) ? s : '';
}

export function renderSidebarBBCode(target, raw) {
  target.replaceChildren();
  const input=String(raw||'').slice(0,8000);
  // Images are deliberately matched as a complete pair, so their URL text
  // cannot be interpreted as markup. Unrecognized tags are harmless text.
  const token=/\[img\]([\s\S]*?)\[\/img\]|\[(\/)?(b|i|u|center|color|url|br)(?:=([^\]\r\n]+))?\]/gi;
  const levels=[{tag:'root',node:target}];
  let pos=0, match, count=0;
  const current=()=>levels[levels.length-1].node;
  const addText=text=>{ if(text)current().append(document.createTextNode(text)); };
  while((match=token.exec(input))!==null && count++<350) {
    addText(input.slice(pos,match.index));pos=token.lastIndex;
    if (match[1]!==undefined) {
      const url=safeSidebarUrl(match[1]);
      if(url){const img=document.createElement('img');img.src=url;img.alt='';img.loading='lazy';img.referrerPolicy='no-referrer';current().append(img);}
      else addText(match[0]);
      continue;
    }
    const closing=!!match[2],tag=match[3].toLowerCase(),arg=match[4]||'';
    if(tag==='br'&&!closing){current().append(document.createElement('br'));continue;}
    if (closing) {
      if(levels.length>1 && levels[levels.length-1].tag===tag){
        const last=levels.pop();
        if(tag==='url' && last.fromText){
          const url=safeSidebarUrl(last.node.textContent);
          if(url){last.node.href=url;} else last.node.replaceWith(document.createTextNode(last.node.textContent));
        }
      } else addText(match[0]);
      continue;
    }
    if(levels.length>12){addText(match[0]);continue;}
    if(tag==='color'&&!safeColor(arg)){addText(match[0]);continue;}
    const url=tag==='url' ? safeSidebarUrl(arg) : '';
    if(tag==='url'&&arg&&!url){addText(match[0]);continue;}
    const element=document.createElement(({b:'strong',i:'em',u:'u',center:'span',color:'span',url:'a'})[tag]);
    if(tag==='center')element.className='bb-center';
    if(tag==='color')element.style.color=safeColor(arg);
    if(tag==='url'){
      if(url)element.href=url;
      element.target='_blank';element.rel='noopener noreferrer';element.referrerPolicy='no-referrer';
    }
    current().append(element);levels.push({tag,node:element,fromText:tag==='url'&&!arg});
  }
  addText(input.slice(pos));
}

// Safely display credits saved by the older HTML editor. Scripts, styles and
// arbitrary attributes are discarded; existing database values are retained
// untouched, so an upgrade cannot erase previously saved work.
export function legacySidebarToBBCode(source) {
  const raw=String(source||'');
  if(!raw.includes('<'))return raw;
  if(typeof DOMParser==='undefined')return raw.replace(/<[^>]*>/g,'');
  const parsed=new DOMParser().parseFromString(raw,'text/html');
  const walk=node=>{
    if(node.nodeType===3)return node.nodeValue||'';
    if(node.nodeType!==1)return '';
    const tag=node.tagName.toLowerCase();
    if(['script','style','iframe','object','embed','svg','head','noscript'].includes(tag))return '';
    if(tag==='br')return '\n';
    if(tag==='img'){const url=safeSidebarUrl(node.getAttribute('src'));return url?`[img]${url}[/img]`:'';}
    const content=Array.from(node.childNodes).map(walk).join('');
    if(tag==='a'){
      const url=safeSidebarUrl(node.getAttribute('href'));
      return url?`[url=${url}]${content}[/url]`:content;
    }
    if(['b','strong'].includes(tag))return `[b]${content}[/b]`;
    if(['i','em'].includes(tag))return `[i]${content}[/i]`;
    if(tag==='u')return `[u]${content}[/u]`;
    if(['div','p','li','h1','h2','h3','section'].includes(tag))return content+'\n';
    return content;
  };
  return Array.from(parsed.body.childNodes).map(walk).join('').trim();
}
