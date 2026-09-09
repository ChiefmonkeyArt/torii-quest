// engine/character/retargetWorldDelta.js — runtime world-delta animation
// retargeting: redrive the shared animation-library clips (authored Z-up on a
// Meshy 24-bone master) onto an ARBITRARY uploaded humanoid skeleton by
// converting each bone's world-space rotation into a "delta from bind", mapping
// that delta through the master's Z-up -> Y-up frame, then re-expressing it in
// the target's local frame. This is the runtime port of tools/glb_retarget.py
// (the offline bake guest-master.glb / nostrich-master.glb use), so an uploaded
// mesh animates like the built-in characters instead of tipping on its back
// when its bind pose / axis convention differs from the library's.
//
// The name-only retarget (animationRetarget.retargetClip) is insufficient: it
// remaps bone NAMES but leaves track VALUES untouched, so the library's Z-up
// hips rest (~-71deg about X) is applied verbatim to a Y-up target's
// near-identity hips and the whole character lies supine. World-delta cancels
// the source rest and re-applies the target rest, axis-frame included.
//
// Runtime only — imports three for math. Pure seams stay in animationRetarget.js.

import * as THREE from 'three';

// ── Frame map ───────────────────────────────────────────────────────────────
// RotX(+90deg): (x,y,z) → (x,-z,y). Maps the master's Z-up world to Y-up target
// space. Matches glb_retarget.py Fm = [[1,0,0],[0,0,-1],[0,1,0]].
const FRAME = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

const IDENT = new THREE.Quaternion(0, 0, 0, 1);

// buildRigBind(bones) → bind snapshot of a THREE.Bone[] skeleton, parent-first.
// World transforms treat each ROOT bone as identity (the GLB scene node's
// cosmetic rotation is ignored; the rig is analysed in its own canonical frame).
export function buildRigBind(bones) {
  const set = new Set(bones);
  const names = [];
  const parentOf = new Map();
  const localQ = new Map();
  const localP = new Map();
  const worldQ = new Map();
  const worldP = new Map();

  const roots = bones.filter((b) => !set.has(b.parent));
  const seen = new Set();
  const walk = (b) => {
    if (!b || !set.has(b) || seen.has(b)) return;
    seen.add(b);
    const pName = set.has(b.parent) ? b.parent.name : null;
    parentOf.set(b.name, pName);
    localQ.set(b.name, b.quaternion.clone().normalize());
    localP.set(b.name, b.position.clone());
    if (pName) {
      const wq = worldQ.get(pName).clone().multiply(localQ.get(b.name)).normalize();
      const wp = localP.get(b.name).clone().applyQuaternion(worldQ.get(pName)).add(worldP.get(pName));
      worldQ.set(b.name, wq);
      worldP.set(b.name, wp);
    } else {
      worldQ.set(b.name, localQ.get(b.name).clone());
      worldP.set(b.name, localP.get(b.name).clone());
    }
    names.push(b.name);
    for (const c of b.children) walk(c);
  };
  for (const r of roots) walk(r);

  return { names, parentOf, localQ, localP, worldQ, worldP };
}

function extractTracks(clip) {
  const quat = new Map();
  const pos = new Map();
  for (const t of (clip && Array.isArray(clip.tracks) ? clip.tracks : [])) {
    if (!t || typeof t.name !== 'string') continue;
    const dot = t.name.lastIndexOf('.');
    const bone = dot > 0 ? t.name.slice(0, dot) : t.name;
    const prop = dot > 0 ? t.name.slice(dot + 1) : '';
    if (prop === 'quaternion') quat.set(bone, t);
    else if (prop === 'position') pos.set(bone, t);
  }
  return { quat, pos };
}

function sampleQuat(track, t, out) {
  const ts = track.times, vs = track.values, n = ts.length;
  if (!n) return out.copy(IDENT);
  if (t <= ts[0]) return out.set(vs[0], vs[1], vs[2], vs[3]).normalize();
  if (t >= ts[n - 1]) return out.set(vs[(n - 1) * 4], vs[(n - 1) * 4 + 1], vs[(n - 1) * 4 + 2], vs[(n - 1) * 4 + 3]).normalize();
  let i = 0; while (i < n - 1 && ts[i + 1] < t) i++;
  const k = (t - ts[i]) / (ts[i + 1] - ts[i]);
  const qa = new THREE.Quaternion(vs[i * 4], vs[i * 4 + 1], vs[i * 4 + 2], vs[i * 4 + 3]).normalize();
  const qb = new THREE.Quaternion(vs[(i + 1) * 4], vs[(i + 1) * 4 + 1], vs[(i + 1) * 4 + 2], vs[(i + 1) * 4 + 3]).normalize();
  if (qa.dot(qb) < 0) qb.multiplyScalar(-1);
  return out.set(0, 0, 0, 1).slerpQuaternions(qa, qb, k);
}

