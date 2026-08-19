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
  ISLAND_BASE_Y,
} from '../src/terrain/heightmap.js';
import { CRATES } from '../src/config.js';
import { isArenaPlayArea } from '../src/terrain/tomoeShape.js';
import {
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK,
  BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH, BRIDGE2_THICK,
  BRIDGE_YAW, WALL_H,
} from '../src/config.js';

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

// Phase 0k.2 — static crates baked into the manifest. Each crate rests ON the
// terrain: center Y = fullH/2 + sampleArenaHeight(cx, cz), matching arena.js:144
// + physics.js:152. Crates outside the play zone (isArenaPlayArea) are skipped.
describe('chiefmonkey-template baked crates (0k.2)', () => {
  // Filter crates by XZ (not just type:box+collider) so bridge decks (also boxes
  // with colliders) aren't counted as crates.
  const expected = CRATES.filter(([cx, cz]) => isArenaPlayArea(cx, cz));
  const crateXZ = new Set(expected.map(([cx, cz]) => `${cx},${cz}`));
  const crates = world.objects.filter(
    (o) => o.type === 'box' && o.collider && crateXZ.has(`${o.position[0]},${o.position[2]}`),
  );

  it('bakes exactly the in-zone crates (one box object each)', () => {
    expect(crates.length).toBe(expected.length);
  });

  it('each crate Y = fullH/2 + sampleArenaHeight(cx, cz) (rides the hills)', () => {
    for (const [cx, cz, hw, hd, ch] of expected) {
      const crate = crates.find(
        (o) => o.position[0] === cx && o.position[2] === cz,
      );
      expect(crate).toBeTruthy();
      const expectedY = ch / 2 + sampleArenaHeight(cx, cz);
      expect(Math.abs(crate.position[1] - expectedY)).toBeLessThan(0.001);
    }
  });

  it('each crate has a box collider matching its footprint + height', () => {
    for (const [cx, cz, hw, hd, ch] of expected) {
      const crate = crates.find(
        (o) => o.position[0] === cx && o.position[2] === cz,
      );
      expect(crate.collider.shape).toBe('box');
      expect(crate.collider.size).toEqual([hw * 2, ch, hd * 2]);
      expect(crate.scale).toEqual([hw * 2, ch, hd * 2]);
    }
  });
});

// Phase 0k.1 — sea-channel bridges baked into the manifest. 2 box decks
// (walkable colliders, top at BRIDGE_DECK_Y) + 4 side rails (visual-only).
// Mirrors bridge.js + physics.js:182-190. RAIL_H/RAIL_T mirror bridge.js.
describe('chiefmonkey-template baked bridges (0k.1)', () => {
  const RAIL_H = 0.5;
  const RAIL_T = 0.12;
  const r4 = (n) => Math.round(n * 10000) / 10000;
  const rotXZ = (x, z, yaw) => {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    return [x * c - z * s, x * s + z * c];
  };
  const boxes = world.objects.filter((o) => o.type === 'box');

  const specs = [
    { name: 'bridge 1', x: BRIDGE_X, z: BRIDGE_Z, len: BRIDGE_LEN, width: BRIDGE_WIDTH, thick: BRIDGE_THICK, yaw: BRIDGE_YAW },
    { name: 'bridge 2', x: BRIDGE2_X, z: BRIDGE2_Z, len: BRIDGE2_LEN, width: BRIDGE2_WIDTH, thick: BRIDGE2_THICK, yaw: 0 },
  ];

  it('bakes 2 decks + 4 rails (6 bridge boxes total)', () => {
    const decks = boxes.filter((o) => o.collider);
    const rails = boxes.filter((o) => !o.collider);
    // 9 crate decks (with colliders) + 2 bridge decks = 11 colliders; 4 rails.
    expect(decks.filter((o) => o.scale[1] === specs[0].thick || o.scale[1] === specs[1].thick).length).toBeGreaterThanOrEqual(2);
    expect(rails.filter((o) => o.scale[1] === RAIL_H).length).toBe(4);
  });

  for (const spec of specs) {
    it(`${spec.name} deck matches legacy constants + has a walkable collider`, () => {
      const deck = boxes.find(
        (o) => o.collider && o.scale[0] === spec.len && o.scale[2] === spec.width &&
          o.position[0] === r4(spec.x) && o.position[2] === r4(spec.z),
      );
      expect(deck).toBeTruthy();
      expect(deck.position[1]).toBeCloseTo(BRIDGE_DECK_Y - spec.thick / 2, 3);
      expect(deck.scale).toEqual([spec.len, spec.thick, spec.width]);
      expect(deck.rotation).toEqual([0, spec.yaw, 0]);
      expect(deck.collider).toEqual({ shape: 'box', size: [spec.len, spec.thick, spec.width] });
    });

    it(`${spec.name} rails are visual-only + ride the deck edges`, () => {
      const railOff = spec.width / 2 - RAIL_T / 2;
      for (const side of [-1, 1]) {
        const [dx, dz] = rotXZ(0, side * railOff, spec.yaw);
        const rail = boxes.find(
          (o) => !o.collider && o.scale[1] === RAIL_H &&
            o.position[0] === r4(spec.x + dx) && o.position[2] === r4(spec.z + dz),
        );
        expect(rail).toBeTruthy();
        expect(rail.scale).toEqual([spec.len, RAIL_H, RAIL_T]);
        expect(rail.rotation).toEqual([0, spec.yaw, 0]);
        expect(rail.collider).toBeUndefined();
      }
    });
  }
});

