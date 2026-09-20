import { describe, it, expect } from 'vitest';
import {
  sampleTerrainHeight,
  liftTransformToTerrain,
  groundFloorFor,
  PORTAL_EYE_HEIGHT,
} from '../../src/engine/world/terrainSample.js';

// A minimal single-zone inline heightfield. Column-major: index = col * rows + row,
// where col walks +X (cols count) and row walks +Z (rows count). scaleY = 1 so the
// raw heights are world-Y metres; offset places the zone's centre at [0,0,0].
function flatWorld(rows = 4, cols = 4, height = 1.0, scale = [12, 1, 12]) {
  const heights = new Array(rows * cols).fill(height);
  return { terrain: { zones: [{ rows, cols, heights, scale, offset: [0, 0, 0] }] } };
}

describe('sampleTerrainHeight — bilinear zone sampling', () => {
  it('returns null for worlds without terrain', () => {
    expect(sampleTerrainHeight(null, 0, 0)).toBeNull();
    expect(sampleTerrainHeight({}, 0, 0)).toBeNull();
    expect(sampleTerrainHeight({ terrain: {} }, 0, 0)).toBeNull();
    expect(sampleTerrainHeight({ terrain: { zones: [] } }, 0, 0)).toBeNull();
  });

  it('returns the flat surface height inside the zone', () => {
    const w = flatWorld(4, 4, 1.5);
    expect(sampleTerrainHeight(w, 0, 0)).toBeCloseTo(1.5, 6);
    expect(sampleTerrainHeight(w, -5, 0)).toBeCloseTo(1.5, 6); // near the -X edge
    expect(sampleTerrainHeight(w, 0, 5.99)).toBeCloseTo(1.5, 6); // near the +Z edge
  });

  it('returns null outside every zone', () => {
    const w = flatWorld(4, 4, 1.0, [12, 1, 12]); // spans ±6 in X/Z
    expect(sampleTerrainHeight(w, 10, 0)).toBeNull();
    expect(sampleTerrainHeight(w, 0, -10)).toBeNull();
  });

  it('interpolates between four distinct corner heights', () => {
    // rows=2, cols=2 → single cell with corners h[col*2+row]:
    //   h00 = heights[0] (col0,row0), h10 = heights[2] (col1,row0)
    //   h01 = heights[1] (col0,row1), h11 = heights[3] (col1,row1)
    const heights = [0, 0, 2, 2]; // X varies (0 → 2), Z constant
    const w = { terrain: { zones: [{ rows: 2, cols: 2, heights, scale: [2, 1, 2], offset: [0, 0, 0] }] } };
    // zone spans ±1 in X/Z; at x=-1 (colF=0) → h=0, at x=+1 (colF=1) → h=2.
    expect(sampleTerrainHeight(w, -1, 0)).toBeCloseTo(0, 6);
    expect(sampleTerrainHeight(w, 1, 0)).toBeCloseTo(2, 6);
    expect(sampleTerrainHeight(w, 0, 0)).toBeCloseTo(1, 6); // midpoint
  });

  it('applies scale[1] and offset[1] to the world-Y result', () => {
    // scaleY = 0.5, offsetY = 0.3 → y = raw * 0.5 + 0.3.
    const w = flatWorld(4, 4, 1.0, [12, 0.5, 12]);
    // Rebuild with offset[1] = 0.3.
    w.terrain.zones[0].offset = [0, 0.3, 0];
    expect(sampleTerrainHeight(w, 0, 0)).toBeCloseTo(0.8, 6);
  });

  it('drops malformed zones and keeps trying later zones', () => {
    const good = flatWorld(4, 4, 2.0, [6, 1, 6]); // spans ±3
    const bad = { rows: 2, cols: 2, heights: [1, 1, 1], scale: [2, 1, 2], offset: [0, 0, 0] }; // wrong length
    const w = { terrain: { zones: [bad, good.terrain.zones[0]] } };
    expect(sampleTerrainHeight(w, 0, 0)).toBeCloseTo(2.0, 6);
  });
});

describe('liftTransformToTerrain — anchor the far-side gate above ground', () => {
  const id = { x: 0, y: 0, z: 0, w: 1 };

  it('is a pure no-op when there is no terrain', () => {
    const t = { position: { x: 5, y: 0, z: 5 }, quaternion: id };
    const out = liftTransformToTerrain({}, t);
    expect(out).toBe(t); // same reference — untouched
  });

  it('raises a y=0 gate to EYE height above the surface', () => {
    const w = flatWorld(4, 4, 1.2);
    const t = { position: { x: 0, y: 0, z: 0 }, quaternion: id };
    const out = liftTransformToTerrain(w, t);
    expect(out.position.x).toBe(0);
    expect(out.position.z).toBe(0);
    expect(out.position.y).toBeCloseTo(1.2 + PORTAL_EYE_HEIGHT, 6);
    expect(out.quaternion).toEqual(id);
    expect(t.position.y).toBe(0); // input untouched
  });

  it('returns the original when the gate is outside every zone', () => {
    const w = flatWorld(4, 4, 1.0, [2, 1, 2]); // spans ±1
    const t = { position: { x: 99, y: 0, z: 99 }, quaternion: id };
    expect(liftTransformToTerrain(w, t)).toBe(t);
  });
});

describe('groundFloorFor — camera floor above the surface', () => {
  it('returns surface + headroom over terrain', () => {
    const w = flatWorld(4, 4, 1.4);
    expect(groundFloorFor(w, 0, 0)).toBeCloseTo(1.4 + 1.2, 6);
  });

  it('accepts a custom headroom', () => {
    const w = flatWorld(4, 4, 1.0);
    expect(groundFloorFor(w, 0, 0, 3)).toBeCloseTo(4.0, 6);
  });

  it('returns null without terrain', () => {
    expect(groundFloorFor({}, 0, 0)).toBeNull();
  });
});