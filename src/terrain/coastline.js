// terrain/coastline.js — organic closed boundary polygons for the outer arena.
//
// Two explicit rings, generated once at module load from a fixed sum-of-sines
// radius (pure + node-safe: no THREE, no game state, no Math.random), so every
// consumer agrees byte-for-byte across runs:
//
//   • terrainEdgeRing() — the TRUE rounded outer island boundary. The VISIBLE +
//     physical terrain mesh (terrainMesh.js) is CROPPED to this polygon, so the
//     island footprint is genuinely rounded, not a square. The river/torii (east)
//     side is preserved exactly (no outward push); the other flats bulge outward
//     so the corners read as a natural coast rather than a square.
//   • fenceRing() — the terrain edge offset INWARD by SAFE_ZONE_M (1m). This is
//     the glass wall (arena.js), the knee-high colliders (physics.js) and the bot
//     containment clamp (bots.js). The 1m gap between the fence and the terrain
//     edge is the "safe zone": a player standing in it (or out on the beach) is
//     OUTSIDE the fence and cannot be shot by bots (see player.js / bots.js).
//
// coastlineRing()/ARENA_COASTLINE and the pointInCoastline/clampToCoastline/
// coastlineBounds helpers all operate on the FENCE ring, so existing consumers and
// the pinned unit tests keep working unchanged.

const VERT_COUNT = 32;
const BASE_R = 14.0; // mean radius of the organic base coast

// Safe-zone width — the fence sits this far INSIDE the true terrain edge.
export const SAFE_ZONE_M = 1.0;
// Outward push applied to the terrain edge on the NON-river flats (masked to 0
// due-east so the river/torii side is preserved exactly), capped so a beach band
// always remains inside the ±ARENA_HALF (20) footprint.
const EDGE_EXPAND = 3.0;
const EDGE_MAX    = 19.2;

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

// TRUE terrain-edge radius: the organic base radius pushed outward by EDGE_EXPAND,
// masked by (1 − max(0, cos θ)) so the push is ZERO due-east (θ=0, the river/torii
// side) and grows to full away from east. Capped at EDGE_MAX (< ARENA_HALF) so a
// beach band always remains between the rounded land edge and the sea.
function _terrainRadiusAt(theta) {
  const eastMask = 1 - Math.max(0, Math.cos(theta)); // 0 due-east → 1 away from east
  return Math.min(EDGE_MAX, _radiusAt(theta) + EDGE_EXPAND * eastMask);
}

// TRUE rounded outer boundary, counter-clockwise about the origin.
const _terrainEdge = [];
for (let i = 0; i < VERT_COUNT; i++) {
  const t = (i / VERT_COUNT) * Math.PI * 2;
  const r = _terrainRadiusAt(t);
  _terrainEdge.push([Math.cos(t) * r, Math.sin(t) * r]);
}

// Inward unit normal of edge A→B (pointing toward the origin — valid because the
// ring is star-shaped about the origin).
function _edgeInwardNormal(ax, az, bx, bz) {
  let nx = -(bz - az), nz = (bx - ax);
  const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
  if (nx * -mx + nz * -mz < 0) { nx = -nx; nz = -nz; }
  const l = Math.hypot(nx, nz) || 1e-9;
  return { nx: nx / l, nz: nz / l };
}

// Offset a closed ring INWARD by `dist` using a per-vertex MITER of the two
// adjacent edges' inward normals. The miter is cos-corrected (off = dist / cos)
// so the perpendicular offset equals `dist` on straight runs; a cos FLOOR of 0.2
// caps the correction at sharp corners so the miter can never spike out into a
// self-intersection.
function _offsetInward(ring, dist) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n];
    const cur  = ring[i];
    const next = ring[(i + 1) % n];
    const n1 = _edgeInwardNormal(prev[0], prev[1], cur[0], cur[1]);
    const n2 = _edgeInwardNormal(cur[0], cur[1], next[0], next[1]);
    let mx = n1.nx + n2.nx, mz = n1.nz + n2.nz;
    const mlen = Math.hypot(mx, mz) || 1e-9;
    mx /= mlen; mz /= mlen;
    let cos = mx * n1.nx + mz * n1.nz; // = cos(half the corner angle)
    if (cos < 0.2) cos = 0.2;          // floor → no runaway miter at sharp corners
    const off = dist / cos;
    out.push([cur[0] + mx * off, cur[1] + mz * off]);
  }
  return out;
}

