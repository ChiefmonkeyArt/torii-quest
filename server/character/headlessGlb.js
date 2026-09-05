// server/character/headlessGlb.js — reusable core for authoring a headless FP body
// from an arbitrary player GLB. Server-side only (uses @gltf-transform + draco3d,
// both native/WASM deps too heavy for the browser bundle).
//
// The FP body renders on layer 2 of the main camera (hidden from the mirror) and
// is parented to the player's head. At authoring time we REMOVE every vertex whose
// dominant skin weight lives on Head / head_end / headfront (all three player GLBs
// share the same Mixamo 24-bone skeleton, and the same convention is expected of
// uploaded / AI-generated meshes that pass validateGeneratedMesh). A runtime
// clip plane in src/firstPersonBody.js then slices any residual neck stump.
//
// The FP body only plays idle/walk/run, so we keep just those three clips (the
// exact names ship in the manifest via `keepAnims`) and drop the rest to shrink
// the file. Textures are always re-encoded to WebP (quality 85) and the mesh is
// re-Draco-compressed on write, matching public/*-headless.glb.
//
// This module is ALSO the source of truth for tools/headless-glb.mjs (the CLI
// keeps its own arg parsing but delegates the heavy lifting to authorHeadlessGlb).
//
// authorHeadlessGlb(buffer, opts) → Promise<{
//   ok: true, buffer: Uint8Array, stats: { removedVerts, keptClips, droppedClips, bytesIn, bytesOut }
// } | { ok: false, error: string }>
//
// `buffer` — the input GLB as a Uint8Array / Node Buffer.
// `opts.keepAnims` — array of clip names to keep (default: the three FP clips
//   used by guest / nostrich: ['Idle_02','Stylish_Walk_inplace','Running']).
// `opts.headJointNames` — override the set of head-joint names (default:
//   ['Head','head_end','headfront']).
//   * texture compression (WebP via sharp) was REMOVED in v0.2.771-alpha: sharp's
//     native binary + platform-specific optional deps were a fragile runtime
//     install on the VPS (version drift to 0.35.4 broke @img/* exports), keeping
//     arena-ws from starting. Draco geometry compression remains (the dominant
//     GLB size win); re-add texture compression only if sharp can be installed
//     reproducibly (pinned exact version + verified native binding).
//
// Errors we return (never thrown; callers rely on the tagged union):
//   'invalid-glb'        — @gltf-transform failed to parse the buffer.
//   'no-skin'            — the mesh has no skin (not a rigged character).
//   'no-head-joint'      — none of the skin's joints match headJointNames.
//   'no-mesh'            — the document has no meshes / primitives.
//   'no-required-attrs'  — the primitive is missing POSITION/JOINTS_0/WEIGHTS_0/indices.
//   'no-verts-remaining' — head removal would leave the mesh empty (all verts head-dominant).
//   'author-failed'      — any other authoring-pipeline error (with message in `detail`).

import { WebIO } from '@gltf-transform/core';
import {
  EXTTextureWebP,
  KHRDracoMeshCompression,
  KHRMaterialsIOR,
  KHRMaterialsSpecular,
  KHRONOS_EXTENSIONS,
} from '@gltf-transform/extensions';
import { prune, draco } from '@gltf-transform/functions';
import draco3d from 'draco3d';

export const HEADLESS_GLB_VERSION = 1;

// Sensible defaults matching guest-master.glb / nostrich-master.glb clip names.
// Callers can override; validateGeneratedMesh should ensure any AI mesh ships
// clips matching one of the supported sets.
export const DEFAULT_KEEP_ANIMS = Object.freeze(['Idle_02', 'Stylish_Walk_inplace', 'Running']);
export const DEFAULT_HEAD_JOINTS = Object.freeze(['Head', 'head_end', 'headfront']);

// Cached draco3d WASM modules — loading them takes ~200ms and they're
// per-process singletons.
let _dracoDecoder = null;
let _dracoEncoder = null;
async function _getDracoDeps() {
  if (!_dracoDecoder) _dracoDecoder = await draco3d.createDecoderModule({});
  if (!_dracoEncoder) _dracoEncoder = await draco3d.createEncoderModule({});
  return { 'draco3d.decoder': _dracoDecoder, 'draco3d.encoder': _dracoEncoder };
}

function _fail(error, detail) {
  const out = { ok: false, error };
  if (detail) out.detail = detail;
  return out;
}

