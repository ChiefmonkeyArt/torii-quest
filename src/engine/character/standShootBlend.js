// standShootBlend.js — procedural "stand and shoot": synthesize a planted firing
// pose by layering the FIRING clip's upper body (spine → head, both arms) over the
// IDLE clip's lower body (hips, legs, feet). The library has only Run_Forward_Firing
// (a run+fire clip), so standing still while firing currently reuses it and the legs
// run in place. No new asset is needed: this bakes a clean Stand_Shoot clip from the
// two clips already present, per-bone, on a common timeline.
//
// Frame-agnostic by design: it only *picks* per-bone rotation tracks from one of two
// source clips that share a coordinate frame, so it works identically on the Z-up
// library (which retargetClipWorldDelta then frames onto a Y-up upload) and on the
// already-baked Y-up built-in clips (guest/nostrich/chiefmonkey .glb files).
//
// The only position track preserved is the Hips (from IDLE — constant, in-place), so
// the planted stance stays rooted; every other bone keeps its bind position (the
// retarget path drops those anyway).
import * as THREE from 'three';

const FIRE_CLIP = 'Run_Forward_Firing';
const IDLE_CLIP = 'Idle_02';
export const STAND_SHOOT_NAME = 'Stand_Shoot';

// Lower-body bones keep the IDLE pose (planted legs, stable hips); everything else
// (spine → head, both arms) keeps the FIRING pose (aim + hold + recoil). The seam
// sits at Hips(idle)/Spine(fire) — the aiming twist across the waist is intended.
const LOWER = new Set([
  'Hips',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase',
  'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase',
]);

function _find(clips, ...names) {
  for (const n of names) {
    if (!n) continue;
    if (clips instanceof Map) { if (clips.has(n)) return clips.get(n); }
    else if (clips && clips[n]) return clips[n];
  }
  return null;
}

// _tracksByBone(clip, prop) → Map<boneName, Float-backed track> for the given prop.
function _tracksByBone(clip, prop) {
  const m = new Map();
  for (const t of (clip && Array.isArray(clip.tracks) ? clip.tracks : [])) {
    if (!t || typeof t.name !== 'string') continue;
    const dot = t.name.lastIndexOf('.');
    if (dot <= 0) continue;
    if (t.name.slice(dot + 1) === prop) m.set(t.name.slice(0, dot), t);
  }
  return m;
}

// _sampleQuat(track, t, out) — SLERP a quaternion track at time t (loop-safe).
function _sampleQuat(track, t, out) {
  const ts = track.times, vs = track.values, n = ts.length;
  if (!n) return out.set(0, 0, 0, 1);
  // Loop t into the track's own range so a shorter idle loop repeats cleanly.
  const span = ts[n - 1] - ts[0];
  let lt = t;
  if (span > 0) lt = ts[0] + ((t - ts[0]) % span + span) % span;
  if (lt <= ts[0]) return out.set(vs[0], vs[1], vs[2], vs[3]).normalize();
  if (lt >= ts[n - 1]) return out.set(vs[(n - 1) * 4], vs[(n - 1) * 4 + 1], vs[(n - 1) * 4 + 2], vs[(n - 1) * 4 + 3]).normalize();
  let i = 0; while (i < n - 1 && ts[i + 1] < lt) i++;
  const k = (lt - ts[i]) / (ts[i + 1] - ts[i]);
  const qa = new THREE.Quaternion(vs[i * 4], vs[i * 4 + 1], vs[i * 4 + 2], vs[i * 4 + 3]).normalize();
  const qb = new THREE.Quaternion(vs[(i + 1) * 4], vs[(i + 1) * 4 + 1], vs[(i + 1) * 4 + 2], vs[(i + 1) * 4 + 3]).normalize();
  if (qa.dot(qb) < 0) { qb.x = -qb.x; qb.y = -qb.y; qb.z = -qb.z; qb.w = -qb.w; }
  return out.set(0, 0, 0, 1).slerpQuaternions(qa, qb, k);
}

