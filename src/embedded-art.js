// Extract a bounded ID3v2 album picture from an original MP3 without rewriting
// audio. Shared by the Cloudflare Worker and the deterministic unit tests.
export const MAX_ID3_ART_READ = 6 * 1024 * 1024;
export const MAX_EMBEDDED_IMAGE = 5 * 1024 * 1024;
const sync = (b,p) => ((b[p]&127)<<21)|((b[p+1]&127)<<14)|((b[p+2]&127)<<7)|(b[p+3]&127);
const big = (b,p) => ((b[p]*0x1000000)+(b[p+1]<<16)+(b[p+2]<<8)+b[p+3]);
const text = (b) => String.fromCharCode(...b);
function unescapeUnsync(b){
  const out=new Uint8Array(b.length);let k=0;
  for(let i=0;i<b.length;i++){out[k++]=b[i];if(b[i]===255&&b[i+1]===0)i++;}
  return out.slice(0,k);
}
function pictureFromFrame(frame,version,unsynchronised){
  if(unsynchronised)frame=unescapeUnsync(frame);
  // An APIC header contains MIME, image type and description. The actual
  // image signature is authoritative (not the user-editable MIME string).
  let start=0;
  if(version===2)start=5; // encoding + 3-letter image format + picture type
  else {
    // Encoding, NUL-terminated MIME type and picture type.
    let end=1;while(end<Math.min(frame.length,128)&&frame[end]!==0)end++;
    if(end>=frame.length||end>=128)return null;
    start=end+2;
  }
  const until=Math.min(frame.length,start+65536);
  for(let i=start;i<until;i++){
    let type='';
    if(frame[i]===255&&frame[i+1]===216&&frame[i+2]===255)type='image/jpeg';
    else if(frame[i]===137&&frame[i+1]===80&&frame[i+2]===78&&frame[i+3]===71&&frame[i+4]===13)type='image/png';
    else if(frame[i]===82&&frame[i+1]===73&&frame[i+2]===70&&frame[i+3]===70&&text(frame.subarray(i+8,i+12))==='WEBP')type='image/webp';
    if(!type)continue;
    let data=frame.subarray(i);
    if(data.length<32||data.length>MAX_EMBEDDED_IMAGE)return null;
    return {type,bytes:data};
  }
  return null;
}
export function extractEmbeddedArt(input){
  const b=input instanceof Uint8Array?input:new Uint8Array(input);
  if(b.length<16||text(b.subarray(0,3))!=='ID3'||![2,3,4].includes(b[3]))return null;
  const v=b[3],size=sync(b,6),limit=Math.min(b.length,10+size);
  if(size<=0||size>MAX_ID3_ART_READ-10)return null;
  let p=10,best=null;
  // Skip ID3 extended header when present.
  if((b[5]&0x40)&&v>=3){
    if(p+4>limit)return null;
    const ext=v===4?sync(b,p):big(b,p)+4;
    if(ext<4||p+ext>limit)return null;
    p+=ext;
  }
  const header=v===2?6:10;
  while(p+header<=limit){
    const id=text(b.subarray(p,p+(v===2?3:4)));
    if(!/^[A-Z0-9]{3,4}$/.test(id))break;
    const length=v===2?(b[p+3]<<16)|(b[p+4]<<8)|b[p+5]:v===4?sync(b,p+4):big(b,p+4);
    if(!length||length>MAX_ID3_ART_READ||p+header+length>limit)break;
    if(id==='APIC'||id==='PIC'){
      const flags=v>=3?b[p+9]:0;
      // Ignore compressed/encrypted picture frames, which cannot be decoded
      // safely without an ID3 library.
      if(!(flags&0x0c)){
        const payload=b.subarray(p+header,p+header+length);
        const result=pictureFromFrame(payload,v,!!(b[5]&0x80)||!!(flags&0x02));
        if(result){
          const kind=v===2?payload[4]:(()=>{let j=1;while(j<Math.min(payload.length,128)&&payload[j]!==0)j++;return payload[j+1];})();
          if(kind===3)return result; // Prefer official front cover
          if(!best)best=result;
        }
      }
    }
    p+=header+length;
  }
  return best;
}
