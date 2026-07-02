// terrain/heightmap.js — TWO-ISLAND terrain heightfield (Stage 5, v0.2.332).
//
// The SINGLE source of truth for ground height in BOTH playable zones — the main
// ARENA (x ≤ 20) and the NAP zone (x ≥ 20). Both are undulating ISLANDS that rise
// from the Stage-2 sea: their interior sits on a raised plateau (ISLAND_BASE_Y =
// +0.6, comfortably above SEA_LEVEL = -0.3 so no water pools in the dips), and
// their sea-facing edges slope OUTWARD down to sea level so the land reads as an
// island, not a floating slab. The two islands are separated by a MEANDERING RIVER
// (Stage 5, v0.2.332): a curved water band that snakes north-south, oscillating
// east/west about the x=20 seam. The river is carved GLOBALLY in sample() (keyed on
// the distance to the curved centreline riverCenterX(z)), identically in both zones,
// so it is one continuous feature; the x=20 seam itself is a level JOIN (hills fade
// to 0 there in both zones) so the two heightfields still meet continuously wherever
// the meander has curved away. A bridge crosses the river at z=0.
//
// Every consumer reads the SAME continuous height function h(x,z) per zone:
//   - terrainMesh.js  → bakes h() into mesh vertex Y (exact, CPU)
//   - arena-foliage.js → bakes h() into each grass blade's base Y (exact, CPU)
//   - physics.js       → samples h() at grid points into a Rapier heightfield
//
// PURE + node-safe: no THREE, no RAPIER, no window/document. Deterministic (no
// Math.random) so all consumers agree and unit tests are stable. Y-up: heights are
// along +Y, ground is the XZ plane.

import { NAP_X, NAP_FAR_X, ARENA_HALF } from '../config.js';
import { SEA_LEVEL } from './seaConfig.js';

// ── Island shaping constants ────────────────────────────────────────────────
// Plateau height the interior of each island sits at. Chosen so baseY − (peak
// downward wave) stays above SEA_LEVEL: even the deepest trough of the hills is
// dry land, so the sea never shows through a dip (the Stage-1/2 pooling bug).
export const ISLAND_BASE_Y = 0.6;
// Outward shore band (metres): how far past a sea-facing footprint edge the land
// slopes down to sea level. The plateau keeps full height right to the footprint
// edge; the beach lives OUTSIDE it (mostly hidden behind arena walls / beyond the
// play-area clamps), so the gameplay floor stays flat and level.
export const SHORE_WIDTH = 4.0;
// Seam band (metres): approaching a JOIN edge the hills fade to 0 so both zones
// meet at exactly ISLAND_BASE_Y — continuous, level ground. The shared x=20 line is
// a 'join' seam in BOTH zones; the meandering river is carved globally on top (see
// sample()), so the two heightfields agree at x=20 wherever the river has curved off.
export const SEAM_WIDTH = 3.0;

// ── Meandering river (Stage 5, v0.2.332) ─────────────────────────────────────
// The Stage-4 straight channel at x=20 is replaced by a river that MEANDERS as
// it runs north-south: its centreline curves east/west with a smooth sine so the
// water snakes between the two islands instead of cutting a dead-straight line.
//
//   riverCenterX(z) = RIVER_BASE_X + MEANDER_AMP · sin(z · MEANDER_FREQ)
//
// RIVER_BASE_X = 20 (the shared seam) and sin(0) = 0, so riverCenterX(0) === 20
// EXACTLY — the river passes through the bridge (which crosses E-W at z=0) right
// where the deck spans it. MEANDER_FREQ = 2π/30 → one full wiggle every ~30m.
// The river is a band of half-width RIVER_HALF centred on that curve; its floor
// sinks RIVER_DIP below sea level at the centreline so it reads as water.
//
// The carve is applied GLOBALLY in sample() (not as a per-edge kind) using the
// distance from riverCenterX(z), so BOTH zones share the identical centreline and
// the river is continuous across the x=20 seam. The seam itself stays a level
// 'join' (hills fade to 0 at x=20 in both zones) so the two heightfields still
// meet continuously wherever the meander has curved away from x=20.
export const RIVER_BASE_X = NAP_X;          // 20 — seam the river oscillates about
export const MEANDER_AMP  = 3.5;            // ±3.5m east/west sway of the centreline
export const MEANDER_FREQ = (2 * Math.PI) / 30; // one full meander per ~30m of z
export const RIVER_HALF   = 3.0;            // half-width of the water band (~6m wide)
export const RIVER_DIP    = 0.6;            // metres the floor sinks BELOW SEA_LEVEL

// riverCenterX(z) — world-X of the meandering river centreline at depth z. Shared
// by both zones (and by grass exclusion) so the river is one continuous feature.
export function riverCenterX(z) {
  return RIVER_BASE_X + MEANDER_AMP * Math.sin(z * MEANDER_FREQ);
}

// riverDist(x,z) — perpendicular-ish distance from the meandering centreline. Used
// to decide how deeply a point is inside the river band.
export function riverDist(x, z) {
  return Math.abs(x - riverCenterX(z));
}

