// src/gamezone/client/hitbox.js — skeletal hitboxes that follow the rendered mesh.
//
// The legacy hitbox was a fixed capsule + head sphere standing at the bot's
// logical position, while the visible mesh played clips with root motion that
// moved the head up to ~1 m away. "What you see" and "what you hit" disagreed.
//
// Here the hitbox IS the rendered mesh, tested in two stages:
//   1. broad phase — one enclosing capsule per (bone, zone, height band) group of
//      triangles, carried through the skinning chain of its dominant bone:
//        world = matrixWorld · bindMatrixInverse · (bone.matrixWorld · boneInverse) · bindMatrix · p
//   2. exact phase — only for groups the ray enters, the group's vertices are
//      skinned with three.js's own applyBoneTransform (full blend weights) and
//      the ray is tested against those triangles. Whatever pose is on screen is
//      exactly the pose you are shooting.
//
// Zone rule (anatomical): the struck triangle is HEAD when its nearest vertex's
// rest-pose height is at/above the template's neck line. Bone names are not
// trusted (see fitHitboxParts). Works in Node (bench/tests) and the browser —
// three.js math only, no DOM.

import * as THREE from 'three';
import { rayCapsule } from '../core/geom.js';

const MIN_VERTS = 16;
const BAND = 0.3;          // geometry-space height band per capsule (m)
const ENCLOSE_MARGIN = 0.06; // m (geometry units) — blend-weight slack on the broad-phase capsule

function dominantBones(geom) {
  const si = geom.attributes.skinIndex, sw = geom.attributes.skinWeight;
  const n = geom.attributes.position.count;
  const dom = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) {
      const w = sw.getComponent(i, k);
      if (w > bw) { bw = w; best = si.getComponent(i, k); }
    }
    dom[i] = best;
  }
  return dom;
}

function percentile(arr, q) {
  const s = Float32Array.from(arr).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * s.length)))];
}

// Principal axis of a point cloud (power iteration on the covariance).
function principalAxis(pts, c) {
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  for (const p of pts) {
    const x = p.x - c.x, y = p.y - c.y, z = p.z - c.z;
    xx += x * x; xy += x * y; xz += x * z; yy += y * y; yz += y * z; zz += z * z;
  }
  let v = new THREE.Vector3(0.3, 1, 0.2).normalize();
  for (let k = 0; k < 24; k++) {
    const nx = xx * v.x + xy * v.y + xz * v.z;
    const ny = xy * v.x + yy * v.y + yz * v.z;
    const nz = xz * v.x + yz * v.y + zz * v.z;
    const L = Math.hypot(nx, ny, nz);
    if (L < 1e-12) break;
    v.set(nx / L, ny / L, nz / L);
  }
  return v;
}

// Enclosing capsule around a point cloud along its principal axis.
function fitCapsule(pts) {
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.multiplyScalar(1 / pts.length);
  const ax = principalAxis(pts, c);
  let t0 = Infinity, t1 = -Infinity, r = 0;
  for (const p of pts) {
    const t = (p.x - c.x) * ax.x + (p.y - c.y) * ax.y + (p.z - c.z) * ax.z;
    if (t < t0) t0 = t;
    if (t > t1) t1 = t;
    const d = Math.hypot(p.x - c.x - ax.x * t, p.y - c.y - ax.y * t, p.z - c.z - ax.z * t);
    if (d > r) r = d;
  }
  r += ENCLOSE_MARGIN;
  return { a: c.clone().addScaledVector(ax, t0), b: c.clone().addScaledVector(ax, t1), r };
}

/**
 * Fit the part list for a skinned mesh (once per template; clones share it —
 * SkeletonUtils.clone preserves bone order).
 *
 * Vertices are grouped by (dominant bone, zone, height band) and each group
 * becomes one capsule rigidly attached to its bone. The ZONE is anatomical: a
 * vertex is HEAD when its rest-pose height is at or above `neckY` (geometry
 * units). Bone names are deliberately NOT trusted — banker-rigged.glb's "Head"
 * bone drives everything from 0.76 m up.
 *
 * @param {THREE.SkinnedMesh} skinned
 * @param {{neckY:number}} opts
 * @returns {Array<{bone:number, a:THREE.Vector3, b:THREE.Vector3, r:number, head:boolean, name:string}>}
 */
