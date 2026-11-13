import assert from 'node:assert/strict';
import {folderFallbackCover} from '../docker/folder-art.mjs';
const catalogue=new Map([
 ['one',{id:'one',title:'No picture',artist:'Test Band',album:'Album A'}],
 ['two',{id:'two',title:'Has picture',artist:'Test Band',album:'Album A'}],
 ['three',{id:'three',title:'Other album',artist:'Test Band',album:'Album B'}],
 ['four',{id:'four',title:'Different artist',artist:'Other Band',album:'Album A'}],
]);
const image=Buffer.from([0xff,0xd8,0xff,0x55]);
const covers=new Map([['two',{data:image,type:'image/jpeg'}],['four',{data:Buffer.from('other'),type:'image/jpeg'}]]);
assert.deepEqual(folderFallbackCover('album',new URLSearchParams('artist=Test+Band&album=Album+A'),catalogue,covers)?.data,image);
assert.deepEqual(folderFallbackCover('artist',new URLSearchParams('name=Test+Band'),catalogue,covers)?.data,image);
assert.equal(folderFallbackCover('album',new URLSearchParams('artist=Test+Band&album=Album+B'),catalogue,covers),null);
assert.equal(folderFallbackCover('album',new URLSearchParams('artist=Other+Band&album=Album+A'),catalogue,covers)?.data.toString(),'other');
assert.equal(folderFallbackCover('artist',new URLSearchParams('name=Unknown'),catalogue,covers),null);
console.log('PASS v15.0.3: Docker folder album/artist fallback selects only matching original MP3 covers');