// _sampleVec3(track, t, out) — linear sample a Vec3 track (loop-safe).
function _sampleVec3(track, t, out) {
  const ts = track.times, vs = track.values, n = ts.length;
  if (!n) return out.set(0, 0, 0);
  const span = ts[n - 1] - ts[0];
  let lt = t;
  if (span > 0) lt = ts[0] + ((t - ts[0]) % span + span) % span;
  if (lt <= ts[0]) return out.set(vs[0], vs[1], vs[2]);
  if (lt >= ts[n - 1]) return out.set(vs[(n - 1) * 3], vs[(n - 1) * 3 + 1], vs[(n - 1) * 3 + 2]);
  let i = 0; while (i < n - 1 && ts[i + 1] < lt) i++;
  const k = (lt - ts[i]) / (ts[i + 1] - ts[i]);
  return out.set(
    vs[i * 3] + (vs[(i + 1) * 3] - vs[i * 3]) * k,
    vs[i * 3 + 1] + (vs[(i + 1) * 3 + 1] - vs[i * 3 + 1]) * k,
    vs[i * 3 + 2] + (vs[(i + 1) * 3 + 2] - vs[i * 3 + 2]) * k,
  );
}

// synthStandShoot(clips, opts?) → a new THREE.AnimationClip named Stand_Shoot, or
// null when either source clip (or the "Stand_Shoot" already being present) makes
// the blend unnecessary/impossible. `clips` is a Map<name, clip> or {name: clip}.
export function synthStandShoot(clips, opts = {}) {
  if (!clips) return null;
  const fire = _find(clips, FIRE_CLIP);
  const idle = _find(clips, IDLE_CLIP);
  if (!fire || !idle) return null;

  const fps = Number.isFinite(opts.fps) && opts.fps > 0 ? opts.fps : 30;
  const dur = (typeof fire.duration === 'number' && fire.duration > 0) ? fire.duration : 1;

  const fireQ = _tracksByBone(fire, 'quaternion');
  const idleQ = _tracksByBone(idle, 'quaternion');
  const idleP = _tracksByBone(idle, 'position');

  // Union of all bones present in either source (the Meshy 24-bone set).
  const bones = new Set([...fireQ.keys(), ...idleQ.keys()]);

  const nfr = Math.max(2, Math.round(dur * fps) + 1);
  const times = new Float32Array(nfr);
  for (let fi = 0; fi < nfr; fi++) times[fi] = (fi / (nfr - 1)) * dur;

  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const tracks = [];

  for (const bone of bones) {
    const lower = LOWER.has(bone);
    // Lower bones from idle; upper bones from fire. Fall back to the other source
    // if the assigned one is missing a track (robustness against a partial rig).
    const src = lower ? (idleQ.get(bone) || fireQ.get(bone)) : (fireQ.get(bone) || idleQ.get(bone));
    if (!src) continue;
    const arr = new Float32Array(nfr * 4);
    for (let fi = 0; fi < nfr; fi++) {
      _sampleQuat(src, times[fi], q);
      arr[fi * 4] = q.x; arr[fi * 4 + 1] = q.y; arr[fi * 4 + 2] = q.z; arr[fi * 4 + 3] = q.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, Array.from(times), Array.from(arr)));
  }

  // Hips stays rooted: carry the IDLE Hips position (in-place, constant) so the
  // planted stance doesn't lurch with the firing clip's run stride.
  const hipsT = idleP.get('Hips');
  if (hipsT) {
    const arr = new Float32Array(nfr * 3);
    for (let fi = 0; fi < nfr; fi++) {
      _sampleVec3(hipsT, times[fi], v);
      arr[fi * 3] = v.x; arr[fi * 3 + 1] = v.y; arr[fi * 3 + 2] = v.z;
    }
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', Array.from(times), Array.from(arr)));
  }

  return new THREE.AnimationClip(STAND_SHOOT_NAME, dur, tracks);
}