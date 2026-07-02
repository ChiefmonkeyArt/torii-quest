// tests/coastline.test.js — organic outer-arena boundary polygon (v0.2.342).
// Pure + node-safe (no THREE): guards the deterministic coastline shape and the
// point-in-polygon / clamp helpers that drive the wall, the player colliders and
// the bot containment clamp. If this shape drifts, all three fall out of sync.
import { describe, it, expect } from 'vitest';
import {
  ARENA_COASTLINE, pointInCoastline, clampToCoastline,
  coastlineRing, coastlineBounds,
} from '../src/terrain/coastline.js';
import { ARENA_HALF } from '../src/config.js';

describe('ARENA_COASTLINE shape', () => {
  it('is a closed ring of many vertices (organic, not a square)', () => {
    expect(Array.isArray(ARENA_COASTLINE)).toBe(true);
    expect(ARENA_COASTLINE.length).toBeGreaterThanOrEqual(24);
    for (const p of ARENA_COASTLINE) {
      expect(p).toHaveLength(2);
      expect(Number.isFinite(p[0])).toBe(true);
      expect(Number.isFinite(p[1])).toBe(true);
    }
  });

  it('fits inside the island footprint (max |x|,|z| < ARENA_HALF)', () => {
    for (const [x, z] of ARENA_COASTLINE) {
      expect(Math.abs(x)).toBeLessThan(ARENA_HALF);
      expect(Math.abs(z)).toBeLessThan(ARENA_HALF);
    }
  });

  it('is genuinely wavy — radius is not constant (not a circle)', () => {
    const radii = ARENA_COASTLINE.map(([x, z]) => Math.hypot(x, z));
    const min = Math.min(...radii), max = Math.max(...radii);
    expect(max - min).toBeGreaterThan(1); // real headlands/bays, > 1m variation
  });

  it('is deterministic — coastlineRing() returns the same shape', () => {
    expect(coastlineRing()).toBe(ARENA_COASTLINE);
  });
});

describe('coastlineBounds', () => {
  it('encloses every vertex', () => {
    const b = coastlineBounds();
    for (const [x, z] of ARENA_COASTLINE) {
      expect(x).toBeGreaterThanOrEqual(b.minX);
      expect(x).toBeLessThanOrEqual(b.maxX);
      expect(z).toBeGreaterThanOrEqual(b.minZ);
      expect(z).toBeLessThanOrEqual(b.maxZ);
    }
  });
});

describe('pointInCoastline', () => {
  it('is true at the origin (deep inside)', () => {
    expect(pointInCoastline(0, 0)).toBe(true);
  });

  it('is false far outside', () => {
    expect(pointInCoastline(100, 100)).toBe(false);
    expect(pointInCoastline(-50, 0)).toBe(false);
    expect(pointInCoastline(0, 40)).toBe(false);
  });

  it('is false just beyond the max extent on each axis', () => {
    const b = coastlineBounds();
    expect(pointInCoastline(b.maxX + 2, 0)).toBe(false);
    expect(pointInCoastline(b.minX - 2, 0)).toBe(false);
    expect(pointInCoastline(0, b.maxZ + 2)).toBe(false);
    expect(pointInCoastline(0, b.minZ - 2)).toBe(false);
  });
});

describe('clampToCoastline', () => {
  it('leaves a deep-interior point unchanged', () => {
    const [x, z] = clampToCoastline(0, 0, 0.4);
    expect(x).toBeCloseTo(0, 9);
    expect(z).toBeCloseTo(0, 9);
  });

  it('pulls an outside point back inside (with margin)', () => {
    const margin = 0.4;
    const [x, z] = clampToCoastline(30, 30, margin);
    expect(pointInCoastline(x, z)).toBe(true);
    // and it should be meaningfully closer to the interior than the input
    expect(Math.hypot(x, z)).toBeLessThan(Math.hypot(30, 30));
  });

  it('keeps any clamped point inside for a sweep of far-flung inputs', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.13) {
      const x = Math.cos(a) * 40, z = Math.sin(a) * 40;
      const [cx, cz] = clampToCoastline(x, z, 0.4);
      expect(pointInCoastline(cx, cz)).toBe(true);
    }
  });

  it('honours a larger margin (clamped point sits further in)', () => {
    const [x0, z0] = clampToCoastline(30, 0, 0.1);
    const [x2, z2] = clampToCoastline(30, 0, 2.0);
    expect(Math.hypot(x2, z2)).toBeLessThan(Math.hypot(x0, z0));
    expect(pointInCoastline(x2, z2)).toBe(true);
  });
});