// Phase 0k.3 — torii entrance gate + 2 collision-only pillar colliders. The
// torii-gate object loads torii-gate.glb at the legacy GLB placement; the 2
// pillars (OBSTACLES) are visible:false box objects (collision-only) at the
// un-rotated legacy positions. Mirrors arena.js:160-210 + physics.js OBSTACLES.
describe('chiefmonkey-template torii gate + pillars (0k.3)', () => {
  const GATE_H = WALL_H * 1.3; // 3.38
  const r4 = (n) => Math.round(n * 10000) / 10000;

  it('has exactly one torii-gate at the legacy GLB placement', () => {
    const gates = world.objects.filter((o) => o.type === 'torii-gate');
    expect(gates.length).toBe(1);
    const g = gates[0];
    expect(g.position[0]).toBeCloseTo(BRIDGE_X - 0.2, 3); // legacy GLB x
    expect(g.position[1]).toBeCloseTo(BRIDGE_DECK_Y, 3);
    expect(g.position[2]).toBeCloseTo(BRIDGE_Z, 3);
    expect(g.rotation).toEqual([0, BRIDGE_YAW, 0]);
    expect(g.scale).toBeCloseTo(GATE_H, 3);
  });

  it('has exactly 2 collision-only pillars at the legacy obstacle positions', () => {
    const pillars = world.objects.filter((o) => o.visible === false);
    expect(pillars.length).toBe(2);
    const pillarXZ = new Set(pillars.map((p) => `${p.position[0]},${p.position[2]}`));
    expect(pillarXZ.has(`${r4(BRIDGE_X)},${r4(BRIDGE_Z - 3)}`)).toBe(true);
    expect(pillarXZ.has(`${r4(BRIDGE_X)},${r4(BRIDGE_Z + 3)}`)).toBe(true);
  });

  it('each pillar has a matching box collider + legacy centre Y', () => {
    const pillars = world.objects.filter((o) => o.visible === false);
    for (const p of pillars) {
      expect(p.collider).toEqual({ shape: 'box', size: [0.8, GATE_H, 0.8] });
      expect(p.position[1]).toBeCloseTo(ISLAND_BASE_Y + GATE_H / 2, 3);
      expect(p.rotation).toEqual([0, 0, 0]); // un-rotated (legacy quirk)
    }
  });
});
