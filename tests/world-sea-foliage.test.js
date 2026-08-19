// tests/world-sea-foliage.test.js — locks the Phase 0k.8 sea + foliage flags.
// The legacy arena builds the ocean (buildArena → buildSeaMesh) + grass
// (arenaRuntime boot → buildFoliage) unconditionally; the data-driven world
// builds them only when world.sea / world.foliage are set. arenaRuntime wires
// buildSeaMesh into the world-mode branch + buildFoliage into the minimal boot.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { validateWorld } from '../src/engine/world/worldSchema.js';
import { buildSeaMesh } from '../src/terrain/sea.js';

const WORLD_PATH = new URL('../worlds/chiefmonkey-template/world.json', import.meta.url);
const world = JSON.parse(readFileSync(WORLD_PATH, 'utf8'));

describe('worldSchema — sea + foliage flags', () => {
  it('preserves sea === true + foliage === true', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', sea: true, foliage: true });
    expect(v.ok).toBe(true);
    expect(v.world.sea).toBe(true);
    expect(v.world.foliage).toBe(true);
  });

  it('omits sea/foliage when not strictly true (false / string / undefined)', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', sea: false, foliage: 'yes', sea2: 1 });
    expect(v.ok).toBe(true);
    expect(v.world.sea).toBeUndefined();
    expect(v.world.foliage).toBeUndefined();
  });
});

describe('buildSeaMesh (node-safe)', () => {
  it('adds a sea mesh to the scene', () => {
    const scene = new THREE.Scene();
    buildSeaMesh(scene);
    const sea = scene.children.find((c) => c.isMesh);
    expect(sea).toBeTruthy();
    expect(sea.geometry).toBeTruthy();
    expect(sea.material).toBeTruthy();
  });
});

describe('chiefmonkey-template ships the sea + foliage flags', () => {
  it('declares sea: true + foliage: true', () => {
    expect(world.sea).toBe(true);
    expect(world.foliage).toBe(true);
    const v = validateWorld(world);
    expect(v.ok).toBe(true);
    expect(v.world.sea).toBe(true);
    expect(v.world.foliage).toBe(true);
  });
});
