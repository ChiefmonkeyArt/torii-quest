// terrain-visual.test.js — locks buildTerrainVisual: the portal mirror builds the
// destination's REAL island silhouette (visual-only, no physics) instead of a flat
// platform-only peek (two-node playtest: "black circle iris").
import { describe, it, expect } from 'vitest';
import { buildTerrainVisual } from '../src/engine/world/terrainVisual.js';

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

// 2 rows × 3 cols, column-major heights.
const ZONE = {
  rows: 2, cols: 3,
  heights: [0, 1, 2, 3, 4, 5],
  scale: [10, 1, 8],
  offset: [5, 0, 4],
};

describe('buildTerrainVisual', () => {
  it('is a no-op for a world with no terrain zones', () => {
    expect(buildTerrainVisual({}, { THREE: mockThree() })).toEqual({ ok: true, meshes: [] });
    expect(buildTerrainVisual({ terrain: {} }, { THREE: mockThree() })).toEqual({ ok: true, meshes: [] });
    expect(buildTerrainVisual({ terrain: { zones: [] } }, { THREE: mockThree() })).toEqual({ ok: true, meshes: [] });
  });

  it('requires THREE', () => {
    const r = buildTerrainVisual({ terrain: { zones: [ZONE] } }, {});
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/THREE dep required/);
  });

  it('builds one mesh per valid zone', () => {
    const r = buildTerrainVisual({ terrain: { zones: [ZONE, ZONE] } }, { THREE: mockThree() });
    expect(r.ok).toBe(true);
    expect(r.meshes).toHaveLength(2);
    for (const m of r.meshes) {
      expect(m.mesh.name).toBe('world-terrain-visual');
      expect(typeof m.dispose).toBe('function');
    }
  });

  it('skips a malformed zone rather than failing the whole peek', () => {
    const bad = { rows: 2, cols: 3, heights: [0, 1], scale: [10, 1, 8], offset: [5, 0, 4] }; // wrong length
    const r = buildTerrainVisual({ terrain: { zones: [bad, ZONE] } }, { THREE: mockThree() });
    expect(r.ok).toBe(true);
    expect(r.meshes).toHaveLength(1); // only the valid one
  });

  it('disposes geometry + material through the returned dispose', () => {
    const THREE = mockThree();
    const r = buildTerrainVisual({ terrain: { zones: [ZONE] } }, { THREE });
    expect(r.meshes).toHaveLength(1);
    r.meshes[0].dispose();
    expect(THREE._disposed.geo).toBe(1);
    expect(THREE._disposed.mat).toBe(1);
  });

  it('writes world-space vertex positions (offset + scale applied)', () => {
    const THREE = mockThree();
    const r = buildTerrainVisual({ terrain: { zones: [ZONE] } }, { THREE });
    const mesh = r.meshes[0].mesh;
    const pos = mesh.geo.attributes.position.array;
    // cellW = 10/(3-1)=5, cellD=8/(2-1)=8; gMinX=5-5=0, gMinZ=4-4=0.
    // col0,row0 → x=0, y=heights[0]*1+0=0, z=0.
    expect(pos[0]).toBeCloseTo(0, 5);
    expect(pos[1]).toBeCloseTo(0, 5);
    expect(pos[2]).toBeCloseTo(0, 5);
    // col2 (x=10), row1 (z=8) → heights[2*2+1]=heights[5]=5.
    const last = (2 * 2 + 1) * 3;
    expect(pos[last + 0]).toBeCloseTo(10, 5);
    expect(pos[last + 1]).toBeCloseTo(5, 5);
    expect(pos[last + 2]).toBeCloseTo(8, 5);
    // index count: (3-1)*(2-1)*6 = 12.
    expect(mesh.geo.index.array).toHaveLength(12);
  });
});