// GLSL-style smoothstep, mirrored in JS. Used for both the shore slope and the
// seam hill-fade so the transitions are C1-smooth (walkable, jitter-free).
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Per-edge land factor (1 = full plateau land, 0 = sea).
//   'join' → always land (the seam is land on both sides — the meandering river is
//            carved GLOBALLY in sample(), not per-edge, so the x=20 seam is plain land).
//   'sea'  → 1 at/inside the footprint edge, ramping to 0 SHORE_WIDTH outside it.
// d is the inward distance from the footprint edge (≥0 inside, <0 in the shore).
function edgeLand(kind, d, shore) {
  if (kind === 'join') return 1;
  return smoothstep(-shore, 0, d);
}

// Per-edge hill factor (1 = full wave amplitude, 0 = flat).
//   'join' → fade hills to 0 across SEAM_WIDTH inside the edge (level at the seam) so
//            both zones agree at x=20 wherever the meander has curved away from it.
//   'sea'  → fade hills to 0 into the shore band (flat beach, no hills in the surf).
function edgeHill(kind, d, shore, seam) {
  if (kind === 'join') return smoothstep(0, seam, d);
  return smoothstep(-shore, 0, d);
}

// Layered low-frequency sines → broad rolling hills (no high-frequency content, so
// slopes stay walkable + jitter-free). Centre-relative coords; a per-zone `phase`
// makes the two islands read as distinct landforms rather than a mirrored pattern.
// Returns metres of vertical displacement, scaled by the zone amplitude.
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