// FENCE ring = terrain edge inset inward by the safe-zone width.
const _ring = _offsetInward(_terrainEdge, SAFE_ZONE_M);

// Precomputed axis-aligned bounds of the FENCE ring — used for spawn sampling.
let _minX = Infinity, _maxX = -Infinity, _minZ = Infinity, _maxZ = -Infinity;
for (const [x, z] of _ring) {
  if (x < _minX) _minX = x;
  if (x > _maxX) _maxX = x;
  if (z < _minZ) _minZ = z;
  if (z > _maxZ) _maxZ = z;
}
const _bounds = Object.freeze({ minX: _minX, maxX: _maxX, minZ: _minZ, maxZ: _maxZ });

export const ARENA_COASTLINE = _ring;

// Generic ray-casting point-in-polygon over an arbitrary [x,z] ring.
function _pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    const intersect =
      (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// True when (x, z) is inside the FENCE ring (the arena coast the wall follows).
export function pointInCoastline(x, z) { return _pointInRing(_ring, x, z); }

// True when (x, z) is inside the TRUE terrain edge (used to crop the render mesh).
export function pointInTerrainEdge(x, z) { return _pointInRing(_terrainEdge, x, z); }

// Safe-zone helper: a player is INSIDE the fence when inside the fence ring; the
// 1m band between the fence and the terrain edge (and the beach beyond) is OUTSIDE.
export function isInsideFence(x, z) { return _pointInRing(_ring, x, z); }

// Closest point on segment A→B to P, plus the inward unit normal of that edge.
// Returns { px, pz, nx, nz, dist }.
function _closestOnEdge(ax, az, bx, bz, x, z) {
  const ex = bx - ax, ez = bz - az;
  const len2 = ex * ex + ez * ez || 1e-9;
  let t = ((x - ax) * ex + (z - az) * ez) / len2;
  if (t < 0) t = 0; else if (t > 1) t = 1;
  const px = ax + ex * t, pz = az + ez * t;
  const nrm = _edgeInwardNormal(ax, az, bx, bz);
  const dx = x - px, dz = z - pz;
  return { px, pz, nx: nrm.nx, nz: nrm.nz, dist: Math.hypot(dx, dz) };
}

// Clamp (x, z) so it stays at least `margin` inside the FENCE ring. Points already
// comfortably inside are returned unchanged; points outside — or within `margin`
// of the edge — are projected to the nearest edge and pushed inward by `margin`.
export function clampToCoastline(x, z, margin = 0) {
  const inside = pointInCoastline(x, z);
  let best = null;
  for (let i = 0, j = _ring.length - 1; i < _ring.length; j = i++) {
    const c = _closestOnEdge(_ring[j][0], _ring[j][1], _ring[i][0], _ring[i][1], x, z);
    if (!best || c.dist < best.dist) best = c;
  }
  if (inside && best.dist >= margin) return [x, z];
  return [best.px + best.nx * margin, best.pz + best.nz * margin];
}

// The FENCE polygon vertices (wall/collider/clamp geometry). Live frozen ring —
// callers must not mutate it. coastlineRing() kept as the historical alias.
export function fenceRing() { return _ring; }
export function coastlineRing() { return _ring; }

// The TRUE rounded terrain-edge polygon — used by terrainMesh.js to crop the
// visible/physical arena mesh to the rounded footprint.
export function terrainEdgeRing() { return _terrainEdge; }

// Axis-aligned bounds { minX, maxX, minZ, maxZ } of the fence ring for spawn sampling.
export function coastlineBounds() { return _bounds; }
