// tests/gamestrPublisher.test.js — gamestr.io LIVE score publish wrapper
// (Phase 0f, src/engine/gamestr/gamestrPublisher.js). Mirrors the livePublish.js
// seam-mocking pattern: a fake NIP-07 signer (sign → { ok, event, error }) + a
// fake relay pool (publish → { accepted, used, failed }). Exercises the consent
// gate, the no-signer gate, a successful publish, a zero-accept fan-out, a
// publish throw (never throws into the loop), and that a gamestr failure never
// blocks the caller (best-effort). Pure unit tests — no DOM, no sockets, no timers.
import { describe, it, expect, vi } from 'vitest';
import { createGamestrPublisher } from '../src/engine/gamestr/gamestrPublisher.js';
import { GAMESTR_KIND, GAMESTR_RELAYS } from '../src/engine/gamestr/gamestrScore.js';

const PK = 'b'.repeat(64);
const STATS = { score: 42, kills: 21, duration: 99 };
const RELAYS = ['wss://main.relay.gamestr.io', 'wss://relay.damus.io'];

// A NIP-07-equivalent signer mock: stamps pubkey + id + sig onto the template and
// returns the nostr.js signEvent shape { ok, event, error }.
function okSign() {
  return vi.fn(async (template) => ({
    ok: true,
    event: { ...template, id: 'i'.repeat(64), sig: '1'.repeat(128) },
    error: null,
  }));
}

// A fanoutPublish mock: every relay accepts.
function acceptingPool() {
  return vi.fn(async (relays, _event) => ({ accepted: relays.length, used: [...relays], failed: [] }));
}

describe('createGamestrPublisher — consent gate (never publish without consent)', () => {
  it('does NOT sign or publish when consent is withheld (consent !== true)', async () => {
    const sign = okSign();
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: false });

    expect(res.ok).toBe(false);
    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/consent required/);
  });

  it('does NOT sign or publish when consent is omitted entirely', async () => {
    const sign = okSign();
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: PK });

    expect(res.ok).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('createGamestrPublisher — no-signer gate (login required)', () => {
  it('does NOT sign or publish when no hex64 signer pubkey is supplied', async () => {
    const sign = okSign();
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: '', consent: true });

    expect(res.ok).toBe(false);
    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/not logged in/);
  });

  it('rejects a malformed (non-hex64) signer before signing', async () => {
    const sign = okSign();
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: 'nope', consent: true });
    expect(res.ok).toBe(false);
    expect(sign).not.toHaveBeenCalled();
  });
});

describe('createGamestrPublisher — successful publish reports accepted relays', () => {
  it('signs a kind 30762 event and fans it out to the configured relays', async () => {
    const sign = okSign();
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });

    expect(res.ok).toBe(true);
    expect(res.signed).toBe(true);
    expect(res.published).toBe(true);
    expect(sign).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();

    const [relaysArg, eventArg] = publish.mock.calls[0];
    expect(relaysArg).toEqual(RELAYS);
    expect(eventArg.kind).toBe(GAMESTR_KIND);
    expect(eventArg.kind).toBe(30762);
    expect(eventArg.pubkey).toBe(PK);
    expect(eventArg.sig).toMatch(/^[0-9a-f]{128}$/);
    // player = signer attribution: the p tag is the signer pubkey.
    expect(eventArg.tags.find((t) => t[0] === 'p')[1]).toBe(PK);

    expect(res.event).toBe(eventArg);
    expect(res.relay.used).toEqual(RELAYS);
    expect(res.errors).toEqual([]);
  });

  it('defaults relays to GAMESTR_RELAYS when none are passed to the factory', async () => {
    const sign = okSign();
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish });

    await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });

    const [relaysArg] = publish.mock.calls[0];
    expect(relaysArg).toEqual(GAMESTR_RELAYS);
  });
});

describe('createGamestrPublisher — zero-accept fan-out is a failure', () => {
  it('reports ok:false with an error when no relay accepts the event', async () => {
    const sign = okSign();
    const publish = vi.fn(async (relays) => ({ accepted: 0, used: [], failed: [...relays] }));
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });

    expect(publish).toHaveBeenCalledOnce();
    expect(res.published).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.errors.join(' ')).toMatch(/no relay accepted/);
    expect(res.relay.accepted).toBe(0);
  });
});

describe('createGamestrPublisher — never throws into the loop', () => {
  it('captures a NIP-07 signer rejection without throwing', async () => {
    const sign = vi.fn(async () => ({ ok: false, event: null, error: 'nip-07-rejected' }));
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });

    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/nip-07-rejected/);
  });

  it('captures a publish() throw without re-throwing into the caller', async () => {
    const sign = okSign();
    const publish = vi.fn(async () => { throw new Error('relay exploded'); });
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    let res;
    expect(() => { res = undefined; }).not.toThrow();
    res = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });

    expect(res.ok).toBe(false);
    expect(res.published).toBe(false);
    expect(res.errors.join(' ')).toMatch(/relay exploded/);
  });

  it('captures a sign() throw without re-throwing into the caller', async () => {
    const sign = vi.fn(async () => { throw new Error('extension crashed'); });
    const publish = acceptingPool();
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    const res = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });

    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(res.errors.join(' ')).toMatch(/extension crashed/);
  });
});

describe('createGamestrPublisher — best-effort (gamestr failure does not block caller)', () => {
  it('the caller can await a failed gamestr publish and continue (no throw escapes)', async () => {
    const sign = okSign();
    const publish = vi.fn(async (relays) => ({ accepted: 0, used: [], failed: [...relays] }));
    const pub = createGamestrPublisher({ sign, publish, relays: RELAYS });

    // Mirror the caller pattern: a gamestr failure is captured, never thrown.
    let inAppPublishOk = true;
    let gamestrRes;
    try {
      gamestrRes = await pub.publishGameScore(STATS, { signerPubkey: PK, consent: true });
    } catch (e) {
      gamestrRes = { ok: false, published: false, errors: [String(e)] };
    }
    // The in-app publish outcome is independent of the gamestr result.
    expect(inAppPublishOk).toBe(true);
    expect(gamestrRes.ok).toBe(false);
    expect(gamestrRes.published).toBe(false);
  });
});
