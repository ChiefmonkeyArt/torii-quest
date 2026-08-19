// src/engine/world/worldSchema.test.js — locks the Phase 0 world manifest
// schema gate (validateWorld). Pure vitest: valid manifest passes; missing
// version fails; bad types fail; unknown fields ignored; never throws on
// garbage. No three/DOM — importable in the node env.
import { describe, it, expect } from 'vitest';
import { validateWorld } from './worldSchema.js';

describe('validateWorld — valid manifest', () => {
  it('passes a complete, well-formed manifest and normalises it', () => {
    const r = validateWorld({
      version: 1,
      id: 'gateway-blank',
      name: 'Torii Gateway — Blank',
      sky: { type: 'space', color: '#05050f', stars: true },
      platform: { type: 'cloud', size: 40, color: '#c4b5fd' },
      gateway: { position: [0, 0, -8], target: [0, 0, 0], relays: [] },
      spawn: { position: [0, 0, 0], yaw: 0 },
      lights: [
        { kind: 'ambient', color: '#3b3b5c', intensity: 0.6 },
        { kind: 'directional', color: '#ffffff', intensity: 0.9, position: [8, 12, 6] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.world.version).toBe(1);
    expect(r.world.id).toBe('gateway-blank');
    expect(r.world.name).toBe('Torii Gateway — Blank');
    expect(r.world.legacy).toBe(false);
    expect(r.world.sky).toEqual({ type: 'space', color: '#05050f', stars: true });
    expect(r.world.platform).toEqual({ type: 'cloud', size: 40, color: '#c4b5fd' });
    expect(r.world.gateway.position).toEqual([0, 0, -8]);
    expect(r.world.spawn.position).toEqual([0, 0, 0]);
    expect(r.world.lights).toHaveLength(2);
    expect(r.world.lights[0].kind).toBe('ambient');
  });

  it('passes a minimal manifest with only the required fields', () => {
    const r = validateWorld({ version: 1, id: 'minimal', name: 'Minimal' });
    expect(r.ok).toBe(true);
    expect(r.world.id).toBe('minimal');
    expect(r.world.legacy).toBe(false);
    expect(r.world.sky).toBeUndefined();
  });

  it('coerces numeric-string vec3 and numeric-string numbers', () => {
    const r = validateWorld({
      version: 1, id: 'coerce', name: 'Coerce',
      gateway: { position: ['1', '2', '3'] },
      platform: { size: '40' },
      spawn: { yaw: '1.5' },
    });
    expect(r.ok).toBe(true);
    expect(r.world.gateway.position).toEqual([1, 2, 3]);
    expect(r.world.platform.size).toBe(40);
    expect(r.world.spawn.yaw).toBe(1.5);
  });

  it('drops optional fields with bad shapes instead of failing', () => {
    const r = validateWorld({
      version: 1, id: 'drop', name: 'Drop',
      sky: { type: 'space', color: '#fff', stars: 'not-a-bool' }, // stars dropped
      platform: { size: -5 }, // negative size dropped
      gateway: { position: [1, 2] }, // wrong-length vec dropped
      lights: [{ kind: 'ambient' }, { kind: 'unknown-kind' }, 'not-an-object'],
    });
    expect(r.ok).toBe(true);
    expect(r.world.sky).toEqual({ type: 'space', color: '#fff' });
    expect(r.world.platform).toBeUndefined();
    expect(r.world.gateway).toBeUndefined();
    expect(r.world.lights).toEqual([{ kind: 'ambient' }]);
  });
});

describe('validateWorld — missing version', () => {
  it('fails when version is missing', () => {
    const r = validateWorld({ id: 'x', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.world).toBeNull();
    expect(r.errors.some((e) => e.includes('version'))).toBe(true);
  });

  it('fails when version is the wrong integer', () => {
    const r = validateWorld({ version: 2, id: 'x', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('version must be 1'))).toBe(true);
  });

  it('fails when version is a non-integer number', () => {
    const r = validateWorld({ version: 1.5, id: 'x', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('version must be an integer'))).toBe(true);
  });
});

describe('validateWorld — bad types fail', () => {
  it('fails when id is missing', () => {
    const r = validateWorld({ version: 1, name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('id'))).toBe(true);
  });

  it('fails when id is not a slug (uppercase / spaces)', () => {
    const r = validateWorld({ version: 1, id: 'Bad Slug', name: 'X' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('id must be a slug'))).toBe(true);
  });

  it('fails when name is missing/blank', () => {
    const r = validateWorld({ version: 1, id: 'x', name: '   ' });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('fails when the top-level value is not an object', () => {
    expect(validateWorld(null).ok).toBe(false);
    expect(validateWorld(undefined).ok).toBe(false);
    expect(validateWorld('string').ok).toBe(false);
    expect(validateWorld(42).ok).toBe(false);
    expect(validateWorld([1, 2, 3]).ok).toBe(false);
  });
});

describe('validateWorld — unknown fields ignored', () => {
  it('ignores unknown top-level and nested fields', () => {
    const r = validateWorld({
      version: 1, id: 'x', name: 'X',
      unknownTop: 'ignored',
      sky: { type: 'space', unknownNested: 'ignored' },
      objects: [{ reserved: true }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.unknownTop).toBeUndefined();
    expect(r.world.sky.unknownNested).toBeUndefined();
    // objects: { reserved: true } has no type/position → dropped (Phase 0e now
    // validates entries). An empty surviving array is omitted (like lights).
    expect(r.world.objects).toBeUndefined();
    // The invalid entry records an error but doesn't fail the whole world.
    expect(r.errors.some((e) => e.includes('objects[0]'))).toBe(true);
  });
});

describe('validateWorld — never throws on garbage', () => {
  it('does not throw on deeply malformed input', () => {
    expect(() => validateWorld({ version: 'oops', id: 123, name: null })).not.toThrow();
    expect(() => validateWorld({ sky: 'nope', lights: 'nope' })).not.toThrow();
    expect(() => validateWorld({ gateway: { position: 'nope' } })).not.toThrow();
    const r = validateWorld({ version: 'oops', id: 123, name: null });
    expect(r.ok).toBe(false);
    expect(r.world).toBeNull();
  });
});

// ── Phase 0e: objects validation + _safeModelPath ─────────────────────────────
import { _safeModelPath } from './worldSchema.js';

describe('validateWorld — objects validation (Phase 0e)', () => {
  const baseWorld = { version: 1, id: 'obj-test', name: 'Obj Test' };

  it('validates a valid gltf object with model + position', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'gltf', model: 'gate.glb', position: [1, 2, 3] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toHaveLength(1);
    expect(r.world.objects[0]).toEqual({ type: 'gltf', model: 'gate.glb', position: [1, 2, 3] });
  });

  it('validates a torii-gate object (no model required)', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'torii-gate', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects[0].type).toBe('torii-gate');
    expect(r.world.objects[0].model).toBeUndefined();
  });

  it('validates primitive objects (box/cylinder/plane)', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [
        { type: 'box', position: [0, 0, 0], scale: 2, color: '#ff0000' },
        { type: 'cylinder', position: [1, 0, 1], rotation: [0, 1.5, 0] },
        { type: 'plane', position: [0, 0, 0], scale: [2, 1, 2] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toHaveLength(3);
    expect(r.world.objects[0]).toEqual({ type: 'box', position: [0, 0, 0], scale: 2, color: '#ff0000' });
    expect(r.world.objects[1].rotation).toEqual([0, 1.5, 0]);
    expect(r.world.objects[2].scale).toEqual([2, 1, 2]);
  });

  it('fails on an unknown object type', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'sphere', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true); // per-item drop, world still ok
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('type must be one of'))).toBe(true);
  });

  it('drops an object with missing position', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'box' }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('position'))).toBe(true);
  });

  it('drops a gltf object with an unsafe model path (.. segment)', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'gltf', model: '../escape.glb', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('safe model path'))).toBe(true);
  });

  it('drops a gltf object with a protocol model path (://)', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'gltf', model: 'https://evil.com/gate.glb', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('safe model path'))).toBe(true);
  });

  it('drops a gltf object with a leading-slash model path', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'gltf', model: '/gate.glb', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('safe model path'))).toBe(true);
  });

  it('drops a gltf object with a wrong extension', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'gltf', model: 'gate.png', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('safe model path'))).toBe(true);
  });

  it('drops a gltf object with a missing model', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'gltf', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('safe model path'))).toBe(true);
  });

  it('rejects a primitive that carries a model', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'box', model: 'gate.glb', position: [0, 0, 0] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toBeUndefined();
    expect(r.errors.some((e) => e.includes('must not carry a model'))).toBe(true);
  });

  it('hard-errors when objects exceeds the 64 cap', () => {
    const objs = Array.from({ length: 65 }, () => ({ type: 'box', position: [0, 0, 0] }));
    const r = validateWorld({ ...baseWorld, objects: objs });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('exceeds cap of 64'))).toBe(true);
    expect(r.world).toBeNull();
  });

  it('drops one bad object without killing valid ones (per-item drop)', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [
        { type: 'box', position: [0, 0, 0] },
        { type: 'sphere', position: [1, 0, 1] }, // bad type
        { type: 'cylinder', position: [2, 0, 2] },
      ],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toHaveLength(2);
    expect(r.world.objects[0].type).toBe('box');
    expect(r.world.objects[1].type).toBe('cylinder');
    expect(r.errors.some((e) => e.includes('objects[1]'))).toBe(true);
  });

  it('accepts exactly 64 objects (at the cap, not over)', () => {
    const objs = Array.from({ length: 64 }, () => ({ type: 'box', position: [0, 0, 0] }));
    const r = validateWorld({ ...baseWorld, objects: objs });
    expect(r.ok).toBe(true);
    expect(r.world.objects).toHaveLength(64);
  });

  it('coerces numeric-string positions in objects', () => {
    const r = validateWorld({
      ...baseWorld,
      objects: [{ type: 'box', position: ['1', '2', '3'] }],
    });
    expect(r.ok).toBe(true);
    expect(r.world.objects[0].position).toEqual([1, 2, 3]);
  });
});

