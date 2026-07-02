// tests/terrain-heightmap.test.js — TWO-ISLAND terrain heightmap (Stage 3, v0.2.329).
// Pure + node-safe (no THREE/RAPIER, deterministic), so it runs node-fast. Locks the
// single source-of-truth height function that mesh + grass + physics all read for
// BOTH the NAP zone and the main arena. The Stage-1 "fade to y=0 at the borders"
// model is gone: each zone is now a raised island (interior ≈ ISLAND_BASE_Y) whose
// sea-facing edges slope OUTWARD to SEA_LEVEL and whose shared x=20 seam is a level
// JOIN at ISLAND_BASE_Y.
import { describe, it, expect } from 'vitest';
import {
  NAP_TERRAIN, NAP_GRID, NAP_TERRAIN_AMP,
  ARENA_TERRAIN, ARENA_GRID, ARENA_TERRAIN_AMP,
  sampleHeight, sampleNapHeight, sampleArenaHeight,
  buildNapHeightfieldArray, buildArenaHeightfieldArray,
  napTerrainPeak, arenaTerrainPeak,
  ISLAND_BASE_Y, CHANNEL_X, CHANNEL_HALF, CHANNEL_DIP,
} from '../src/terrain/heightmap.js';
import { SEA_LEVEL } from '../src/terrain/seaConfig.js';

describe('sampleHeight alias === sampleNapHeight (backward compat)', () => {
  it('is the same function reference', () => {
    expect(sampleHeight).toBe(sampleNapHeight);
  });
});

