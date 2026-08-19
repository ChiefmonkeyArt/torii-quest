// tests/chiefmonkey-template-world.test.js — validate the REAL chiefmonkey-template
// world.json manifest (Phase 0k.5 step B). The template now declares a `terrain`
// field (arena heightfield baked to terrain.json); this test guards that the
// shipped manifest passes validateWorld + the terrain field is well-formed, so a
// bad edit to world.json is caught before deploy (the data-driven path would
// otherwise fall back to legacy buildArena at runtime).
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { validateWorld } from '../src/engine/world/worldSchema.js';

const WORLD_PATH = new URL('../worlds/chiefmonkey-template/world.json', import.meta.url);
const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));

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

  it('ships terrain.json alongside world.json', async () => {
    const { statSync } = await import('node:fs');
    const terrainPath = new URL('../worlds/chiefmonkey-template/terrain.json', import.meta.url);
    const stat = statSync(terrainPath);
    expect(stat.size).toBeGreaterThan(100000); // the baked heightfield (~300 KB)
  });
});
