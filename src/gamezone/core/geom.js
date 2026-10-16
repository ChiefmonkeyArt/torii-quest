// src/gamezone/core/geom.js — allocation-light ray primitives (ADR-0130).
//
// Plain-number math shared by the authority and the client. Rays are
// (ox,oy,oz) + t·(dx,dy,dz) with a UNIT direction; every function returns the
// ENTRY distance t (>= 0) or -1 for a miss. A ray that starts inside a shape
// returns 0. Node-pure.

export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const mx = ox - cx, my = oy - cy, mz = oz - cz;
  const b = mx * dx + my * dy + mz * dz;
  const c = mx * mx + my * my + mz * mz - r * r;
  if (c <= 0) return 0;
  if (b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  return -b - Math.sqrt(disc);
}

// Capsule = segment a→b swept by radius r.
export function rayCapsule(ox, oy, oz, dx, dy, dz, ax, ay, az, bx, by, bz, r) {
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const oax = ox - ax, oay = oy - ay, oaz = oz - az;
  const baba = bax * bax + bay * bay + baz * baz;
  if (baba < 1e-12) return raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  const bard = bax * dx + bay * dy + baz * dz;
  const baoa = bax * oax + bay * oay + baz * oaz;
  const rdoa = dx * oax + dy * oay + dz * oaz;
  const oaoa = oax * oax + oay * oay + oaz * oaz;
  // Inside test (origin within r of the segment).
  const s0 = Math.max(0, Math.min(1, baoa / baba));
  const qx = oax - bax * s0, qy = oay - bay * s0, qz = oaz - baz * s0;
  if (qx * qx + qy * qy + qz * qz <= r * r) return 0;
  const a = baba - bard * bard;
  let b = baba * rdoa - baoa * bard;
  let c = baba * oaoa - baoa * baoa - r * r * baba;
  let h = b * b - a * c;
  if (a > 1e-12 && h >= 0) {
    const t = (-b - Math.sqrt(h)) / a;
    const y = baoa + t * bard;
    if (t >= 0 && y > 0 && y < baba) return t;
  }
  // End caps.
  let best = -1;
  const t0 = raySphere(ox, oy, oz, dx, dy, dz, ax, ay, az, r);
  if (t0 >= 0) best = t0;
  const t1 = raySphere(ox, oy, oz, dx, dy, dz, bx, by, bz, r);
  if (t1 >= 0 && (best < 0 || t1 < best)) best = t1;
  return best;
}

// Axis-aligned box (slab method), allocation-free.
function _slab(o, d, lo, hi, st) {
  if (Math.abs(d) < 1e-12) return o >= lo && o <= hi;
  const inv = 1 / d;
  let t1 = (lo - o) * inv, t2 = (hi - o) * inv;
  if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
  if (t1 > st[0]) st[0] = t1;
  if (t2 < st[1]) st[1] = t2;
  return st[0] <= st[1];
}
const _st = [0, 0];
export function rayAabb(ox, oy, oz, dx, dy, dz, minX, minY, minZ, maxX, maxY, maxZ) {
  _st[0] = 0; _st[1] = Infinity;
  if (!_slab(ox, dx, minX, maxX, _st)) return -1;
  if (!_slab(oy, dy, minY, maxY, _st)) return -1;
  if (!_slab(oz, dz, minZ, maxZ, _st)) return -1;
  return _st[0];
}

// Closest approach between the ray segment [0,maxT] and the segment a→b.
// Writes { dist, t, s, px, py, pz } (p = closest point ON THE RAY) into `out`.
export function raySegmentClosest(ox, oy, oz, dx, dy, dz, maxT, ax, ay, az, bx, by, bz, out) {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const wx = ox - ax, wy = oy - ay, wz = oz - az;
  const a = 1; // |d|^2
  const b = dx * ux + dy * uy + dz * uz;
  const c = ux * ux + uy * uy + uz * uz;
  const d = dx * wx + dy * wy + dz * wz;
  const e = ux * wx + uy * wy + uz * wz;
  const den = a * c - b * b;
  let t, s;
  if (den < 1e-12) { t = 0; s = c > 1e-12 ? e / c : 0; }
  else { t = (b * e - c * d) / den; s = (a * e - b * d) / den; }
  t = Math.max(0, Math.min(maxT, t));
  s = c > 1e-12 ? Math.max(0, Math.min(1, (t * b + e) / c)) : 0;
  // Re-project t for the clamped s.
  t = Math.max(0, Math.min(maxT, s * b - d));
  const px = ox + dx * t, py = oy + dy * t, pz = oz + dz * t;
  const qx = ax + ux * s, qy = ay + uy * s, qz = az + uz * s;
  out.dist = Math.hypot(px - qx, py - qy, pz - qz);
  out.t = t; out.s = s; out.px = px; out.py = py; out.pz = pz;
  return out;
}

export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  if (!(l > 1e-9) || !Number.isFinite(l)) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

// O(1), non-finite-safe wrap into [-π, π).
export function wrapAngle(a) {
  if (!Number.isFinite(a)) return 0;
  const TAU = Math.PI * 2;
  return ((((a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
}

export function lerpAngle(a, b, t) {
  return wrapAngle(a + wrapAngle(b - a) * t);
}

// Deterministic PRNG (mulberry32) so the simulation can be replayed in tests.
export function createRng(seed = 0x7071) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
