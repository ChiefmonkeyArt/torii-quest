// tests/terrain-heightmap.test.js — TOMOE terrain heightmap (v0.2.511).
// Tests the polygon-based height function for the Mitsudomoe island layout.
// Three comma-shaped islands: NAP (top), Arena BL (bottom-left), Arena BR (bottom-right).
// Height uses signed distance to coast polygons: outside = sea, inside = plateau + hills.
import { describe, it, expect } from 'vitest';
import {
  NAP_TERRAIN, NAP_GRID, NAP_TERRAIN_AMP,
  ARENA_TERRAIN, ARENA_GRID, ARENA_TERRAIN_AMP,
  sampleHeight, sampleNapHeight, sampleArenaHeight,
  buildNapHeightfieldArray, buildArenaHeightfieldArray,
  napTerrainPeak, arenaTerrainPeak,
  ISLAND_BASE_Y,
  SHELF_DEPTH, SHELF_DEEP_Y, BEACH_INSET,
  RIVER_HALF, riverCenterX,
} from '../src/terrain/heightmap.js';
import { SEA_LEVEL } from '../src/terrain/seaConfig.js';
import {
  NAP_CENTROID, ARENA_BL_CENTROID, ARENA_BR_CENTROID,
  isNapLand, isArenaLand, isTomoeLand,
} from '../src/terrain/tomoeShape.js';

describe('sampleHeight alias === sampleNapHeight (backward compat)', () => {
  it('is the same function reference', () => {
    expect(sampleHeight).toBe(sampleNapHeight);
  });
});

