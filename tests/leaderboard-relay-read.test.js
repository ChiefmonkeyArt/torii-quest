// tests/leaderboard-relay-read.test.js — locks the READ-ONLY leaderboard
// relay-read proof (src/engine/nostr/leaderboardRelayRead.js, NOSTR-READ /
// LB-1, v0.2.160). Proves the leaderboard READ path: build the score filter,
// extract + validate score objects from relay events, dedupe addressable runs,
// rank via leaderboardView, and return a read-only report — no signing, no
// publishing, no network. Pure module → node-testable.
import { describe, it, expect } from 'vitest';
import {
  LEADERBOARD_TOPIC,
  buildScoreFilter, extractScoreFromEvent, dedupeScores, readLeaderboardEvents,
  SCORE_FIELDS,
} from '../src/engine/nostr/leaderboardRelayRead.js';
import { LEADERBOARD_KIND } from '../src/engine/nostr/leaderboard.js';
import * as SDK from '../src/sdk/index.js';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_SIG = 'c'.repeat(64) + 'd'.repeat(64); // 128-hex

// A structurally-valid kind-30000 leaderboard score event.
function scoreEvent(over = {}) {
  const score = {
    runId: 'run-1', score: 120, kills: 10, headshots: 4, accuracy: 0.5, version: 'v0.2.160-alpha',
    ...(over.score || {}),
  };
  const id = over.id || HEX_A;
  const pubkey = over.pubkey || HEX_B;
  const created_at = over.created_at != null ? over.created_at : 1000;
  return {
    id,
    pubkey,
    created_at,
    kind: over.kind != null ? over.kind : LEADERBOARD_KIND,
    tags: over.tags || [
      ['d', score.runId],
      ['score', String(score.score)],
      ['kills', String(score.kills)],
      ['headshots', String(score.headshots)],
      ['accuracy', score.accuracy.toFixed(4)],
      ['version', score.version],
      ['t', LEADERBOARD_TOPIC],
    ],
    content: over.content != null ? over.content : JSON.stringify(score),
    sig: over.sig || HEX_SIG,
  };
}

describe('buildScoreFilter', () => {
  it('selects kind-30000 leaderboard events with the torii-quest topic tag', () => {
    const f = buildScoreFilter();
    expect(f.kinds).toEqual([LEADERBOARD_KIND]);
    expect(f['#t']).toEqual([LEADERBOARD_TOPIC]);
    expect(f).not.toHaveProperty('authors');
  });

  it('includes well-formed authors/since/until/limit and drops malformed options', () => {
    const f = buildScoreFilter({ authors: [HEX_B, '', 7], since: 100, until: 200, limit: 5 });
    expect(f.authors).toEqual([HEX_B]); // empty + non-string dropped
    expect(f.since).toBe(100);
    expect(f.until).toBe(200);
    expect(f.limit).toBe(5);

    const g = buildScoreFilter({ authors: [], since: 'x', limit: -1 });
    expect(g).not.toHaveProperty('authors');
    expect(g).not.toHaveProperty('since');
    expect(g).not.toHaveProperty('limit');
  });
});

describe('extractScoreFromEvent', () => {
  it('reconstructs a valid score from JSON content', () => {
    const r = extractScoreFromEvent(scoreEvent());
    expect(r.ok).toBe(true);
    expect(r.score.runId).toBe('run-1');
    expect(r.score.score).toBe(120);
    expect(r.score.kills).toBe(10);
    expect(r.score.pubkey).toBe(HEX_B);
    expect(r.score.created_at).toBe(1000);
  });

  it('falls back to indexable tags when content is missing/malformed', () => {
    const r = extractScoreFromEvent(scoreEvent({ content: 'not json{' }));
    expect(r.ok).toBe(true);
    expect(r.score.score).toBe(120); // from tags
    expect(r.score.kills).toBe(10);
    expect(r.score.runId).toBe('run-1'); // from d tag
  });

  it('rejects non-leaderboard kinds and invalid scores without throwing', () => {
    expect(extractScoreFromEvent(scoreEvent({ kind: 1 })).ok).toBe(false);
    expect(extractScoreFromEvent({ kind: LEADERBOARD_KIND, tags: [], content: '{}' }).ok).toBe(false); // no runId/score
    expect(extractScoreFromEvent(null).ok).toBe(false);
    const bad = extractScoreFromEvent(scoreEvent({ content: JSON.stringify({ runId: 'r', score: 5, kills: 1, headshots: 9, accuracy: 0.5 }) }));
    expect(bad.ok).toBe(false); // headshots > kills
  });
});

