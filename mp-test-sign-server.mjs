// Burner-key NIP-07 signing microservice for the MP live test.
// Runs in torii-quest/ so @noble/curves + @noble/hashes resolve.
import http from 'node:http';
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes } from 'node:crypto';

const enc = new TextEncoder();
function bytesToHex(b){let h='';for(const x of b)h+=x.toString(16).padStart(2,'0');return h;}
function hexToBytes(h){const o=new Uint8Array(h.length/2);for(let i=0;i<o.length;i++)o[i]=parseInt(h.slice(i*2,i*2+2),16);return o;}
function serializeForId(e){return JSON.stringify([0,e.pubkey,e.created_at,e.kind,Array.isArray(e.tags)?e.tags:[],typeof e.content==='string'?e.content:'']);}

const CHARSET='qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function bech32Polymod(v){let G=[0x3b6a57b2,0x26508e6d,0x1ea119fa,0x3d4233dd,0x2a1462b3];let c=1;for(const x of v){const t=c>>25;c=((c&0x1ffffff)<<5)^x;for(let i=0;i<5;i++)if((t>>i)&1)c^=G[i];}return c;}
function bech32HrpExpand(hrp){const o=[];for(const c of hrp)o.push(c.charCodeAt(0)>>5);o.push(0);for(const c of hrp)o.push(c.charCodeAt(0)&31);return o;}
function bech32CreateChecksum(hrp,d){const v=bech32HrpExpand(hrp).concat(d);const m=bech32Polymod(v.concat([0,0,0,0,0,0]))^1;const r=[];for(let i=0;i<6;i++)r.push((m>>(5*(5-i)))&31);return r;}
function convertBits(data,from,to,pad){let acc=0,bits=0;const o=[];const maxv=(1<<to)-1,maxAcc=(1<<(from+to-1))-1;for(const v of data){acc=((acc<<from)|v)&maxAcc;bits+=from;while(bits>=to){bits-=to;o.push((acc>>bits)&maxv);}}if(pad&&bits)o.push((acc<<(to-bits))&maxv);return o;}
function bech32Encode(hrp,d){const c=d.concat(bech32CreateChecksum(hrp,d));return hrp+'1'+c.map(i=>CHARSET[i]).join('');}

function generateKeyPair(){
  const priv=randomBytes(32);
  const privHex=bytesToHex(priv);
  const pubHex=bytesToHex(schnorr.getPublicKey(priv));
  const data5=convertBits(Array.from(hexToBytes(pubHex)),8,5,true);
  const npub=bech32Encode('npub',data5);
  return {privHex,pubHex,npub};
}
function finalizeEvent(evt,privHex){
  const priv=hexToBytes(privHex);
  const pubHex=bytesToHex(schnorr.getPublicKey(priv));
  const event={kind:evt.kind,created_at:evt.created_at,content:evt.content,tags:evt.tags,pubkey:pubHex};
  const id=bytesToHex(sha256(enc.encode(serializeForId(event))));
  event.id=id;
  event.sig=bytesToHex(schnorr.sign(hexToBytes(id),priv));
  return event;
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');
  if(req.method==='GET'&&req.url==='/keypair'){res.end(JSON.stringify(generateKeyPair()));return;}
  if(req.method==='POST'&&req.url==='/sign'){
    let body='';for await(const c of req)body+=c;
    try{const{evt,privHex}=JSON.parse(body);res.end(JSON.stringify(finalizeEvent(evt,privHex)));}
    catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
    return;
  }
  res.statusCode=404;res.end('{}');
});
server.listen(9876,'127.0.0.1',()=>console.log('sign-server on 9876'));
