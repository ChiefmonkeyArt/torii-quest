// tests/world-schema-terrain.test.js — locks the Phase 0k.5 terrain heightfield
// field (the singular ground). Pure vitest: a well-formed terrain is normalised
// onto the world; a malformed terrain is silently omitted (the world still
// validates ok — a bad terrain never forces fallback:legacy on its own). Mirrors
// the permissive omit-on-bad style of sky/platform/gateway.
import { describe, it, expect } from 'vitest';
import { validateWorld, _safeDataSourcePath } from '../src/engine/world/worldSchema.js';

const BASE = { version: 1, id: 'arena', name: 'Arena' };

describe('validateWorld — terrain field (Phase 0k.5)', () => {
  it('keeps a complete, well-formed terrain', () => {
    const r = validateWorld({
      ...BASE,
      terrain: { source: './terrain.js', rows: 64, cols: 64, scale: [2, 0.5, 2] },
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.world.terrain).toEqual({
      source: './terrain.js',
      rows: 64,
      cols: 64,
      scale: [2, 0.5, 2],
    });
  });

  it('keeps optional offset + seaLevel when present', () => {
    const r = validateWorld({
      ...BASE,
      terrain: {
        source: './heights.json',
        rows: 32,
        cols: 48,
        scale: [1, 1, 1],
        offset: [10, -2, 0],
        seaLevel: 0.25,
      },
    });
    expect(r.ok).toBe(true);
    expect(r.world.terrain.offset).toEqual([10, -2, 0]);
    expect(r.world.terrain.seaLevel).toBe(0.25);
  });

  it('coerces numeric-string rows/cols/scale/seaLevel like the rest of the schema', () => {
    const r = validateWorld({
      ...BASE,
      terrain: { source: 'terrain.js', rows: '16', cols: '16', scale: ['1', '2', '1'], seaLevel: '0.1' },
    });
    expect(r.ok).toBe(true);
    expect(r.world.terrain.rows).toBe(16);
    expect(r.world.terrain.cols).toBe(16);
    expect(r.world.terrain.scale).toEqual([1, 2, 1]);
    expect(r.world.terrain.seaLevel).toBe(0.1);
  });

  it('omits terrain entirely when source is missing (partial terrain)', () => {
    const r = validateWorld({ ...BASE, terrain: { rows: 64, cols: 64, scale: [2, 1, 2] } });
    expect(r.ok).toBe(true);
    expect(r.world.terrain).toBeUndefined();
  });

  it('omits terrain when rows/cols are missing, < 2, or non-integer', () => {
    // rows/cols are VERTEX counts; Rapier needs >= 1 cell = >= 2 vertices per axis.
    const r1 = validateWorld({ ...BASE, terrain: { source: './t.js', cols: 64, scale: [2, 1, 2] } });
    const r2 = validateWorld({ ...BASE, terrain: { source: './t.js', rows: 1, cols: 64, scale: [2, 1, 2] } });
    const r3 = validateWorld({ ...BASE, terrain: { source: './t.js', rows: 8, cols: 1, scale: [2, 1, 2] } });
    const r4 = validateWorld({ ...BASE, terrain: { source: './t.js', rows: 0, cols: 64, scale: [2, 1, 2] } });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r4.ok).toBe(true);
    expect(r1.world.terrain).toBeUndefined();
    expect(r2.world.terrain).toBeUndefined();
    expect(r3.world.terrain).toBeUndefined();
    expect(r4.world.terrain).toBeUndefined();
  });

  it('omits terrain when scale is missing or has a non-positive component', () => {
    const r1 = validateWorld({ ...BASE, terrain: { source: './t.js', rows: 8, cols: 8 } });
    const r2 = validateWorld({ ...BASE, terrain: { source: './t.js', rows: 8, cols: 8, scale: [2, 0, 2] } });
    const r3 = validateWorld({ ...BASE, terrain: { source: './t.js', rows: 8, cols: 8, scale: [2, -1, 2] } });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r3.ok).toBe(true);
    expect(r1.world.terrain).toBeUndefined();
    expect(r2.world.terrain).toBeUndefined();
    expect(r3.world.terrain).toBeUndefined();
  });

  it('omits terrain + NEVER pushes errors (a bad terrain cannot force fallback:legacy)', () => {
    const r = validateWorld({
      ...BASE,
      terrain: { source: 'https://evil.example/terrain.js', rows: 8, cols: 8, scale: [2, 1, 2] },
    });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.world.terrain).toBeUndefined();
  });

  it('ignores a non-object terrain (null/array)', () => {
    const r1 = validateWorld({ ...BASE, terrain: null });
    const r2 = validateWorld({ ...BASE, terrain: [] });
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(r1.world.terrain).toBeUndefined();
    expect(r2.world.terrain).toBeUndefined();
  });
});

describe('_safeDataSourcePath', () => {
  it('accepts relative .js / .json module paths', () => {
    expect(_safeDataSourcePath('./terrain.js')).toBe('./terrain.js');
    expect(_safeDataSourcePath('terrain.json')).toBe('terrain.json');
    expect(_safeDataSourcePath('./data/heights.js')).toBe('./data/heights.js');
  });

  it('rejects absolute paths, protocols, traversal, and wrong extensions', () => {
    expect(_safeDataSourcePath('/etc/passwd')).toBeNull();
    expect(_safeDataSourcePath('https://evil.example/terrain.js')).toBeNull();
    expect(_safeDataSourcePath('../escape.js')).toBeNull();
    expect(_safeDataSourcePath('terrain.txt')).toBeNull();
    expect(_safeDataSourcePath('terrain')).toBeNull();
  });

  it('rejects non-strings + over-length paths', () => {
    expect(_safeDataSourcePath(null)).toBeNull();
    expect(_safeDataSourcePath(42)).toBeNull();
    expect(_safeDataSourcePath('a'.repeat(257) + '.js')).toBeNull();
  });
});
