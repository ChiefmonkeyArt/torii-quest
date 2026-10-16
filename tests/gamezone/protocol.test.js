// tests/gamezone/protocol.test.js — Game Zone v2 wire shapes (ADR-0130).
// Strict, bounded validators so a hostile client cannot make the authority
// allocate or loop, wired into the shared wireProtocol decode().
import { describe, it, expect } from 'vitest';
import {
  GZ_MSG, validateFire, validateSnap, validateEvent, eventForWire, legacyBotRows,
} from '../../src/gamezone/core/protocol.js';
import { MSG, encode, decode, sanitize, PROTOCOL_VERSION } from '../../src/engine/multiplayer/wireProtocol.js';

const FIRE = { seq: 3, origin: [1, 1.7, 2], dir: [0, 0, 1], rt: 120.5 };

describe('validateFire', () => {
  it('accepts a claimless and a claimed shot', () => {
    expect(validateFire(FIRE)).toBeNull();
    expect(validateFire({ ...FIRE, claim: { k: 'bot', id: 2, zone: 'head', dist: 12.3 } })).toBeNull();
    expect(validateFire({ ...FIRE, claim: { k: 'player', id: 'abc', zone: 'body', dist: 4 } })).toBeNull();
  });
  it.each([
    [{ seq: -1 }, 'seq'], [{ seq: 1.5 }, 'seq'],
    [{ origin: [0, 0] }, 'origin'], [{ origin: [0, NaN, 0] }, 'origin'], [{ origin: [1e6, 0, 0] }, 'origin'],
    [{ dir: [0, 0, 9] }, 'dir'], [{ dir: 'x' }, 'dir'],
    [{ rt: -1 }, 'rt'], [{ rt: Infinity }, 'rt'],
    [{ claim: 5 }, 'claim'],
    [{ claim: { k: 'tree', id: 1, zone: 'head', dist: 1 } }, 'claim.k'],
    [{ claim: { k: 'bot', id: 1000, zone: 'head', dist: 1 } }, 'claim.id'],
    [{ claim: { k: 'bot', id: '1', zone: 'head', dist: 1 } }, 'claim.id'],
    [{ claim: { k: 'player', id: 'x'.repeat(33), zone: 'head', dist: 1 } }, 'claim.id'],
    [{ claim: { k: 'bot', id: 1, zone: 'leg', dist: 1 } }, 'claim.zone'],
    [{ claim: { k: 'bot', id: 1, zone: 'head', dist: 501 } }, 'claim.dist'],
  ])('rejects %j → %s', (patch, reason) => {
    expect(validateFire({ ...FIRE, ...patch })).toBe(reason);
  });
});

describe('validateSnap / validateEvent', () => {
  const row = [0, 0, 1, 0, 2, 0.5, 5, 0, 1, 0];
  it('accepts well-formed frames', () => {
    expect(validateSnap({ tick: 4, b: [row] })).toBeNull();
    expect(validateEvent({ tick: 4, ev: [{ type: 'kill' }, { type: 'result' }] })).toBeNull();
  });
  it('bounds row count, row width, numbers and positions', () => {
    expect(validateSnap({ tick: -1, b: [] })).toBe('tick');
    expect(validateSnap({ tick: 1, b: new Array(65).fill(row) })).toBe('b');
    expect(validateSnap({ tick: 1, b: [row.slice(0, 9)] })).toBe('b[row]');
    expect(validateSnap({ tick: 1, b: [[...row.slice(0, 9), NaN]] })).toBe('b[num]');
    expect(validateSnap({ tick: 1, b: [[1000, ...row.slice(1)]] })).toBe('b[id]');
    expect(validateSnap({ tick: 1, b: [[0, 0, 9999, ...row.slice(3)]] })).toBe('b[pos]');
    expect(validateEvent({ tick: 1, ev: new Array(257).fill({ type: 'shot' }) })).toBe('ev');
    expect(validateEvent({ tick: 1, ev: [{ type: 'teleport' }] })).toBe('ev[type]');
  });
  it('eventForWire strips undefined; legacyBotRows maps for older spectators', () => {
    expect(eventForWire({ type: 'result', ok: true, reason: undefined })).toEqual({ type: 'result', ok: true });
    expect(legacyBotRows({ b: [row, [1, 1, 3, 0, 4, 0, 0, 1, 6, 2]] })).toEqual([
      { id: 0, x: 1, z: 2, rotY: 0.5, hp: 5, alive: true, animHint: 'walk' },
      { id: 1, x: 3, z: 4, rotY: 0, hp: 0, alive: false, animHint: 'die' },
    ]);
  });
});

describe('wireProtocol integration', () => {
  it('GZ messages are additive on PROTOCOL_VERSION 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    expect([MSG.GZ_FIRE, MSG.GZ_SNAP, MSG.GZ_EVENT]).toEqual([GZ_MSG.FIRE, GZ_MSG.SNAP, GZ_MSG.EVENT]);
  });
  it('round-trips GZ_FIRE and rejects a malformed one', () => {
    const raw = encode({ t: MSG.GZ_FIRE, ...FIRE, claim: { k: 'bot', id: 1, zone: 'body', dist: 3 } });
    expect(decode(raw)).toMatchObject({ ok: true, msg: { t: MSG.GZ_FIRE, seq: 3 } });
    expect(decode(JSON.stringify({ t: MSG.GZ_FIRE, ...FIRE, dir: [0, 0] }))).toMatchObject({ ok: false, code: 'BAD_FIELD' });
  });
  it('sanitize drops injected fields from GZ_FIRE', () => {
    const out = sanitize({ t: MSG.GZ_FIRE, ...FIRE, godMode: true, dmg: 999 });
    expect(out).toEqual({ t: MSG.GZ_FIRE, ...FIRE });
  });
});
