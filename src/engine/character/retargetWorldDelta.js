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
  const childOf = new Map();

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
    for (const c of b.children) {
      if (set.has(c) && !childOf.has(b.name)) childOf.set(b.name, c.name);
      walk(c);
    }
  };
  for (const r of roots) walk(r);

  return { names, parentOf, localQ, localP, worldQ, worldP, childOf };
}

// buildBoneAlignment(libBind, tgtBind, rebind) → Map<targetBone, Quaternion> of the
// per-bone shortest-arc bind alignment (glb_retarget.py's A_bone). Each bone's
// parent→first-child WORLD direction is measured in both rigs' bind pose; the
// source direction is frame-mapped (Z-up→Y-up), then the rotation mapping the
// target's child axis onto the frame-mapped source axis is baked. Without it,
// bones whose child-axis differs between rigs (the head/neck, upper arm, …) keep
// a residual twist — the head tilts back and the firing pose washes out. Leaf
// bones (no child) keep identity. This is the runtime port of the offline bake's
// bone-axis step and is the piece that actually stands the head/arms up straight.
export function buildBoneAlignment(libBind, tgtBind, rebind) {
  const masterOfTarget = new Map();
  for (const [m, t] of rebind) masterOfTarget.set(t, m);

  const A = new Map();
  const dS = new THREE.Vector3();
  const dT = new THREE.Vector3();
  const dSF = new THREE.Vector3();
  for (const tName of tgtBind.names) {
    const a = new THREE.Quaternion();
    const mName = masterOfTarget.get(tName);
    const tcName = tgtBind.childOf.get(tName);
    if (mName && tcName) {
      const mcName = masterOfTarget.get(tcName);
      if (mcName && libBind.worldP.has(mName) && libBind.worldP.has(mcName) &&
          tgtBind.worldP.has(tName) && tgtBind.worldP.has(tcName)) {
        dS.copy(libBind.worldP.get(mcName)).sub(libBind.worldP.get(mName));
        dT.copy(tgtBind.worldP.get(tcName)).sub(tgtBind.worldP.get(tName));
        if (dS.lengthSq() > 1e-18 && dT.lengthSq() > 1e-18) {
          dSF.copy(dS).applyQuaternion(FRAME).normalize();
          a.setFromUnitVectors(dT.normalize(), dSF);
        }
      }
    }
    A.set(tName, a);
  }
  return A;
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
  // Hemisphere alignment: negate qb when the two stored samples sit in opposite
  // quaternion hemispheres (same rotation, opposite sign). THREE.Quaternion has
  // no multiplyScalar/negate — flip the components directly or slerp would take
  // the long way around and the runtime would throw on the missing method.
  if (qa.dot(qb) < 0) { qb.x = -qb.x; qb.y = -qb.y; qb.z = -qb.z; qb.w = -qb.w; }
  return out.set(0, 0, 0, 1).slerpQuaternions(qa, qb, k);
}

