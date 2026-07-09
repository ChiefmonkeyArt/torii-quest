// tests/multiplayer/score-reporter.test.js — MP-3 (v0.2.366-alpha)
// Drives the client-signed reporter with injected signer/publisher/storage.
import { describe, it, expect, vi } from 'vitest';
import {
  createScoreReporter, buildAddressableEvent, buildHistoryEvent,
  pickSelfRow, dedupeKey,
  SCORE_KIND_ADDRESSABLE, SCORE_KIND_HISTORY, SCORE_D_TAG, SCORE_HISTORY_T_TAG,
} from '../../src/engine/multiplayer/scoreReporter.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';

const PUB = 'a'.repeat(64);
const SESS = '1'.repeat(16);
const tally = { id: 'p1', npub: PUB, kills: 3, deaths: 1, damage: 90 };
const scoreMsg = { t: 'SCORE', sessionId: SESS, endedAt: 2_000_000, tallies: [tally] };

function memStore() {
  const m = new Map();
  return { get: (k) => (m.has(k) ? m.get(k) : null), set: (k, v) => m.set(k, v) };
}

function fakeSigner(evt) {
  const id = nostrEventId(evt);
  return { ...evt, id, sig: 'sig-' + id };
}

describe('constants', () => {
  it('kind and tag values are stable', () => {
    expect(SCORE_KIND_ADDRESSABLE).toBe(30078);
    expect(SCORE_KIND_HISTORY).toBe(1);
    expect(SCORE_D_TAG).toBe('torii-quest');
    expect(SCORE_HISTORY_T_TAG).toBe('torii-quest-score');
  });
});

describe('pickSelfRow', () => {
  it('matches by selfId when present', () => {
    const row = pickSelfRow([{ id: 'p1', npub: PUB, kills: 1, deaths: 0, damage: 3 }],
                            { selfId: 'p1' });
    expect(row.kills).toBe(1);
  });
  it('falls back to selfPubkey', () => {
    const row = pickSelfRow([{ id: 'x', npub: PUB, kills: 2, deaths: 2, damage: 4 }],
                            { selfPubkey: PUB });
    expect(row.deaths).toBe(2);
  });
  it('returns null when neither matches', () => {
    expect(pickSelfRow([tally], { selfId: 'zzz' })).toBeNull();
  });
});

describe('buildAddressableEvent / buildHistoryEvent', () => {
  const args = {
    pubkey: PUB, sessionId: SESS, endedAt: 42, row: { kills: 3, deaths: 1, damage: 90 },
    createdAt: 1_700_000_000, clientTag: 'torii-quest/v0.2.366-alpha',
  };
  it('addressable event has d-tag and correct kind', () => {
    const e = buildAddressableEvent(args);
    expect(e.kind).toBe(SCORE_KIND_ADDRESSABLE);
    expect(e.tags.find((t) => t[0] === 'd')).toEqual(['d', 'torii-quest']);
    expect(JSON.parse(e.content).kills).toBe(3);
  });
  it('history event drops d-tag and uses kind:1 + t-tag', () => {
    const e = buildHistoryEvent(args);
    expect(e.kind).toBe(SCORE_KIND_HISTORY);
    expect(e.tags.find((t) => t[0] === 'd')).toBeUndefined();
    expect(e.tags.find((t) => t[0] === 't')).toEqual(['t', 'torii-quest-score']);
  });
});

describe('createScoreReporter — reports and dedupes', () => {
  it('rejects a non-SCORE input', async () => {
    const rep = createScoreReporter({
      signer: async () => ({}), publisher: async () => {}, self: { selfPubkey: PUB },
      storage: memStore(),
    });
    const r = await rep.report({ t: 'HELLO' });
    expect(r.published).toBe(false);
    expect(r.reason).toBe('not-score');
  });

  it('empty row is marked dedupe but not published', async () => {
    const rep = createScoreReporter({
      signer: vi.fn(async (evt) => fakeSigner(evt)),
      publisher: vi.fn(async () => ({ published: 1, tried: 1 })),
      self: { selfPubkey: PUB },
      storage: memStore(),
    });
    const empty = { t: 'SCORE', sessionId: SESS, endedAt: 100,
                    tallies: [{ id: 'p1', npub: PUB, kills: 0, deaths: 0, damage: 0 }] };
    const r1 = await rep.report(empty);
    expect(r1.published).toBe(false);
    expect(r1.reason).toBe('empty-row');
    // second call short-circuits with dedupe
    const r2 = await rep.report(empty);
    expect(r2.reason).toBe('dedupe');
  });

  it('signs, publishes, and dedupes on the second report', async () => {
    const publisher = vi.fn(async () => ({ published: 3, tried: 3 }));
    const signer = vi.fn(async (evt) => fakeSigner(evt));
    const rep = createScoreReporter({
      signer, publisher, self: { selfPubkey: PUB }, storage: memStore(),
      now: () => 1_700_000_000_000,
    });
    const r1 = await rep.report(scoreMsg);
    expect(r1.published).toBe(true);
    expect(signer).toHaveBeenCalledTimes(2); // addressable + history
    expect(publisher).toHaveBeenCalledTimes(2);
    const r2 = await rep.report(scoreMsg);
    expect(r2.published).toBe(false);
    expect(r2.reason).toBe('dedupe');
  });

  it('detects a signer that mangles the id', async () => {
    const bogusSigner = async (evt) => ({ ...evt, id: 'deadbeef', sig: 'x' });
    const rep = createScoreReporter({
      signer: bogusSigner,
      publisher: vi.fn(),
      self: { selfPubkey: PUB },
      storage: memStore(),
    });
    const r = await rep.report(scoreMsg);
    expect(r.published).toBe(false);
    expect(r.reason).toBe('sig-id-mismatch');
  });

  it('catches signer or publisher exceptions', async () => {
    const rep = createScoreReporter({
      signer: async () => { throw new Error('nip07 unavailable'); },
      publisher: vi.fn(),
      self: { selfPubkey: PUB },
      storage: memStore(),
    });
    const r = await rep.report(scoreMsg);
    expect(r.published).toBe(false);
    expect(r.reason).toBe('signer-or-publisher-threw');
  });

  it('no self row → no publish, no dedupe mark', async () => {
    const store = memStore();
    const rep = createScoreReporter({
      signer: vi.fn(), publisher: vi.fn(),
      self: { selfPubkey: 'f'.repeat(64) }, storage: store,
    });
    const r = await rep.report(scoreMsg);
    expect(r.published).toBe(false);
    expect(r.reason).toBe('no-self-row');
    expect(store.get(dedupeKey(SESS, scoreMsg.endedAt))).toBeNull();
  });
});
