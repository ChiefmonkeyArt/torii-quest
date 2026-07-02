// tests/sea-config.test.js — Stage 2 SEA wave config (v0.2.328).
// Pure + node-safe (no THREE), deterministic. Locks the wave-height function the
// GLSL water shader mirrors (src/terrain/sea.js generates its GLSL from the SAME
// SEA_WAVES array, so this test guards both). Sea is visual only — no physics.
import { describe, it, expect } from 'vitest';
import {
  SEA_LEVEL, SEA_SIZE, SEA_SEGMENTS, SEA_WAVES, SEA_WAVE_MAX_AMP,
  seaWaveHeight, seaSurfaceY,
} from '../src/terrain/seaConfig.js';

describe('sea constants', () => {
  it('SEA_LEVEL is exactly -0.26 (raised so water laps higher up the shore)', () => {
    expect(SEA_LEVEL).toBe(-0.26);
  });

  it('SEA_SIZE is a positive extent that reaches past the fog horizon (~300m)', () => {
    expect(SEA_SIZE).toBeGreaterThan(0);
    // Half-extent must clear the fog horizon so the plane edge is hidden.
    expect(SEA_SIZE / 2).toBeGreaterThan(300);
  });

  it('SEA_SEGMENTS is a sane positive integer', () => {
    expect(Number.isInteger(SEA_SEGMENTS)).toBe(true);
    expect(SEA_SEGMENTS).toBeGreaterThan(0);
  });

  it('SEA_WAVES + wave params are frozen and sane', () => {
    expect(Object.isFrozen(SEA_WAVES)).toBe(true);
    expect(SEA_WAVES.length).toBeGreaterThanOrEqual(2); // multiple independent waves
    for (const w of SEA_WAVES) {
      expect(Object.isFrozen(w)).toBe(true);
      expect(w.amplitude).toBeGreaterThan(0);
      expect(w.wavelength).toBeGreaterThan(0);
      expect(w.speed).toBeGreaterThan(0);
      // Directions are unit vectors in the XZ plane.
      const len = Math.hypot(w.dirX, w.dirZ);
      expect(len).toBeCloseTo(1, 5);
    }
  });

  it('directions are not all identical (waves travel in different directions)', () => {
    const dirs = new Set(SEA_WAVES.map((w) => `${w.dirX.toFixed(3)},${w.dirZ.toFixed(3)}`));
    expect(dirs.size).toBeGreaterThan(1);
  });

  it('crest amplitude is obviously visible (~0.3-0.5m as requested)', () => {
    expect(SEA_WAVE_MAX_AMP).toBeCloseTo(
      SEA_WAVES.reduce((s, w) => s + w.amplitude, 0), 9);
    expect(SEA_WAVE_MAX_AMP).toBeGreaterThanOrEqual(0.3);
    expect(SEA_WAVE_MAX_AMP).toBeLessThanOrEqual(0.6);
  });
});

describe('seaWaveHeight', () => {
  it('is deterministic for the same (x,z,t)', () => {
    expect(seaWaveHeight(12.3, -7.1, 4.2)).toBe(seaWaveHeight(12.3, -7.1, 4.2));
  });

  it('is 0 at the origin at t=0 (all phases zero — reference point)', () => {
    expect(seaWaveHeight(0, 0, 0)).toBeCloseTo(0, 9);
  });

  it('stays finite everywhere and within ±max-amplitude', () => {
    for (let i = 0; i < 500; i++) {
      const x = (i * 13.7) % 500 - 250;
      const z = (i * 7.3) % 500 - 250;
      const t = (i * 0.11) % 20;
      const h = seaWaveHeight(x, z, t);
      expect(Number.isFinite(h)).toBe(true);
      expect(Math.abs(h)).toBeLessThanOrEqual(SEA_WAVE_MAX_AMP + 1e-9);
    }
  });

  it('reaches near a crest somewhere (waves are visible, not flat)', () => {
    let maxH = -Infinity;
    for (let x = -20; x <= 20; x += 0.25) {
      for (let z = -20; z <= 20; z += 0.25) {
        maxH = Math.max(maxH, seaWaveHeight(x, z, 0));
      }
    }
    // A meaningful fraction of the theoretical crest is actually attained.
    expect(maxH).toBeGreaterThan(SEA_WAVE_MAX_AMP * 0.5);
  });

  it('crests travel over time (surface is animated, not static)', () => {
    const before = seaWaveHeight(5, 5, 0);
    const after = seaWaveHeight(5, 5, 1.0);
    expect(after).not.toBeCloseTo(before, 3);
  });
});

describe('seaSurfaceY', () => {
  it('equals SEA_LEVEL + displacement', () => {
    const x = 3.3, z = -9.9, t = 2.5;
    expect(seaSurfaceY(x, z, t)).toBeCloseTo(SEA_LEVEL + seaWaveHeight(x, z, t), 9);
  });

  it('oscillates around SEA_LEVEL (never a runaway value)', () => {
    for (let t = 0; t < 10; t += 0.5) {
      const y = seaSurfaceY(2, 2, t);
      expect(y).toBeGreaterThanOrEqual(SEA_LEVEL - SEA_WAVE_MAX_AMP - 1e-9);
      expect(y).toBeLessThanOrEqual(SEA_LEVEL + SEA_WAVE_MAX_AMP + 1e-9);
    }
  });
});
