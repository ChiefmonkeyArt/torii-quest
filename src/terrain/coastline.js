// terrain/coastline.js — organic closed boundary polygon for the outer arena.
//
// Replaces the old square ±ARENA_HALF footprint with a wavy coast. Pure and
// node-safe (no THREE, no game state, no Math.random) so the SAME shape drives:
//   • the visual glass wall + neon strip (arena.js),
//   • the knee-high player colliders (physics.js),
//   • the bot containment clamp (bots.js),
// and can be unit-tested in isolation. The ring is generated once at module load
// from a fixed sum-of-sines radius function, so it is byte-identical every run —
// the wall, the colliders and the clamp all agree exactly.
//
// The polygon sits INSIDE the island (max |x|,|z| ≈ 18 < ARENA_HALF = 20), so the
// existing beach band still surrounds it: a player hops the low wall onto the
// beach, then wades into the sea. Bots are locked inside by a polygon clamp that
// is INDEPENDENT of the wall (bots ignore physics — see bots.js).

const VERT_COUNT = 32;
const BASE_R = 14.0; // mean radius — keeps max extent ≲18 (< ARENA_HALF 20), so a
                     // beach ring always remains between the coast and the sea edge

// Deterministic organic radius: a base circle warped by a few fixed low-frequency
// harmonics so the outline reads as a natural coast (a couple of bays + headlands)
// rather than a circle or a square. No randomness — stable across runs.
function _radiusAt(theta) {
  return BASE_R
    + 2.2 * Math.sin(theta * 3 + 0.6)
    + 1.4 * Math.sin(theta * 5 + 2.1)
    + 0.9 * Math.sin(theta * 2 - 1.2)
    + 0.6 * Math.sin(theta * 7 + 0.3);
}

// Closed ring of [x, z] points, counter-clockwise about the origin.
const _ring = [];
for (let i = 0; i < VERT_COUNT; i++) {
  const t = (i / VERT_COUNT) * Math.PI * 2;
  const r = _radiusAt(t);
  _ring.push([Math.cos(t) * r, Math.sin(t) * r]);
}

// Precomputed axis-aligned bounds — used for spawn sampling.
let _minX = Infinity, _maxX = -Infinity, _minZ = Infinity, _maxZ = -Infinity;
for (const [x, z] of _ring) {
  if (x < _minX) _minX = x;
  if (x > _maxX) _maxX = x;
  if (z < _minZ) _minZ = z;
  if (z > _maxZ) _maxZ = z;
}
const _bounds = Object.freeze({ minX: _minX, maxX: _maxX, minZ: _minZ, maxZ: _maxZ });

export const ARENA_COASTLINE = _ring;

// Ray-casting point-in-polygon. True when (x, z) is inside the coast.
export function pointInCoastline(x, z) {
  let inside = false;
  for (let i = 0, j = _ring.length - 1; i < _ring.length; j = i++) {
    const xi = _ring[i][0], zi = _ring[i][1];
    const xj = _ring[j][0], zj = _ring[j][1];
    const intersect =
      (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Closest point on segment A→B to P, plus the inward unit normal of that edge
// (pointing toward the origin — valid because the polygon is star-shaped about
// the origin). Returns { px, pz, nx, nz, dist }.
function _closestOnEdge(ax, az, bx, bz, x, z) {
  const ex = bx - ax, ez = bz - az;
  const len2 = ex * ex + ez * ez || 1e-9;
  let t = ((x - ax) * ex + (z - az) * ez) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const px = ax + ex * t, pz = az + ez * t;
  // Edge normal candidates; pick the one pointing toward the interior (origin).
  let nx = -ez, nz = ex;
  const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
  if (nx * -mx + nz * -mz < 0) { nx = -nx; nz = -nz; }
  const nlen = Math.hypot(nx, nz) || 1e-9;
  nx /= nlen; nz /= nlen;
  const dx = x - px, dz = z - pz;
  return { px, pz, nx, nz, dist: Math.hypot(dx, dz) };
}

// Clamp (x, z) so it stays at least `margin` inside the coast. Points already
// comfortably inside are returned unchanged; points outside — or within `margin`
// of the edge — are projected to the nearest edge and pushed inward by `margin`.
export function clampToCoastline(x, z, margin = 0) {
  const inside = pointInCoastline(x, z);
  // Find the nearest edge.
  let best = null;
  for (let i = 0, j = _ring.length - 1; i < _ring.length; j = i++) {
    const c = _closestOnEdge(_ring[j][0], _ring[j][1], _ring[i][0], _ring[i][1], x, z);
    if (!best || c.dist < best.dist) best = c;
  }
  if (inside && best.dist >= margin) return [x, z];
  return [best.px + best.nx * margin, best.pz + best.nz * margin];
}

// The polygon vertices (used to build the wall/collider geometry). Returns the
// live frozen ring — callers must not mutate it.
export function coastlineRing() { return _ring; }

// Axis-aligned bounds { minX, maxX, minZ, maxZ } for spawn sampling.
export function coastlineBounds() { return _bounds; }
