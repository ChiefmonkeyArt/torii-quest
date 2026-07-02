// tests/terrain-heightmap.test.js — TWO-ISLAND terrain heightmap (Stage 5, v0.2.332).
// Pure + node-safe (no THREE/RAPIER, deterministic), so it runs node-fast. Locks the
// single source-of-truth height function that mesh + grass + physics all read for
// BOTH the NAP zone and the main arena. Each zone is a raised island (interior ≈
// ISLAND_BASE_Y) whose sea-facing edges slope OUTWARD to SEA_LEVEL; the two islands
// are separated by a MEANDERING RIVER — a curved water band that oscillates east/west
// about the x=20 seam as it runs north-south (riverCenterX(z) = 20 + AMP·sin(z·FREQ)).
// The river is carved GLOBALLY (same centreline in both zones), while the x=20 seam
// itself is a level JOIN so the two heightfields still meet continuously there.
import { describe, it, expect } from 'vitest';
import {
  NAP_TERRAIN, NAP_GRID, NAP_TERRAIN_AMP,
  ARENA_TERRAIN, ARENA_GRID, ARENA_TERRAIN_AMP,
  sampleHeight, sampleNapHeight, sampleArenaHeight,
  buildNapHeightfieldArray, buildArenaHeightfieldArray,
  napTerrainPeak, arenaTerrainPeak,
  ISLAND_BASE_Y, RIVER_BASE_X, RIVER_HALF, RIVER_DIP, MEANDER_AMP, riverCenterX,
} from '../src/terrain/heightmap.js';
import { SEA_LEVEL } from '../src/terrain/seaConfig.js';

// Sample the river floor at depth z on whichever island grid contains the curved
// centreline there (arena grid ends at x=20, NAP grid starts at x=20; join edges are
// NOT extended, so a point on the far side of the seam reads SEA_LEVEL as "off-grid").
function sampleRiverFloor(z) {
  const cx = riverCenterX(z);
  return cx <= RIVER_BASE_X ? sampleArenaHeight(cx, z) : sampleNapHeight(cx, z);
}

describe('sampleHeight alias === sampleNapHeight (backward compat)', () => {
  it('is the same function reference', () => {
    expect(sampleHeight).toBe(sampleNapHeight);
  });
});

