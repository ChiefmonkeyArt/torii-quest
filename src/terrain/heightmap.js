// terrain/heightmap.js — TWO-ISLAND terrain heightfield (Stage 3, v0.2.329).
//
// The SINGLE source of truth for ground height in BOTH playable zones — the main
// ARENA (x ≤ 20) and the NAP zone (x ≥ 20). Both are now undulating ISLANDS that
// rise from the Stage-2 sea: their interior sits on a raised plateau (ISLAND_BASE_Y
// = +0.6, comfortably above SEA_LEVEL = -0.3 so no water pools in the dips), and
// their sea-facing edges slope OUTWARD down to sea level so the land reads as an
// island, not a floating slab. The shared edge at x=20 is now a SEA CHANNEL
// (Stage 4, v0.2.331): both zones fade their land to SEA_LEVEL and dip
// CHANNEL_DIP below it at the centreline, so the islands are separated by water
// spanned by a bridge — the old level land JOIN under the gate is gone.
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
// meet at exactly ISLAND_BASE_Y — continuous, level ground. (No zone uses a plain
// 'join' seam any more — the shared x=20 line is now a 'channel' — but the kind is
// kept for completeness / any future interior join.)
export const SEAM_WIDTH = 3.0;

// ── Sea channel (Stage 4, v0.2.331) ──────────────────────────────────────────
// The shared x=20 seam is no longer a level land JOIN: a north-south sea channel
// is carved along it so the two islands are separated by water, spanned by a
// bridge. CHANNEL_HALF is the half-width of the carve on EACH side of the seam
// (so the channel land-gap is ~2·CHANNEL_HALF wide: arena land ends ≈ x=17, NAP
// land starts ≈ x=23). CHANNEL_DIP is how far BELOW sea level the channel floor
// sinks at the centreline so the gap reads as water, not a dry ditch.
export const CHANNEL_HALF = 3.0;
export const CHANNEL_DIP = 0.6;
// Channel centreline (world X) — the shared seam both zones fade to.
export const CHANNEL_X = NAP_X; // 20

// GLSL-style smoothstep, mirrored in JS. Used for both the shore slope and the
// seam hill-fade so the transitions are C1-smooth (walkable, jitter-free).
function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Per-edge land factor (1 = full plateau land, 0 = sea).
//   'join' → always land (the seam is land on both sides).
//   'sea'  → 1 at/inside the footprint edge, ramping to 0 SHORE_WIDTH outside it.
// d is the inward distance from the footprint edge (≥0 inside, <0 in the shore).
function edgeLand(kind, d, shore) {
  if (kind === 'join') return 1;
  // 'channel' → land ramps from 0 at the seam (d=0) up to full plateau
  // CHANNEL_HALF inward, so the base sinks to SEA_LEVEL at the water's edge.
  if (kind === 'channel') return smoothstep(0, CHANNEL_HALF, d);
  return smoothstep(-shore, 0, d);
}

// Per-edge hill factor (1 = full wave amplitude, 0 = flat).
//   'join' → fade hills to 0 across SEAM_WIDTH inside the edge (level at the seam).
//   'sea'  → fade hills to 0 into the shore band (flat beach, no hills in the surf).
function edgeHill(kind, d, shore, seam) {
  if (kind === 'join') return smoothstep(0, seam, d);
  // 'channel' → hills fade to 0 into the channel (flat water surface, no waves).
  if (kind === 'channel') return smoothstep(0, CHANNEL_HALF, d);
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
    // Channel carve: on a 'channel' edge the land factor already ramps the base
    // down to SEA_LEVEL at the seam; additionally sink it CHANNEL_DIP BELOW sea
    // level at the centreline so the gap reads as water. The dip fades to 0
    // CHANNEL_HALF inward (same band as the land ramp) → C1-continuous surface.
    let drop = 0;
    if (edges.minX === 'channel') drop = Math.max(drop, (1 - smoothstep(0, CHANNEL_HALF, dW)) * CHANNEL_DIP);
    if (edges.maxX === 'channel') drop = Math.max(drop, (1 - smoothstep(0, CHANNEL_HALF, dE)) * CHANNEL_DIP);
    if (edges.minZ === 'channel') drop = Math.max(drop, (1 - smoothstep(0, CHANNEL_HALF, dS)) * CHANNEL_DIP);
    if (edges.maxZ === 'channel') drop = Math.max(drop, (1 - smoothstep(0, CHANNEL_HALF, dN)) * CHANNEL_DIP);
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
// West edge (x=20) is the sea CHANNEL shared with the arena island; the other
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
  edges: { minX: 'channel', maxX: 'sea', minZ: 'sea', maxZ: 'sea' },
});

// ── Main-arena island (west of the torii gate) ───────────────────────────────
// East edge (x=20) is the sea CHANNEL shared with the NAP island; the other three edges are open sea
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
  edges: { minX: 'sea', maxX: 'channel', minZ: 'sea', maxZ: 'sea' },
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
