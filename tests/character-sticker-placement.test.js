// tests/character-sticker-placement.test.js — locks the sticker-placement model
// (src/engine/character/stickerPlacement.js). Pure → fully node-testable.
import { describe, it, expect } from 'vitest';
import {
  STICKER_PLACEMENT_VERSION,
  MAX_STICKERS,
  STICKER_ZONES,
  STICKER_LIBRARY,
  isKnownZone,
  getStickerZone,
  resolveRoleZone,
  resolveZoneFromRoles,
  resolveZoneFromBoneNames,
  normalizeUv,
  normalizeRotation,
  normalizeStickerPlacement,
  addSticker,
  removeSticker,
  updateSticker,
  countStickers,
} from '../src/engine/character/stickerPlacement.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'c'.repeat(64);
const manifestWithMesh = (stickers = []) => ({
  version: 1,
  mesh: { hash: 'a'.repeat(64), name: 'avatar.glb' },
  clips: [],
  stickers,
  name: 'Tester',
  colors: [],
  contrib: [],
});

describe('zone registry', () => {
  it('exposes a frozen version + zone set covering every major body region', () => {
    expect(STICKER_PLACEMENT_VERSION).toBe(1);
    expect(Object.isFrozen(STICKER_ZONES)).toBe(true);
    expect(STICKER_ZONES.length).toBeGreaterThanOrEqual(8);
    expect(STICKER_ZONES.some((z) => z.id === 'torso')).toBe(true);
  });

  it('isKnownZone / getStickerZone resolve cleanly', () => {
    expect(isKnownZone('torso')).toBe(true);
    expect(isKnownZone('nope')).toBe(false);
    expect(isKnownZone(null)).toBe(false);
    expect(getStickerZone('head').label).toBe('Head');
    expect(getStickerZone('missing')).toBe(null);
  });

  it('maps canonical roles to zones', () => {
    expect(resolveRoleZone('Head')).toBe('head');
    expect(resolveRoleZone('Spine')).toBe('torso');
    expect(resolveRoleZone('RightHand')).toBe('right-hand');
    expect(resolveRoleZone('LeftToe')).toBe('left-foot');
    expect(resolveRoleZone('MadeUpRole')).toBe(null);
    expect(resolveZoneFromRoles(['Unknown', 'Spine'])).toBe('torso');
    expect(resolveZoneFromRoles([])).toBe(null);
    expect(resolveZoneFromRoles(null)).toBe(null);
  });

  it('resolves a zone from Mixamo bone names', () => {
    expect(resolveZoneFromBoneNames(['mixamorigSpine', 'mixamorigSpine1'])).toBe('torso');
    expect(resolveZoneFromBoneNames(['mixamorigHead'])).toBe('head');
    expect(resolveZoneFromBoneNames(['completelyUnknownBone'])).toBe(null);
    expect(resolveZoneFromBoneNames(null)).toBe(null);
    expect(resolveZoneFromBoneNames([])).toBe(null);
  });
});

describe('placement normalisation', () => {
  it('clamps u/v and wraps rotation', () => {
    expect(normalizeUv(0.5)).toBe(0.5);
    expect(normalizeUv(1.5)).toBe(1);
    expect(normalizeUv(-0.5)).toBe(0);
    expect(normalizeUv('nope')).toBe(0.5);
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(Math.PI * 2.5)).toBeCloseTo(Math.PI * 0.5);
    expect(normalizeRotation(-Math.PI / 2)).toBeCloseTo(Math.PI * 1.5);
    expect(normalizeRotation(undefined)).toBe(0);
  });

  it('rejects an invalid hash or zone', () => {
    expect(normalizeStickerPlacement({ hash: 'x', zoneId: 'torso' })).toBe(null);
    expect(normalizeStickerPlacement({ hash: SHA, zoneId: 'not-a-zone' })).toBe(null);
    expect(normalizeStickerPlacement(null)).toBe(null);
  });

  it('normalises a valid placement (lowercases hash, clamps u/v/rot)', () => {
    const p = normalizeStickerPlacement({ hash: SHA.toUpperCase(), zoneId: 'torso', u: 2, v: -1, rot: 99 });
    expect(p.hash).toBe(SHA);
    expect(p.zoneId).toBe('torso');
    expect(p.u).toBe(1);
    expect(p.v).toBe(0);
    expect(p.rot).toBeCloseTo(99 % (Math.PI * 2));
  });
});

