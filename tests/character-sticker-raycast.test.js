// tests/character-sticker-raycast.test.js — locks the hit→placement conversion
// (src/engine/character/stickerRaycast.js). Pure → fully node-testable.
import { describe, it, expect } from 'vitest';
import {
  STICKER_RAYCAST_VERSION,
  normalizeRaycastHit,
  rotationFromNormal,
  placementFromRaycastHit,
} from '../src/engine/character/stickerRaycast.js';
import * as SDK from '../src/sdk/index.js';

const mixamoHit = (over) => ({
  boneNames: ['mixamorigSpine', 'mixamorigSpine1'],
  uv: { u: 0.4, v: 0.6 },
  normal: { x: 0, y: 0, z: 1 },
  point: { x: 0, y: 1.2, z: 0.5 },
  ...over,
});

describe('hit normalisation', () => {
  it('requires bones, normalises across substrates', () => {
    expect(STICKER_RAYCAST_VERSION).toBe(1);
    const h = normalizeRaycastHit(mixamoHit());
    expect(h.boneNames).toEqual(['mixamorigSpine', 'mixamorigSpine1']);
    expect(h.uv).toEqual({ u: 0.4, v: 0.6 });
    expect(h.normal).toEqual({ x: 0, y: 0, z: 1 });
    expect(normalizeRaycastHit({ boneNames: [], uv: { u: 0, v: 0 } })).toBe(null);
    expect(normalizeRaycastHit(null)).toBe(null);
    expect(normalizeRaycastHit({ uv: { u: 0, v: 0 } })).toBe(null);
  });

  it('tolerates missing optional fields', () => {
    const h = normalizeRaycastHit({ boneNames: ['mixamorigHead'] });
    expect(h.uv).toBe(null);
    expect(h.normal).toBe(null);
    expect(h.point).toBe(null);
  });
});

describe('rotation from normal', () => {
  it('derives azimuth and normalises to [0, 2π)', () => {
    expect(rotationFromNormal({ x: 0, y: 0, z: 1 })).toBeCloseTo(0);
    expect(rotationFromNormal({ x: 1, y: 0, z: 0 })).toBeCloseTo(Math.PI / 2);
    expect(rotationFromNormal({ x: 0, y: 1, z: 0 })).toBeCloseTo(rotationFromNormal({ x: 0, y: 0, z: 0 }));
    expect(rotationFromNormal({ x: 0, y: 1, z: 0 }, 0.7)).toBeCloseTo(0.7);
    expect(rotationFromNormal(null)).toBe(0);
  });
});

describe('placement from hit', () => {
  it('resolves the zone from bones and passes uv/rot through', () => {
    const p = placementFromRaycastHit(mixamoHit());
    expect(p.zoneId).toBe('torso');
    expect(p.u).toBe(0.4);
    expect(p.v).toBe(0.6);
    expect(p.rot).toBeCloseTo(0);
  });

  it('falls back to zone centre u/v without a UV', () => {
    const p = placementFromRaycastHit({ boneNames: ['mixamorigHead'] });
    expect(p.zoneId).toBe('head');
    expect(p.u).toBe(0.5);
    expect(p.v).toBe(0.5);
  });

  it('clamps out-of-range uv', () => {
    const p = placementFromRaycastHit(mixamoHit({ uv: { u: 3, v: -1 } }));
    expect(p.u).toBe(1);
    expect(p.v).toBe(0);
  });

  it('returns null for a hit whose bones map to no zone', () => {
    expect(placementFromRaycastHit({ boneNames: ['utterlyUnknown'] })).toBe(null);
  });
});

describe('SDK exposure', () => {
  it('is exported at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.stickerRaycast.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.stickerRaycast.placementFromRaycastHit).toBe('function');
  });
});