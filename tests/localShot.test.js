// tests/localShot.test.js (v0.2.397) — locks the SP local-player hitscan
// resolver. SP now resolves the player's shot as hitscan on the aim ray at fire
// time (matching the MP server path) instead of via the travelling projectile,
// which fixed the long-range / near-object body-shot drops. These tests pin:
//   • SP live-bot hit → { bot, dmg, isHead, toi } with the shared damage/head rules
//   • MP (netMode true) → null (server is authoritative; no double-resolve)
//   • no bot / dead bot / null hit → clean miss (null)
//   • head vs body classification off the aim-ray impact point
import { describe, it, expect } from 'vitest';
import { resolveLocalHitscan } from '../src/engine/combat/localShot.js';
import { HEADSHOT_DAMAGE, BODY_DAMAGE } from '../src/engine/combat/damage.js';
import { BOT_HEAD_CENTRE_Y_OFFSET } from '../src/engine/physics/bodies.js';

// Bot foot at origin; body impact ~chest height, head impact at the head centre.
const bot = { alive: true, name: 'B1', pos: { x: 0, y: 0, z: 0 } };
const bodyHit = { bot, bodyPart: 'body', toi: 12.5, point: { x: 0, y: 1.0, z: 0 } };
const headHit = { bot, bodyPart: 'head', toi: 30.0, point: { x: 0, y: BOT_HEAD_CENTRE_Y_OFFSET, z: 0 } };

describe('resolveLocalHitscan — SP live-bot hit', () => {
  it('body shot resolves to the body damage, not a headshot', () => {
    const r = resolveLocalHitscan(bodyHit, false);
    expect(r).not.toBeNull();
    expect(r.bot).toBe(bot);
    expect(r.isHead).toBe(false);
    expect(r.dmg).toBe(BODY_DAMAGE);
    expect(r.toi).toBe(12.5);
  });

  it('head shot resolves to the headshot damage', () => {
    const r = resolveLocalHitscan(headHit, false);
    expect(r).not.toBeNull();
    expect(r.isHead).toBe(true);
    expect(r.dmg).toBe(HEADSHOT_DAMAGE);
    expect(r.toi).toBe(30.0);
  });

  it('a body-collider impact inside the head sphere is promoted to a headshot', () => {
    const prox = { bot, bodyPart: 'body', toi: 5, point: { x: 0, y: BOT_HEAD_CENTRE_Y_OFFSET, z: 0 } };
    const r = resolveLocalHitscan(prox, false);
    expect(r.isHead).toBe(true);
    expect(r.dmg).toBe(HEADSHOT_DAMAGE);
  });

  it('resolves at long range (aim-ray hitscan is range-independent)', () => {
    const far = { bot, bodyPart: 'body', toi: 78, point: { x: 0, y: 1.0, z: 0 } };
    const r = resolveLocalHitscan(far, false);
    expect(r).not.toBeNull();
    expect(r.dmg).toBe(BODY_DAMAGE);
  });
});

describe('resolveLocalHitscan — no resolution (clean miss / server-authoritative)', () => {
  it('MP (netMode true) resolves nothing — server is authoritative', () => {
    expect(resolveLocalHitscan(bodyHit, true)).toBeNull();
  });

  it('null hit is a clean miss', () => {
    expect(resolveLocalHitscan(null, false)).toBeNull();
  });

  it('a non-bot hit (wall/crate) is a clean miss', () => {
    expect(resolveLocalHitscan({ point: { x: 0, y: 1, z: 0 }, bodyPart: null }, false)).toBeNull();
  });

  it('a dead bot is a clean miss (no damage to corpses)', () => {
    const dead = { alive: false, name: 'D', pos: { x: 0, y: 0, z: 0 } };
    const hit = { bot: dead, bodyPart: 'body', toi: 4, point: { x: 0, y: 1, z: 0 } };
    expect(resolveLocalHitscan(hit, false)).toBeNull();
  });
});