describe('immutable manifest operations', () => {
  it('addSticker appends without mutating the input', () => {
    const m = manifestWithMesh();
    const next = addSticker(m, { hash: SHA, zoneId: 'torso', u: 0.5, v: 0.5, rot: 0 });
    expect(next).not.toBe(m);
    expect(m.stickers).toEqual([]);
    expect(countStickers(next)).toBe(1);
    expect(next.stickers[0].zoneId).toBe('torso');
  });

  it('addSticker rejects invalid placement / non-object manifest', () => {
    const m = manifestWithMesh();
    expect(addSticker(m, { hash: 'bad', zoneId: 'torso' })).toBe(m);
    expect(addSticker(null, { hash: SHA, zoneId: 'torso' })).toBe(null);
  });

  it('removeSticker drops by index, out-of-range is a no-op', () => {
    const m = manifestWithMesh([{ hash: SHA, zoneId: 'head', u: 0, v: 0, rot: 0 }]);
    const next = removeSticker(m, 0);
    expect(countStickers(next)).toBe(0);
    expect(countStickers(m)).toBe(1); // input untouched
    expect(removeSticker(m, 1)).toBe(m);
    expect(removeSticker(m, -1)).toBe(m);
    expect(removeSticker(m, 1.5)).toBe(m);
  });

  it('updateSticker patches only the fields provided', () => {
    const m = manifestWithMesh([{ hash: SHA, zoneId: 'head', u: 0, v: 0, rot: 0 }]);
    const next = updateSticker(m, 0, { u: 0.9, rot: Math.PI });
    expect(next.stickers[0].hash).toBe(SHA);
    expect(next.stickers[0].zoneId).toBe('head');
    expect(next.stickers[0].u).toBe(0.9);
    expect(next.stickers[0].v).toBe(0);
    expect(next.stickers[0].rot).toBeCloseTo(Math.PI);
    expect(m.stickers[0].u).toBe(0); // input untouched
  });

  it('updateSticker rejects a patch that breaks validity', () => {
    const m = manifestWithMesh([{ hash: SHA, zoneId: 'head', u: 0, v: 0, rot: 0 }]);
    expect(updateSticker(m, 0, { hash: 'not-a-hash' })).toBe(m);
    expect(updateSticker(m, 0, { zoneId: 'nope' })).toBe(m);
  });

  it('enforces MAX_STICKERS', () => {
    let m = manifestWithMesh();
    for (let i = 0; i < MAX_STICKERS; i++) {
      m = addSticker(m, { hash: SHA, zoneId: 'torso', u: 0.5, v: 0.5, rot: 0 });
    }
    expect(countStickers(m)).toBe(MAX_STICKERS);
    expect(addSticker(m, { hash: SHA, zoneId: 'torso', u: 0, v: 0, rot: 0 })).toBe(m);
  });
});

describe('curated sticker library', () => {
  it('every entry carries a valid sha256 + a known recommended zone', () => {
    expect(STICKER_LIBRARY.length).toBeGreaterThan(0);
    for (const s of STICKER_LIBRARY) {
      expect(s.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(isKnownZone(s.recommendedZone)).toBe(true);
    }
  });
});

describe('SDK exposure', () => {
  it('is exported at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.stickerPlacement.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.stickerPlacement.addSticker).toBe('function');
    expect(typeof SDK.stickerPlacement.resolveZoneFromBoneNames).toBe('function');
  });
});