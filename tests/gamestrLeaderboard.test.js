// tests/gamestrLeaderboard.test.js — PURE gamestr.io kind 30762 leaderboard
// reader (Phase 0h, src/engine/gamestr/gamestrLeaderboard.js). Verifies the
// dedupe-by-pubkey (latest created_at, tie-break highest score), score parsing
// (non-negative int; drop malformed), optional duration tag, hex64 pubkey
// validation, sort by score desc, and the never-throws contract. Pure +
// node-safe — no DOM, no sockets, no timers.
import { describe, it, expect } from 'vitest';
import { buildGamestrLeaderboard } from '../src/engine/gamestr/gamestrLeaderboard.js';

const PK_A = 'a'.repeat(64);
const PK_B = 'b'.repeat(64);
const PK_C = 'c'.repeat(64);
const PK_UPPER = 'A'.repeat(64); // upper-case hex → normalised to lower

// _ev({pubkey, score, duration?, createdAt?, p?}) → a minimal kind 30762 event.
function _ev({ pubkey = PK_A, score, duration, createdAt = 1000, p } = {}) {
  const tags = [
    ['d', `torii-quest:${pubkey}`],
    ['game', 'torii-quest'],
    ['score', String(score)],
  ];
  if (p !== undefined) tags.push(['p', p]);
  else tags.push(['p', pubkey]);
  tags.push(['t', 'arcade'], ['t', 'shooter']);
  if (duration !== undefined) tags.push(['duration', String(duration)]);
  return { id: `${pubkey}-${createdAt}-${score}`, kind: 30762, pubkey, created_at: createdAt, tags, content: '' };
}

describe('buildGamestrLeaderboard — input tolerance (never throws)', () => {
  it('returns [] for null input', () => {
    expect(buildGamestrLeaderboard(null)).toEqual([]);
  });

  it('returns [] for undefined input', () => {
    expect(buildGamestrLeaderboard(undefined)).toEqual([]);
  });

  it('returns [] for a non-array input (object)', () => {
    expect(buildGamestrLeaderboard({ kinds: [30762] })).toEqual([]);
  });

  it('returns [] for a non-array input (string)', () => {
    expect(buildGamestrLeaderboard('not-an-array')).toEqual([]);
  });

  it('returns [] for an empty array', () => {
    expect(buildGamestrLeaderboard([])).toEqual([]);
  });

  it('never throws on a hostile event with a throwing getter', () => {
    const hostile = {
      get tags() { throw new Error('boom'); },
      pubkey: PK_A,
      created_at: 1,
    };
    expect(() => buildGamestrLeaderboard([hostile])).not.toThrow();
    expect(buildGamestrLeaderboard([hostile])).toEqual([]);
  });
});

