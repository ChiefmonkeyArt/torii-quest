// tests/multiplayer/leaderboard-agg.test.js — MP-3 (v0.2.366-alpha)
import { describe, it, expect } from 'vitest';
import { aggregate, topN } from '../../src/engine/multiplayer/leaderboardAgg.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

function evt(pubkey, kind, kills, deaths, damage, sessionId, createdAt, endedAt = createdAt * 1000) {
  return {
    pubkey, kind, created_at: createdAt,
    content: JSON.stringify({ kills, deaths, damage, sessionId, endedAt }),
  };
}
const HEX16 = (n) => n.toString(16).padStart(16, '0');

describe('aggregate — sort + dedupe', () => {
  it('sums kind:1 history and dedupes by (pubkey, sessionId)', () => {
    const rows = aggregate({
      current: [],
      history: [
        evt(A, 1, 3, 1, 90, HEX16(1), 1000),
        evt(A, 1, 3, 1, 90, HEX16(1), 1001), // dupe of same session
        evt(A, 1, 2, 0, 40, HEX16(2), 1002),
        evt(B, 1, 5, 4, 200, HEX16(3), 1003),
      ],
    });
    // A: 2 matches, 5 kills; B: 1 match, 5 kills → tie-break by K/D
    expect(rows.map((r) => r.npub)).toEqual([A, B]);
    const a = rows.find((r) => r.npub === A);
    expect(a.matches).toBe(2);
    expect(a.lifetimeKills).toBe(5);
    expect(a.lifetimeDamage).toBe(130);
  });

  it('uses current snapshot as lifetime when history is empty', () => {
    const rows = aggregate({
      current: [evt(A, 30078, 7, 3, 210, HEX16(9), 5000)],
      history: [],
    });
    expect(rows[0].lifetimeKills).toBe(7);
    expect(rows[0].matches).toBe(0);
  });

  it('drops rows with malformed content or bad session id', () => {
    const rows = aggregate({
      current: [],
      history: [
        { pubkey: A, kind: 1, created_at: 100, content: '{"bad":true}' },
        evt(A, 1, 1, 0, 5, 'not-hex', 200), // bad sessionId
        evt(A, 1, 1, 0, 5, HEX16(4), 300),
      ],
    });
    expect(rows[0].lifetimeKills).toBe(1);
    expect(rows[0].matches).toBe(1);
  });

  it('handles duplicate current snapshots by picking newest created_at', () => {
    const rows = aggregate({
      current: [
        evt(A, 30078, 1, 1, 3, HEX16(1), 500),
        evt(A, 30078, 9, 2, 300, HEX16(2), 900),
      ],
      history: [],
    });
    expect(rows[0].currentKills).toBe(9);
  });

  it('sort key: kills desc, then kd desc, then lastSeen desc', () => {
    const rows = aggregate({
      current: [],
      history: [
        evt(A, 1, 5, 5, 100, HEX16(1), 100),
        evt(B, 1, 5, 1, 100, HEX16(2), 100), // higher K/D
        evt(C, 1, 5, 1, 100, HEX16(3), 200), // same K/D but later
      ],
    });
    expect(rows.map((r) => r.npub)).toEqual([C, B, A]);
  });
});

describe('topN', () => {
  it('returns the first N rows', () => {
    const history = [];
    for (let i = 0; i < 10; i++) {
      history.push(evt(('a'.repeat(63) + i.toString(16)), 1, 10 - i, 0, 0, HEX16(i), 1000 + i));
    }
    const top = topN({ current: [], history }, 3);
    expect(top).toHaveLength(3);
    expect(top[0].lifetimeKills).toBe(10);
  });

  it('rejects invalid pubkey and returns []', () => {
    expect(topN({ current: [{ pubkey: 'nope', kind: 30078, created_at: 1, content: '{}' }], history: [] }, 5))
      .toEqual([]);
  });
});
