// tests/multiplayer/headless-los.test.js — the PURE headless line-of-sight used
// by the server bot sim (server/bots/headlessLos.js). The server has NO Rapier,
// so LOS is a 2D top-down segment-vs-AABB test over the tall arena boxes at eye
// height. Boxes shorter than the ray height are shot over (not blockers).
import { describe, it, expect } from 'vitest';
import { segmentIntersectsAabb, createHeadlessLos } from '../../server/bots/headlessLos.js';

describe('segmentIntersectsAabb', () => {
  // Unit box footprint centred at origin: x,z in [-1,1].
  const box = [0, 0, 1, 1];

  it('a segment passing straight through the box intersects', () => {
    expect(segmentIntersectsAabb(-5, 0, 5, 0, ...box)).toBe(true);
  });

  it('a parallel segment clear of the box misses', () => {
    expect(segmentIntersectsAabb(-5, 5, 5, 5, ...box)).toBe(false);
  });

  it('a segment entirely to one side misses', () => {
    expect(segmentIntersectsAabb(2, -5, 2, 5, ...box)).toBe(false);
  });

  it('an endpoint inside the box counts as intersecting', () => {
    expect(segmentIntersectsAabb(0, 0, 10, 10, ...box)).toBe(true);
  });

  it('a diagonal that clips a corner intersects', () => {
    expect(segmentIntersectsAabb(-0.5, -2, 1.5, 0, ...box)).toBe(true);
  });
});

describe('createHeadlessLos', () => {
  const EYE_Y = 0.9;
  // A tall wall box (fullH 2 > eyeY) at the origin; a short crate (fullH 0.5)
  // off to the side that must NOT block at eye height.
  const boxes = [
    [0, 0, 1, 1, 2.0],   // tall — blocker
    [10, 0, 1, 1, 0.5],  // short — never a blocker at EYE_Y
  ];
  const los = createHeadlessLos(boxes, EYE_Y);

  it('blocks a sightline crossing a tall box', () => {
    expect(los(-5, EYE_Y, 0, 5, EYE_Y, 0)).toBe(false);
  });

  it('passes a sightline that clears every tall box', () => {
    expect(los(-5, EYE_Y, 5, 5, EYE_Y, 5)).toBe(true);
  });

  it('shoots OVER a box shorter than eye height', () => {
    // Ray straight through the short crate's footprint — but it is too low to occlude.
    expect(los(5, EYE_Y, 0, 15, EYE_Y, 0)).toBe(true);
  });

  it('is clear on an empty arena', () => {
    const empty = createHeadlessLos([], EYE_Y);
    expect(empty(-100, EYE_Y, -100, 100, EYE_Y, 100)).toBe(true);
  });
});
