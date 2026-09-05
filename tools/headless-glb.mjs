// tools/headless-glb.mjs — author a headless first-person body from a full GLB.
//
// The FP body renders on layer 2 (main camera only, hidden from the mirror) and
// is parented to the player. At authoring time the HEAD GEOMETRY is removed so
// the skull never clips the eye camera; a runtime clip plane then slices the
// neck stump (see src/firstPersonBody.js). All three player GLBs share the same
// Mixamo 24-bone skeleton, so the head is simply every vertex whose dominant
// skin weight lives on Head / head_end / headfront.
//
// The FP body only plays idle/walk/run, so we keep just those clips (matching
// chiefmonkey-headless.glb's 3-clip layout) and drop the rest to keep the file
// small. The result is Draco-compressed + WebP/-texture preserved.
//
// Usage: node tools/headless-glb.mjs --in public/models/guest-master.glb \
//        --out public/guest-headless.glb --keep-anims Idle_02,Stylish_Walk_inplace,Running

import { NodeIO, Accessor } from '@gltf-transform/core';
import {
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRMaterialsIOR,
  KHRMaterialsSpecular,
  KHRONOS_EXTENSIONS,
} from '@gltf-transform/extensions';
import { prune, draco, textureCompress } from '@gltf-transform/functions';
import draco3d from 'draco3d';

function parseArgs(argv) {
  const a = { in: null, out: null, keepAnims: [], compressTextures: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--in') a.in = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--keep-anims') a.keepAnims = (argv[++i] || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (argv[i] === '--compress-textures') a.compressTextures = true;
  }
  if (!a.in || !a.out) throw new Error('usage: --in <glb> --out <glb> --keep-anims a,b,c [--compress-textures]');
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const io = new NodeIO()
    .registerExtensions([EXTTextureWebP, KHRDracoMeshCompression, KHRMaterialsIOR, KHRMaterialsSpecular, ...KHRONOS_EXTENSIONS])
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule({}),
      'draco3d.encoder': await draco3d.createEncoderModule({}),
    });

  const doc = await io.read(args.in);
  const root = doc.getRoot();

  // ── 1. Locate head skin-joints ──────────────────────────────────────────────
  const skin = root.listSkins()[0];
  const HEAD_NAMES = new Set(['Head', 'head_end', 'headfront']);
  const headJ = new Set();
  skin.listJoints().forEach((node, idx) => { if (HEAD_NAMES.has(node.getName())) headJ.add(idx); });
  console.error(`head skin-joints: ${[...headJ].join(',')} (${[...headJ].map(i => skin.listJoints()[i].getName()).join('/')})`);

  // ── 2. Remove head vertices ─────────────────────────────────────────────────
  const mesh = root.listMeshes()[0];
  const prim = mesh.listPrimitives()[0];
  const J = prim.getAttribute('JOINTS_0').getArray();
  const W = prim.getAttribute('WEIGHTS_0').getArray();
  const P = prim.getAttribute('POSITION').getArray();
  const N = prim.getAttribute('NORMAL').getArray();
  const UV = prim.getAttribute('TEXCOORD_0').getArray();
  const I = prim.getIndices().getArray();

  const nV = P.length / 3;
  const keep = new Uint8Array(nV).fill(1);
  let removed = 0;
  for (let v = 0; v < nV; v++) {
    let dom = J[v * 4], domW = W[v * 4];
    for (let k = 1; k < 4; k++) { if (W[v * 4 + k] > domW) { domW = W[v * 4 + k]; dom = J[v * 4 + k]; } }
    if (headJ.has(dom)) { keep[v] = 0; removed++; }
  }
  console.error(`removing ${removed}/${nV} verts (head)`);

  const remap = new Int32Array(nV).fill(-1);
  let nk = 0;
  for (let v = 0; v < nV; v++) if (keep[v]) remap[v] = nk++;

  const newIdx = [];
  const nt = Math.floor(I.length / 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    if (keep[a] && keep[b] && keep[c]) newIdx.push(remap[a], remap[b], remap[c]);
  }

  const nP = new Float32Array(nk * 3), nN = new Float32Array(nk * 3), nUV = new Float32Array(nk * 2);
  const nJ = new Uint16Array(nk * 4), nW = new Float32Array(nk * 4);
  for (let v = 0; v < nV; v++) {
    if (!keep[v]) continue;
    const d = remap[v];
    nP.set(P.subarray(v * 3, v * 3 + 3), d * 3);
    nN.set(N.subarray(v * 3, v * 3 + 3), d * 3);
    nUV.set(UV.subarray(v * 2, v * 2 + 2), d * 2);
    nJ.set(J.subarray(v * 4, v * 4 + 4), d * 4);
    nW.set(W.subarray(v * 4, v * 4 + 4), d * 4);
  }

  const mk = (type, arr) => doc.createAccessor().setType(type).setArray(arr);
  prim.setAttribute('POSITION', mk('VEC3', nP));
  prim.setAttribute('NORMAL', mk('VEC3', nN));
  prim.setAttribute('TEXCOORD_0', mk('VEC2', nUV));
  prim.setAttribute('JOINTS_0', mk('VEC4', nJ));
  prim.setAttribute('WEIGHTS_0', mk('VEC4', nW));
  prim.setIndices(mk('SCALAR', new Uint32Array(newIdx)));

  // ── 3. Keep only the FP idle/walk/run clips ────────────────────────────────
  const keepClips = new Set(args.keepAnims);
  let dropped = 0;
  for (const anim of root.listAnimations()) {
    if (keepClips.has(anim.getName())) continue;
    anim.dispose();
    dropped++;
  }
  console.error(`kept ${args.keepAnims.length} clips, dropped ${dropped}`);

  // ── 4. Clean orphans + compress textures + re-encode Draco ─────────────────
  const transforms = [prune()];
  if (args.compressTextures) transforms.push(textureCompress({ targetFormat: 'webp', quality: 85 }));
  transforms.push(draco());
  await doc.transform(...transforms);

  await io.write(args.out, doc);
  console.error(`wrote ${args.out}`);
}

main().catch(err => { console.error(err); process.exit(1); });
