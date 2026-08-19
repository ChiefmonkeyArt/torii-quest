// tests/world-terrain.test.js — locks the Phase 0k.5 data-driven terrain
// heightfield collider (worldTerrain.js). Pure vitest with a FAKE Rapier +
// physicsWorld + loader (no WASM, no THREE). Verifies: no-terrain no-op, a
// valid 2×3 heightfield passes rows-1/cols-1 + scale + centre translation
// exactly, bad length + non-finite + source-load-failure return a structured
// failure (so arenaRuntime falls back to legacy buildArena — the ground must
// never vanish), heights-vs-buildHeightfieldArray source forms, + dispose.
import { describe, it, expect } from 'vitest';
import {
  buildWorldTerrain,
  buildWorldTerrainCollider,
  loadWorldTerrainData,
} from '../src/engine/world/worldTerrain.js';

// A fake Rapier namespace + physics world + loader. The heightfield() desc
// records its args so tests can assert the exact nrows/ncols/scale passed; the
// physicsWorld records createCollider + removeCollider calls.
function mockDeps(modules) {
  const rapier = {
    ColliderDesc: {
      heightfield(nrows, ncols, heights, scale) {
        rapier._heightfieldCalls.push({ nrows, ncols, heightsLength: heights.length, scale });
        return {
          setTranslation(x, y, z) { rapier._translationCalls.push({ x, y, z }); return this; },
        };
      },
    },
    _heightfieldCalls: [],
    _translationCalls: [],
  };
  const physicsWorld = {
    createCollider(desc) {
      const c = { handle: physicsWorld._colliders.length + 1, desc };
      physicsWorld._colliders.push(c);
      return c;
    },
    removeCollider(c, wakeUp) { physicsWorld._removed.push({ handle: c && c.handle, wakeUp }); },
    _colliders: [],
    _removed: [],
  };
  const loadTerrainSource = async (source) => {
    if (!(source in modules)) throw new Error(`module not found: ${source}`);
    return modules[source];
  };
  return { physicsWorld, Rapier: rapier, loadTerrainSource, rapier, physicsWorld };
}

const HEIGHTS_2x3 = new Float32Array([0, 1, 2, 3, 4, 5]); // 2 rows × 3 cols, column-major
const TERRAIN_2x3 = { source: './t.js', rows: 2, cols: 3, scale: [10, 1, 8], offset: [5, 0, 4] };

describe('buildWorldTerrain — no terrain (gateway-blank minimal world)', () => {
  it('returns ok + null terrain when the world has no terrain field (no-op, no deps used)', async () => {
    const deps = mockDeps({});
    const r = await buildWorldTerrain({ id: 'gateway-blank', name: 'Blank' }, deps);
    expect(r.ok).toBe(true);
    expect(r.terrain).toBeNull();
    expect(deps.rapier._heightfieldCalls).toHaveLength(0);
    expect(deps.physicsWorld._colliders).toHaveLength(0);
  });

  it('returns ok + null terrain when world is null/absent', async () => {
    const r1 = await buildWorldTerrain(null, mockDeps({}));
    const r2 = await buildWorldTerrain(undefined, mockDeps({}));
    expect(r1).toEqual({ ok: true, terrain: null });
    expect(r2).toEqual({ ok: true, terrain: null });
  });
});

