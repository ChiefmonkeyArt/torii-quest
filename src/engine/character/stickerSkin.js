// src/engine/character/stickerSkin.js — stickers land exactly where you aim (ADR-0135).
//
// Sticker targeting on characters (NAP NPC, peers) used to be gated by 0.20 m
// Rapier ball sensors on every bone and, when the real mesh was missed, a
// synthesized "graze" point on an estimated limb radius — a sticker could land
// somewhere the crosshair never touched. Once landed it was pinned to ONE bone,
// so on blended skin (shoulders, hips, elbows) it slid off the surface as the
// pose changed.
//
// Now the drawn skin is the only truth, using the Game Zone hitbox (hitbox.js):
//   • raycastSkin — exact skinned-triangle hit (broad capsules → exact phase),
//     with a small honest assist: if the crosshair just misses, the nearest real
//     skin within STICKER_ASSIST_M of the aim line is used (never a guess);
//   • the hit is stored as an ANCHOR {tri, u, v, sign}: a triangle plus
//     barycentrics. anchorPose() re-skins those three vertices with the current
//     bones, so the sticker sits on the drawn surface in every frame of every clip.
// Node-pure three.js maths (tests + bench run it headless).
import * as THREE from 'three';
import { fitHitboxParts, createHitboxRig } from '../../gamezone/client/hitbox.js';

/** Max distance (m) from the aim line to the skin for the assist to apply. */
export const STICKER_ASSIST_M = 0.04;
const ASSIST_RINGS = [STICKER_ASSIST_M / 2, STICKER_ASSIST_M];
const ASSIST_SPOKES = 8;

const _parts = new WeakMap(); // geometry → fitted parts (clones share geometry)
const _rigs = new WeakMap();  // skinned mesh → rig

function _usable(sm) {
  const g = sm && sm.isSkinnedMesh && sm.skeleton && sm.geometry;
  return !!(g && g.attributes.position && g.attributes.skinIndex && g.attributes.skinWeight);
}

/** The (cached) hitbox rig for a skinned mesh, or null. Fitting runs once per geometry. */
export function skinRig(sm) {
  if (!_usable(sm)) return null;
  let rig = _rigs.get(sm);
  if (rig) return rig;
  let parts = _parts.get(sm.geometry);
  if (!parts) { parts = fitHitboxParts(sm, {}); _parts.set(sm.geometry, parts); }
  rig = createHitboxRig(sm, parts);
  _rigs.set(sm, rig);
  return rig;
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3();
const _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();

function _skin(sm, i, out) {
  out.fromBufferAttribute(sm.geometry.attributes.position, i);
  sm.applyBoneTransform(i, out);
  return out.applyMatrix4(sm.matrixWorld);
}

/**
 * Current world point + unit normal of an anchor on the drawn skin.
 * Uses the bones' current world matrices (what the last frame drew).
 * @returns {boolean} false when the anchor is no longer valid
 */
export function anchorPose(sm, anchor, outPoint, outNormal) {
  const rig = _rigs.get(sm);
  if (!rig || !anchor) return false;
  const index = rig.parts.index;
  const j = anchor.tri;
  if (!(j >= 0 && j + 2 < index.length)) return false;
  _skin(sm, index[j], _a); _skin(sm, index[j + 1], _b); _skin(sm, index[j + 2], _c);
  const w0 = 1 - anchor.u - anchor.v;
  outPoint.set(
    _a.x * w0 + _b.x * anchor.u + _c.x * anchor.v,
    _a.y * w0 + _b.y * anchor.u + _c.y * anchor.v,
    _a.z * w0 + _b.z * anchor.u + _c.z * anchor.v,
  );
  if (outNormal) {
    _e1.subVectors(_b, _a); _e2.subVectors(_c, _a);
    outNormal.crossVectors(_e1, _e2);
    const L = outNormal.length();
    if (L > 1e-12) outNormal.multiplyScalar((anchor.sign || 1) / L); else outNormal.set(0, 1, 0);
  }
  return true;
}

const _ax = new THREE.Vector3(), _ay = new THREE.Vector3(), _tmp = new THREE.Vector3();

/**
 * Exact hit on the drawn skin along a ray, with the small assist.
 * @returns {null | {point:THREE.Vector3, normal:THREE.Vector3, t:number,
 *   anchor:{tri:number,u:number,v:number,sign:number}, assisted:number}}
 *   `assisted` is the aim-line offset used (0 = the crosshair hit the skin).
 */
export function raycastSkin(sm, origin, dir, maxT = 200, opts = {}) {
  const rig = skinRig(sm);
  if (!rig) return null;
  const dx = dir.x, dy = dir.y, dz = dir.z;
  rig.update(-1);
  let h = rig.raycast(origin.x, origin.y, origin.z, dx, dy, dz, maxT);
  let assisted = 0;
  const assist = opts.assist !== false;
  if (!h && assist && rig.nearRay(origin.x, origin.y, origin.z, dx, dy, dz, maxT)) {
    // Parallel rays on two rings around the aim line: the nearest ring with a
    // hit wins, and within it the nearest surface. Lands on real skin only.
    _ax.set(Math.abs(dy) < 0.9 ? 0 : 1, Math.abs(dy) < 0.9 ? 1 : 0, 0).cross(dir).normalize();
    _ay.crossVectors(dir, _ax).normalize();
    for (const r of ASSIST_RINGS) {
      for (let k = 0; k < ASSIST_SPOKES; k++) {
        const ang = (k / ASSIST_SPOKES) * Math.PI * 2;
        const cx = Math.cos(ang) * r, cy = Math.sin(ang) * r;
        const ox = origin.x + _ax.x * cx + _ay.x * cy;
        const oy = origin.y + _ax.y * cx + _ay.y * cy;
        const oz = origin.z + _ax.z * cx + _ay.z * cy;
        const hk = rig.raycast(ox, oy, oz, dx, dy, dz, maxT);
        if (hk && (!h || hk.t < h.t)) { h = hk; assisted = r; }
      }
      if (h) break;
    }
  }
  if (!h || !(h.tri >= 0)) return null;
  const anchor = { tri: h.tri, u: h.u, v: h.v, sign: 1 };
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  anchorPose(sm, anchor, point, normal);
  // Face the shooter: the sticker goes on the side of the skin that was hit.
  if (normal.dot(dir) > 0) { anchor.sign = -1; normal.negate(); }
  _tmp.copy(point).sub(origin);
  return { point, normal, t: _tmp.dot(dir), anchor, assisted };
}