// sampleVec3(track, t, out) — sample a Vector3 position track (used for the Hips
// root-motion delta). Mirrors sampleQuat's linear interpolation over time.
function sampleVec3(track, t, out) {
  const ts = track.times, vs = track.values, n = ts.length;
  if (!n) return out.set(0, 0, 0);
  if (t <= ts[0]) return out.set(vs[0], vs[1], vs[2]);
  if (t >= ts[n - 1]) return out.set(vs[(n - 1) * 3], vs[(n - 1) * 3 + 1], vs[(n - 1) * 3 + 2]);
  let i = 0; while (i < n - 1 && ts[i + 1] < t) i++;
  const k = (t - ts[i]) / (ts[i + 1] - ts[i]);
  const ax = vs[i * 3], ay = vs[i * 3 + 1], az = vs[i * 3 + 2];
  const bx = vs[(i + 1) * 3], by = vs[(i + 1) * 3 + 1], bz = vs[(i + 1) * 3 + 2];
  return out.set(ax + (bx - ax) * k, ay + (by - ay) * k, az + (bz - az) * k);
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
  const abone = buildBoneAlignment(libBind, tgtBind, rebind);

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
    const tWorldQ = new Map();  // baked WORLD rotation (parent lookup uses world)
    for (const tName of tgtBind.names) {
      const mName = tgtByMaster.get(tName);
      if (!mName || !mWorldQ.has(mName)) continue;
      const wl = mWorldQ.get(mName);
      const delta = qa.copy(wl).multiply(invLibWorldQ.get(mName)).normalize();
      const dw = qb.copy(FRAME).multiply(delta).multiply(FInv).normalize();
      // wtWorld = dw * A_bone * target.bind_world (world-space, matches
      // glb_retarget.py: wt = dw @ A_bone @ target.bind_world).
      const wtWorld = dw.clone().multiply(abone.get(tName)).multiply(tgtBind.worldQ.get(tName)).normalize();
      // Baked LOCAL = inv(parent_baked_world) * wtWorld. The parent lookup MUST
      // use the parent's baked WORLD, not its local — the old code premultiplied
      // wt in place and then stored the (already-local) result, so every child
      // below the hips used a local where a world was required.
      const p = tgtBind.parentOf.get(tName);
      const local = (p && tWorldQ.has(p))
        ? tWorldQ.get(p).clone().invert().multiply(wtWorld).normalize()
        : wtWorld.clone();
      tWorldQ.set(tName, wtWorld);
      const arr = outVals.get(tName);
      if (arr) { arr[fi * 4] = local.x; arr[fi * 4 + 1] = local.y; arr[fi * 4 + 2] = local.z; arr[fi * 4 + 3] = local.w; }
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

  // ── Hips root motion (the ONLY position track, matching glb_retarget.py) ──
  // The library clips carry a CONSTANT position track on every bone (the bind
  // offset, authored in the library's centimetre / Z-up convention). Name-remapping
  // those verbatim corrupted the target's metre / Y-up skeleton — e.g. the target
  // Hips got the library's Y=19.63 instead of its own Y=95.98, sinking the
  // character ~76cm into the floor. The offline bake instead emits ONE translation
  // track for the Hips: world delta frame-mapped Z-up→Y-up and height-scaled,
  // added back onto the target's bind position. All other bones keep their bind
  // positions (no track).
  if (libPos.has('Hips')) {
    const tH = rebind.get('Hips');
    const lH = libBind.worldP.get('Hips');
    const tHP = tH ? tgtBind.worldP.get(tH) : null;
    if (tH && lH && tHP && tgtBind.worldQ.has(tH)) {
      const hL = lH.length();
      const hT = tHP.length();
      const s = (hL > 1e-9 && hT > 1e-9) ? hT / hL : 1;
      const hipTrk = libPos.get('Hips');
      const arr = new Float32Array(nfr * 3);
      const tv = new THREE.Vector3();
      const dv = new THREE.Vector3();
      const ov = new THREE.Vector3();
      const pHips = tgtBind.parentOf.get(tH);
      for (let fi = 0; fi < nfr; fi++) {
        const t = (nfr === 1) ? 0 : (fi / (nfr - 1)) * dur;
        sampleVec3(hipTrk, t, tv);                 // library Hips world translation
        dv.copy(tv).sub(lH);                       // delta from library bind
        dv.applyQuaternion(FRAME).multiplyScalar(s); // Z-up → Y-up world, height-scaled
        ov.copy(tHP).add(dv);                      // target Hips world position
        if (pHips) {
          ov.sub(tgtBind.worldP.get(pHips)).applyQuaternion(tgtBind.worldQ.get(pHips).clone().invert());
        }
        arr[fi * 3] = ov.x; arr[fi * 3 + 1] = ov.y; arr[fi * 3 + 2] = ov.z;
      }
      outTracks.push(new THREE.VectorKeyframeTrack(tH + '.position', Array.from(times), Array.from(arr)));
    }
  }

  const out = clip.clone();
  out.tracks = outTracks;
  out.duration = dur;
  return out;
}