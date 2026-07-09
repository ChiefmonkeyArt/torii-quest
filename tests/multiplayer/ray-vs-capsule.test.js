// ray-vs-capsule.test.js — MP-2 analytic ray tests + rayVsPeer classifier.
import { describe, it, expect } from 'vitest';
import {
  intersectSphere,
  intersectCapsule,
  rayVsPeer,
} from '../../server/combat/rayVsCapsule.js';
import { buildColliders } from '../../server/combat/capsuleModel.js';

describe('ray vs sphere (MP-2)', () => {
  it('centred head-on hit returns t = distance to surface', () => {
    // Shooter at origin looking +x, sphere at (5, 0, 0) r=1 → hit at t=4.
    const res = intersectSphere([0, 0, 0], [1, 0, 0], { c: [5, 0, 0], r: 1 });
    expect(res.hit).toBe(true);
    expect(res.t).toBeCloseTo(4, 6);
    expect(res.point[0]).toBeCloseTo(4, 6);
  });

  it('ray missing the sphere returns hit=false', () => {
    const res = intersectSphere([0, 0, 0], [1, 0, 0], { c: [5, 10, 0], r: 1 });
    expect(res.hit).toBe(false);
  });

  it('ray pointing away from sphere is a miss (no negative-t hits)', () => {
    const res = intersectSphere([0, 0, 0], [-1, 0, 0], { c: [5, 0, 0], r: 1 });
    expect(res.hit).toBe(false);
  });
});

describe('ray vs capsule (MP-2)', () => {
  // Peer at (0, 1.7, 5): foot y=0, body cap p0=(0,0.26,5), p1=(0,1.26,5), r=0.26.
  const peer = buildColliders({ pos: [0, 1.7, 5] });

  it('centre-mass shot along +z hits the body cap', () => {
    const res = intersectCapsule([0, 0.76, 0], [0, 0, 1], peer.bodyCap);
    expect(res.hit).toBe(true);
    expect(res.t).toBeCloseTo(5 - 0.26, 5);
  });

  it('shot passing under the capsule (foot cap) still hits the hemisphere', () => {
    // Aim just above foot at y=0.30 → within the bottom hemisphere sphere at p0.
    const res = intersectCapsule([0, 0.30, 0], [0, 0, 1], peer.bodyCap);
    expect(res.hit).toBe(true);
  });

  it('shot below the foot misses cleanly', () => {
    const res = intersectCapsule([0, -0.5, 0], [0, 0, 1], peer.bodyCap);
    expect(res.hit).toBe(false);
  });
});

describe('rayVsPeer classifier (MP-2)', () => {
  const peer = buildColliders({ pos: [0, 1.7, 5] }); // foot 0, head centre 1.55

  it('shot at head height classifies as head', () => {
    const res = rayVsPeer([0, 1.55, 0], [0, 0, 1], peer);
    expect(res.hit).toBe(true);
    expect(res.zone).toBe('head');
  });

  it('shot at body centre classifies as body', () => {
    const res = rayVsPeer([0, 0.76, 0], [0, 0, 1], peer);
    expect(res.hit).toBe(true);
    expect(res.zone).toBe('body');
  });

  it('head-body overlap zone: head wins on equal-or-closer t', () => {
    // At y≈1.5, both the head sphere (extends to y=1.35..1.75) and the body cap
    // top (radius sphere around p1=1.26, extends to y up to 1.52) are candidates.
    // Head is *at* the ray line, so head should win.
    const res = rayVsPeer([0, 1.50, 0], [0, 0, 1], peer);
    expect(res.hit).toBe(true);
    expect(res.zone).toBe('head');
  });

  it('total miss returns hit=false, zone=null', () => {
    const res = rayVsPeer([100, 100, 0], [0, 1, 0], peer);
    expect(res.hit).toBe(false);
    expect(res.zone).toBeNull();
  });

  it('unnormalised ray dir still resolves via internal normalisation', () => {
    // Scale ray dir by 7 — should give same t (in metric distance).
    const a = rayVsPeer([0, 0.76, 0], [0, 0, 1], peer);
    const b = rayVsPeer([0, 0.76, 0], [0, 0, 7], peer);
    expect(a.hit).toBe(true);
    expect(b.hit).toBe(true);
    expect(a.t).toBeCloseTo(b.t, 4);
  });
});
