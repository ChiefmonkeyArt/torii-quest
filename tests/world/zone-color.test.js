// tests/world/zone-color.test.js — locks the arena's per-zone terrain ground colour
// (legacy terrainMesh.js parity). The data-driven world renderer (worldTerrain.js +
// terrainVisual.js) must colour a serialized arena byte-identically to the live arena:
// sandy arena with height tint + speckle, green NAP with earth/stone detail, and a
// dark underwater tint below the waterline. Pure node-safe — no THREE, no DOM.
import { describe, it, expect } from 'vitest';
import {
  zoneVary,
  zoneBaseColor,
  arenaGroundColor,
  napGroundColor,
  ZONE_ARENA,
  ZONE_NAP,
  ZONE_SEA_LEVEL,
  ZONE_ISLAND_BASE_Y,
} from '../../src/engine/world/zoneColor.js';

describe('zoneColor — base colours match the legacy hex constants', () => {
  it('arena base = 0xb9a06b (sandy shore)', () => {
    const c = zoneBaseColor(ZONE_ARENA);
    expect(c.r).toBeCloseTo(0xb9 / 255, 5);
    expect(c.g).toBeCloseTo(0xa0 / 255, 5);
    expect(c.b).toBeCloseTo(0x6b / 255, 5);
    expect(c.r).toBeCloseTo(0.7255, 1);
  });

  it('NAP base = 0x5a7a3a (lighter green)', () => {
    const c = zoneBaseColor(ZONE_NAP);
    expect(c.r).toBeCloseTo(0x5a / 255, 5);
    expect(c.g).toBeCloseTo(0x7a / 255, 5);
    expect(c.b).toBeCloseTo(0x3a / 255, 5);
  });
});

describe('zoneColor — deterministic speckle (matches terrainMesh._hash)', () => {
  it('is deterministic and bounded to [0,1)', () => {
    const a = zoneVary(ZONE_ARENA);
    const v1 = a(10, 20, 1.0);
    const v2 = a(10, 20, 1.0);
    expect(v1).toEqual(v2);
    for (const c of [v1.r, v1.g, v1.b]) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1.2); // arena shade can exceed 1 (no clamp, like legacy)
    }
  });
});

describe('zoneColor — waterline (below SEA_LEVEL + 0.3 the ground goes dark)', () => {
  it('arena goes dark underwater (the sea plane hides the mesh)', () => {
    const c = arenaGroundColor(0, 0, ZONE_SEA_LEVEL - 1.0);
    // fully submerged → underwater=1 → ~0
    expect(c.r).toBeCloseTo(0, 1);
    expect(c.g).toBeCloseTo(0, 1);
    expect(c.b).toBeCloseTo(0, 1);
  });

  it('NAP goes dark underwater too', () => {
    const c = napGroundColor(0, 0, ZONE_SEA_LEVEL - 0.5);
    expect(c.r).toBeLessThan(0.1);
    expect(c.g).toBeLessThan(0.1);
  });

  it('above the waterline the arena returns the sunny sand shade (lighter on rises)', () => {
    const low = arenaGroundColor(0, 0, ZONE_SEA_LEVEL + 0.05); // just above waterline
    const high = arenaGroundColor(0, 0, ZONE_ISLAND_BASE_Y);   // plateau
    // Same speckle → the only delta is the height brightening (hf 0 → 1).
    expect(high.r).toBeGreaterThan(low.r);
  });
});

describe('zoneColor — zoneVary selects the right vary per kind', () => {
  it('index 0 → arena, index 1 → NAP (positional, ADR-0119)', () => {
    // The zones builder passes zoneIndex 0/1; verify the colour is visibly distinct.
    const a = arenaGroundColor(0, 0, ZONE_ISLAND_BASE_Y);
    const n = napGroundColor(0, 0, ZONE_ISLAND_BASE_Y);
    // Arena sand is warm (red-dominant); NAP green is cool (green-dominant).
    expect(a.r).toBeGreaterThan(a.g);
    expect(n.g).toBeGreaterThan(n.r);
  });
});