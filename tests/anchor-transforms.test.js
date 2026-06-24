// tests/anchor-transforms.test.js — pure ANCHOR→TRANSFORM contract for the four
// in-world proof surfaces (anchorTransforms.js, v0.2.149). Covers: every current
// anchor resolves, unknown anchors are reported (not thrown), the transform
// descriptor is plain data of the expected shape, no live-action keys leak onto
// it, and the contract stays consistent with PROOF_SURFACE_SPECS.
import { describe, it, expect } from 'vitest';
import {
  PROOF_SURFACE_ANCHORS,
  ANCHOR_IDS,
  ANCHOR_BADGE,
  getAnchor,
  resolveAnchorTransform,
  resolveAllAnchors,
} from '../src/engine/world/anchorTransforms.js';
import { PROOF_SURFACE_SPECS } from '../src/engine/world/proofSurfaceSpecs.js';

const FORBIDDEN_KEYS = [
  'fetch', 'navigate', 'href', 'url', 'onClick', 'onclick', 'sign', 'publish',
  'checkout', 'pay', 'zap', 'submit', 'relay', 'action', 'actions', 'mesh',
  'geometry', 'material',
];

const isPlainNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isVec3 = (v) =>
  v && typeof v === 'object' && isPlainNum(v.x) && isPlainNum(v.y) && isPlainNum(v.z);

describe('anchorTransforms — registry', () => {
  it('exposes exactly the four current anchor ids', () => {
    expect(ANCHOR_IDS).toEqual([
      'torii-gate-threshold',
      'nap-zone-north-stall',
      'nap-zone-far-centre',
      'nap-zone-south-board',
    ]);
  });

  it('every anchor carries a plain ground origin (y=0), parent, and zone', () => {
    for (const id of ANCHOR_IDS) {
      const a = PROOF_SURFACE_ANCHORS[id];
      expect(a.id).toBe(id);
      expect(isVec3(a.origin)).toBe(true);
      expect(a.origin.y).toBe(0);
      expect(typeof a.parent).toBe('string');
      expect(a.zone).toBe('nap-zone');
    }
  });

  it('getAnchor returns the frozen anchor or null for unknown', () => {
    expect(getAnchor('torii-gate-threshold')).toBe(PROOF_SURFACE_ANCHORS['torii-gate-threshold']);
    expect(getAnchor('does-not-exist')).toBe(null);
    expect(Object.isFrozen(PROOF_SURFACE_ANCHORS)).toBe(true);
  });
});

describe('anchorTransforms — resolveAnchorTransform', () => {
  it('resolves each current spec into a plain-data transform descriptor', () => {
    for (const spec of PROOF_SURFACE_SPECS) {
      const t = resolveAnchorTransform(spec);
      expect(t).not.toBeNull();
      expect(t.surfaceId).toBe(spec.id);
      expect(t.anchor).toBe(spec.anchor);
      expect(t.badge).toBe(ANCHOR_BADGE);
      expect(isVec3(t.origin)).toBe(true);
      expect(isVec3(t.position)).toBe(true);
      expect(isVec3(t.offset)).toBe(true);
      expect(isPlainNum(t.yawRad)).toBe(true);
      expect(isPlainNum(t.size.width)).toBe(true);
      expect(isPlainNum(t.size.height)).toBe(true);
      expect(isPlainNum(t.size.depth)).toBe(true);
      expect(t.rendered).toBe(false);
      expect(t.actionable).toBe(false);
    }
  });

  it('offset = surface position − anchor origin, and position = origin + offset', () => {
    for (const spec of PROOF_SURFACE_SPECS) {
      const t = resolveAnchorTransform(spec);
      const a = getAnchor(spec.anchor);
      expect(t.offset.x).toBe(spec.position.x - a.origin.x);
      expect(t.offset.y).toBe(spec.position.y - a.origin.y);
      expect(t.offset.z).toBe(spec.position.z - a.origin.z);
      expect(t.origin.x + t.offset.x).toBe(spec.position.x);
      expect(t.origin.y + t.offset.y).toBe(spec.position.y);
      expect(t.origin.z + t.offset.z).toBe(spec.position.z);
    }
  });

  it('returns null for an unknown anchor and for bad input', () => {
    expect(resolveAnchorTransform({ id: 'x', anchor: 'nope', position: { x: 0, y: 0, z: 0 }, size: { width: 1, height: 1, depth: 1 }, yawRad: 0 })).toBeNull();
    expect(resolveAnchorTransform(null)).toBeNull();
    expect(resolveAnchorTransform(undefined)).toBeNull();
    expect(resolveAnchorTransform('x')).toBeNull();
  });

  it('produces no live-action keys on the descriptor', () => {
    for (const spec of PROOF_SURFACE_SPECS) {
      const t = resolveAnchorTransform(spec);
      for (const k of FORBIDDEN_KEYS) {
        expect(Object.prototype.hasOwnProperty.call(t, k)).toBe(false);
      }
    }
  });

  it('uses no THREE classes — only plain objects (JSON round-trips)', () => {
    const t = resolveAnchorTransform(PROOF_SURFACE_SPECS[0]);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
    expect(Object.getPrototypeOf(t.origin)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(t.position)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(t.offset)).toBe(Object.prototype);
  });
});

describe('anchorTransforms — resolveAllAnchors', () => {
  it('resolves all four current specs with ok:true and no unresolved', () => {
    const r = resolveAllAnchors();
    expect(r.badge).toBe(ANCHOR_BADGE);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(PROOF_SURFACE_SPECS.length);
    expect(r.resolved).toHaveLength(PROOF_SURFACE_SPECS.length);
    expect(r.unresolved).toEqual([]);
    expect(r.rendered).toBe(false);
    expect(r.actionable).toBe(false);
  });

  it('is deterministic — repeated calls are deeply equal', () => {
    expect(resolveAllAnchors()).toEqual(resolveAllAnchors());
  });

  it('reports unresolved anchors instead of throwing', () => {
    const specs = [
      { id: 'good', anchor: 'torii-gate-threshold', position: { x: 21, y: 2, z: 0 }, size: { width: 1, height: 1, depth: 0.1 }, yawRad: 0 },
      { id: 'bad', anchor: 'mystery-anchor', position: { x: 0, y: 0, z: 0 }, size: { width: 1, height: 1, depth: 0.1 }, yawRad: 0 },
    ];
    const r = resolveAllAnchors(specs);
    expect(r.ok).toBe(false);
    expect(r.count).toBe(2);
    expect(r.resolved).toHaveLength(1);
    expect(r.unresolved).toEqual([{ surfaceId: 'bad', anchor: 'mystery-anchor' }]);
  });

  it('defaults to an empty report for a non-array argument', () => {
    const r = resolveAllAnchors(null);
    expect(r.count).toBe(0);
    expect(r.ok).toBe(true);
    expect(r.resolved).toEqual([]);
  });
});

describe('anchorTransforms — consistency with PROOF_SURFACE_SPECS', () => {
  it('every spec anchor has a matching registry entry', () => {
    for (const spec of PROOF_SURFACE_SPECS) {
      expect(ANCHOR_IDS).toContain(spec.anchor);
    }
  });

  it('every registry anchor is referenced by exactly one spec', () => {
    for (const id of ANCHOR_IDS) {
      const matches = PROOF_SURFACE_SPECS.filter((s) => s.anchor === id);
      expect(matches).toHaveLength(1);
    }
  });
});
