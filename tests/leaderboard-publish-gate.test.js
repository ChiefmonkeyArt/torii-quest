// tests/leaderboard-publish-gate.test.js — SEC-1 leaderboard publish gate (v0.2.256;
// real BIP-340 crypto landed v0.2.277).
// Asserts the gate that must clear before a signed score event is published to a
// relay. A failure NEVER yields trusted:true; the publisher treats !trusted as
// "do not publish". The gate now requires a REAL schnorr signature: structural
// checks are a fast pre-flight, then verifyNostrEventSig must pass under the
// event's pubkey. A tampered, wrong-key, or stub-signed event fails closed —
// there is no structural-only trusted path anymore (mirrors SEC-2 handoffVerify).
import { describe, it, expect, vi } from 'vitest';
import { verifyPublishGate } from '../src/engine/leaderboard/publishGate.js';
import { LEADERBOARD_KIND } from '../src/engine/nostr/leaderboard.js';
import { createLeaderboardPublisher } from '../src/engine/nostr/leaderboardPublisher.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const PK_SK = hexToBytes('a1'.repeat(32));   // the logged-in player's secret key
const EVIL_SK = hexToBytes('e7'.repeat(32)); // an attacker's secret key
const PK = bytesToHex(schnorr.getPublicKey(PK_SK)); // x-only hex64 signer pubkey
const NOW = Math.floor(Date.now() / 1000);
const SCORE = { runId: 'run-1', score: 10, kills: 5, headshots: 2, accuracy: 0.5, version: 'v0.2.277-alpha' };
const STUB_SIG = 'c'.repeat(128); // a well-shaped but non-real schnorr signature

const DEFAULT_TAGS = [
  ['d', SCORE.runId],
  ['score', String(SCORE.score)],
  ['kills', String(SCORE.kills)],
  ['headshots', String(SCORE.headshots)],
  ['accuracy', SCORE.accuracy.toFixed(4)],
  ['version', SCORE.version],
  ['t', 'torii-quest'],
];

// realSign — derive the x-only pubkey, compute the NIP-01 id, BIP-340 schnorr-sign
// it (exactly what a NIP-07 signer does).
function realSign(unsigned, sk) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = { ...unsigned, pubkey };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

// A fully-valid REAL-signed kind-30000 event from PK. `overrides` to the signable
// fields (kind/created_at/tags/content) are applied BEFORE signing so the sig stays
// valid; `id`/`sig` overrides are applied AFTER signing to exercise the crypto path.
function signedEvent(overrides = {}, sk = PK_SK) {
  const { id: idOv, sig: sigOv, ...signable } = overrides;
  const base = {
    kind: LEADERBOARD_KIND,
    created_at: NOW,
    tags: DEFAULT_TAGS.map((t) => [...t]),
    content: JSON.stringify(SCORE),
    ...signable,
  };
  const signed = realSign(base, sk);
  if (idOv !== undefined) signed.id = idOv;
  if (sigOv !== undefined) signed.sig = sigOv;
  return signed;
}

describe('SEC-1 publishGate — accept path (crypto-verified)', () => {
  it('trusts a real-signed event signed by the expected player with consent', () => {
    const v = verifyPublishGate(signedEvent(), { expectedSignerPubkey: PK, consent: true });
    expect(v.ok).toBe(true);
    expect(v.trusted).toBe(true);
    expect(v.trust).toBe('crypto-verified');
    expect(v.errors).toEqual([]);
  });

  it('trusts when score is exactly at the abuse ceiling (boundary)', () => {
    const ev = signedEvent({ content: JSON.stringify({ ...SCORE, score: 1_000_000, kills: 10_000 }) });
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(true);
    expect(v.trust).toBe('crypto-verified');
  });
});

