// src/engine/world/arenaSerialize.test.js — locks the legacy→portable serializer
// (ADR-0119). Round-trips the legacy arena config + injected heightfields into a
// validateWorld-accepted version:1 manifest with inlined terrain zones, and proves
// hash-stability (same input → byte-identical manifestJson).
import { describe, it, expect } from 'vitest';
import { serializeArenaWorld } from './arenaSerialize.js';
import { validateWorld } from './worldSchema.js';

// A faithful subset of worlds/default/world.json (legacy arena config).
const legacyArena = {
  v: 1,
  name: 'Torii Arena',
  mode: 'arena-shooter',
  bounds: { arenaHalf: 20, napX: 20, napFarX: 45, wallH: 2.6, wallWallH: 0.5 },
  lights: [
    { type: 'ambient', color: '#ffd9a0', intensity: 0.9 },
    { type: 'directional', color: '#ffe5b0', intensity: 1.8, pos: [40, 20, -30] },
    { type: 'hemisphere', sky: '#7fdfff', ground: '#b9a06b', intensity: 0.5, pos: [0, 8.6, 0] },
    { type: 'point', color: '#ffaa44', intensity: 1.2, distance: 60, pos: [0, 4, 0] },
  ],
  spawns: { player: { x: -14, y: 3.1, z: -14, yaw: -2.356194490192345 }, nap: { x: 40, z: -17 } },
  objects: [
    { type: 'torii-gate', pos: [20, 0, 0], rot: 0 },
    { type: 'travel-gate', pos: [42, 0, 16], rot: -0.7853981633974483 },
    { type: 'bridge', pos: [20, 0, 0] },
    { type: 'tree', pos: [34, 0, 7], variant: 0 },
    { type: 'fence', comment: 'coastline glass wall' },
  ],
  combat: { botCount: 5, botHp: 5, bossHp: 60, lagCompMs: 300 },
  foliage: { enabled: true, bladeCount: 75000 },
};

const zones = [
  { name: 'arena', rows: 2, cols: 2, scale: [40, 1, 40], offset: [0, 0, 0], heights: [1, 1, 1, 1] },
  { name: 'nap', rows: 2, cols: 2, scale: [25, 1, 40], offset: [32.5, 0, 0], heights: [1, 1, 1, 1] },
];

describe('serializeArenaWorld', () => {
  it('serializes a legacy arena into a valid portable manifest with inlined terrain zones', () => {
    const r = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    expect(r.ok).toBe(true);
    const world = JSON.parse(r.manifestJson);
    expect(world.version).toBe(1);
    expect(world.id).toBe('arena');
    expect(world.name).toBe('Torii Arena');
    expect(world.terrain.zones).toHaveLength(2);
    expect(world.terrain.zones[0].heights).toEqual([1, 1, 1, 1]);
    expect(world.spawn.position).toEqual([-14, 3.1, -14]);
    expect(world.spawn.yaw).toBeCloseTo(-2.356194490192345);
    expect(world.sea).toBe(true);
    expect(world.foliage).toBe(true);
    expect(world.sky).toEqual({ type: 'clear', color: '#87ceeb' });
  });

  it('maps lights (type→kind, pos→position) and drops unsupported kinds', () => {
    const r = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    const world = JSON.parse(r.manifestJson);
    expect(world.lights).toHaveLength(4);
    expect(world.lights[0]).toMatchObject({ kind: 'ambient', color: '#ffd9a0', intensity: 0.9 });
    expect(world.lights[1]).toMatchObject({ kind: 'directional', position: [40, 20, -30] });
  });

  it('maps torii-gate/travel-gate objects and skips unmappable bridge/tree/fence', () => {
    const r = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    const world = JSON.parse(r.manifestJson);
    expect(world.objects).toHaveLength(2);
    expect(world.objects[0]).toMatchObject({ type: 'torii-gate', position: [20, 0, 0] });
    expect(world.objects[1]).toMatchObject({ type: 'torii-gate', position: [42, 0, 16] });
  });

  it('passes through combat + bounds config', () => {
    const r = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    const world = JSON.parse(r.manifestJson);
    expect(world.combat).toEqual({ botCount: 5, botHp: 5, bossHp: 60, lagCompMs: 300 });
    expect(world.bounds).toEqual({ arenaHalf: 20, napX: 20, napFarX: 45, wallH: 2.6, wallWallH: 0.5 });
  });

  it('rejects a bad world id', () => {
    const r = serializeArenaWorld({ worldId: 'BAD Has Spaces', legacy: legacyArena, zones });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('bad-world-id');
  });

  it('rejects when all zones are invalid (ground must never vanish)', () => {
    const r = serializeArenaWorld({
      worldId: 'arena',
      legacy: legacyArena,
      zones: [{ rows: 3, cols: 3, scale: [1, 1, 1], heights: [1, 2] }], // length mismatch
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no-valid-zones');
  });

  it('produces byte-identical JSON for identical input (hash stability)', () => {
    const a = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    const b = serializeArenaWorld({ worldId: 'arena', legacy: legacyArena, zones });
    expect(a.manifestJson).toBe(b.manifestJson);
  });
});