describe('buildGamestrLeaderboard — single event parsing', () => {
  it('parses a single event into one row with score from the score tag', () => {
    const rows = buildGamestrLeaderboard([_ev({ pubkey: PK_A, score: 42, createdAt: 1000 })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({ pubkey: PK_A, score: 42, createdAt: 1000 });
  });

  it('reads the pubkey from the p tag (not event.pubkey)', () => {
    // event.pubkey is the signer; p tag is the player. Here they differ and the
    // p tag wins (mirroring the spec: pubkey from the p tag, fallback event.pubkey).
    const e = _ev({ pubkey: PK_B, score: 5, createdAt: 1000, p: PK_A });
    const rows = buildGamestrLeaderboard([e]);
    expect(rows[0].pubkey).toBe(PK_A);
  });

  it('falls back to event.pubkey when the p tag is missing', () => {
    const e = {
      id: 'x', kind: 30762, pubkey: PK_A, created_at: 1000,
      tags: [['d', `torii-quest:${PK_A}`], ['game', 'torii-quest'], ['score', '7']],
      content: '',
    };
    const rows = buildGamestrLeaderboard([e]);
    expect(rows[0].pubkey).toBe(PK_A);
    expect(rows[0].score).toBe(7);
  });

  it('normalises an upper-case pubkey to lower-case hex64', () => {
    const rows = buildGamestrLeaderboard([_ev({ pubkey: PK_UPPER, score: 3, createdAt: 1000 })]);
    expect(rows[0].pubkey).toBe(PK_UPPER.toLowerCase());
  });

  it('parses the duration tag when present', () => {
    const rows = buildGamestrLeaderboard([_ev({ pubkey: PK_A, score: 9, duration: 120, createdAt: 1000 })]);
    expect(rows[0]).toEqual({ pubkey: PK_A, score: 9, duration: 120, createdAt: 1000 });
  });

  it('omits duration when the tag is absent', () => {
    const rows = buildGamestrLeaderboard([_ev({ pubkey: PK_A, score: 9, createdAt: 1000 })]);
    expect(rows[0]).not.toHaveProperty('duration');
  });

  it('omits duration when the tag is unparseable (non-integer)', () => {
    const e = _ev({ pubkey: PK_A, score: 9, createdAt: 1000 });
    // inject a malformed duration tag
    e.tags = e.tags.filter((t) => t[0] !== 'duration');
    e.tags.push(['duration', 'not-a-number']);
    const rows = buildGamestrLeaderboard([e]);
    expect(rows[0].score).toBe(9);
    expect(rows[0]).not.toHaveProperty('duration');
  });
});

describe('buildGamestrLeaderboard — dedupe by pubkey', () => {
  it('keeps the latest created_at for the same pubkey', () => {
    const rows = buildGamestrLeaderboard([
      _ev({ pubkey: PK_A, score: 10, createdAt: 1000 }),
      _ev({ pubkey: PK_A, score: 20, createdAt: 2000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(20);
    expect(rows[0].createdAt).toBe(2000);
  });

  it('keeps the older event when the newer one has a lower score (latest wins on created_at)', () => {
    const rows = buildGamestrLeaderboard([
      _ev({ pubkey: PK_A, score: 99, createdAt: 1000 }),
      _ev({ pubkey: PK_A, score: 5, createdAt: 2000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(5);
    expect(rows[0].createdAt).toBe(2000);
  });

  it('tie-breaks a created_at tie by the highest score', () => {
    const rows = buildGamestrLeaderboard([
      _ev({ pubkey: PK_A, score: 10, createdAt: 1000 }),
      _ev({ pubkey: PK_A, score: 50, createdAt: 1000 }),
      _ev({ pubkey: PK_A, score: 30, createdAt: 1000 }),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(50);
    expect(rows[0].createdAt).toBe(1000);
  });

  it('dedupes across the p tag (same p, different event.pubkey signer)', () => {
    // Two events attributing to the same player (p tag) but signed by different
    // pubkeys — the player pubkey (p) is the dedupe key.
    const e1 = _ev({ pubkey: PK_B, score: 10, createdAt: 1000, p: PK_A });
    const e2 = _ev({ pubkey: PK_C, score: 20, createdAt: 2000, p: PK_A });
    const rows = buildGamestrLeaderboard([e1, e2]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pubkey).toBe(PK_A);
    expect(rows[0].score).toBe(20);
  });
});

describe('buildGamestrLeaderboard — sort by score desc', () => {
  it('sorts multiple pubkeys by score descending', () => {
    const rows = buildGamestrLeaderboard([
      _ev({ pubkey: PK_A, score: 10, createdAt: 1000 }),
      _ev({ pubkey: PK_B, score: 50, createdAt: 1000 }),
      _ev({ pubkey: PK_C, score: 30, createdAt: 1000 }),
    ]);
    expect(rows.map((r) => r.pubkey)).toEqual([PK_B, PK_C, PK_A]);
    expect(rows.map((r) => r.score)).toEqual([50, 30, 10]);
  });

  it('preserves a stable order for equal scores (input order)', () => {
    const rows = buildGamestrLeaderboard([
      _ev({ pubkey: PK_A, score: 20, createdAt: 1000 }),
      _ev({ pubkey: PK_B, score: 20, createdAt: 1000 }),
      _ev({ pubkey: PK_C, score: 20, createdAt: 1000 }),
    ]);
    expect(rows.map((r) => r.pubkey)).toEqual([PK_A, PK_B, PK_C]);
  });
});

describe('buildGamestrLeaderboard — malformed events dropped', () => {
  it('drops an event with no score tag', () => {
    const e = {
      id: 'x', kind: 30762, pubkey: PK_A, created_at: 1000,
      tags: [['d', `torii-quest:${PK_A}`], ['game', 'torii-quest'], ['p', PK_A]],
      content: '',
    };
    expect(buildGamestrLeaderboard([e])).toEqual([]);
  });

  it('drops an event with an unparseable (non-numeric) score', () => {
    const e = _ev({ pubkey: PK_A, score: 0, createdAt: 1000 });
    e.tags = e.tags.map((t) => (t[0] === 'score' ? ['score', 'not-a-number'] : t));
    expect(buildGamestrLeaderboard([e])).toEqual([]);
  });

  it('drops an event with a negative score', () => {
    const e = _ev({ pubkey: PK_A, score: 0, createdAt: 1000 });
    e.tags = e.tags.map((t) => (t[0] === 'score' ? ['score', '-5'] : t));
    expect(buildGamestrLeaderboard([e])).toEqual([]);
  });

  it('drops an event with a fractional score (non-integer)', () => {
    const e = _ev({ pubkey: PK_A, score: 0, createdAt: 1000 });
    e.tags = e.tags.map((t) => (t[0] === 'score' ? ['score', '12.5'] : t));
    expect(buildGamestrLeaderboard([e])).toEqual([]);
  });

  it('drops an event with a bad (non-hex64) pubkey in both p tag and event.pubkey', () => {
    const e = _ev({ pubkey: 'not-a-pubkey', score: 5, createdAt: 1000, p: 'also-bad' });
    expect(buildGamestrLeaderboard([e])).toEqual([]);
  });

  it('drops an event whose p tag is bad but falls back to a valid event.pubkey', () => {
    const e = _ev({ pubkey: PK_A, score: 5, createdAt: 1000, p: 'bad-p' });
    const rows = buildGamestrLeaderboard([e]);
    expect(rows).toHaveLength(1);
    expect(rows[0].pubkey).toBe(PK_A);
  });

  it('drops a non-object event entry without throwing', () => {
    expect(buildGamestrLeaderboard([null, undefined, 42, 'x', []])).toEqual([]);
  });

  it('drops malformed events but keeps the valid ones in the same batch', () => {
    const bad = {
      id: 'bad', kind: 30762, pubkey: 'nope', created_at: 1000,
      tags: [['score', 'not-a-number']], content: '',
    };
    const good = _ev({ pubkey: PK_A, score: 42, createdAt: 2000 });
    const rows = buildGamestrLeaderboard([bad, good]);
    expect(rows).toHaveLength(1);
    expect(rows[0].score).toBe(42);
  });
});

describe('buildGamestrLeaderboard — created_at handling', () => {
  it('coerces a non-finite created_at to 0', () => {
    const e = _ev({ pubkey: PK_A, score: 5, createdAt: 1000 });
    e.created_at = NaN;
    const rows = buildGamestrLeaderboard([e]);
    expect(rows[0].createdAt).toBe(0);
  });

  it('floors a fractional created_at to an integer', () => {
    const e = _ev({ pubkey: PK_A, score: 5, createdAt: 1000 });
    e.created_at = 1999.9;
    const rows = buildGamestrLeaderboard([e]);
    expect(rows[0].createdAt).toBe(1999);
  });
});