describe('buildWorldTerrain — valid heightfield', () => {
  it('builds a 2×3 heightfield: passes rows-1, cols-1, scale, centre translation exactly', async () => {
    const deps = mockDeps({ './t.js': { buildHeightfieldArray: () => HEIGHTS_2x3 } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(true);
    expect(r.terrain.colliders).toHaveLength(1);
    expect(r.terrain.bodies).toEqual([]);
    expect(r.terrain.meshes).toEqual([]);
    // Rapier gotcha: nrows/ncols are CELL counts (one fewer than vertex counts).
    expect(deps.rapier._heightfieldCalls[0]).toEqual({
      nrows: 1, ncols: 2, heightsLength: 6, scale: { x: 10, y: 1, z: 8 },
    });
    expect(deps.rapier._translationCalls[0]).toEqual({ x: 5, y: 0, z: 4 });
    expect(deps.physicsWorld._colliders).toHaveLength(1);
  });

  it('accepts a source module that exports `heights` directly (eager form)', async () => {
    const deps = mockDeps({ './t.js': { heights: HEIGHTS_2x3 } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(true);
    expect(r.terrain.colliders).toHaveLength(1);
  });

  it('normalises a plain array (from .json modules) to a Float32Array', async () => {
    const deps = mockDeps({ './t.js': { heights: [0, 1, 2, 3, 4, 5] } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(true);
    expect(r.terrain.colliders).toHaveLength(1);
  });

  it('defaults offset to [0,0,0] when absent', async () => {
    const deps = mockDeps({ './t.js': { buildHeightfieldArray: () => HEIGHTS_2x3 } });
    const r = await buildWorldTerrain(
      { terrain: { source: './t.js', rows: 2, cols: 3, scale: [10, 1, 8] } },
      deps,
    );
    expect(r.ok).toBe(true);
    expect(deps.rapier._translationCalls[0]).toEqual({ x: 0, y: 0, z: 0 });
  });
});

describe('buildWorldTerrain — structured failure (fall back to legacy buildArena)', () => {
  it('fails when heights length != rows*cols (no collider created)', async () => {
    const deps = mockDeps({ './t.js': { heights: new Float32Array([0, 1, 2, 3, 4]) } }); // 5, not 6
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/length 5 != rows\*cols/);
    expect(deps.rapier._heightfieldCalls).toHaveLength(0); // never reached Rapier
    expect(deps.physicsWorld._colliders).toHaveLength(0);
  });

  it('fails on a non-finite height (NaN/Infinity corrupts the heightfield)', async () => {
    const bad = new Float32Array([0, 1, NaN, 3, 4, 5]);
    const deps = mockDeps({ './t.js': { heights: bad } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/non-finite value at index 2/);
    expect(deps.physicsWorld._colliders).toHaveLength(0);
  });

  it('fails when the source module is missing / load throws', async () => {
    const deps = mockDeps({}); // no './t.js'
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/load failed/);
    expect(deps.physicsWorld._colliders).toHaveLength(0);
  });

  it('fails when the source exports neither heights nor buildHeightfieldArray', async () => {
    const deps = mockDeps({ './t.js': { foo: 'bar' } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/must export heights/);
  });

  it('fails when physics deps are missing but a terrain is present (ground is not optional)', async () => {
    // loadTerrainSource present (so data loads) but no physicsWorld/Rapier.
    const deps = { loadTerrainSource: async () => ({ heights: HEIGHTS_2x3 }) };
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/physicsWorld \+ Rapier deps required/);
  });
});

describe('buildWorldTerrain — dispose', () => {
  it('dispose removes the collider from the physics world (idempotent, best-effort)', async () => {
    const deps = mockDeps({ './t.js': { buildHeightfieldArray: () => HEIGHTS_2x3 } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(true);
    const collider = r.terrain.colliders[0];
    r.terrain.dispose();
    expect(deps.physicsWorld._removed[0]).toEqual({ handle: collider.handle, wakeUp: true });
    // Idempotent: a second call is a no-op (no duplicate removal).
    r.terrain.dispose();
    expect(deps.physicsWorld._removed).toHaveLength(1);
  });
});

describe('loadWorldTerrainData + buildWorldTerrainCollider (unit seams)', () => {
  it('loadWorldTerrainData returns data:null for a null terrain', async () => {
    const r = await loadWorldTerrainData(null, { loadTerrainSource: async () => ({}) });
    expect(r).toEqual({ ok: true, data: null });
  });

  it('buildWorldTerrainCollider returns ok + null collider for null data (no terrain)', () => {
    const r = buildWorldTerrainCollider(null, mockDeps({}));
    expect(r.ok).toBe(true);
    expect(r.collider).toBeNull();
  });
});
