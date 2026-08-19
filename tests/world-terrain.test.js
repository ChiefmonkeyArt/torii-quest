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
  buildWorldTerrainMesh,
  loadWorldTerrainData,
} from '../src/engine/world/worldTerrain.js';

// A fake THREE namespace. Records the geometry/material/mesh instances so tests can
// assert the exact positions/indices written. Mirrors only the surface
// buildWorldTerrainMesh touches (BufferGeometry, BufferAttribute, MeshStandardMaterial, Mesh).
function mockThree() {
  const disposed = { geo: 0, mat: 0 };
  class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; }
    setAttribute(name, attr) { this.attributes[name] = attr; return this; }
    setIndex(idx) { this.index = idx; return this; }
    computeVertexNormals() {}
    dispose() { disposed.geo++; }
  }
  class MeshStandardMaterial {
    constructor(opts) { this.opts = opts; }
    dispose() { disposed.mat++; }
  }
  class Mesh {
    constructor(geo, mat) { this.geo = geo; this.mat = mat; this.name = ''; this.receiveShadow = false; }
  }
  return { BufferGeometry, BufferAttribute, MeshStandardMaterial, Mesh, _disposed: disposed };
}

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

describe('buildWorldTerrainMesh — world-space displaced geometry', () => {
  // 2 rows × 3 cols, column-major heights with DISTINCT values per vertex so a
  // row/col transposition (row*cols+col instead of col*rows+row) fails loudly:
  // vertex (col0,row1) must read heights[1]=1, not the transposed heights[3]=3.
  it('vertex Y maps to heights[col*rows+row] (column-major — catches transposition)', () => {
    const THREE = mockThree();
    const r = buildWorldTerrainMesh(
      { rows: 2, cols: 3, heights: HEIGHTS_2x3, scale: [10, 1, 8], offset: [5, 0, 4] },
      { THREE },
    );
    expect(r.ok).toBe(true);
    const pos = r.mesh.geo.attributes.position.array;
    // Y at vertex index i (every 3rd from 1) === heights[i] (scaleY=1, offsetY=0).
    expect(pos[1]).toBe(0);   // heights[0] = vertex (col0,row0)
    expect(pos[4]).toBe(1);   // heights[1] = vertex (col0,row1) — would be 3 if transposed
    expect(pos[7]).toBe(2);   // heights[2] = vertex (col1,row0)
    expect(pos[10]).toBe(3);  // heights[3] = vertex (col1,row1)
    expect(pos[13]).toBe(4);  // heights[4] = vertex (col2,row0)
    expect(pos[16]).toBe(5);  // heights[5] = vertex (col2,row1)
  });

  it('XZ span is centred at the offset: gMinX=offset-scale/2, cellW=scale/(cols-1)', () => {
    const THREE = mockThree();
    const r = buildWorldTerrainMesh(
      { rows: 2, cols: 3, heights: HEIGHTS_2x3, scale: [10, 1, 8], offset: [5, 0, 4] },
      { THREE },
    );
    const pos = r.mesh.geo.attributes.position.array;
    // X: gMinX=5-5=0, then +5 per col → 0,5,10 across the 3 columns.
    expect(pos[0]).toBe(0);   // x (col0,row0)
    expect(pos[6]).toBe(5);   // x (col1,row0)
    expect(pos[12]).toBe(10); // x (col2,row0)
    // Z: gMinZ=4-4=0, then +8 per row → 0,8 across the 2 rows.
    expect(pos[2]).toBe(0);   // z (col0,row0)
    expect(pos[5]).toBe(8);   // z (col0,row1)
    expect(pos[8]).toBe(0);   // z (col1,row0)
  });

  it('heights are scaled by scale[1] + offset by offset[1] (matches the Rapier heightfield)', () => {
    const THREE = mockThree();
    const r = buildWorldTerrainMesh(
      { rows: 2, cols: 3, heights: HEIGHTS_2x3, scale: [10, 2, 8], offset: [5, 10, 4] },
      { THREE },
    );
    const pos = r.mesh.geo.attributes.position.array;
    // y = heights[i]*2 + 10. heights[2]=2 → 2*2+10=14 at vertex (col1,row0).
    expect(pos[7]).toBe(14);
    // heights[0]=0 → 0*2+10=10 at vertex (col0,row0).
    expect(pos[1]).toBe(10);
  });

  it('emits 2 triangles per cell (column-major winding a,d,b,b,d,c — no culling gap)', () => {
    const THREE = mockThree();
    const r = buildWorldTerrainMesh(
      { rows: 2, cols: 3, heights: HEIGHTS_2x3, scale: [10, 1, 8], offset: [5, 0, 4] },
      { THREE },
    );
    const idx = r.mesh.geo.index.array;
    // 2 cells (cols-1=2 × rows-1=1) × 6 = 12 indices.
    expect(idx).toHaveLength(12);
    // Cell (col0,row0): a=0,d=1,b=2,c=3 → a,d,b,b,d,c = 0,1,2,2,1,3.
    expect(Array.from(idx.slice(0, 6))).toEqual([0, 1, 2, 2, 1, 3]);
  });

  it('returns ok + null mesh for null data (no terrain)', () => {
    const r = buildWorldTerrainMesh(null, { THREE: mockThree() });
    expect(r.ok).toBe(true);
    expect(r.mesh).toBeNull();
  });

  it('fails when THREE is not provided', () => {
    const r = buildWorldTerrainMesh(
      { rows: 2, cols: 3, heights: HEIGHTS_2x3, scale: [10, 1, 8], offset: [5, 0, 4] },
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/THREE dep required/);
  });

  it('dispose disposes the geometry + material (idempotent, best-effort)', () => {
    const THREE = mockThree();
    const r = buildWorldTerrainMesh(
      { rows: 2, cols: 3, heights: HEIGHTS_2x3, scale: [10, 1, 8], offset: [5, 0, 4] },
      { THREE },
    );
    r.dispose();
    expect(THREE._disposed.geo).toBe(1);
    expect(THREE._disposed.mat).toBe(1);
    r.dispose(); // idempotent — no double-dispose
    expect(THREE._disposed.geo).toBe(1);
  });
});

describe('buildWorldTerrain — mesh integration', () => {
  it('builds collider + mesh when THREE is provided', async () => {
    const deps = { ...mockDeps({ './t.js': { buildHeightfieldArray: () => HEIGHTS_2x3 } }), THREE: mockThree() };
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(true);
    expect(r.terrain.colliders).toHaveLength(1);
    expect(r.terrain.meshes).toHaveLength(1);
    expect(r.terrain.meshes[0].name).toBe('world-terrain');
  });

  it('is physics-only (no mesh) when THREE is absent', async () => {
    const deps = mockDeps({ './t.js': { buildHeightfieldArray: () => HEIGHTS_2x3 } });
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    expect(r.ok).toBe(true);
    expect(r.terrain.meshes).toEqual([]);
    expect(r.terrain.colliders).toHaveLength(1);
  });

  it('disposes collider + mesh together', async () => {
    const THREE = mockThree();
    const deps = { ...mockDeps({ './t.js': { buildHeightfieldArray: () => HEIGHTS_2x3 } }), THREE };
    const r = await buildWorldTerrain({ terrain: TERRAIN_2x3 }, deps);
    r.terrain.dispose();
    expect(deps.physicsWorld._removed).toHaveLength(1);
    expect(THREE._disposed.geo).toBe(1);
    expect(THREE._disposed.mat).toBe(1);
  });
});