export async function authorHeadlessGlb(buffer, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const keepAnims = Array.isArray(o.keepAnims) && o.keepAnims.length > 0
    ? o.keepAnims.slice()
    : DEFAULT_KEEP_ANIMS.slice();
  const headNames = new Set(
    Array.isArray(o.headJointNames) && o.headJointNames.length > 0
      ? o.headJointNames
      : DEFAULT_HEAD_JOINTS,
  );
  if (!buffer || typeof buffer !== 'object' || typeof buffer.length !== 'number') {
    return _fail('invalid-glb', 'buffer missing or not a byte array');
  }
  const bytesIn = buffer.length;
  // WebIO handles both Uint8Array and Buffer (Buffer IS a Uint8Array in Node).
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);

  const io = new WebIO()
    .registerExtensions([
      EXTTextureWebP,
      KHRDracoMeshCompression,
      KHRMaterialsIOR,
      KHRMaterialsSpecular,
      ...KHRONOS_EXTENSIONS,
    ])
    .registerDependencies(await _getDracoDeps());

  let doc;
  try {
    doc = await io.readBinary(bytes);
  } catch (err) {
    return _fail('invalid-glb', (err && err.message) || 'read failed');
  }
  const root = doc.getRoot();

  // ── 1. Locate head skin-joints ─────────────────────────────────────────────
  const skins = root.listSkins();
  if (!skins.length) return _fail('no-skin');
  const skin = skins[0];
  const joints = skin.listJoints();
  const headJ = new Set();
  joints.forEach((node, idx) => { if (headNames.has(node.getName())) headJ.add(idx); });
  if (headJ.size === 0) return _fail('no-head-joint');

  // ── 2. Remove head vertices from the primary primitive ─────────────────────
  const meshes = root.listMeshes();
  if (!meshes.length) return _fail('no-mesh');
  const mesh = meshes[0];
  const prim = mesh.listPrimitives()[0];
  if (!prim) return _fail('no-mesh');

  const attrJ = prim.getAttribute('JOINTS_0');
  const attrW = prim.getAttribute('WEIGHTS_0');
  const attrP = prim.getAttribute('POSITION');
  const idxAcc = prim.getIndices();
  if (!attrJ || !attrW || !attrP || !idxAcc) return _fail('no-required-attrs');

  const J = attrJ.getArray();
  const W = attrW.getArray();
  const P = attrP.getArray();
  const N = prim.getAttribute('NORMAL') ? prim.getAttribute('NORMAL').getArray() : null;
  const UV = prim.getAttribute('TEXCOORD_0') ? prim.getAttribute('TEXCOORD_0').getArray() : null;
  const I = idxAcc.getArray();

  const nV = P.length / 3;
  const keep = new Uint8Array(nV).fill(1);
  let removed = 0;
  for (let v = 0; v < nV; v++) {
    let dom = J[v * 4], domW = W[v * 4];
    for (let k = 1; k < 4; k++) {
      if (W[v * 4 + k] > domW) { domW = W[v * 4 + k]; dom = J[v * 4 + k]; }
    }
    if (headJ.has(dom)) { keep[v] = 0; removed++; }
  }
  if (removed === nV) return _fail('no-verts-remaining');

  const remap = new Int32Array(nV).fill(-1);
  let nk = 0;
  for (let v = 0; v < nV; v++) if (keep[v]) remap[v] = nk++;

  const newIdx = [];
  const nt = Math.floor(I.length / 3);
  for (let t = 0; t < nt; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    if (keep[a] && keep[b] && keep[c]) newIdx.push(remap[a], remap[b], remap[c]);
  }

  const nP = new Float32Array(nk * 3);
  const nN = N ? new Float32Array(nk * 3) : null;
  const nUV = UV ? new Float32Array(nk * 2) : null;
  const nJ = new Uint16Array(nk * 4);
  const nW = new Float32Array(nk * 4);
  for (let v = 0; v < nV; v++) {
    if (!keep[v]) continue;
    const d = remap[v];
    nP.set(P.subarray(v * 3, v * 3 + 3), d * 3);
    if (nN) nN.set(N.subarray(v * 3, v * 3 + 3), d * 3);
    if (nUV) nUV.set(UV.subarray(v * 2, v * 2 + 2), d * 2);
    nJ.set(J.subarray(v * 4, v * 4 + 4), d * 4);
    nW.set(W.subarray(v * 4, v * 4 + 4), d * 4);
  }

  const mk = (type, arr) => doc.createAccessor().setType(type).setArray(arr);
  prim.setAttribute('POSITION', mk('VEC3', nP));
  if (nN) prim.setAttribute('NORMAL', mk('VEC3', nN));
  if (nUV) prim.setAttribute('TEXCOORD_0', mk('VEC2', nUV));
  prim.setAttribute('JOINTS_0', mk('VEC4', nJ));
  prim.setAttribute('WEIGHTS_0', mk('VEC4', nW));
  prim.setIndices(mk('SCALAR', new Uint32Array(newIdx)));

  // ── 3. Keep only the FP idle/walk/run clips ────────────────────────────────
  const keepClipsSet = new Set(keepAnims);
  const totalAnims = root.listAnimations().length;
  let dropped = 0;
  let kept = 0;
  for (const anim of root.listAnimations()) {
    if (keepClipsSet.has(anim.getName())) { kept++; continue; }
    anim.dispose();
    dropped++;
  }

  // ── 4. Clean orphans + Draco re-encode (WebP texture compression removed —
  //    see v0.2.771 note in the header) ───────────────────────────────────────
  try {
    const transforms = [prune(), draco()];
    await doc.transform(...transforms);
  } catch (err) {
    return _fail('author-failed', (err && err.message) || 'transform failed');
  }

  let out;
  try {
    out = await io.writeBinary(doc);
  } catch (err) {
    return _fail('author-failed', (err && err.message) || 'write failed');
  }

  return {
    ok: true,
    buffer: out,
    stats: {
      removedVerts: removed,
      totalVerts: nV,
      keptClips: kept,
      droppedClips: dropped,
      totalAnims,
      bytesIn,
      bytesOut: out.length,
    },
  };
}
