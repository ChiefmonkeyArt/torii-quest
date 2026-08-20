// tests/gamestrScore.test.js — PURE gamestr.io kind 30762 score-event builder
// (Phase 0f, src/engine/gamestr/gamestrScore.js). Verifies the event shape, required
// tags (d/game/score/p), genre t tags, duration tag, content message, signer
// validation, and score bounds. Pure + node-safe — no DOM, no sockets, no timers.
import { describe, it, expect } from 'vitest';
import {
  buildGamestrScoreEvent,
  GAMESTR_KIND,
  GAMESTR_GAME_ID,
  GAMESTR_RELAYS,
} from '../src/engine/gamestr/gamestrScore.js';

const PK = 'a'.repeat(64);
const PK_UPPER = 'A'.repeat(64); // upper-case hex should be normalised to lower
const NOW = 1_700_000_000_000; // epoch ms

describe('buildGamestrScoreEvent — event kind + pubkey + created_at', () => {
  it('builds a kind 30762 (NOT the old NIP-133 kind 33334) event', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 42 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    expect(event.kind).toBe(GAMESTR_KIND);
    expect(event.kind).toBe(30762);
    expect(event.kind).not.toBe(33334);
  });

  it('sets pubkey to the signer (player = signer) and created_at = floor(now/1000)', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 7 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    expect(event.pubkey).toBe(PK);
    expect(event.created_at).toBe(Math.floor(NOW / 1000));
  });

  it('normalises an upper-case signer pubkey to lower-case hex64', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 1 }, { signerPubkey: PK_UPPER, now: NOW });
    expect(ok).toBe(true);
    expect(event.pubkey).toBe(PK.toLowerCase());
    expect(event.tags.find((t) => t[0] === 'p')[1]).toBe(PK.toLowerCase());
  });

  it('defaults created_at to a sane epoch seconds value when `now` is omitted', () => {
    const before = Math.floor(Date.now() / 1000);
    const { ok, event } = buildGamestrScoreEvent({ score: 1 }, { signerPubkey: PK });
    const after = Math.floor(Date.now() / 1000);
    expect(ok).toBe(true);
    expect(event.created_at).toBeGreaterThanOrEqual(before);
    expect(event.created_at).toBeLessThanOrEqual(after);
  });
});

describe('buildGamestrScoreEvent — required tags (d/game/score/p)', () => {
  it('emits d = "<game-id>:<signerPubkey>" (unique per player+game)', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 5 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    const d = event.tags.find((t) => t[0] === 'd');
    expect(d).toBeDefined();
    expect(d[1]).toBe(`${GAMESTR_GAME_ID}:${PK}`);
    expect(d[1]).toBe(`arena-shooter:${PK}`); // v0.2.611: the game id is Arena Shooter
  });

  it('emits game = "arena-shooter"', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 5 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    const game = event.tags.find((t) => t[0] === 'game');
    expect(game).toBeDefined();
    expect(game[1]).toBe('arena-shooter');
  });

  it('emits score as a numeric string', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 123 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    const score = event.tags.find((t) => t[0] === 'score');
    expect(score).toBeDefined();
    expect(score[1]).toBe('123');
    expect(typeof score[1]).toBe('string');
  });

  it('emits p = signerPubkey (player = signer attribution)', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 3 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    const p = event.tags.find((t) => t[0] === 'p');
    expect(p).toBeDefined();
    expect(p[1]).toBe(PK);
  });
});

describe('buildGamestrScoreEvent — genre t tags + duration', () => {
  it('emits both arcade and shooter genre t tags', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 9 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    const ts = event.tags.filter((t) => t[0] === 't').map((t) => t[1]);
    expect(ts).toEqual(expect.arrayContaining(['arcade', 'shooter']));
    expect(ts.length).toBe(2);
  });

  it('emits a duration tag (numeric string) when a finite duration is supplied', () => {
    const { ok, event } = buildGamestrScoreEvent(
      { score: 9, duration: 184.5 },
      { signerPubkey: PK, now: NOW },
    );
    expect(ok).toBe(true);
    const dur = event.tags.find((t) => t[0] === 'duration');
    expect(dur).toBeDefined();
    expect(dur[1]).toBe('184.5');
    expect(typeof dur[1]).toBe('string');
  });

  it('omits the duration tag when no duration is supplied', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 9 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    const dur = event.tags.find((t) => t[0] === 'duration');
    expect(dur).toBeUndefined();
  });
});

describe('buildGamestrScoreEvent — content message', () => {
  it('uses a short text message naming the score (gamestr.io uses a text message)', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 77 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    expect(event.content).toBe('Torii Quest score: 77');
  });
});

describe('buildGamestrScoreEvent — signer validation (fail closed, never throws)', () => {
  it('fails closed (ok:false, no event) when the signer is not hex64', () => {
    const res = buildGamestrScoreEvent({ score: 5 }, { signerPubkey: 'not-a-pubkey', now: NOW });
    expect(res.ok).toBe(false);
    expect(res.event).toBeNull();
    expect(res.errors.join(' ')).toMatch(/hex64 signer pubkey/);
  });

  it('fails closed when the signer is an empty string', () => {
    const res = buildGamestrScoreEvent({ score: 5 }, { signerPubkey: '', now: NOW });
    expect(res.ok).toBe(false);
    expect(res.event).toBeNull();
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('never throws on malformed stats — degrades gracefully', () => {
    let res;
    expect(() => {
      res = buildGamestrScoreEvent(null, { signerPubkey: PK, now: NOW });
    }).not.toThrow();
    expect(res.ok).toBe(true);
    expect(res.event.tags.find((t) => t[0] === 'score')[1]).toBe('0');
  });
});

describe('buildGamestrScoreEvent — score bounds (default to kills)', () => {
  it('defaults score to kills when score is missing (leaderboard invariant)', () => {
    const { ok, event } = buildGamestrScoreEvent({ kills: 8 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    expect(event.tags.find((t) => t[0] === 'score')[1]).toBe('8');
  });

  it('defaults score to kills (then 0) when score is a negative number', () => {
    const { ok, event } = buildGamestrScoreEvent(
      { score: -5, kills: 4 },
      { signerPubkey: PK, now: NOW },
    );
    expect(ok).toBe(true);
    expect(event.tags.find((t) => t[0] === 'score')[1]).toBe('4');
  });

  it('defaults score to 0 when both score and kills are invalid', () => {
    const { ok, event } = buildGamestrScoreEvent(
      { score: 'oops', kills: null },
      { signerPubkey: PK, now: NOW },
    );
    expect(ok).toBe(true);
    expect(event.tags.find((t) => t[0] === 'score')[1]).toBe('0');
  });

  it('keeps an explicit non-negative integer score as-is', () => {
    const { ok, event } = buildGamestrScoreEvent({ score: 42, kills: 4 }, { signerPubkey: PK, now: NOW });
    expect(ok).toBe(true);
    expect(event.tags.find((t) => t[0] === 'score')[1]).toBe('42');
  });
});

describe('GAMESTR_RELAYS — frozen const', () => {
  it('includes the authoritative gamestr relay + a few public relays for discoverability', () => {
    expect(GAMESTR_RELAYS.includes('wss://main.relay.gamestr.io')).toBe(true);
    expect(GAMESTR_RELAYS.length).toBeGreaterThanOrEqual(4);
  });

  it('is frozen so the publish target cannot be mutated at runtime', () => {
    expect(Object.isFrozen(GAMESTR_RELAYS)).toBe(true);
  });
});