export function fitHitboxParts(skinned, opts) {
  const neckY = opts && Number.isFinite(opts.neckY) ? opts.neckY : Infinity;
  const geom = skinned.geometry;
  const bones = skinned.skeleton.bones;
  const dom = dominantBones(geom);
  const pos = geom.attributes.position;
  const n = pos.count;
  const index = geom.index ? geom.index.array : Uint32Array.from({ length: n }, (_, i) => i);
  const head = new Uint8Array(n);
  for (let i = 0; i < n; i++) head[i] = isHeadVertex(pos.getY(i), neckY) ? 1 : 0;
  const keyOf = (i) => {
    const y = pos.getY(i);
    return `${dom[i]}|${head[i]}|${head[i] ? 0 : Math.floor(y / BAND)}`;
  };
  // Each triangle joins the group of its first vertex; the group's capsule must
  // enclose every vertex of every triangle it owns.
  const groups = new Map();
  for (let k = 0; k < index.length; k += 3) {
    const key = keyOf(index[k]);
    let g = groups.get(key);
    if (!g) { g = { bone: dom[index[k]], head: !!head[index[k]], tris: [], verts: new Set() }; groups.set(key, g); }
    g.tris.push(k);
    g.verts.add(index[k]); g.verts.add(index[k + 1]); g.verts.add(index[k + 2]);
  }
  const parts = [];
  const v = new THREE.Vector3();
  for (const g of groups.values()) {
    const pts = [];
    for (const i of g.verts) pts.push(v.fromBufferAttribute(pos, i).clone());
    const c = fitCapsule(pts);
    parts.push({
      bone: g.bone, a: c.a, b: c.b, r: c.r, head: g.head,
      name: bones[g.bone].name + (g.head ? ':head' : ''),
      tris: Uint32Array.from(g.tris), verts: Uint32Array.from(g.verts),
    });
  }
  parts.index = index;
  parts.headVert = head;
  parts.vertexCount = n;
  return parts;
}

/** Is a rest-pose (geometry-space) vertex part of the head? Shared with the bench. */
export function isHeadVertex(y, neckY) { return y >= neckY; }

const _m = new THREE.Matrix4();
const _c = new THREE.Matrix4();

/**
 * Per-instance rig: transforms the template parts with the instance's current
 * skeleton. `update()` is cheap (one matrix chain per part) and is called on
 * demand — at most once per frame — before ray tests.
 */