// invert the rebind (Map<master, target>) → Map<target, master>
function invertRebind(rebind) {
  const inv = new Map();
  for (const [m, t] of rebind) inv.set(t, m);
  return inv;
}

// retargetClipWorldDelta(clip, libBind, tgtBind, rebind, opts) → a new
// AnimationClip driving the TARGET skeleton. Resamples at opts.fps (default 30,
// matches glb_retarget.py). Returns null for a non-cloneable input.
export function retargetClipWorldDelta(clip, libBind, tgtBind, rebind, opts = {}) {
  if (!clip || typeof clip.clone !== 'function' || !Array.isArray(clip.tracks)) return null;
  if (!libBind || !tgtBind || !rebind || rebind.size === 0) return null;

  const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 30;
  const { quat: libQuat, pos: libPos } = extractTracks(clip);
  const tgtByMaster = invertRebind(rebind);

  const dur = (typeof clip.duration === 'number' && clip.duration > 0) ? clip.duration : 1;
  const nfr = Math.max(2, Math.round(dur * fps) + 1);

  const invLibWorldQ = new Map();
  for (const n of libBind.names) invLibWorldQ.set(n, libBind.worldQ.get(n).clone().invert());
  const FInv = FRAME.clone().invert();

  // ── resample + retarget ───────────────────────────────────────────────────
  const times = new Float32Array(nfr);
  const outVals = new Map(); // target name -> Float32Array(nfr*4)
  for (const tName of tgtBind.names) if (tgtByMaster.has(tName)) outVals.set(tName, new Float32Array(nfr * 4));

  const q = new THREE.Quaternion();
  const qa = new THREE.Quaternion();
  const qb = new THREE.Quaternion();

  for (let fi = 0; fi < nfr; fi++) {
    const t = (nfr === 1) ? 0 : (fi / (nfr - 1)) * dur;
    times[fi] = t;

    // master FK (rotations), parent-first
    const mWorldQ = new Map();
    for (const mName of libBind.names) {
      const trk = libQuat.get(mName);
      if (trk) sampleQuat(trk, t, q); else q.copy(libBind.localQ.get(mName));
      const p = libBind.parentOf.get(mName);
      if (p && mWorldQ.has(p)) q.premultiply(mWorldQ.get(p));
      q.normalize();
      mWorldQ.set(mName, q.clone());
    }

    // world-delta retarget
    const tWorldQ = new Map();
    for (const tName of tgtBind.names) {
      const mName = tgtByMaster.get(tName);
      if (!mName || !mWorldQ.has(mName)) continue;
      const wl = mWorldQ.get(mName);
      const delta = qa.copy(wl).multiply(invLibWorldQ.get(mName)).normalize();
      const dw = qb.copy(FRAME).multiply(delta).multiply(FInv).normalize();
      const wt = dw.clone().multiply(tgtBind.worldQ.get(tName)).normalize();
      const p = tgtBind.parentOf.get(tName);
      if (p && tWorldQ.has(p)) wt.premultiply(tWorldQ.get(p).clone().invert());
      wt.normalize();
      tWorldQ.set(tName, wt);
      const arr = outVals.get(tName);
      if (arr) { arr[fi * 4] = wt.x; arr[fi * 4 + 1] = wt.y; arr[fi * 4 + 2] = wt.z; arr[fi * 4 + 3] = wt.w; }
    }
  }

  // ── hemisphere continuity + build quaternion tracks ──
  const outTracks = [];
  for (const tName of tgtBind.names) {
    const arr = outVals.get(tName);
    if (!arr) continue;
    let px = arr[0], py = arr[1], pz = arr[2], pw = arr[3];
    for (let k = 1; k < nfr; k++) {
      const i = k * 4;
      if (px * arr[i] + py * arr[i + 1] + pz * arr[i + 2] + pw * arr[i + 3] < 0) {
        arr[i] = -arr[i]; arr[i + 1] = -arr[i + 1]; arr[i + 2] = -arr[i + 2]; arr[i + 3] = -arr[i + 3];
      }
      px = arr[i]; py = arr[i + 1]; pz = arr[i + 2]; pw = arr[i + 3];
    }
    outTracks.push(new THREE.QuaternionKeyframeTrack(tName + '.quaternion', Array.from(times), Array.from(arr)));
  }

  // ── position tracks: name-remap only (root motion). The in-place game clips
  // carry no meaningful root translation; any jump/fall root motion is preserved
  // as the pre-existing name-remap did — the world-delta fix targets rotation.
  for (const [mName, trk] of libPos) {
    const tName = rebind.get(mName);
    if (!tName) continue;
    const remapped = trk.clone();
    remapped.name = tName + '.position';
    outTracks.push(remapped);
  }

  const out = clip.clone();
  out.tracks = outTracks;
  out.duration = dur;
  return out;
}