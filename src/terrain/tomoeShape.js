// src/terrain/tomoeShape.js
// Single source of truth for the Mitsudomoe island layout.
// ALL terrain, physics, combat, and rendering systems must use these predicates.
//
// Three comma-shaped islands (counter-clockwise Mitsudomoe):
//   • NAP (top)           — peaceful zone with tree + Torii gate
//   • Arena BL (bottom-left)  — shooter arena, part 1
//   • Arena BR (bottom-right) — shooter arena, part 2
//
// Each island has two rings:
//   *_COAST — black SVG outline = waterline (where land meets sea)
//   *_PLAY  — pink SVG outline  = play-area boundary (1m inland from coast)
//
// The 1m band between *_PLAY and *_COAST is the beach: walkable land but
// NOT inside the arena combat zone.

import {
  NAP_COAST, NAP_PLAY,
  ARENA_BL_COAST, ARENA_BL_PLAY,
  ARENA_BR_COAST, ARENA_BR_PLAY,
  TOMOE_SCALE,
} from './tomoeShapeData.js';

// ── Point-in-polygon (ray casting) ─────────────────────────────────────────────
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

// ── Signed distance to polygon edge ────────────────────────────────────────────
// Returns distance from (x,z) to the nearest edge of `ring`.
// Sign is not included — use _pointInRing to determine inside/outside.
function _distToRing(ring, x, z) {
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1];
    const bx = ring[i][0], bz = ring[i][1];
    const ex = bx - ax, ez = bz - az;
    const len2 = ex * ex + ez * ez || 1e-9;
    let t = ((x - ax) * ex + (z - az) * ez) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const dx = x - (ax + ex * t), dz = z - (az + ez * t);
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best) best = d;
  }
  return best;
}

// ── Closest point on polygon edge ──────────────────────────────────────────────
function _closestOnRing(ring, x, z) {
  let best = { px: 0, pz: 0, dist: Infinity };
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = ring[j][0], az = ring[j][1];
    const bx = ring[i][0], bz = ring[i][1];
    const ex = bx - ax, ez = bz - az;
    const len2 = ex * ex + ez * ez || 1e-9;
    let t = ((x - ax) * ex + (z - az) * ez) / len2;
    if (t < 0) t = 0; else if (t > 1) t = 1;
    const px = ax + ex * t, pz = az + ez * t;
    const dx = x - px, dz = z - pz;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d < best.dist) best = { px, pz, dist: d };
  }
  return best;
}

// ── Land predicates ────────────────────────────────────────────────────────────

// True if (x,z) is on NAP island land (inside the NAP waterline).
export function isNapLand(x, z) {
  return _pointInRing(NAP_COAST, x, z);
}

// True if (x,z) is on either arena island land (inside either arena waterline).
export function isArenaLand(x, z) {
  return _pointInRing(ARENA_BL_COAST, x, z) ||
         _pointInRing(ARENA_BR_COAST, x, z);
}

// True if (x,z) is on any tomoe island land (NAP or arena).
export function isTomoeLand(x, z) {
  return isNapLand(x, z) || isArenaLand(x, z);
}

// ── Play-area predicates ──────────────────────────────────────────────────────

// True if (x,z) is inside the NAP play boundary (pink outline).
export function isNapPlayArea(x, z) {
  return _pointInRing(NAP_PLAY, x, z);
}

// True if (x,z) is inside either arena play boundary (pink outlines).
// This is the invisible combat zone — players CAN be shot here.
// Includes the water gaps between the two arena islands (jumpable).
export function isArenaPlayArea(x, z) {
  return _pointInRing(ARENA_BL_PLAY, x, z) ||
         _pointInRing(ARENA_BR_PLAY, x, z);
}

// ── Distance functions ─────────────────────────────────────────────────────────

// Signed distance to nearest coast: positive inside land, negative outside.
// Returns the distance from (x,z) to the nearest waterline, with sign.
export function distanceToCoast(x, z) {
  // Check all three islands
  const rings = [NAP_COAST, ARENA_BL_COAST, ARENA_BR_COAST];
  let bestInside = -Infinity;  // best (max) distance when inside
  let bestOutside = Infinity;  // best (min) distance when outside

  for (const ring of rings) {
    const inside = _pointInRing(ring, x, z);
    const dist = _distToRing(ring, x, z);
    if (inside) {
      if (dist > bestInside) bestInside = dist;
    } else {
      if (dist < bestOutside) bestOutside = dist;
    }
  }

  if (bestInside > -Infinity) return bestInside;  // inside at least one island
  return -bestOutside;  // outside all islands
}

// Distance to nearest arena play boundary (positive inside, negative outside).
export function distanceToArenaPlay(x, z) {
  const rings = [ARENA_BL_PLAY, ARENA_BR_PLAY];
  let bestInside = -Infinity;
  let bestOutside = Infinity;

  for (const ring of rings) {
    const inside = _pointInRing(ring, x, z);
    const dist = _distToRing(ring, x, z);
    if (inside) {
      if (dist > bestInside) bestInside = dist;
    } else {
      if (dist < bestOutside) bestOutside = dist;
    }
  }

  if (bestInside > -Infinity) return bestInside;
  return -bestOutside;
}

// ── Glow ring accessors ────────────────────────────────────────────────────────
// The glow ring is VISUAL ONLY — two separate neon loops, one per arena island.
// They do NOT cross over water. Each loop follows the pink play boundary of
// its respective island.

export function arenaGlowLoops() {
  return [ARENA_BL_PLAY, ARENA_BR_PLAY];
}

export function getNapGlowLoop() {
  return NAP_PLAY;
}

// ── Clamping ───────────────────────────────────────────────────────────────────

