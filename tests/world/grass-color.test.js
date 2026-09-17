// tests/world/grass-color.test.js — locks the grass-colour single source of truth
// (world-as-data, P2). The blade palette was hardcoded in the GLSL vertex shader,
// so a swapped-in world always showed the traveller's own node green. It now lives
// in engine/world/grassColor.js, is serialized into the manifest + validated, and
// is fed to the shader as uniforms.
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_GRASS_COLOR,
  normalizeGrassColor,
  resolveGrassColor,
} from '../../src/engine/world/grassColor.js';
import { validateWorld } from '../../src/engine/world/worldSchema.js';
import { serializeArenaWorld } from '../../src/engine/world/arenaSerialize.js';

describe('grassColor — palette source of truth', () => {
  it('ships the exact pre-extraction GLSL defaults (byte-stable colours)', () => {
    expect(DEFAULT_GRASS_COLOR.napBase).toEqual([0.27, 0.60, 0.15]);
    expect(DEFAULT_GRASS_COLOR.napTip).toEqual([0.18, 0.43, 0.12]);
    expect(DEFAULT_GRASS_COLOR.arenaBase).toEqual([0.45, 0.20, 0.65]);
    expect(DEFAULT_GRASS_COLOR.arenaTip).toEqual([0.95, 0.55, 0.15]);
  });

  it('normalizes a full valid palette unchanged', () => {
    const c = { napBase: [1, 0, 0], napTip: [0, 1, 0], arenaBase: [0, 0, 1], arenaTip: [1, 1, 0] };
    expect(normalizeGrassColor(c)).toEqual(c);
  });

  it('fills missing keys from the default (idempotent partial override)', () => {
    const c = normalizeGrassColor({ napBase: [1, 0, 0] });
    expect(c.napBase).toEqual([1, 0, 0]);
    expect(c.napTip).toEqual(DEFAULT_GRASS_COLOR.napTip);
    expect(c.arenaBase).toEqual(DEFAULT_GRASS_COLOR.arenaBase);
    expect(c.arenaTip).toEqual(DEFAULT_GRASS_COLOR.arenaTip);
  });

  it('fails closed on malformed input (bad length, out-of-range, non-array)', () => {
    expect(normalizeGrassColor(null)).toBeNull();
    expect(normalizeGrassColor('green')).toBeNull();
    expect(normalizeGrassColor({ napBase: [0.5, 0.5] })).toBeNull();       // length 2
    expect(normalizeGrassColor({ napBase: [1.2, 0, 0] })).toBeNull();     // >1
    expect(normalizeGrassColor({ napBase: [-0.1, 0, 0] })).toBeNull();    // <0
    expect(normalizeGrassColor({ napBase: [NaN, 0, 0] })).toBeNull();     // non-finite
    expect(normalizeGrassColor({ napBase: '111' })).toBeNull();           // string
  });

  it('resolveGrassColor always returns a valid palette (default on garbage)', () => {
    expect(resolveGrassColor(null)).toEqual(DEFAULT_GRASS_COLOR);
    expect(resolveGrassColor({ napBase: [1, 0, 0] }).napBase).toEqual([1, 0, 0]);
  });
});

describe('worldSchema — grassColor validation', () => {
  it('keeps a valid grassColor on a foliage world', () => {
    const v = validateWorld({
      version: 1, id: 'x', name: 'X', foliage: true,
      grassColor: { napBase: [1, 0, 0], napTip: [0, 1, 0], arenaBase: [0, 0, 1], arenaTip: [1, 1, 0] },
    });
    expect(v.ok).toBe(true);
    expect(v.world.foliage).toBe(true);
    expect(v.world.grassColor.napBase).toEqual([1, 0, 0]);
  });

  it('drops a malformed grassColor (fails closed, world still validates, no grassColor)', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', foliage: true, grassColor: { napBase: [9, 9, 9] } });
    expect(v.ok).toBe(true);
    expect(v.world.foliage).toBe(true);
    expect(v.world.grassColor).toBeUndefined();
  });

  it('omits grassColor entirely when foliage is absent', () => {
    const v = validateWorld({ version: 1, id: 'x', name: 'X', grassColor: DEFAULT_GRASS_COLOR });
    expect(v.ok).toBe(true);
    expect(v.world.grassColor).toBeUndefined();
  });
});

describe('serializeArenaWorld — grass colour serialization', () => {
  const legacyArena = {
    name: 'A', spawns: { player: { x: 0, y: 0, z: 0 } },
    foliage: { enabled: true, bladeCount: 75000 },
  };
  const zones = [{ name: 'arena', rows: 2, cols: 2, scale: [40, 1, 40], heights: [1, 1, 1, 1] }];

  it('pins the shipped default palette into the manifest when foliage has no override', () => {
    const r = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    expect(r.ok).toBe(true);
    const world = JSON.parse(r.manifestJson);
    expect(world.grassColor).toEqual(DEFAULT_GRASS_COLOR);
  });

  it('serializes a legacy foliage.grassColor override verbatim', () => {
    const over = { napBase: [1, 0, 0], napTip: [0, 1, 0], arenaBase: [0, 0, 1], arenaTip: [1, 1, 0] };
    const r = serializeArenaWorld({
      worldId: 'arena', zones,
      legacy: { ...legacyArena, foliage: { enabled: true, bladeCount: 75000, grassColor: over } },
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.manifestJson).grassColor).toEqual(over);
  });

  it('falls back to the default when a foliage.grassColor override is malformed', () => {
    const r = serializeArenaWorld({
      worldId: 'arena', zones,
      legacy: { ...legacyArena, foliage: { enabled: true, grassColor: { napBase: [9, 9, 9] } } },
    });
    expect(r.ok).toBe(true);
    expect(JSON.parse(r.manifestJson).grassColor).toEqual(DEFAULT_GRASS_COLOR);
  });
});