describe('sea channel at x=20 (Stage 4, v0.2.331 — replaces the old level JOIN)', () => {
  // The shared x=20 seam is now a SEA CHANNEL: both zones fade their land to
  // SEA_LEVEL and dip CHANNEL_DIP below it at the centreline, so the islands are
  // separated by water (spanned by a bridge). The old ISLAND_BASE_Y level-join
  // assertions are gone by design.
  const CHANNEL_FLOOR = SEA_LEVEL - CHANNEL_DIP;

  it('NAP west channel edge dips to SEA_LEVEL − CHANNEL_DIP at the centreline', () => {
    expect(sampleNapHeight(CHANNEL_X, NAP_TERRAIN.centerZ)).toBeCloseTo(CHANNEL_FLOOR, 6);
  });

  it('arena east channel edge dips to SEA_LEVEL − CHANNEL_DIP at the centreline', () => {
    expect(sampleArenaHeight(CHANNEL_X, ARENA_TERRAIN.centerZ)).toBeCloseTo(CHANNEL_FLOOR, 6);
  });

  it('channel floor at the seam is below SEA_LEVEL (reads as water, not dry land)', () => {
    for (const z of [-15, -5, 0, 7, 15]) {
      expect(sampleArenaHeight(CHANNEL_X, z)).toBeLessThanOrEqual(SEA_LEVEL);
      expect(sampleNapHeight(CHANNEL_X, z)).toBeLessThanOrEqual(SEA_LEVEL);
    }
  });

  it('both zones still meet continuously on the shared x=20 line', () => {
    for (const z of [-15, -5, 0, 7, 15]) {
      expect(sampleArenaHeight(CHANNEL_X, z)).toBeCloseTo(sampleNapHeight(CHANNEL_X, z), 6);
    }
  });

  it('land returns to the plateau just OUTSIDE the channel band on both sides', () => {
    // Arena land edge ≈ x=17, NAP land edge ≈ x=23 (CHANNEL_HALF=3 from x=20).
    expect(sampleArenaHeight(CHANNEL_X - CHANNEL_HALF, 0)).toBeGreaterThan(SEA_LEVEL);
    expect(sampleNapHeight(CHANNEL_X + CHANNEL_HALF, 0)).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('outside the grid extent → SEA_LEVEL', () => {
  it('NAP samples the sea far outside its footprint', () => {
    expect(sampleNapHeight(1000, 0)).toBe(SEA_LEVEL);
    expect(sampleNapHeight(NAP_TERRAIN.centerX, 1000)).toBe(SEA_LEVEL);
  });

  it('arena samples the sea far outside its footprint', () => {
    expect(sampleArenaHeight(-1000, 0)).toBe(SEA_LEVEL);
    expect(sampleArenaHeight(0, 1000)).toBe(SEA_LEVEL);
  });
});

describe('island shore — sea edges slope OUTWARD down to SEA_LEVEL', () => {
  it('NAP far-east shore has dropped to ~SEA_LEVEL at the extended grid edge', () => {
    // maxX is a 'sea' edge → land ramps to 0 SHORE_WIDTH beyond the footprint.
    expect(sampleNapHeight(NAP_TERRAIN.gMaxX, NAP_TERRAIN.centerZ)).toBeCloseTo(SEA_LEVEL, 3);
  });

  it('arena west shore has dropped to ~SEA_LEVEL at the extended grid edge', () => {
    expect(sampleArenaHeight(ARENA_TERRAIN.gMinX, ARENA_TERRAIN.centerZ)).toBeCloseTo(SEA_LEVEL, 3);
  });
});

describe('no pooling — interior stays dry land above SEA_LEVEL', () => {
  function interiorMin(TERRAIN, sample) {
    // Sample the footprint interior on a fine grid; the lowest point must still
    // be above SEA_LEVEL so the sea never shows through a wave trough. The sea
    // CHANNEL band around x=20 is DELIBERATELY below sea level (it's water), so
    // it's excluded — "no pooling" means the dry LAND interior never dips below.
    let min = Infinity;
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const x = TERRAIN.minX + (TERRAIN.maxX - TERRAIN.minX) * (i / N);
      if (Math.abs(x - CHANNEL_X) < CHANNEL_HALF) continue;
      for (let j = 0; j <= N; j++) {
        const z = TERRAIN.minZ + (TERRAIN.maxZ - TERRAIN.minZ) * (j / N);
        min = Math.min(min, sample(x, z));
      }
    }
    return min;
  }

  it('NAP interior minimum is comfortably above SEA_LEVEL', () => {
    expect(interiorMin(NAP_TERRAIN, sampleNapHeight)).toBeGreaterThan(SEA_LEVEL);
  });

  it('arena interior minimum is comfortably above SEA_LEVEL', () => {
    expect(interiorMin(ARENA_TERRAIN, sampleArenaHeight)).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('hills exist and are bounded by baseY ± amplitude', () => {
  // rawHeight() sums 4 sine layers with |weights| = 0.55+0.35+0.22+0.30 = 1.42,
  // scaled by the zone amp — so the analytic max upward displacement is 1.42·amp.
  const RAW_WEIGHT_SUM = 1.42;

  it('NAP peak sits between baseY and baseY + 1.42·amp', () => {
    const peak = napTerrainPeak();
    expect(peak.height).toBeGreaterThan(ISLAND_BASE_Y);
    expect(peak.height).toBeLessThanOrEqual(ISLAND_BASE_Y + NAP_TERRAIN_AMP * RAW_WEIGHT_SUM + 1e-9);
  });

  it('arena peak sits between baseY and baseY + 1.42·amp (pronounced undulation)', () => {
    const peak = arenaTerrainPeak();
    expect(peak.height).toBeGreaterThan(ISLAND_BASE_Y);
    expect(peak.height).toBeLessThanOrEqual(ISLAND_BASE_Y + ARENA_TERRAIN_AMP * RAW_WEIGHT_SUM + 1e-9);
  });

  it('arena undulates PRONOUNCEDLY now that entities ride the terrain (v0.2.330)', () => {
    // v0.2.329 kept the arena gentle because bots/crates sat at a flat baseY. In
    // v0.2.330 bots sample the surface each tick, static crates sit on the sampled
    // height, and dynamic crates gravity-rest on the heightfield — so the arena is
    // now the MORE pronounced island (bigger rolling hills), not the gentler one.
    expect(ARENA_TERRAIN_AMP).toBeGreaterThan(NAP_TERRAIN_AMP);
    expect(ARENA_TERRAIN_AMP).toBeCloseTo(0.5, 6);
  });
});

describe('v0.2.330 — arena no-pooling holds at the raised amplitude', () => {
  it('arena LAND interior minimum stays above SEA_LEVEL even at amp 0.5', () => {
    // Bigger hills mean deeper dips; verify the deepest interior point is still
    // dry land (above SEA_LEVEL) so the sea never shows through an arena trough.
    // The sea channel band around x=20 is excluded — it's intentionally water.
    let min = Infinity;
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const x = ARENA_TERRAIN.minX + (ARENA_TERRAIN.maxX - ARENA_TERRAIN.minX) * (i / N);
      if (Math.abs(x - CHANNEL_X) < CHANNEL_HALF) continue;
      for (let j = 0; j <= N; j++) {
        const z = ARENA_TERRAIN.minZ + (ARENA_TERRAIN.maxZ - ARENA_TERRAIN.minZ) * (j / N);
        min = Math.min(min, sampleArenaHeight(x, z));
      }
    }
    expect(min).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('v0.2.331 — sea channel is carved below sea level along the whole x=20 seam', () => {
  it('channel centreline is below SEA_LEVEL across the full N-S extent of both zones', () => {
    for (let z = ARENA_TERRAIN.minZ; z <= ARENA_TERRAIN.maxZ; z += 2) {
      expect(sampleArenaHeight(CHANNEL_X, z)).toBeLessThan(SEA_LEVEL);
      expect(sampleNapHeight(CHANNEL_X, z)).toBeLessThan(SEA_LEVEL);
    }
  });

  it('channel is a narrow band — land is dry again CHANNEL_HALF away on each side', () => {
    // Just outside the band the surface is back on the plateau (well above sea).
    expect(sampleArenaHeight(CHANNEL_X - CHANNEL_HALF - 0.5, 0)).toBeGreaterThan(SEA_LEVEL);
    expect(sampleNapHeight(CHANNEL_X + CHANNEL_HALF + 0.5, 0)).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('heightfield arrays — Rapier-ready, column-major', () => {
  it('NAP array is Float32Array of length rowsZ*colsX, finite, max above baseY', () => {
    const heights = buildNapHeightfieldArray();
    expect(heights).toBeInstanceOf(Float32Array);
    expect(heights.length).toBe(NAP_GRID.rowsZ * NAP_GRID.colsX);
    let max = -Infinity;
    for (const h of heights) { expect(Number.isFinite(h)).toBe(true); if (h > max) max = h; }
    expect(max).toBeGreaterThan(ISLAND_BASE_Y);
  });

  it('arena array is Float32Array of length rowsZ*colsX, finite, max above baseY', () => {
    const heights = buildArenaHeightfieldArray();
    expect(heights).toBeInstanceOf(Float32Array);
    expect(heights.length).toBe(ARENA_GRID.rowsZ * ARENA_GRID.colsX);
    let max = -Infinity;
    for (const h of heights) { expect(Number.isFinite(h)).toBe(true); if (h > max) max = h; }
    expect(max).toBeGreaterThan(ISLAND_BASE_Y);
  });

  it('is column-major over the EXTENDED grid: heights[col*rows+row] maps to world (x,z)', () => {
    const heights = buildNapHeightfieldArray();
    const { colsX, rowsZ, cellW, cellD } = NAP_GRID;
    const col = Math.floor(colsX / 2);
    const row = Math.floor(rowsZ / 2);
    const x = NAP_TERRAIN.gMinX + col * cellW;
    const z = NAP_TERRAIN.gMinZ + row * cellD;
    expect(heights[col * rowsZ + row]).toBeCloseTo(sampleNapHeight(x, z), 6);
  });
});