export function createHitboxRig(skinned, parts) {
  const sk = skinned.skeleton;
  const world = parts.map(() => ({ ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0 }));
  const va = new THREE.Vector3(), vb = new THREE.Vector3();
  let stamp = -1, gen = 0;

  function update(frame = -1) {
    if (frame >= 0 && frame === stamp) return;
    stamp = frame;
    gen++;
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k];
      // C = matrixWorld · bindMatrixInverse · (bone.matrixWorld · boneInverse) · bindMatrix
      _m.multiplyMatrices(sk.bones[p.bone].matrixWorld, sk.boneInverses[p.bone]);
      _c.multiplyMatrices(skinned.matrixWorld, skinned.bindMatrixInverse).multiply(_m).multiply(skinned.bindMatrix);
      va.copy(p.a).applyMatrix4(_c);
      vb.copy(p.b).applyMatrix4(_c);
      const e = _c.elements;
      const scale = Math.cbrt(Math.abs(_c.determinant())) || Math.hypot(e[0], e[1], e[2]);
      const w = world[k];
      w.ax = va.x; w.ay = va.y; w.az = va.z; w.bx = vb.x; w.by = vb.y; w.bz = vb.z; w.r = p.r * scale;
    }
  }

  // Exact phase scratch: skinned world positions, stamped per vertex so shared
  // vertices are skinned once per frame.
  const P = new Float32Array(parts.vertexCount * 3);
  const vStamp = new Int32Array(parts.vertexCount).fill(-1);
  const index = parts.index, headVert = parts.headVert;
  const pos = skinned.geometry.attributes.position;
  const sv = new THREE.Vector3();
  let skinFrame = 0;
  const cand = [];

  function _skinPart(p) {
    const vs = p.verts;
    for (let k = 0; k < vs.length; k++) {
      const i = vs[k];
      if (vStamp[i] === skinFrame) continue;
      vStamp[i] = skinFrame;
      sv.fromBufferAttribute(pos, i);
      skinned.applyBoneTransform(i, sv);
      sv.applyMatrix4(skinned.matrixWorld);
      P[i * 3] = sv.x; P[i * 3 + 1] = sv.y; P[i * 3 + 2] = sv.z;
    }
  }

  // Möller–Trumbore over one part's triangles. Returns nearest
  // {t, zone, tri, u, v} or null — `tri` is the triangle's offset into the index
  // array and (u, v) its barycentrics, so callers can anchor to the skin (ADR-0135).
  function _exact(p, ox, oy, oz, dx, dy, dz, maxT) {
    let best = maxT, zone = null, bj = -1, bu = 0, bv = 0;
    const tris = p.tris;
    for (let k = 0; k < tris.length; k++) {
      const j = tris[k];
      const a = index[j] * 3, b = index[j + 1] * 3, c = index[j + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-12 && det < 1e-12) continue;
      const inv = 1 / det;
      const tx = ox - P[a], ty = oy - P[a + 1], tz = oz - P[a + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const w = (dx * qx + dy * qy + dz * qz) * inv;
      if (w < 0 || u + w > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t > 1e-4 && t < best) {
        best = t; bj = j; bu = u; bv = w;
        const w0 = 1 - u - w;
        const vi = w0 >= u && w0 >= w ? index[j] : (u >= w ? index[j + 1] : index[j + 2]);
        zone = headVert[vi] ? 'head' : 'body';
      }
    }
    return zone ? { t: best, zone, tri: bj, u: bu, v: bv } : null;
  }

  /**
   * Nearest hit on the rendered mesh along a unit ray, or null.
   * Call update(frame) first; `frame` also keys the per-vertex skin cache.
   */
  function raycast(ox, oy, oz, dx, dy, dz, maxT = Infinity) {
    skinFrame = gen;
    cand.length = 0;
    for (let k = 0; k < parts.length; k++) {
      const w = world[k];
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, w.ax, w.ay, w.az, w.bx, w.by, w.bz, w.r);
      if (t >= 0 && t <= maxT) cand.push(t, k);
    }
    if (!cand.length) return null;
    // Visit candidate parts nearest-first; stop once a part starts beyond the best hit.
    const order = [];
    for (let i = 0; i < cand.length; i += 2) order.push(i);
    order.sort((x, y) => cand[x] - cand[y]);
    let best = null;
    for (const i of order) {
      const tEnter = cand[i];
      if (best && tEnter > best.t) break;
      const p = parts[cand[i + 1]];
      _skinPart(p);
      const h = _exact(p, ox, oy, oz, dx, dy, dz, best ? best.t : maxT);
      if (h) best = { t: h.t, zone: h.zone, part: p.name, tri: h.tri, u: h.u, v: h.v };
    }
    return best;
  }

  /** Cheap broad-phase only (enclosing capsules) — for "is anything near the ray". */
  function nearRay(ox, oy, oz, dx, dy, dz, maxT = Infinity) {
    for (let k = 0; k < parts.length; k++) {
      const w = world[k];
      const t = rayCapsule(ox, oy, oz, dx, dy, dz, w.ax, w.ay, w.az, w.bx, w.by, w.bz, w.r);
      if (t >= 0 && t <= maxT) return true;
    }
    return false;
  }

  return { update, raycast, nearRay, world, parts };
}

/**
 * Remove horizontal root motion from every clip (Hips X/Z pinned to frame 0), so
 * the mesh stays on the authoritative position while the clip plays. Vertical
 * motion (crouch, fall) is kept. Mutates the clips — call once per template.
 */
export function stripRootMotion(clips, rootBoneName = 'Hips') {
  const re = new RegExp(`(?:^|[/.:])(?:mixamorig:?)?${rootBoneName}\\.position$`, 'i');
  let n = 0;
  for (const clip of clips) {
    for (const tr of clip.tracks) {
      if (!re.test(tr.name)) continue;
      const v = tr.values;
      const x0 = v[0], z0 = v[2];
      for (let i = 0; i < v.length; i += 3) { v[i] = x0; v[i + 2] = z0; }
      n++;
    }
  }
  return n;
}