describe('SEC-1 publishGate — malformed inputs (ok:false)', () => {
  it('returns ok:false when the event is missing', () => {
    const v = verifyPublishGate(null, { expectedSignerPubkey: PK, consent: true });
    expect(v.ok).toBe(false);
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('signed event is required');
  });

  it('returns ok:false when expectedSignerPubkey is not hex64', () => {
    const v = verifyPublishGate(signedEvent(), { expectedSignerPubkey: 'not-hex', consent: true });
    expect(v.ok).toBe(false);
    expect(v.errors).toContain('expectedSignerPubkey must be hex64');
  });
});

describe('SEC-1 publishGate — reject path (event shape / identity)', () => {
  it('rejects a wrong kind', () => {
    const v = verifyPublishGate(signedEvent({ kind: 1 }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.startsWith('kind must be'))).toBe(true);
  });

  it('rejects an event signed by a different pubkey (anti-impersonation)', () => {
    // A genuine, validly-signed event from EVIL — but not the expected player.
    const v = verifyPublishGate(signedEvent({}, EVIL_SK), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('event signer does not match expected signer pubkey');
  });

  it('rejects a missing id (tamper anchor absent)', () => {
    const v = verifyPublishGate(signedEvent({ id: 'short' }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('event id must be a hex64 string');
  });

  it('rejects a missing sig (bare unsigned template)', () => {
    const v = verifyPublishGate(signedEvent({ sig: '' }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('event sig must be a hex128 schnorr signature');
  });
});

describe('SEC-1 publishGate — reject path (created_at / tags / content)', () => {
  it('rejects a future-skewed created_at', () => {
    const future = Math.floor(Date.now() / 1000) + 600;
    const v = verifyPublishGate(signedEvent({ created_at: future }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('created_at is in the future');
  });

  it('rejects an ancient created_at', () => {
    const v = verifyPublishGate(signedEvent({ created_at: 1_000_000 }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('created_at is too far in the past');
  });

  it('rejects a missing torii-quest topic tag', () => {
    const ev = signedEvent({ tags: [['d', SCORE.runId]] });
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('missing torii-quest topic tag');
  });

  it('rejects non-JSON content', () => {
    const v = verifyPublishGate(signedEvent({ content: 'not-json' }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('content is not valid JSON');
  });

  it('rejects an invalid score (headshots exceed kills)', () => {
    const bad = { ...SCORE, kills: 1, headshots: 5 };
    const v = verifyPublishGate(signedEvent({ content: JSON.stringify(bad) }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.startsWith('invalid score'))).toBe(true);
  });
});

describe('SEC-1 publishGate — reject path (abuse ceilings + consent)', () => {
  it('rejects a score above the ceiling', () => {
    const ev = signedEvent({ content: JSON.stringify({ ...SCORE, score: 1_000_001 }) });
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('score exceeds ceiling');
  });

  it('rejects kills above the ceiling', () => {
    const ev = signedEvent({ content: JSON.stringify({ ...SCORE, kills: 10_001 }) });
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('kills exceeds ceiling');
  });

  it('rejects an oversized runId', () => {
    const ev = signedEvent({ content: JSON.stringify({ ...SCORE, runId: 'x'.repeat(129) }) });
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('runId exceeds length ceiling');
  });

  it('rejects when consent is not granted', () => {
    const v = verifyPublishGate(signedEvent(), { expectedSignerPubkey: PK, consent: false });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('consent not granted for this submission');
  });
});

describe('SEC-1 publishGate — BIP-340 schnorr crypto layer (v0.2.277)', () => {
  it('fails closed on a tampered body (id no longer binds the content)', () => {
    const ev = signedEvent();
    ev.content = JSON.stringify({ ...SCORE, score: 999 }); // mutate AFTER signing
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.trust).toBe('unverified');
    expect(v.errors).toContain('schnorr signature verification failed');
  });

  it('fails closed on a wrong-key signature (sig from another key over our id)', () => {
    const ev = signedEvent();
    ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), EVIL_SK)); // EVIL signs PK's id
    const v = verifyPublishGate(ev, { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('schnorr signature verification failed');
  });

  it('fails closed on a stub (well-shaped but non-real) signature', () => {
    const v = verifyPublishGate(signedEvent({ sig: STUB_SIG }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trusted).toBe(false);
    expect(v.errors).toContain('schnorr signature verification failed');
  });

  it('a structurally-valid but stub-signed event no longer passes (no structure-only trust)', () => {
    const v = verifyPublishGate(signedEvent({ sig: STUB_SIG }), { expectedSignerPubkey: PK, consent: true });
    expect(v.trust).not.toBe('crypto-verified');
    expect(v.trusted).toBe(false);
  });
});

describe('SEC-1 publishGate — publisher integration (gate blocks relay write)', () => {
  // The sign mock produces a REAL signed event (NIP-07-equivalent) so the gate's
  // crypto layer has a genuine signature to verify.
  const realSigner = async (t) => realSign({ ...t, created_at: NOW }, PK_SK);

  it('blocks publish() when the gate fails (consent missing) and never calls publish', async () => {
    const publish = vi.fn(async () => 'OK');
    const sign = vi.fn(realSigner);
    const pub = createLeaderboardPublisher({ sign, publish, gate: verifyPublishGate });
    const res = await pub.publishScore(SCORE, { signerPubkey: PK, consent: false });
    expect(res.signed).toBe(true);
    expect(res.published).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.errors.some((e) => e.startsWith('SEC-1 gate blocked publish'))).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it('allows publish() when the gate passes (crypto-verified)', async () => {
    const publish = vi.fn(async () => 'OK');
    const sign = vi.fn(realSigner);
    const pub = createLeaderboardPublisher({ sign, publish, gate: verifyPublishGate });
    const res = await pub.publishScore(SCORE, { signerPubkey: PK, consent: true });
    expect(res.published).toBe(true);
    expect(publish).toHaveBeenCalledOnce();
  });

  it('blocks publish() when the signer is not the expected player (forged identity)', async () => {
    const publish = vi.fn(async () => 'OK');
    const sign = vi.fn(async (t) => realSign({ ...t, created_at: NOW }, EVIL_SK));
    const pub = createLeaderboardPublisher({ sign, publish, gate: verifyPublishGate });
    const res = await pub.publishScore(SCORE, { signerPubkey: PK, consent: true });
    expect(res.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });

  it('SEC-1 (v0.2.355): omitting the gate defaults to the real crypto gate — a stub-signed event fails closed', async () => {
    // The earlier "backward compatible" bypass — where a caller could wire
    // { sign, publish } with no gate and quietly ship stub-signed events to a
    // relay — is closed. From v0.2.355 the gate DEFAULTS to verifyPublishGate,
    // so omitting it opts INTO the real crypto gate rather than out of SEC-1.
    const publish = vi.fn(async () => 'OK');
    const sign = vi.fn(async (t) => ({ ...t, sig: STUB_SIG, id: 'a'.repeat(64), pubkey: PK }));
    const pub = createLeaderboardPublisher({ sign, publish }); // no gate
    const res = await pub.publishScore(SCORE); // no ctx
    expect(res.ok).toBe(false);
    expect(res.signed).toBe(true);
    expect(res.published).toBe(false);
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.some((e) => e.startsWith('SEC-1 gate blocked publish'))).toBe(true);
  });

  it('SEC-1 (v0.2.355): an explicit `gate: null` with publish wired fails closed BEFORE signing', async () => {
    // The one true opt-out path ("I really do not want a gate") is refused when
    // publish is wired — the fail-closed construction guard blocks the call
    // before sign() is even invoked. Callers who want no gate must leave publish
    // unset (build-only), not pass gate:null.
    const publish = vi.fn(async () => 'OK');
    const sign = vi.fn(async (t) => ({ ...t, sig: STUB_SIG }));
    const pub = createLeaderboardPublisher({ sign, publish, gate: null });
    const res = await pub.publishScore(SCORE);
    expect(res.ok).toBe(false);
    expect(res.signed).toBe(false);
    expect(res.published).toBe(false);
    expect(sign).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    expect(res.errors.some((e) => e.startsWith('SEC-1: publish is wired without a gate'))).toBe(true);
  });
});
