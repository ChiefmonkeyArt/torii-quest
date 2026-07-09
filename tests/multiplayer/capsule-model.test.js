// capsule-model.test.js — MP-2 parity of server colliders with shipped client bodies.js.
import { describe, it, expect } from 'vitest';
import {
  buildColliders,
  BODY_HALF_H,
  BODY_RADIUS,
  BODY_CENTRE_Y,
  HEAD_RADIUS,
  HEAD_CENTRE_Y,
  EYE_HEIGHT,
} from '../../server/combat/capsuleModel.js';

describe('capsuleModel (MP-2)', () => {
  it('exports match shipped client constants (bodies.js parity)', () => {
    // Shipped values — DO NOT change without also bumping bodies.js.
    expect(BODY_HALF_H).toBe(0.50);
    expect(BODY_RADIUS).toBe(0.26);
    expect(BODY_CENTRE_Y).toBe(0.76);
    expect(HEAD_RADIUS).toBe(0.20);
    expect(HEAD_CENTRE_Y).toBe(1.55);
    expect(EYE_HEIGHT).toBe(1.7);
  });

  it('body capsule endpoints span foot→top, with radius', () => {
    // Peer at eye-level (10, 1.7 + 3, 5) → foot at y=3.
    const c = buildColliders({ pos: [10, 4.7, 5] });
    // foot=3.0; p0.y=foot+r=3.26; p1.y=foot+r+2*half=3.26+1.0=4.26
    expect(c.bodyCap.p0).toEqual([10, 3.26, 5]);
    expect(c.bodyCap.p1).toEqual([10, 4.26, 5]);
    expect(c.bodyCap.r).toBe(BODY_RADIUS);
  });

  it('head sphere centre = foot + HEAD_CENTRE_Y', () => {
    const c = buildColliders({ pos: [0, EYE_HEIGHT + 5, 0] }); // foot=5
    // head centre = 5 + 1.55 = 6.55
    expect(c.headSphere.c[1]).toBeCloseTo(6.55, 6);
    expect(c.headSphere.r).toBe(HEAD_RADIUS);
  });

  it('foot derivation is idempotent under x/z translation', () => {
    const a = buildColliders({ pos: [-3, 10.7, 7] }); // foot=9
    expect(a.bodyCap.p0).toEqual([-3, 9.26, 7]);
    expect(a.headSphere.c).toEqual([-3, 10.55, 7]);
  });
});
