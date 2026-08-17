// tests/proof-surface-specs.test.js — pure LAYOUT/SPEC contracts for the four
// future in-world MVP proof meshes (proofSurfaceSpecs.js, v0.2.147). Asserts the
// spec shape, that positions/sizes are PLAIN data (no THREE classes), the NAP-zone
// placement, the inert invariants, and that no live-action keys leak.
import { describe, it, expect } from 'vitest';
import {
  PROOF_SURFACE_SPECS, PROOF_SURFACE_IDS, PROOF_SURFACE_BADGE,
  getProofSurfaceSpec, proofSurfaceLayout,
} from '../src/engine/world/proofSurfaceSpecs.js';
import { TRAVEL_GATE_X, BRIDGE_X } from '../src/config.js';

const isPlainObject = (o) =>
  o !== null && typeof o === 'object' && Object.getPrototypeOf(o) === Object.prototype;

describe('proofSurfaceSpecs — spec list', () => {
  it('defines the two in-world proof surfaces in MVP-loop order', () => {
    expect(PROOF_SURFACE_SPECS).toHaveLength(2);
    expect(PROOF_SURFACE_IDS).toEqual([
      'product-stall-panel', 'leaderboard-board',
    ]);
    expect(PROOF_SURFACE_SPECS.map((s) => s.step)).toEqual(['MARKET', 'SCORE']);
    expect(PROOF_SURFACE_SPECS.map((s) => s.lean)).toEqual(['LEAN-3', 'LEAN-4']);
  });

  it('maps each surface to its SDK preview namespace + shells report', () => {
    for (const s of PROOF_SURFACE_SPECS) {
      expect(typeof s.previewSdk).toBe('string');
      expect(typeof s.shell).toBe('string');
      expect(typeof s.title).toBe('string');
      expect(typeof s.kind).toBe('string');
      expect(typeof s.anchor).toBe('string');
    }
  });

  it('is frozen all the way down (read-only contract)', () => {
    expect(Object.isFrozen(PROOF_SURFACE_SPECS)).toBe(true);
    for (const s of PROOF_SURFACE_SPECS) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(Object.isFrozen(s.position)).toBe(true);
      expect(Object.isFrozen(s.size)).toBe(true);
      expect(Object.isFrozen(s.invariants)).toBe(true);
    }
  });
});

describe('proofSurfaceSpecs — plain data, no THREE allocations', () => {
  it('positions/sizes are plain objects of finite numbers (not Vector3/Matrix4)', () => {
    for (const s of PROOF_SURFACE_SPECS) {
      expect(isPlainObject(s.position)).toBe(true);
      expect(isPlainObject(s.size)).toBe(true);
      for (const k of ['x', 'y', 'z']) expect(Number.isFinite(s.position[k])).toBe(true);
      for (const k of ['width', 'height', 'depth']) expect(Number.isFinite(s.size[k])).toBe(true);
      expect(Number.isFinite(s.yawRad)).toBe(true);
      // Defensively reject anything THREE-shaped leaking in.
      expect(s.position).not.toHaveProperty('isVector3');
      expect(s.position).not.toHaveProperty('setFromMatrixPosition');
    }
  });

  it('places every surface in the NAP zone (east of the torii gate)', () => {
    for (const s of PROOF_SURFACE_SPECS) {
      expect(s.position.x).toBeGreaterThanOrEqual(-10); // v0.2.521: NAP zone edge
      expect(s.position.x).toBeLessThanOrEqual(10); // v0.2.521: NAP zone edge
      expect(s.size.width).toBeGreaterThan(0);
      expect(s.size.height).toBeGreaterThan(0);
    }
  });
});

describe('proofSurfaceSpecs — inert invariants', () => {
  it('every surface is readOnly:true / actionable:false and never signed/published', () => {
    for (const s of PROOF_SURFACE_SPECS) {
      expect(s.invariants.readOnly).toBe(true);
      expect(s.invariants.actionable).toBe(false);
      expect(s.invariants.signed).not.toBe(true);
      expect(s.invariants.published).not.toBe(true);
    }
    // The leaderboard surface pins signed/published explicitly false.
    const lb = getProofSurfaceSpec('leaderboard-board');
    expect(lb.invariants.signed).toBe(false);
    expect(lb.invariants.published).toBe(false);
  });

  it('exposes NO live-action keys on any spec', () => {
    for (const s of PROOF_SURFACE_SPECS) {
      for (const k of ['fetch', 'navigate', 'href', 'sign', 'publish', 'checkout', 'onClick', 'mesh', 'geometry']) {
        expect(s).not.toHaveProperty(k);
      }
    }
  });
});

describe('proofSurfaceSpecs — getProofSurfaceSpec', () => {
  it('returns the spec by id and null for unknown ids', () => {
    expect(getProofSurfaceSpec('product-stall-panel').step).toBe('MARKET');
    expect(getProofSurfaceSpec('nope')).toBeNull();
    expect(getProofSurfaceSpec()).toBeNull();
  });
});

describe('proofSurfaceSpecs — proofSurfaceLayout', () => {
  it('summarises the two specs with an all-inert gate and NAP-zone bounds', () => {
    const l = proofSurfaceLayout();
    expect(l.count).toBe(2);
    expect(l.anchorZone).toBe('nap-zone');
    expect(l.badge).toBe(PROOF_SURFACE_BADGE);
    expect(l.allInert).toBe(true);
    expect(l.rendered).toBe(false);
    expect(l.actionable).toBe(false);
    expect(l.bounds.minX).toBeGreaterThanOrEqual(-10);
    expect(l.bounds.maxX).toBeLessThanOrEqual(10);
    expect(l.bounds.minZ).toBeLessThanOrEqual(l.bounds.maxZ);
    expect(l.specs).toBe(PROOF_SURFACE_SPECS);
  });

  it('exposes NO live-action keys on the layout summary', () => {
    const l = proofSurfaceLayout();
    for (const k of ['fetch', 'navigate', 'href', 'sign', 'publish', 'checkout', 'onClick']) {
      expect(l).not.toHaveProperty(k);
    }
  });
});
