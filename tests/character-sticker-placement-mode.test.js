// tests/character-sticker-placement-mode.test.js — locks the in-world placement
// state machine (src/engine/character/stickerPlacementMode.js). Pure → node-safe.
import { describe, it, expect } from 'vitest';
import {
  STICKER_PLACEMENT_MODE_VERSION,
  PLACEMENT_PHASE,
  initialPlacementModeState,
  enterPlacementMode,
  aimPlacement,
  confirmPlacement,
  cancelPlacement,
  resetPlacementMode,
  placementToManifest,
} from '../src/engine/character/stickerPlacementMode.js';
import * as SDK from '../src/sdk/index.js';

const SHA = 'e'.repeat(64);
const manifest = () => ({ version: 1, mesh: { hash: 'a'.repeat(64), name: 'm' }, clips: [], stickers: [], name: '', colors: [], contrib: [] });
const torsoHit = { boneNames: ['mixamorigSpine'], uv: { u: 0.5, v: 0.5 }, normal: { x: 0, y: 0, z: 1 } };

describe('placement-mode state machine', () => {
  it('starts inactive, enters aiming', () => {
    expect(STICKER_PLACEMENT_MODE_VERSION).toBe(1);
    expect(initialPlacementModeState().phase).toBe(PLACEMENT_PHASE.INACTIVE);
    expect(enterPlacementMode().phase).toBe(PLACEMENT_PHASE.AIMING);
  });

  it('aim → placing only when the hit resolves to a zone AND a hash is set', () => {
    const aiming = enterPlacementMode();
    const placing = aimPlacement(aiming, torsoHit, SHA);
    expect(placing.phase).toBe(PLACEMENT_PHASE.PLACING);
    expect(placing.draft.zoneId).toBe('torso');
    expect(placing.draft.hash).toBe(SHA);
    // a hit with no resolvable zone stays aiming
    expect(aimPlacement(aiming, { boneNames: ['nope'] }, SHA).phase).toBe(PLACEMENT_PHASE.AIMING);
    // a resolvable hit without a valid hash stays aiming
    expect(aimPlacement(aiming, torsoHit, 'not-a-hash').phase).toBe(PLACEMENT_PHASE.AIMING);
  });

  it('confirm requires a draft; cancel always cancels', () => {
    const placing = aimPlacement(enterPlacementMode(), torsoHit, SHA);
    expect(confirmPlacement(placing).phase).toBe(PLACEMENT_PHASE.CONFIRMED);
    expect(confirmPlacement(enterPlacementMode()).phase).toBe(PLACEMENT_PHASE.AIMING);
    expect(cancelPlacement(placing).phase).toBe(PLACEMENT_PHASE.CANCELLED);
    expect(cancelPlacement(placing).draft).toBe(null);
    expect(resetPlacementMode().phase).toBe(PLACEMENT_PHASE.INACTIVE);
  });

  it('transitions return NEW immutable states (no mutation)', () => {
    const a = enterPlacementMode();
    const b = aimPlacement(a, torsoHit, SHA);
    expect(a).not.toBe(b);
    expect(a.phase).toBe(PLACEMENT_PHASE.AIMING);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(b)).toBe(true);
  });
});

describe('placementToManifest', () => {
  it('applies a confirmed draft via addSticker', () => {
    const confirmed = confirmPlacement(aimPlacement(enterPlacementMode(), torsoHit, SHA));
    const next = placementToManifest(confirmed, manifest());
    expect(next.stickers.length).toBe(1);
    expect(next.stickers[0].zoneId).toBe('torso');
    expect(next.stickers[0].hash).toBe(SHA);
  });

  it('is a no-op without a confirmed draft', () => {
    const aiming = enterPlacementMode();
    const m = manifest();
    expect(placementToManifest(aiming, m)).toBe(m);
  });
});

describe('SDK exposure', () => {
  it('is exported at the experimental tier', () => {
    expect(SDK.SDK_SURFACE.stickerPlacementMode.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.stickerPlacementMode.aimPlacement).toBe('function');
    expect(typeof SDK.stickerPlacementMode.placementToManifest).toBe('function');
  });
});