// Clamp (x,z) to stay inside the arena play area (both islands).
// If outside both play rings, projects to the nearest ring edge.
export function clampToArenaPlay(x, z, margin = 0) {
  const rings = [ARENA_BL_PLAY, ARENA_BR_PLAY];

  // Check if already inside either ring with margin
  for (const ring of rings) {
    if (_pointInRing(ring, x, z)) {
      const dist = _distToRing(ring, x, z);
      if (dist >= margin) return [x, z];
    }
  }

  // Find nearest edge across all arena play rings
  let best = { px: 0, pz: 0, dist: Infinity };
  let bestRing = null;
  for (const ring of rings) {
    const c = _closestOnRing(ring, x, z);
    if (c.dist < best.dist) {
      best = c;
      bestRing = ring;
    }
  }

  // Push inward by margin
  // Find inward direction (toward ring centroid)
  const n = bestRing.length;
  let cx = 0, cz = 0;
  for (const p of bestRing) { cx += p[0]; cz += p[1]; }
  cx /= n; cz /= n;

  let dx = cx - best.px, dz = cz - best.pz;
  const dlen = Math.hypot(dx, dz) || 1e-9;
  dx /= dlen; dz /= dlen;

  return [best.px + dx * margin, best.pz + dz * margin];
}

// Clamp (x,z) to stay on any tomoe land (NAP or arena).
export function clampToTomoeLand(x, z, margin = 0) {
  const rings = [NAP_COAST, ARENA_BL_COAST, ARENA_BR_COAST];

  for (const ring of rings) {
    if (_pointInRing(ring, x, z)) {
      const dist = _distToRing(ring, x, z);
      if (dist >= margin) return [x, z];
    }
  }

  let best = { px: 0, pz: 0, dist: Infinity };
  let bestRing = null;
  for (const ring of rings) {
    const c = _closestOnRing(ring, x, z);
    if (c.dist < best.dist) {
      best = c;
      bestRing = ring;
    }
  }

  const n = bestRing.length;
  let cx = 0, cz = 0;
  for (const p of bestRing) { cx += p[0]; cz += p[1]; }
  cx /= n; cz /= n;

  let dx = cx - best.px, dz = cz - best.pz;
  const dlen = Math.hypot(dx, dz) || 1e-9;
  dx /= dlen; dz /= dlen;

  return [best.px + dx * margin, best.pz + dz * margin];
}

// ── Bounding boxes ─────────────────────────────────────────────────────────────

function _ringBBox(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { minX, maxX, minZ, maxZ };
}

export const TOMOE_BBOX = _ringBBox([
  ...NAP_COAST, ...ARENA_BL_COAST, ...ARENA_BR_COAST
]);

export const ARENA_BBOX = _ringBBox([
  ...ARENA_BL_COAST, ...ARENA_BR_COAST
]);

export const NAP_BBOX = _ringBBox(NAP_COAST);

// ── Interior centers (for object placement) ──────────────────────────────────
// Vertex centroid is NOT reliable for non-convex comma shapes — it can fall
// outside the polygon (in the concave tail region). Instead, we find the point
// inside the polygon that is FURTHEST from any edge — this is the center of
// the "fat round area" of each comma shape.
function _interiorCenter(ring) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  // Scan grid points at 0.5m spacing inside the bbox
  let best = [0, 0], bestDist = -1;
  for (let x = minX + 0.5; x < maxX; x += 0.5) {
    for (let z = minZ + 0.5; z < maxZ; z += 0.5) {
      if (!_pointInRing(ring, x, z)) continue;
      const d = _distToRing(ring, x, z);
      if (d > bestDist) { bestDist = d; best = [x, z]; }
    }
  }
  return best;
}

export const NAP_CENTROID = _interiorCenter(NAP_COAST);
export const ARENA_BL_CENTROID = _interiorCenter(ARENA_BL_COAST);
export const ARENA_BR_CENTROID = _interiorCenter(ARENA_BR_COAST);

// ── Ring accessors (for mesh building and coastline) ───────────────────────────

export function napCoastRing() { return NAP_COAST; }
export function arenaBLCoastRing() { return ARENA_BL_COAST; }
export function arenaBRCoastRing() { return ARENA_BR_COAST; }

export function allCoastRings() {
  return [NAP_COAST, ARENA_BL_COAST, ARENA_BR_COAST];
}

export function allArenaCoastRings() {
  return [ARENA_BL_COAST, ARENA_BR_COAST];
}

// ── Which island is a point on? ────────────────────────────────────────────────

export const ISLAND_NONE  = 0;
export const ISLAND_NAP   = 1;
export const ISLAND_BL    = 2;
export const ISLAND_BR    = 3;

export function whichIsland(x, z) {
  if (_pointInRing(NAP_COAST, x, z)) return ISLAND_NAP;
  if (_pointInRing(ARENA_BL_COAST, x, z)) return ISLAND_BL;
  if (_pointInRing(ARENA_BR_COAST, x, z)) return ISLAND_BR;
  return ISLAND_NONE;
}

// ── Safe-zone helpers ──────────────────────────────────────────────────────────
// The beach is the 1m band between the play boundary and the waterline.
// A player on the beach is on land but NOT in the combat zone.

export function isOnBeach(x, z) {
  // On land (inside coast) but NOT inside play area
  const onLand = isTomoeLand(x, z);
  if (!onLand) return false;

  // Check if inside any play ring
  if (isNapPlayArea(x, z)) return false;
  if (isArenaPlayArea(x, z)) return false;

  return true; // On land but outside play boundary = beach
}

// True if a player at (x,z) can be shot (inside arena play area).
export function isShootable(x, z) {
  return isArenaPlayArea(x, z);
}
