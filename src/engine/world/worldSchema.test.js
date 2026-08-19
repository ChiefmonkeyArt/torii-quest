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
    // objects is reserved verbatim (Phase 1 validates contents)
    expect(r.world.objects).toEqual([{ reserved: true }]);
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