// Build one island zone from a config. Returns the frozen TERRAIN descriptor, its
// heightfield GRID, the canonical sample(x,z), the Rapier heightfield array
// builder, and a debug peak probe. The heightfield/mesh span the EXTENDED rect
// (footprint + outward shore on sea edges); the footprint is the gameplay plateau.
function makeZone(cfg) {
  const { minX, maxX, minZ, maxZ, edges, amp, targetCell } = cfg;

  // Extended rect = footprint grown outward by SHORE_WIDTH on each SEA edge only
  // (JOIN edges are not extended — the neighbouring island's terrain meets them).
  const gMinX = minX - (edges.minX === 'sea' ? SHORE_WIDTH : 0);
  const gMaxX = maxX + (edges.maxX === 'sea' ? SHORE_WIDTH : 0);
  const gMinZ = minZ - (edges.minZ === 'sea' ? SHORE_WIDTH : 0);
  const gMaxZ = maxZ + (edges.maxZ === 'sea' ? SHORE_WIDTH : 0);
  const gWidth = gMaxX - gMinX;
  const gDepth = gMaxZ - gMinZ;

  // Vertex counts over the extended rect at ~targetCell spacing. +1 so the last
  // vertex lands exactly on the far edge; column-major grid used by Rapier + mesh.
  const colsX = Math.max(2, Math.round(gWidth / targetCell) + 1);
  const rowsZ = Math.max(2, Math.round(gDepth / targetCell) + 1);
  const cellW = gWidth / (colsX - 1);
  const cellD = gDepth / (rowsZ - 1);

  const shapeCfg = {
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    amp,
    phase: cfg.phase,
  };

  // Canonical height at world (x,z). SEA_LEVEL outside the extended rect.
  function sample(x, z) {
    if (x < gMinX || x > gMaxX || z < gMinZ || z > gMaxZ) return SEA_LEVEL;
    const dW = x - minX;   // inward distance from the west (minX) edge
    const dE = maxX - x;   // …east (maxX)
    const dS = z - minZ;   // …south (minZ)
    const dN = maxZ - z;   // …north (maxZ)
    let land = 1;
    land = Math.min(land, edgeLand(edges.minX, dW, SHORE_WIDTH));
    land = Math.min(land, edgeLand(edges.maxX, dE, SHORE_WIDTH));
    land = Math.min(land, edgeLand(edges.minZ, dS, SHORE_WIDTH));
    land = Math.min(land, edgeLand(edges.maxZ, dN, SHORE_WIDTH));
    let hill = 1;
    hill = Math.min(hill, edgeHill(edges.minX, dW, SHORE_WIDTH, SEAM_WIDTH));
    hill = Math.min(hill, edgeHill(edges.maxX, dE, SHORE_WIDTH, SEAM_WIDTH));
    hill = Math.min(hill, edgeHill(edges.minZ, dS, SHORE_WIDTH, SEAM_WIDTH));
    hill = Math.min(hill, edgeHill(edges.maxZ, dN, SHORE_WIDTH, SEAM_WIDTH));
    // Meandering river carve (GLOBAL, shared by both zones). Distance from the
    // curved centreline riverCenterX(z) decides how deep we are in the water band:
    // at the centreline riverLand=0 → base drops to SEA_LEVEL and the floor sinks a
    // further RIVER_DIP below it (→ SEA_LEVEL − RIVER_DIP); riverLand ramps back to 1
    // RIVER_HALF away, so plateau land resumes. Hills also fade to 0 in the band
    // (flat water surface). Applying the SAME carve in both zones keeps the river one
    // continuous feature across the x=20 seam even as the centreline meanders across it.
    const rd = riverDist(x, z);
    const riverLand = smoothstep(0, RIVER_HALF, rd);
    land = Math.min(land, riverLand);
    hill = Math.min(hill, riverLand);
    const drop = (1 - riverLand) * RIVER_DIP;
    const base = SEA_LEVEL + (ISLAND_BASE_Y - SEA_LEVEL) * land;
    return base + rawHeight(x, z, shapeCfg) * hill - drop;
  }

  const TERRAIN = Object.freeze({
    name: cfg.name,
    // Footprint (gameplay plateau extents).
    minX, maxX, minZ, maxZ,
    width: maxX - minX,
    depth: maxZ - minZ,
    centerX: (minX + maxX) / 2,
    centerZ: (minZ + maxZ) / 2,
    amp,
    baseY: ISLAND_BASE_Y,
    // Heightfield / mesh extent (footprint + outward shore). Physics uses THESE
    // as the collider scale + translation so the collider matches the mesh 1:1.
    gMinX, gMaxX, gMinZ, gMaxZ,
    gWidth, gDepth,
    gCenterX: (gMinX + gMaxX) / 2,
    gCenterZ: (gMinZ + gMaxZ) / 2,
  });

  const GRID = Object.freeze({ colsX, rowsZ, cellW, cellD });

  // Rapier heights in COLUMN-MAJOR order over the EXTENDED rect:
  //   heights[col * rowsZ + row], col ∈ [0,colsX-1] (X), row ∈ [0,rowsZ-1] (Z).
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

  // Highest sampled point + its location (orientation check / logging).
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

// ── NAP-zone island (east of the torii gate) ─────────────────────────────────
// West edge (x=20) is the level JOIN seam shared with the arena island; the
// meandering river is carved GLOBALLY (see sample()), not on this edge, so both
// zones meet continuously at x=20 wherever the river has curved away. The other
// three edges are open sea.
const _nap = makeZone({
  name: 'nap',
  minX: NAP_X,        // 20  — shared seam with the arena island
  maxX: NAP_FAR_X,    // 45
  minZ: -ARENA_HALF,  // -20
  maxZ: ARENA_HALF,   // 20
  amp: 0.35,          // full rolling hills — walkable garden, no bots/crates
  phase: 0.0,
  targetCell: 0.32,
  edges: { minX: 'join', maxX: 'sea', minZ: 'sea', maxZ: 'sea' },
});

// ── Main-arena island (west of the torii gate) ───────────────────────────────
// East edge (x=20) is the level JOIN seam shared with the NAP island (the river is
// carved globally in sample(), not on this edge); the other three edges are open sea
// (hidden behind the arena walls). Amplitude is now PRONOUNCED (v0.2.330): the
// arena floor visibly rolls ±~0.5m so combat happens over real hills and dips.
// This is safe because every arena entity now RIDES the terrain — bots sample
// sampleArenaHeight() each tick, static crates sit on the sampled surface, and
// dynamic crates gravity-rest on the heightfield collider — so nothing floats or
// sinks. Interior min ≈ baseY − 1.42·amp ≈ 0.6 − 0.71 sampled ≈ +0.15, still
// comfortably above SEA_LEVEL (−0.3) so no water pools in the dips.
const _arena = makeZone({
  name: 'arena',
  minX: -ARENA_HALF,  // -20
  maxX: ARENA_HALF,   // 20  — shared seam with the NAP island
  minZ: -ARENA_HALF,  // -20
  maxZ: ARENA_HALF,   // 20
  amp: 0.5,           // pronounced rolling hills (entities ride the terrain)
  phase: 2.3,         // different phase → distinct landform from the NAP island
  targetCell: 0.32,
  edges: { minX: 'sea', maxX: 'join', minZ: 'sea', maxZ: 'sea' },
});

// ── NAP exports (Stage-1 names preserved) ─────────────────────────────────────
export const NAP_TERRAIN = _nap.TERRAIN;
export const NAP_GRID = _nap.GRID;
export const NAP_TERRAIN_AMP = _nap.TERRAIN.amp;
export const sampleNapHeight = _nap.sample;
export const buildNapHeightfieldArray = _nap.buildHeightfieldArray;
export const napTerrainPeak = _nap.peak;
// Backward-compat alias: Stage-1 code imported `sampleHeight` for the NAP zone.
export const sampleHeight = _nap.sample;

// ── Arena exports (Stage-3, new) ──────────────────────────────────────────────
export const ARENA_TERRAIN = _arena.TERRAIN;
export const ARENA_GRID = _arena.GRID;
export const ARENA_TERRAIN_AMP = _arena.TERRAIN.amp;
export const sampleArenaHeight = _arena.sample;
export const buildArenaHeightfieldArray = _arena.buildHeightfieldArray;
export const arenaTerrainPeak = _arena.peak;

// World (x,z) → NAP heightfield grid indices (fractional). Kept for Stage-1
// callers; measured against the NAP extended-grid origin.
export function worldToGrid(x, z) {
  return {
    col: (x - NAP_TERRAIN.gMinX) / NAP_GRID.cellW,
    row: (z - NAP_TERRAIN.gMinZ) / NAP_GRID.cellD,
  };
}
