// tools/gamezone/glbNode.mjs — load a Draco-compressed GLB in Node (bench/tests).
// Materials/textures are stripped (geometry, skin and clips only). ADR-0130.
import fs from 'fs';
import { createRequire } from 'module';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const require = createRequire(import.meta.url);
const draco3d = require('draco3d');
const draco = await draco3d.createDecoderModule({});
// minimal DRACOLoader shim
const shim = { preload(){return this;}, decodeDracoFile(buffer, cb, attributeIDs, attributeTypes) {
  const dec = new draco.Decoder(); const arr = new Int8Array(buffer);
  const buf = new draco.DecoderBuffer(); buf.Init(arr, arr.length);
  const mesh = new draco.Mesh(); const st = dec.DecodeBufferToMesh(buf, mesh); if(!st.ok()) throw new Error(st.error_msg());
  const g = new THREE.BufferGeometry();
  const nf = mesh.num_faces(); const idx = new Uint32Array(nf*3); const ia = new draco.DracoInt32Array();
  for (let i=0;i<nf;i++){ dec.GetFaceFromMesh(mesh,i,ia); idx[i*3]=ia.GetValue(0); idx[i*3+1]=ia.GetValue(1); idx[i*3+2]=ia.GetValue(2);} g.setIndex(new THREE.BufferAttribute(idx,1));
  for (const name in attributeIDs) { const att = dec.GetAttributeByUniqueId(mesh, attributeIDs[name]); const n = mesh.num_points()*att.num_components();
    const T = ({Float32Array,Uint16Array,Uint8Array,Int16Array,Int8Array,Uint32Array})[attributeTypes[name]]||attributeTypes[name]; let a, out;
    if (T===Float32Array){ a=new draco.DracoFloat32Array(); dec.GetAttributeFloatForAllPoints(mesh,att,a);} else if (T===Uint16Array){a=new draco.DracoUInt16Array(); dec.GetAttributeUInt16ForAllPoints(mesh,att,a);} else if (T===Uint8Array){a=new draco.DracoUInt8Array(); dec.GetAttributeUInt8ForAllPoints(mesh,att,a);} else {a=new draco.DracoFloat32Array(); dec.GetAttributeFloatForAllPoints(mesh,att,a);}
    out = new (T||Float32Array)(n); for(let i=0;i<n;i++) out[i]=a.GetValue(i);
    g.setAttribute(name, new THREE.BufferAttribute(out, att.num_components(), att.normalized()));
  }
  cb(g);
}};

export async function loadGlbNode(path) {
const raw = fs.readFileSync(path);
const jl = raw.readUInt32LE(12); const json = JSON.parse(raw.subarray(20,20+jl).toString());
const binLen = raw.readUInt32LE(20+jl); const bin = raw.subarray(28+jl, 28+jl+binLen);
for (const m of json.meshes||[]) for (const p of m.primitives) delete p.material;
for (const k of ['materials','textures','images','samplers']) delete json[k];
json.extensionsUsed=(json.extensionsUsed||[]).filter(e=>/draco/i.test(e)); json.extensionsRequired=(json.extensionsRequired||[]).filter(e=>/draco/i.test(e));
let js = Buffer.from(JSON.stringify(json)); js = Buffer.concat([js, Buffer.alloc((4-js.length%4)%4, 0x20)]);
const out = Buffer.alloc(20+js.length+8+bin.length);
out.writeUInt32LE(0x46546C67,0); out.writeUInt32LE(2,4); out.writeUInt32LE(out.length,8);
out.writeUInt32LE(js.length,12); out.writeUInt32LE(0x4E4F534A,16); js.copy(out,20);
out.writeUInt32LE(bin.length,20+js.length); out.writeUInt32LE(0x004E4942,24+js.length); bin.copy(out,28+js.length);
const loader = new GLTFLoader(); loader.setDRACOLoader(shim);
const g = await new Promise((res,rej)=>loader.parse(out.buffer.slice(out.byteOffset,out.byteOffset+out.length),'',res,rej));
  return g;
}