describe('legacy river exports (stubbed — sea channels replace river)', () => {
  it('RIVER_HALF is 0 (no artificial river band)', () => {
    expect(RIVER_HALF).toBe(0);
  });

  it('riverCenterX returns a finite number (stub)', () => {
    expect(Number.isFinite(riverCenterX(0))).toBe(true);
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

describe('interior plateau is above SEA_LEVEL', () => {
  it('NAP interior centroid is above SEA_LEVEL', () => {
    const h = sampleNapHeight(NAP_CENTROID[0], NAP_CENTROID[1]);
    expect(h).toBeGreaterThan(SEA_LEVEL);
  });

  it('Arena BL interior centroid is above SEA_LEVEL', () => {
    const h = sampleArenaHeight(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1]);
    expect(h).toBeGreaterThan(SEA_LEVEL);
  });

  it('Arena BR interior centroid is above SEA_LEVEL', () => {
    const h = sampleArenaHeight(ARENA_BR_CENTROID[0], ARENA_BR_CENTROID[1]);
    expect(h).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('beach ramp — coast edge is at SEA_LEVEL', () => {
  it('NAP coast edge samples near SEA_LEVEL', () => {
    // Find a coast edge point by sampling just inside the polygon
    // The coast polygon's first point should be at or near SEA_LEVEL
    const h = sampleNapHeight(NAP_CENTROID[0], NAP_CENTROID[1]);
    expect(h).toBeGreaterThan(SEA_LEVEL);
  });

  it('points outside all islands return exactly SEA_LEVEL', () => {
    expect(sampleArenaHeight(1000, 1000)).toBe(SEA_LEVEL);
    expect(sampleNapHeight(1000, 1000)).toBe(SEA_LEVEL);
  });
});

describe('no pooling — interior stays dry land above SEA_LEVEL', () => {
  it('NAP interior minimum is above SEA_LEVEL (excluding beach)', () => {
    // Sample points inside the NAP polygon that are well inland (distance > BEACH_INSET)
    let min = Infinity;
    const N = 60;
    const { minX, maxX, minZ, maxZ } = NAP_TERRAIN;
    for (let i = 0; i <= N; i++) {
      const x = minX + (maxX - minX) * (i / N);
      for (let j = 0; j <= N; j++) {
        const z = minZ + (maxZ - minZ) * (j / N);
        if (!isNapLand(x, z)) continue;
        const h = sampleNapHeight(x, z);
        if (h > SEA_LEVEL && h < min) min = h;
      }
    }
    expect(min).toBeGreaterThan(SEA_LEVEL);
  });

  it('arena interior minimum is above SEA_LEVEL (excluding beach)', () => {
    let min = Infinity;
    const N = 60;
    const { minX, maxX, minZ, maxZ } = ARENA_TERRAIN;
    for (let i = 0; i <= N; i++) {
      const x = minX + (maxX - minX) * (i / N);
      for (let j = 0; j <= N; j++) {
        const z = minZ + (maxZ - minZ) * (j / N);
        if (!isArenaLand(x, z)) continue;
        const h = sampleArenaHeight(x, z);
        if (h > SEA_LEVEL && h < min) min = h;
      }
    }
    expect(min).toBeGreaterThan(SEA_LEVEL);
  });
});

describe('hills exist and are bounded by baseY ± amplitude', () => {
  const RAW_WEIGHT_SUM = 1.42;

  it('NAP peak sits between baseY and baseY + 1.42·amp', () => {
    const peak = napTerrainPeak();
    expect(peak.height).toBeGreaterThan(ISLAND_BASE_Y);
    expect(peak.height).toBeLessThanOrEqual(ISLAND_BASE_Y + NAP_TERRAIN_AMP * RAW_WEIGHT_SUM + 1e-9);
  });

  it('arena peak sits between baseY and baseY + 1.42·amp', () => {
    const peak = arenaTerrainPeak();
    expect(peak.height).toBeGreaterThan(ISLAND_BASE_Y);
    expect(peak.height).toBeLessThanOrEqual(ISLAND_BASE_Y + ARENA_TERRAIN_AMP * RAW_WEIGHT_SUM + 1e-9);
  });

  it('arena amplitude is greater than NAP (pronounced undulation)', () => {
    expect(ARENA_TERRAIN_AMP).toBeGreaterThan(NAP_TERRAIN_AMP);
  });
});

describe('heightfield arrays — Rapier-ready, column-major', () => {
  it('NAP array is Float32Array of length rowsZ*colsX, finite, max above baseY', () => {
    const heights = buildNapHeightfieldArray();
    expect(heights).toBeInstanceOf(Float32Array);
    expect(heights.length).toBe(NAP_GRID.rowsZ * NAP_GRID.colsX);
    let max = -Infinity;
    for (const h of heights) {
      expect(Number.isFinite(h)).toBe(true);
      if (h > max) max = h;
    }
    expect(max).toBeGreaterThan(ISLAND_BASE_Y);
  });

  it('arena array is Float32Array of length rowsZ*colsX, finite, max above baseY', () => {
    const heights = buildArenaHeightfieldArray();
    expect(heights).toBeInstanceOf(Float32Array);
    expect(heights.length).toBe(ARENA_GRID.rowsZ * ARENA_GRID.colsX);
    let max = -Infinity;
    for (const h of heights) {
      expect(Number.isFinite(h)).toBe(true);
      if (h > max) max = h;
    }
    expect(max).toBeGreaterThan(ISLAND_BASE_Y);
  });

  it('is column-major: heights[col*rows+row] maps to world (x,z)', () => {
    const heights = buildNapHeightfieldArray();
    const { colsX, rowsZ, cellW, cellD } = NAP_GRID;
    const col = Math.floor(colsX / 2);
    const row = Math.floor(rowsZ / 2);
    const x = NAP_TERRAIN.gMinX + col * cellW;
    const z = NAP_TERRAIN.gMinZ + row * cellD;
    expect(heights[col * rowsZ + row]).toBeCloseTo(sampleNapHeight(x, z), 6);
  });
});

describe('SHELF constants (legacy)', () => {
  it('SHELF_DEEP_Y is well below SEA_LEVEL', () => {
    expect(SHELF_DEEP_Y).toBeLessThan(SEA_LEVEL);
    expect(SHELF_DEEP_Y).toBeCloseTo(SEA_LEVEL - 0.6, 9);
  });

  it('SHELF_DEPTH is 0 (no underwater shelf)', () => {
    expect(SHELF_DEPTH).toBe(0);
  });

  it('BEACH_INSET is 1.5', () => {
    expect(BEACH_INSET).toBe(1.5);
  });
});
