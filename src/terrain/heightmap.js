// terrain/heightmap.js — TOMOE terrain heightfield (v0.2.511).
//
// The SINGLE source of truth for ground height in the Mitsudomoe island layout.
// Three comma-shaped islands (counter-clockwise): NAP (top), Arena BL (bottom-left),
// Arena BR (bottom-right). Each island's coast is defined by a polygon from the SVG.
//
// The height function uses SIGNED DISTANCE to the nearest coast polygon:
//   • Outside all islands → SEA_LEVEL (ocean)
//   • Inside, near coast (within BEACH_INSET) → smooth ramp from SEA_LEVEL to ISLAND_BASE_Y
//   • Inside, past beach → plateau (ISLAND_BASE_Y) with rolling hills
//
// Sea channels between the three shapes are NATURAL — the polygon shapes leave gaps
// that are below sea level. No artificial river carve needed.
//
// PURE + node-safe: no THREE, no RAIER, no window/document. Deterministic.
// Y-up: heights are along +Y, ground is the XZ plane.

import { SEA_LEVEL } from './seaConfig.js';
import {
  NAP_COAST, ARENA_BL_COAST, ARENA_BR_COAST,
} from './tomoeShapeData.js';

// ── Island shaping constants ────────────────────────────────────────────────
export const ISLAND_BASE_Y = 1.0;
export const SHORE_WIDTH = 4.0;
export const BEACH_INSET = 1.5;
export const SHELF_DEPTH  = 0.0;
export const SHELF_DEEP_Y = SEA_LEVEL - 0.6;
export const SEAM_WIDTH = 3.0;

// ── Legacy river exports (stubbed — sea channels replace the river) ──────────
// arena-foliage.js imports these; RIVER_HALF=0 means the river exclusion check
// never excludes any points (no artificial river band).
export const RIVER_BASE_X = 0;
export const MEANDER_AMP  = 0;
export const MEANDER_FREQ = 0;
export const RIVER_HALF   = 0;
export const RIVER_DIP    = 0;
export function riverCenterX(z) { return 0; }
export function riverDist(x, z) { return Infinity; }

// ── Smoothstep (GLSL-style, C1-smooth) ────────────────────────────────────────
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ── Point-in-polygon (ray casting) ────────────────────────────────────────────
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

// ── Distance to polygon edge ──────────────────────────────────────────────────
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

