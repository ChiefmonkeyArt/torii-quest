// tests/sticker-render-mode.test.js — locks the sticker render-mode model
// (src/engine/character/stickerRenderMode.js): the baked-vs-plane eligibility
// predicate, the A/B override, and the runtime mode chooser.
import { describe, it, expect } from 'vitest';
import {
  STICKER_RENDER_MODE, createStickerRenderState, isBakedEligible,
  chooseStickerRenderMode, setForcePlaneMode,
} from '../src/engine/character/stickerRenderMode.js';

const face = () => ({ a: 0, b: 1, c: 2, normal: { x: 0, y: 1, z: 0 } });
const staticMeshHit = () => ({
  object: { isMesh: true },
  face: face(),
  point: { x: 0, y: 0, z: 0 },
});
const skinnedMeshHit = () => ({
  object: { isMesh: true, isSkinnedMesh: true },
  face: face(),
});
const instancedMeshHit = () => ({
  object: { isMesh: true, isInstancedMesh: true },
  face: face(),
  instanceId: 42,
});

describe('STICKER_RENDER_MODE', () => {
  it('is a frozen two-value enum', () => {
    expect(Object.isFrozen(STICKER_RENDER_MODE)).toBe(true);
    expect(STICKER_RENDER_MODE.BAKED).toBe('baked');
    expect(STICKER_RENDER_MODE.PLANE).toBe('plane');
  });
});

describe('createStickerRenderState', () => {
  it('starts with baking on (forcePlaneMode false)', () => {
    const s = createStickerRenderState();
    expect(s.forcePlaneMode).toBe(false);
  });

  it('returns independent instances', () => {
    const a = createStickerRenderState();
    const b = createStickerRenderState();
    a.forcePlaneMode = true;
    expect(b.forcePlaneMode).toBe(false);
  });
});

describe('isBakedEligible', () => {
  it('accepts a static Mesh hit with a face', () => {
    expect(isBakedEligible(staticMeshHit())).toBe(true);
  });

  it('rejects a SkinnedMesh hit (bone-parented path)', () => {
    expect(isBakedEligible(skinnedMeshHit())).toBe(false);
  });

  it('rejects an InstancedMesh hit (shared geometry — plane per instance)', () => {
    expect(isBakedEligible(instancedMeshHit())).toBe(false);
  });

  it('rejects a hit with no face', () => {
    const h = staticMeshHit();
    h.face = null;
    expect(isBakedEligible(h)).toBe(false);
  });

  it('rejects a hit whose object is not a Mesh', () => {
    expect(isBakedEligible({ object: { isMesh: false }, face: face() })).toBe(false);
    expect(isBakedEligible({ object: null, face: face() })).toBe(false);
  });

  it('rejects garbage input without throwing', () => {
    expect(isBakedEligible(null)).toBe(false);
    expect(isBakedEligible(undefined)).toBe(false);
    expect(isBakedEligible('x')).toBe(false);
    expect(isBakedEligible({})).toBe(false);
  });
});

describe('chooseStickerRenderMode', () => {
  it('picks BAKED for an eligible hit and a default state', () => {
    const s = createStickerRenderState();
    expect(chooseStickerRenderMode(staticMeshHit(), s)).toBe('baked');
  });

  it('picks PLANE for an ineligible hit even when baking is not forced off', () => {
    const s = createStickerRenderState();
    expect(chooseStickerRenderMode(skinnedMeshHit(), s)).toBe('plane');
    expect(chooseStickerRenderMode(instancedMeshHit(), s)).toBe('plane');
  });

  it('forcePlaneMode overrides every eligible hit to PLANE', () => {
    const s = createStickerRenderState();
    setForcePlaneMode(s, true);
    expect(chooseStickerRenderMode(staticMeshHit(), s)).toBe('plane');
    expect(chooseStickerRenderMode(skinnedMeshHit(), s)).toBe('plane');
    expect(chooseStickerRenderMode(instancedMeshHit(), s)).toBe('plane');
  });

  it('tolerates a missing state (defaults to eligibility only)', () => {
    expect(chooseStickerRenderMode(staticMeshHit(), null)).toBe('baked');
    expect(chooseStickerRenderMode(staticMeshHit(), undefined)).toBe('baked');
    expect(chooseStickerRenderMode(skinnedMeshHit())).toBe('plane');
  });
});

describe('setForcePlaneMode', () => {
  it('coerces to boolean and returns the new value', () => {
    const s = createStickerRenderState();
    expect(setForcePlaneMode(s, 1)).toBe(true);
    expect(s.forcePlaneMode).toBe(true);
    expect(setForcePlaneMode(s, 0)).toBe(false);
    expect(s.forcePlaneMode).toBe(false);
    expect(setForcePlaneMode(s, 'yes')).toBe(true);
    expect(setForcePlaneMode(s, '')).toBe(false);
  });

  it('is safe on a missing state', () => {
    expect(setForcePlaneMode(null, true)).toBe(false);
    expect(setForcePlaneMode(undefined, true)).toBe(false);
  });
});