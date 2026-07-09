// respawn-wire.test.js — MP-2 RESPAWN wire message encode/decode/validate lock.
//
// RESPAWN is additive to PROTOCOL_VERSION=1: server → victim only.
// Fields: pos [x,y,z], rot [yaw,pitch], hp (0-9999).
//
// API contract (matches wire-protocol.test.js patterns):
//   encode(msg)   → JSON string (throws on unknown t)
//   decode(raw)   → { ok:true, msg } | { ok:false, error, code }   (validates fields)
//   sanitize(m)   → new object with only ALLOWED_FIELDS[m.t]
import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION,
  MSG,
  encode,
  decode,
  sanitize,
  isKnownType,
} from '../../src/engine/multiplayer/wireProtocol.js';

const goodRespawn = () => ({
  t: MSG.RESPAWN,
  pos: [14, 3.1, 14],
  rot: [0, 0],
  hp: 100,
});

describe('RESPAWN wire message (MP-2, protocol v1 additive)', () => {
  it('PROTOCOL_VERSION unchanged (still 1) — RESPAWN is additive', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });

  it('MSG.RESPAWN is registered and known', () => {
    expect(MSG.RESPAWN).toBe('RESPAWN');
    expect(isKnownType('RESPAWN')).toBe(true);
  });

  it('encodes and decodes a valid RESPAWN payload', () => {
    const wire = encode(goodRespawn());
    expect(typeof wire).toBe('string');
    const back = decode(wire);
    expect(back.ok).toBe(true);
    expect(back.msg.t).toBe(MSG.RESPAWN);
    expect(back.msg.pos).toEqual([14, 3.1, 14]);
    expect(back.msg.hp).toBe(100);
  });

  it('sanitize strips unknown fields, leaves pos/rot/hp', () => {
    const raw = { ...goodRespawn(), secret: 'x', dmg: 999 };
    const s = sanitize(raw);
    expect(s.t).toBe(MSG.RESPAWN);
    expect(s.pos).toEqual([14, 3.1, 14]);
    expect(s.rot).toEqual([0, 0]);
    expect(s.hp).toBe(100);
    expect(s.secret).toBeUndefined();
    expect(s.dmg).toBeUndefined();
  });

  it('decode rejects bad pos (short vector)', () => {
    const r = decode({ ...goodRespawn(), pos: [0, 1.7] });
    expect(r.ok).toBe(false);
  });

  it('decode rejects bad rot (short tuple)', () => {
    const r = decode({ ...goodRespawn(), rot: [0] });
    expect(r.ok).toBe(false);
  });

  it('decode rejects out-of-range hp (negative, huge, or non-finite)', () => {
    expect(decode({ ...goodRespawn(), hp: -1 }).ok).toBe(false);
    expect(decode({ ...goodRespawn(), hp: 99999 }).ok).toBe(false);
    expect(decode({ ...goodRespawn(), hp: NaN }).ok).toBe(false);
  });
});