// ── Signed distance to nearest coast (positive inside, negative outside) ──────
// Checks multiple coast rings and returns the signed distance to the nearest one.
function _signedDistToCoast(coastRings, x, z) {
  let bestInside = -Infinity;
  let bestOutside = Infinity;
  for (const ring of coastRings) {
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

// ── Rolling hills (same layered sines as before) ──────────────────────────────
function rawHeight(x, z, cfg) {
  const ux = x - cfg.centerX;
  const uz = z - cfg.centerZ;
  const p = cfg.phase;
  let h = 0;
  h += Math.sin(ux * 0.42 + 0.7 + p) * Math.cos(uz * 0.31 + p)        * 0.55;
  h += Math.sin(ux * 0.27 - 1.3 + p) * Math.sin(uz * 0.39 + 0.5)      * 0.35;
  h += Math.cos(ux * 0.61 + 2.1)     * Math.sin(uz * 0.22 - 0.8 + p)  * 0.22;
  h += Math.sin(ux * 0.18 + 3.0)     * Math.cos(uz * 0.15 + 1.1 + p)  * 0.30;
  return h * cfg.amp;
}

// ── Build a zone from coast polygons ──────────────────────────────────────────
function makeTomoeZone(cfg) {
  const { coastRings, name, amp, phase, targetCell } = cfg;

  // Compute bbox from all coast rings + margin for the beach/shore
  const margin = SHORE_WIDTH;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const ring of coastRings) {
    for (const [x, z] of ring) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
  }

  const gMinX = minX - margin;
  const gMaxX = maxX + margin;
  const gMinZ = minZ - margin;
  const gMaxZ = maxZ + margin;
  const gWidth = gMaxX - gMinX;
  const gDepth = gMaxZ - gMinZ;

  const colsX = Math.max(2, Math.round(gWidth / targetCell) + 1);
  const rowsZ = Math.max(2, Math.round(gDepth / targetCell) + 1);
  const cellW = gWidth / (colsX - 1);
  const cellD = gDepth / (rowsZ - 1);

  const shapeCfg = {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    amp,
    phase,
  };

  // Height at world (x,z). Uses signed distance to coast polygons.
  function sample(x, z) {
    const d = _signedDistToCoast(coastRings, x, z);

    if (d <= 0) {
      // Outside all islands — sea level
      return SEA_LEVEL;
    }

    // Inside land — beach ramp from SEA_LEVEL at edge to ISLAND_BASE_Y
    const beachT = smoothstep(0, BEACH_INSET, d);
    const base = SEA_LEVEL + (ISLAND_BASE_Y - SEA_LEVEL) * beachT;

    // Hills fade to 0 near coast (flat beach, no bumps in the surf)
    const hillT = smoothstep(0, BEACH_INSET, d);
    const hills = rawHeight(x, z, shapeCfg) * hillT;

    return base + hills;
  }

  const TERRAIN = Object.freeze({
    name,
    // Footprint (island bounds from coast polygons)
    minX, maxX, minZ, maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    amp,
    baseY: ISLAND_BASE_Y,
    // Extended grid (footprint + margin)
    gMinX, gMaxX, gMinZ, gMaxZ,
    gWidth, gDepth,
    gCenterX: (gMinX + gMaxX) / 2,
    gCenterZ: (gMinZ + gMaxZ) / 2,
  });

  const GRID = Object.freeze({ colsX, rowsZ, cellW, cellD });

  function buildHeightfieldArray() {
    const heights = new Float32Array(colsX * rowsZ);
    for (let col = 0; col < colsX; col++) {
      const x = gMinX + col * cellW;
      for (let row = 0; row < rowsZ; row++) {
        const z = gMinZ + row * cellD;
        heights[col * rowsZ + row] = sample(x, z);
      }
    }
    return heights;
  }

  function peak() {
    let best = -Infinity, bx = 0, bz = 0;
    for (let col = 0; col < colsX; col++) {
      const x = gMinX + col * cellW;
      for (let row = 0; row < rowsZ; row++) {
        const z = gMinZ + row * cellD;
        const h = sample(x, z);
        if (h > best) { best = h; bx = x; bz = z; }
      }
    }
    return { x: bx, z: bz, height: best };
  }

  return { TERRAIN, GRID, sample, buildHeightfieldArray, peak };
}

// ── NAP zone (top comma shape) ────────────────────────────────────────────────
const _nap = makeTomoeZone({
  coastRings: [NAP_COAST],
  name: 'nap',
  amp: 0.35,
  phase: 0.0,
  targetCell: 0.32,
});

// ── Arena zone (bottom two comma shapes) ──────────────────────────────────────
const _arena = makeTomoeZone({
  coastRings: [ARENA_BL_COAST, ARENA_BR_COAST],
  name: 'arena',
  amp: 0.5,
  phase: 2.3,
  targetCell: 0.32,
});

// ── NAP exports (backward-compat names preserved) ─────────────────────────────
export const NAP_TERRAIN = _nap.TERRAIN;
export const NAP_GRID = _nap.GRID;
export const NAP_TERRAIN_AMP = _nap.TERRAIN.amp;
export const sampleNapHeight = _nap.sample;
export const buildNapHeightfieldArray = _nap.buildHeightfieldArray;
export const napTerrainPeak = _nap.peak;
export const sampleHeight = _nap.sample;

// ── Arena exports (backward-compat names preserved) ────────────────────────────
export const ARENA_TERRAIN = _arena.TERRAIN;
export const ARENA_GRID = _arena.GRID;
export const ARENA_TERRAIN_AMP = _arena.TERRAIN.amp;
export const sampleArenaHeight = _arena.sample;
export const buildArenaHeightfieldArray = _arena.buildHeightfieldArray;
export const arenaTerrainPeak = _arena.peak;

// World (x,z) → NAP heightfield grid indices (fractional).
export function worldToGrid(x, z) {
  return {
    col: (x - NAP_TERRAIN.gMinX) / NAP_GRID.cellW,
    row: (z - NAP_TERRAIN.gMinZ) / NAP_GRID.cellD,
  };
}
