// wire-protocol.test.js — locks the MP-1 wire protocol.
// Pure (no WS), so it runs node-fast.
import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_VERSION, MSG, LIMITS,
  encode, decode, sanitize, isKnownType,
} from '../../src/engine/multiplayer/wireProtocol.js';

// ---------- fixtures ----------

const goodHello = {
  t: MSG.HELLO,
  challenge: 'a'.repeat(44),
  serverVersion: 'v0.2.365-alpha',
  protocolVersion: PROTOCOL_VERSION,
};

const goodAuth = {
  t: MSG.AUTH,
  npub: 'npub1' + 'x'.repeat(58),
  sig:  'b'.repeat(128),
  event: { kind: 22242, tags: [], content: '', created_at: 0 },
};

const goodMove = {
  t: MSG.MOVE,
  pos: [1, 2, 3],
  rot: [0.1, -0.2],
  vel: [0, 0, 0],
};

const goodShot = {
  t: MSG.SHOT,
  origin: [0, 1.7, 0],
  dir:    [0, 0, -1],
  ts: 12345,
};

const goodHit = {
  t: MSG.HIT,
  targetId: 'peer-abc',
  dmg: 30,
  zone: 'head',
  shotTs: 12345,
};

// ---------- encode/decode round-trip ----------

describe('encode/decode round-trip', () => {
  it('round-trips every known message type', () => {
    const messages = [
      goodHello,
      goodAuth,
      { t: MSG.AUTH_FAIL, reason: 'bad sig' },
      { t: MSG.WELCOME, selfId: 'me1', roster: [{ id: 'p1', npub: 'npub1' + 'x'.repeat(58), pos: [0, 0, 0], rot: [0, 0], character: 'chiefmonkey' }] },
      { t: MSG.JOIN, id: 'p2', npub: 'npub1' + 'y'.repeat(58), pos: [1, 0, 1], rot: [0, 0], character: 'bot' },
      { t: MSG.LEFT, id: 'p2', reason: 'closed' },
      goodMove,
      goodShot,
      goodHit,
      { t: MSG.KILL, shooterId: 'p1', victimId: 'p2', weapon: 'pistol' },
      { t: MSG.CHAT, msg: 'gg' },
      { t: MSG.PING, ts: 1 },
      { t: MSG.PONG, ts: 1 },
    ];
    for (const m of messages) {
      const wire = encode(m);
      expect(typeof wire).toBe('string');
      const back = decode(wire);
      expect(back.ok, `round-trip failed for ${m.t}: ${back.error}`).toBe(true);
      expect(back.msg.t).toBe(m.t);
    }
  });

  it('encode throws for unknown t', () => {
    expect(() => encode({ t: 'GARBAGE' })).toThrow(/unknown t/);
  });

  it('encode throws for non-object input', () => {
    expect(() => encode(null)).toThrow(/must be an object/);
  });

  it('PROTOCOL_VERSION is 1 (locked for MP-1)', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

// ---------- rejection cases ----------

describe('decode — malformed input is safe', () => {
  it('rejects malformed JSON without throwing', () => {
    const r = decode('{not json');
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_JSON');
  });

  it('rejects non-object / non-string input', () => {
    expect(decode(42).ok).toBe(false);
    expect(decode(null).ok).toBe(false);
  });

  it('rejects missing t', () => {
    const r = decode({ pos: [0, 0, 0] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_TYPE');
  });

  it('rejects unknown t', () => {
    const r = decode({ t: 'HACKME', payload: 'lol' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('UNKNOWN_TYPE');
  });

  it('rejects wrong protocolVersion on HELLO', () => {
    const r = decode({ ...goodHello, protocolVersion: 99 });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_VERSION');
  });

  it('rejects out-of-range pos on MOVE', () => {
    const r = decode({ ...goodMove, pos: [999999, 0, 0] });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_FIELD');
  });

  it('rejects NaN in a vec3 field', () => {
    const r = decode({ ...goodMove, pos: [NaN, 0, 0] });
    expect(r.ok).toBe(false);
  });

  it('rejects unknown hit zone', () => {
    const r = decode({ ...goodHit, zone: 'nuts' });
    expect(r.ok).toBe(false);
    expect(r.code).toBe('BAD_FIELD');
  });

  it('rejects zero or negative damage', () => {
    expect(decode({ ...goodHit, dmg: 0 }).ok).toBe(false);
    expect(decode({ ...goodHit, dmg: -5 }).ok).toBe(false);
  });

  it('rejects chat exceeding CHAT_LEN', () => {
    const r = decode({ t: MSG.CHAT, msg: 'a'.repeat(LIMITS.CHAT_LEN + 1) });
    expect(r.ok).toBe(false);
  });
});

// ---------- sanitize ----------

describe('sanitize — strips unknown fields', () => {
  it('drops client-injected extra fields on MOVE', () => {
    const raw = { ...goodMove, evilExtra: 'x'.repeat(999), godMode: true };
    const parsed = decode(raw);
    expect(parsed.ok).toBe(true);
    const clean = sanitize(parsed.msg);
    expect(clean).toEqual({ t: MSG.MOVE, pos: [1, 2, 3], rot: [0.1, -0.2], vel: [0, 0, 0] });
    expect(clean.evilExtra).toBeUndefined();
    expect(clean.godMode).toBeUndefined();
  });

  it('keeps id when server has stamped it (rebroadcast case)', () => {
    const withId = { ...goodMove, id: 'peer-x' };
    const clean = sanitize(withId);
    expect(clean.id).toBe('peer-x');
  });

  it('never carries fields for unknown t (defensive)', () => {
    // sanitize is only called on validated messages, but be defensive:
    // an unknown-t message returned as-is (caller's problem, not ours).
    const raw = { t: 'MYSTERY', a: 1 };
    expect(sanitize(raw)).toEqual(raw);
  });
});

// ---------- helpers ----------

describe('isKnownType', () => {
  it('recognises every MSG.* value', () => {
    for (const v of Object.values(MSG)) expect(isKnownType(v)).toBe(true);
  });
  it('rejects garbage', () => {
    expect(isKnownType('GARBAGE')).toBe(false);
    expect(isKnownType('')).toBe(false);
    expect(isKnownType(undefined)).toBe(false);
  });
});