describe('_safeModelPath (Phase 0e)', () => {
  it('accepts a clean relative .glb path', () => {
    expect(_safeModelPath('models/gate.glb')).toBe('models/gate.glb');
  });

  it('accepts a clean relative .gltf path', () => {
    expect(_safeModelPath('scene.gltf')).toBe('scene.gltf');
  });

  it('rejects a non-string', () => {
    expect(_safeModelPath(null)).toBeNull();
    expect(_safeModelPath(42)).toBeNull();
    expect(_safeModelPath(undefined)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(_safeModelPath('')).toBeNull();
    expect(_safeModelPath('   ')).toBeNull();
  });

  it('rejects a path over 128 chars', () => {
    const long = 'a'.repeat(125) + '.glb'; // 129 chars — over the cap
    expect(long.length).toBe(129);
    expect(_safeModelPath(long)).toBeNull();
  });

  it('rejects a leading slash', () => {
    expect(_safeModelPath('/gate.glb')).toBeNull();
  });

  it('rejects a protocol', () => {
    expect(_safeModelPath('https://evil.com/gate.glb')).toBeNull();
    expect(_safeModelPath('file://gate.glb')).toBeNull();
  });

  it('rejects a .. segment', () => {
    expect(_safeModelPath('../gate.glb')).toBeNull();
    expect(_safeModelPath('models/../gate.glb')).toBeNull();
    expect(_safeModelPath('a/b/../../c.glb')).toBeNull();
  });

  it('rejects a wrong extension', () => {
    expect(_safeModelPath('gate.png')).toBeNull();
    expect(_safeModelPath('gate')).toBeNull();
    expect(_safeModelPath('gate.txt')).toBeNull();
  });
});
