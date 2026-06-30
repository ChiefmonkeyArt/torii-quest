// tests/leaderboard-live-publish.test.js — LIVE leaderboard publish wiring (M2,
// v0.2.283, src/engine/leaderboard/livePublish.js). Promotes the relay write to a
// real NIP-07 sign + relay fan-out, but ONLY behind explicit consent AND the SEC-1
// crypto-verified publishGate. We mock the NIP-07 signer + relay pool AT THE SEAM
// and exercise: a consented, crypto-verified score reaches the relay pool with the
// right event shape; no consent → no relay write; a non-crypto-verified gate verdict
// → no relay write (fail closed); not-logged-in → no signing; a zero-accept fan-out
// is a failure. The accept path uses a REAL BIP-340 signature through the REAL gate
// so the crypto floor is not bypassed.
import { describe, it, expect, vi } from 'vitest';
import { createLiveLeaderboardPublisher, buildFinalRunScore } from '../src/engine/leaderboard/livePublish.js';
import { LEADERBOARD_KIND } from '../src/engine/nostr/leaderboard.js';
import { verifyPublishGate } from '../src/engine/leaderboard/publishGate.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import * as SDK from '../src/sdk/index.js';

const PK_SK = hexToBytes('a1'.repeat(32));
const PK = bytesToHex(schnorr.getPublicKey(PK_SK));
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol'];
const STATS = { runId: 'run-live-1', score: 12, kills: 6, headshots: 2, accuracy: 0.5 };

// A NIP-07-equivalent signer over the real curve: adds pubkey, recomputes the
// NIP-01 id, schnorr-signs it. Wrapped in nostr.js signEvent's { ok, event } shape.
function realSignEvent(sk) {
  return vi.fn(async (template) => {
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    const evt = { ...template, pubkey, created_at: Math.floor(Date.now() / 1000) };
    const id = nostrEventId(evt);
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
    return { ok: true, event: { ...evt, id, sig }, error: null };
  });
}

// A fanoutPublish mock: every relay accepts.
function acceptingPool() {
  return vi.fn(async (relays, _event) => ({ accepted: relays.length, used: [...relays], failed: [] }));
}

describe('buildFinalRunScore — finalised run snapshot → publishable stats', () => {
  it('clamps headshots to kills and derives accuracy from hits/shots', () => {
    const s = buildFinalRunScore({ kills: 3, headshots: 9, hits: 5, shots: 10 });
    expect(s.kills).toBe(3);
    expect(s.headshots).toBe(3); // clamped
    expect(s.accuracy).toBeCloseTo(0.5);
    expect(s.score).toBe(3); // defaults to kills
    expect(s.runId).toMatch(/^run-/);
  });

  it('degrades a malformed snapshot to a zeroed, valid score', () => {
    const s = buildFinalRunScore(null);
    expect(s).toMatchObject({ score: 0, kills: 0, headshots: 0, accuracy: 0 });
    expect(typeof s.runId).toBe('string');
  });
});

describe('createLiveLeaderboardPublisher — consented + crypto-verified → relay write', () => {
  it('signs via NIP-07 and fans the event out to the configured relays with the right shape', async () => {
    const sign = realSignEvent(PK_SK);
    const publish = acceptingPool();
    const pub = createLiveLeaderboardPublisher({ sign, publish, relays: RELAYS, gate: verifyPublishGate });

    const res = await pub.publishFinalScore(STATS, { signerPubkey: PK, consent: true });

    expect(res.published).toBe(true);
    expect(res.ok).toBe(true);
    expect(sign).toHaveBeenCalledOnce();
    expect(publish).toHaveBeenCalledOnce();

    // The relay pool was called with the configured relays + a signed kind-30000
    // event carrying the discovery topic tag.
    const [relaysArg, eventArg] = publish.mock.calls[0];
    expect(relaysArg).toEqual(RELAYS);
    expect(eventArg.kind).toBe(LEADERBOARD_KIND);
    expect(eventArg.pubkey).toBe(PK);
    expect(eventArg.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(eventArg.tags.some((t) => t[0] === 't' && t[1] === 'torii-quest')).toBe(true);
    expect(res.relay.used).toEqual(RELAYS);
  });
});

describe('createLiveLeaderboardPublisher — consent gate (never publish without consent)', () => {
  it('does NOT write to the relay pool when consent is withheld (real gate fails closed)', async () => {
    const sign = realSignEvent(PK_SK);
    const publish = acceptingPool();
    const pub = createLiveLeaderboardPublisher({ sign, publish, relays: RELAYS, gate: verifyPublishGate });

    const res = await pub.publishFinalScore(STATS, { signerPubkey: PK, consent: false });

    expect(res.published).toBe(false);
    expect(res.ok).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/SEC-1 gate blocked publish/);
  });
});

