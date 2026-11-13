// Read-only artwork selection for albums and artists in server folders.
export function folderFallbackCover(kind, search, catalogue, covers){
 const artist=String(search.get(kind==='artist'?'name':'artist')||'').trim().toLowerCase();
 const album=String(search.get('album')||'').trim().toLowerCase();
 if(!artist || (kind==='album'&&!album))return null;
 for(const t of catalogue.values()){
  const names=String(t.artist||'').toLowerCase().split(/\s*(?:[,;&]|\bfeat\.?\s|\bft\.?\s)\s*/);
  if(!names.includes(artist))continue;
  if(kind==='album'&&String(t.album||'').trim().toLowerCase()!==album)continue;
  const pic=covers.get(t.id);if(pic)return pic;
 }
 return null;
}