describe('meandering river (Stage 5, v0.2.332 — replaces the straight x=20 channel)', () => {
  // The two islands are separated by a CURVED water band that oscillates east/west
  // about x=20. Along its centreline the surface dips to SEA_LEVEL − RIVER_DIP; the
  // x=20 seam itself is a level JOIN so the two heightfields still agree there.
  const RIVER_FLOOR = SEA_LEVEL - RIVER_DIP;

  it('river centreline passes through x=20 at z=0 (aligned with the bridge)', () => {
    // sin(0) = 0 → riverCenterX(0) === RIVER_BASE_X (20) EXACTLY, so the river runs
    // under the bridge that crosses E-W at z=0 right where the deck spans it.
    expect(riverCenterX(0)).toBeCloseTo(RIVER_BASE_X, 12);
    expect(riverCenterX(0)).toBe(20);
  });

  it('centreline meanders east/west, staying within the ±MEANDER_AMP band', () => {
    let sawEast = false, sawWest = false;
    for (let z = -20; z <= 20; z += 1) {
      const cx = riverCenterX(z);
      expect(cx).toBeGreaterThanOrEqual(RIVER_BASE_X - MEANDER_AMP - 1e-9);
      expect(cx).toBeLessThanOrEqual(RIVER_BASE_X + MEANDER_AMP + 1e-9);
      if (cx > RIVER_BASE_X + 0.5) sawEast = true;
      if (cx < RIVER_BASE_X - 0.5) sawWest = true;
    }
    expect(sawEast && sawWest).toBe(true); // the river actually curves both ways
  });

  it('river floor dips to SEA_LEVEL − RIVER_DIP along the CURVED centreline', () => {
    for (const z of [-15, -7.5, 0, 7.5, 15]) {
      expect(sampleRiverFloor(z)).toBeCloseTo(RIVER_FLOOR, 6);
    }
  });

  it('river floor is below SEA_LEVEL along the curve (reads as water, not dry land)', () => {
    for (const z of [-18, -10, -3, 0, 4, 11, 18]) {
      expect(sampleRiverFloor(z)).toBeLessThanOrEqual(SEA_LEVEL);
    }
  });

  it('both zones still meet continuously on the shared x=20 JOIN line', () => {
    for (const z of [-15, -5, 0, 7, 15]) {
      expect(sampleArenaHeight(RIVER_BASE_X, z)).toBeCloseTo(sampleNapHeight(RIVER_BASE_X, z), 6);
    }
  });

  it('land returns to the plateau just OUTSIDE the river band, following the curve', () => {
    for (const z of [-12, 0, 9]) {
      const cx = riverCenterX(z);
      // Step RIVER_HALF+ off the curve on each side; whichever island holds that x
      // must be dry land again (above SEA_LEVEL).
      const west = cx - RIVER_HALF - 0.5;
      const east = cx + RIVER_HALF + 0.5;
      expect(sampleArenaHeight(Math.min(west, RIVER_BASE_X), z)).toBeGreaterThan(SEA_LEVEL);
      expect(sampleNapHeight(Math.max(east, RIVER_BASE_X), z)).toBeGreaterThan(SEA_LEVEL);
    }
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
    // be above SEA_LEVEL so the sea never shows through a wave trough. The
    // meandering RIVER band is DELIBERATELY below sea level (it's water), so points
    // inside it are excluded — "no pooling" means the dry LAND interior never dips
    // below. The band follows the curve, so the exclusion is z-aware.
    let min = Infinity;
    const N = 60;
    for (let i = 0; i <= N; i++) {
      const x = TERRAIN.minX + (TERRAIN.maxX - TERRAIN.minX) * (i / N);
      for (let j = 0; j <= N; j++) {
        const z = TERRAIN.minZ + (TERRAIN.maxZ - TERRAIN.minZ) * (j / N);
        if (Math.abs(x - riverCenterX(z)) < RIVER_HALF) continue;
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
    // The meandering river band is excluded (z-aware) — it's intentionally water.
    let min = Infinity;
    const N = 120;
    for (let i = 0; i <= N; i++) {
      const x = ARENA_TERRAIN.minX + (ARENA_TERRAIN.maxX - ARENA_TERRAIN.minX) * (i / N);
      for (let j = 0; j <= N; j++) {
        const z = ARENA_TERRAIN.minZ + (ARENA_TERRAIN.maxZ - ARENA_TERRAIN.minZ) * (j / N);
        if (Math.abs(x - riverCenterX(z)) < RIVER_HALF) continue;
        min = Math.min(min, sampleArenaHeight(x, z));
      }
    }
    expect(min).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('v0.2.332 — river is carved below sea level along its whole meandering curve', () => {
  it('river floor is below SEA_LEVEL along the curve across the full N-S extent', () => {
    for (let z = ARENA_TERRAIN.minZ; z <= ARENA_TERRAIN.maxZ; z += 2) {
      expect(sampleRiverFloor(z)).toBeLessThan(SEA_LEVEL);
    }
  });

  it('river is a narrow band — land is dry again RIVER_HALF away from the curve', () => {
    // Just outside the band (measured from the curved centreline) the surface is
    // back on the plateau (well above sea) on whichever island holds that x.
    for (const z of [-9, 0, 6]) {
      const cx = riverCenterX(z);
      expect(sampleArenaHeight(Math.min(cx - RIVER_HALF - 0.5, RIVER_BASE_X), z)).toBeGreaterThan(SEA_LEVEL);
      expect(sampleNapHeight(Math.max(cx + RIVER_HALF + 0.5, RIVER_BASE_X), z)).toBeGreaterThan(SEA_LEVEL);
    }
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