describe('dedupeScores — addressable replaceable semantics', () => {
  it('keeps the newest event per pubkey+runId and counts dropped duplicates', () => {
    const older = { runId: 'run-1', score: 50, kills: 5, headshots: 1, accuracy: 0.3, version: 'v', pubkey: HEX_B, created_at: 1000 };
    const newer = { runId: 'run-1', score: 90, kills: 9, headshots: 2, accuracy: 0.4, version: 'v', pubkey: HEX_B, created_at: 2000 };
    const other = { runId: 'run-2', score: 70, kills: 7, headshots: 1, accuracy: 0.5, version: 'v', pubkey: HEX_A, created_at: 1500 };
    const { scores, dropped } = dedupeScores([older, newer, other]);
    expect(dropped).toBe(1);
    expect(scores).toHaveLength(2);
    const run1 = scores.find((s) => s.runId === 'run-1');
    expect(run1.score).toBe(90); // newer survived
  });
});

describe('readLeaderboardEvents — read-only ranked report', () => {
  it('ranks valid events and exposes the score filter', () => {
    const events = [
      scoreEvent({ id: HEX_A, pubkey: HEX_A, content: JSON.stringify({ runId: 'r-a', score: 50, kills: 5, headshots: 1, accuracy: 0.3, version: 'v' }), tags: [['d', 'r-a'], ['t', LEADERBOARD_TOPIC]] }),
      scoreEvent({ id: HEX_B, pubkey: HEX_B, content: JSON.stringify({ runId: 'r-b', score: 200, kills: 20, headshots: 5, accuracy: 0.7, version: 'v' }), tags: [['d', 'r-b'], ['t', LEADERBOARD_TOPIC]] }),
    ];
    const r = readLeaderboardEvents(events);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.rows[0].rank).toBe(1);
    expect(r.rows[0].runId).toBe('r-b'); // highest score first
    expect(r.filter.kinds).toEqual([LEADERBOARD_KIND]);
    expect(r.signed).toBe(false);
    expect(r.published).toBe(false);
    expect(r.readOnly).toBe(true);
  });

  it('accepts a relayRead { events } result and dedupes addressable runs', () => {
    const result = {
      events: [
        scoreEvent({ id: HEX_A, pubkey: HEX_B, created_at: 1000, content: JSON.stringify({ runId: 'run-1', score: 50, kills: 5, headshots: 1, accuracy: 0.3, version: 'v' }), tags: [['d', 'run-1'], ['t', LEADERBOARD_TOPIC]] }),
        scoreEvent({ id: HEX_B, pubkey: HEX_B, created_at: 2000, content: JSON.stringify({ runId: 'run-1', score: 90, kills: 9, headshots: 2, accuracy: 0.4, version: 'v' }), tags: [['d', 'run-1'], ['t', LEADERBOARD_TOPIC]] }),
      ],
    };
    const r = readLeaderboardEvents(result);
    expect(r.count).toBe(1); // same pubkey+runId → newest only
    expect(r.duplicates).toBe(1);
    expect(r.rows[0].score).toBe(90);
  });

  it('skips malformed/non-leaderboard events without throwing', () => {
    const events = [
      scoreEvent(),                              // valid
      { id: 'bad' },                             // fails relay validation
      'not-an-object',                           // not an event
      scoreEvent({ id: 'e'.repeat(64), kind: 1, tags: [], content: 'note' }), // wrong kind
    ];
    const r = readLeaderboardEvents(events);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(1);
    expect(r.skipped.length).toBe(3);
  });

  it('degrades safely on an unusable input shape — never throws', () => {
    expect(readLeaderboardEvents(42).ok).toBe(false);
    expect(readLeaderboardEvents(null).ok).toBe(false);
    expect(readLeaderboardEvents({ nope: true }).ok).toBe(false);
    const r = readLeaderboardEvents([]);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(0);
  });

  it('exposes no publish/sign/send/connect surface on the report', () => {
    const r = readLeaderboardEvents([scoreEvent()]);
    for (const key of ['publish', 'sign', 'send', 'connect', 'close', 'write']) {
      expect(r).not.toHaveProperty(key);
    }
  });
});

describe('SDK exposure', () => {
  it('exposes leaderboardRelayRead at the experimental SDK tier', () => {
    expect(SDK.SDK_SURFACE.leaderboardRelayRead.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(typeof SDK.leaderboardRelayRead.readLeaderboardEvents).toBe('function');
    expect(typeof SDK.leaderboardRelayRead.buildScoreFilter).toBe('function');
    expect(SDK.leaderboardRelayRead.SCORE_FIELDS).toEqual(SCORE_FIELDS);
  });
});