describe('createLiveLeaderboardPublisher — crypto gate (fail closed on unverified verdict)', () => {
  it('does NOT write to the relay pool when the gate verdict is not crypto-verified', async () => {
    const sign = realSignEvent(PK_SK);
    const publish = acceptingPool();
    // A gate that mirrors a non-crypto-verified verdict (e.g. a forged/tampered sig).
    const gate = vi.fn(() => ({ ok: true, trusted: false, trust: 'unverified', errors: ['schnorr signature verification failed'] }));
    const pub = createLiveLeaderboardPublisher({ sign, publish, relays: RELAYS, gate });

    const res = await pub.publishFinalScore(STATS, { signerPubkey: PK, consent: true });

    expect(gate).toHaveBeenCalledOnce();
    expect(res.published).toBe(false);
    expect(res.ok).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/SEC-1 gate blocked publish/);
  });
});

describe('createLiveLeaderboardPublisher — fails closed on missing identity / dead relays', () => {
  it('does NOT sign or publish when not logged in (no hex64 signer pubkey)', async () => {
    const sign = realSignEvent(PK_SK);
    const publish = acceptingPool();
    const pub = createLiveLeaderboardPublisher({ sign, publish, relays: RELAYS, gate: verifyPublishGate });

    const res = await pub.publishFinalScore(STATS, { signerPubkey: '', consent: true });

    expect(res.published).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/not logged in/);
  });

  it('reports a failure when no relay accepts the event (zero-accept fan-out)', async () => {
    const sign = realSignEvent(PK_SK);
    const publish = vi.fn(async (relays) => ({ accepted: 0, used: [], failed: [...relays] }));
    const pub = createLiveLeaderboardPublisher({ sign, publish, relays: RELAYS, gate: verifyPublishGate });

    const res = await pub.publishFinalScore(STATS, { signerPubkey: PK, consent: true });

    expect(publish).toHaveBeenCalledOnce(); // it passed the gate, then the relays rejected
    expect(res.published).toBe(false);
    expect(res.errors.join(' ')).toMatch(/no relay accepted/);
  });

  it('captures a NIP-07 signer rejection without publishing', async () => {
    const sign = vi.fn(async () => ({ ok: false, event: null, error: 'nip-07-rejected' }));
    const publish = acceptingPool();
    const pub = createLiveLeaderboardPublisher({ sign, publish, relays: RELAYS, gate: verifyPublishGate });

    const res = await pub.publishFinalScore(STATS, { signerPubkey: PK, consent: true });

    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.join(' ')).toMatch(/nip-07-rejected/);
  });
});

describe('leaderboardLivePublish — SDK exposure', () => {
  it('is re-exported from the SDK at the experimental tier', () => {
    expect(typeof SDK.leaderboardLivePublish.createLiveLeaderboardPublisher).toBe('function');
    expect(SDK.SDK_SURFACE.leaderboardLivePublish.tier).toBe(SDK.STABILITY.EXPERIMENTAL);
    expect(SDK.surfacesByTier(SDK.STABILITY.EXPERIMENTAL)).toContain('leaderboardLivePublish');
  });
});
