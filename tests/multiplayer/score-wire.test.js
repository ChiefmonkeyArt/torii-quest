// tests/multiplayer/score-wire.test.js — MP-3 (v0.2.366-alpha)
// Locks the SCORE frame wire contract: additive, PROTOCOL_VERSION unchanged.
import { describe, it, expect } from 'vitest';
import { PROTOCOL_VERSION, MSG, encode, decode, sanitize } from '../../src/engine/multiplayer/wireProtocol.js';

const NPUB = 'a'.repeat(64);
const SESS = '0'.repeat(16);

const goodTally = { id: 'p1', npub: NPUB, kills: 1, deaths: 2, damage: 30 };
const goodScore = {
  t: MSG.SCORE,
  sessionId: SESS,
  endedAt: 1_700_000_000_000,
  tallies: [goodTally],
};

describe('SCORE — protocol constants', () => {
  it('PROTOCOL_VERSION stays at 1 (additive-only)', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
  it('MSG.SCORE token is stable', () => {
    expect(MSG.SCORE).toBe('SCORE');
  });
});

describe('SCORE — encode / decode round-trip', () => {
  it('accepts a valid SCORE frame', () => {
    const wire = encode(goodScore);
    const decoded = decode(wire);
    expect(decoded.ok).toBe(true);
    expect(decoded.msg.t).toBe('SCORE');
    expect(decoded.msg.tallies[0].kills).toBe(1);
  });

  it('rejects sessionId that is not 16-hex', () => {
    const r = decode({ ...goodScore, sessionId: 'XYZ' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/sessionId/);
  });

  it('rejects tallies of 0 rows and >32 rows', () => {
    const empty = decode({ ...goodScore, tallies: [] });
    expect(empty.ok).toBe(false);
    const oversized = decode({
      ...goodScore,
      tallies: Array.from({ length: 33 }, (_, i) => ({ ...goodTally, id: `p${i}` })),
    });
    expect(oversized.ok).toBe(false);
  });

  it('rejects rows with non-integer or out-of-range fields', () => {
    const badKills = decode({ ...goodScore, tallies: [{ ...goodTally, kills: 1.5 }] });
    expect(badKills.ok).toBe(false);
    const overCap = decode({ ...goodScore, tallies: [{ ...goodTally, damage: 1e7 }] });
    expect(overCap.ok).toBe(false);
    const badNpub = decode({ ...goodScore, tallies: [{ ...goodTally, npub: 'z'.repeat(64) }] });
    expect(badNpub.ok).toBe(false);
  });

  it('sanitize keeps only allowed fields (drops client-injected fields)', () => {
    const s = sanitize({ ...goodScore, injected: 'oops' });
    expect(s.t).toBe('SCORE');
    expect(s.tallies[0].npub).toBe(NPUB);
    expect(s.injected).toBeUndefined();
  });
});
