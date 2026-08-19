// tests/chiefmonkey-template-world.test.js — validate the REAL chiefmonkey-template
// world.json manifest (Phase 0k.5 step B). The template now declares a `terrain`
// field (arena heightfield baked to terrain.json); this test guards that the
// shipped manifest passes validateWorld + the terrain field is well-formed, so a
// bad edit to world.json is caught before deploy (the data-driven path would
// otherwise fall back to legacy buildArena at runtime).
import { readFileSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { loadWorldTerrainData } from '../src/engine/world/worldTerrain.js';
import { makeTerrainLoader } from '../src/engine/world/worldTerrainLoader.js';
import {
  sampleArenaHeight,
  ARENA_GRID,
  ARENA_TERRAIN,
} from '../src/terrain/heightmap.js';

const WORLD_PATH = new URL('../worlds/chiefmonkey-template/world.json', import.meta.url);
const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));

// A file-backed fetch for the terrain loader: reads the real terrain.json from
// disk + parses it (no network). Mirrors how makeTerrainLoader fetches a .json
// source in the browser, so this exercises the real round-trip (bake → JSON →
// loadWorldTerrainData → Float32Array) end-to-end.
const TERRAIN_JSON_PATH = new URL('../worlds/chiefmonkey-template/terrain.json', import.meta.url);
const fileFetch = (url) => {
  const text = readFileSync(TERRAIN_JSON_PATH, 'utf8');
  return Promise.resolve({ ok: true, status: 200, json: () => JSON.parse(text) });
};

describe('chiefmonkey-template world.json (real manifest)', () => {
  it('passes validateWorld', () => {
    const result = validateWorld(world);
    expect(result.ok).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('declares a terrain field pointing at terrain.json', () => {
    expect(world.terrain).toBeTruthy();
    expect(world.terrain.source).toBe('./terrain.json');
  });

  it('terrain grid matches the baked heightfield (rows=240, cols=228)', () => {
    expect(world.terrain.rows).toBe(240);
    expect(world.terrain.cols).toBe(228);
  });

  it('terrain scale is the arena footprint (total extents, Y=1)', () => {
    expect(world.terrain.scale[1]).toBe(1);
    expect(world.terrain.scale[0]).toBeGreaterThan(70);
    expect(world.terrain.scale[2]).toBeGreaterThan(74);
  });

  it('terrain offset is the arena centre translation', () => {
    expect(world.terrain.offset[1]).toBe(0);
    expect(Math.abs(world.terrain.offset[0])).toBeLessThan(3);
    expect(Math.abs(world.terrain.offset[2])).toBeLessThan(1);
  });

  it('ships terrain.json alongside world.json', () => {
    const stat = statSync(TERRAIN_JSON_PATH);
    expect(stat.size).toBeGreaterThan(100000); // the baked heightfield (~300 KB)
  });

  it('terrain.json round-trips through the loader to a Float32Array of rows*cols', async () => {
    const loadTerrainSource = makeTerrainLoader({
      worldId: 'chiefmonkey-template',
      fetchImpl: fileFetch,
      importModule: () => { throw new Error('not a .js source'); },
      resolveUrl: (source) => source,
    });
    const result = await loadWorldTerrainData(world.terrain, { loadTerrainSource });
    expect(result.ok).toBe(true);
    expect(result.data.heights).toBeInstanceOf(Float32Array);
    expect(result.data.heights.length).toBe(world.terrain.rows * world.terrain.cols);
  });

  it('loaded terrain heights match sampleArenaHeight at sampled grid points', async () => {
    const loadTerrainSource = makeTerrainLoader({
      worldId: 'chiefmonkey-template',
      fetchImpl: fileFetch,
      importModule: () => { throw new Error('not a .js source'); },
      resolveUrl: (source) => source,
    });
    const { data: td } = await loadWorldTerrainData(world.terrain, { loadTerrainSource });
    const heights = td.heights;
    const { colsX, rowsZ } = ARENA_GRID;
    const { gWidth, gDepth, gCenterX, gCenterZ } = ARENA_TERRAIN;
    const gMinX = gCenterX - gWidth / 2;
    const gMinZ = gCenterZ - gDepth / 2;
    const cellW = gWidth / (colsX - 1);
    const cellD = gDepth / (rowsZ - 1);
    // Sample a handful of grid points across the arena; the baked heights are
    // rounded to 0.1mm so allow a 1mm tolerance vs the full-precision sample.
    for (const [col, row] of [[0, 0], [colsX - 1, rowsZ - 1], [100, 120], [50, 200]]) {
      const x = gMinX + col * cellW;
      const z = gMinZ + row * cellD;
      const loaded = heights[col * rowsZ + row];
      const sampled = sampleArenaHeight(x, z);
      expect(Math.abs(loaded - sampled)).toBeLessThan(0.001);
    }
  });
});
