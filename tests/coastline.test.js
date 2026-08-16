// tests/coastline.test.js — TOMOE coastline rings (v0.2.511).
// Tests the two arena play-area rings (bottom islands) and the point-in-polygon /
// clamp helpers. The origin (0,0) is in the sea channel between the two arena
// islands — NOT inside the fence. The centroids of each arena island are inside.
import { describe, it, expect } from 'vitest';
import {
  ARENA_COASTLINE, pointInCoastline, clampToCoastline,
  coastlineRing, coastlineBounds,
} from '../src/terrain/coastline.js';
import {
  ARENA_BL_CENTROID, ARENA_BR_CENTROID,
} from '../src/terrain/tomoeShape.js';

describe('ARENA_COASTLINE shape', () => {
  it('is a closed ring of many vertices (organic, from SVG)', () => {
    expect(Array.isArray(ARENA_COASTLINE)).toBe(true);
    expect(ARENA_COASTLINE.length).toBeGreaterThanOrEqual(24);
    for (const p of ARENA_COASTLINE) {
      expect(p).toHaveLength(2);
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it('coastlineRing() returns an array of rings (two arena islands)', () => {
    const rings = coastlineRing();
    expect(Array.isArray(rings)).toBe(true);
    expect(rings.length).toBe(2);
    for (const ring of rings) {
      expect(ring.length).toBeGreaterThanOrEqual(24);
    }
  });
});

describe('coastlineBounds', () => {
  it('encloses every vertex in all rings', () => {
    const b = coastlineBounds();
    const rings = coastlineRing();
    for (const ring of rings) {
      for (const [x, z] of ring) {
        expect(x).toBeGreaterThanOrEqual(b.minX);
        expect(x).toBeLessThanOrEqual(b.maxX);
        expect(z).toBeGreaterThanOrEqual(b.minZ);
        expect(z).toBeLessThanOrEqual(b.maxZ);
      }
    }
  });
});

describe('pointInCoastline', () => {
  it('is true at the Arena BL centroid (deep inside left island)', () => {
    expect(pointInCoastline(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1])).toBe(true);
  });

  it('is true at the Arena BR centroid (deep inside right island)', () => {
    expect(pointInCoastline(ARENA_BR_CENTROID[0], ARENA_BR_CENTROID[1])).toBe(true);
  });

  it('is false at the origin (sea channel between islands)', () => {
    expect(pointInCoastline(0, 0)).toBe(false);
  });

  it('is false far outside', () => {
    expect(pointInCoastline(100, 100)).toBe(false);
    expect(pointInCoastline(-50, 50)).toBe(false);
    expect(pointInCoastline(0, 40)).toBe(false);
  });
});

describe('clampToCoastline', () => {
  it('leaves a deep-interior point unchanged', () => {
    const [x, z] = clampToCoastline(ARENA_BL_CENTROID[0], ARENA_BL_CENTROID[1], 0.4);
    expect(x).toBeCloseTo(ARENA_BL_CENTROID[0], 6);
    expect(z).toBeCloseTo(ARENA_BL_CENTROID[1], 6);
  });

  it('pulls an outside point back inside (with margin)', () => {
    const margin = 0.4;
    const [x, z] = clampToCoastline(100, 100, margin);
    expect(pointInCoastline(x, z)).toBe(true);
  });

  it('keeps any clamped point inside for a sweep of far-flung inputs', () => {
    // Test from points just outside each arena island's bounds
    const b = coastlineBounds();
    const testPoints = [
      [b.minX - 5, ARENA_BL_CENTROID[1]],
      [b.maxX + 5, ARENA_BR_CENTROID[1]],
      [ARENA_BL_CENTROID[0], b.minZ - 5],
      [ARENA_BR_CENTROID[0], b.maxZ + 5],
      [ARENA_BL_CENTROID[0] - 10, ARENA_BL_CENTROID[1] - 10],
      [ARENA_BR_CENTROID[0] + 10, ARENA_BR_CENTROID[1] + 10],
    ];
    for (const [x, z] of testPoints) {
      const [cx, cz] = clampToCoastline(x, z, 0.4);
      expect(pointInCoastline(cx, cz)).toBe(true);
    }
  });

  it('honours a larger margin (clamped point sits further in)', () => {
    const [x0, z0] = clampToCoastline(100, 0, 0.1);
    const [x2, z2] = clampToCoastline(100, 0, 2.0);
    expect(pointInCoastline(x2, z2)).toBe(true);
  });
});
