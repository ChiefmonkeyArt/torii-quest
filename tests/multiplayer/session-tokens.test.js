// session-tokens.test.js — locks the server session-token authority
// (v0.2.375-alpha, "1 sign at login, 0 signs in-game").
//
// Pure + node-fast: the clock, RNG and stores are injected, so the whole
// challenge → login-event → token lifecycle runs without a socket or a signer.
// One case exercises the REAL schnorr verifier end-to-end; the rest inject a
// verifier stub to isolate the structural checks.
import { describe, it, expect, vi } from 'vitest';
import {
  createSessionTokens,
  CHALLENGE_TTL_MS, TOKEN_TTL_MS, LOGIN_EVENT_KIND,
} from '../../server/auth/sessionTokens.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { sha256 as sha256fn } from '@noble/hashes/sha2.js';

const SK = hexToBytes('a1'.repeat(32));
const PUBKEY = bytesToHex(schnorr.getPublicKey(SK)); // x-only hex64

function sha256Hex(str) {
  return bytesToHex(sha256fn(new TextEncoder().encode(str)));
}

// A real NIP-98 (kind:27235) login event bound to `challenge`, schnorr-signed.
function signLoginEvent({ challenge, sk = SK, url = 'https://host/mp/session', method = 'POST', kind = LOGIN_EVENT_KIND }) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = {
    pubkey,
    kind,
    created_at: 1_700_000_000,
    content: '',
    tags: [
      ['u', url],
      ['method', method],
      ['challenge', challenge],
    ],
  };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

describe('createSessionTokens — challenges', () => {
  it('issues a fresh hex challenge with a TTL and stores it', () => {
    const st = createSessionTokens();
    const { challenge, ttl } = st.issueChallenge();
    expect(challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(ttl).toBe(Math.floor(CHALLENGE_TTL_MS / 1000));
    expect(st._challengeStore.has(challenge)).toBe(true);
  });

  it('challenges are one-time-use: a second verify against the same nonce fails', () => {
    const st = createSessionTokens({ verifyEventSig: () => true });
    const { challenge } = st.issueChallenge();
    const evt = signLoginEvent({ challenge });
    expect(st.verifyLoginEvent({ event: evt, challenge })).toBe(evt.pubkey);
    // Consumed — replay must fail.
    expect(st.verifyLoginEvent({ event: evt, challenge })).toBeNull();
  });

  it('rejects an expired challenge', () => {
    let t = 1000;
    const st = createSessionTokens({ now: () => t, verifyEventSig: () => true });
    const { challenge } = st.issueChallenge();
    const evt = signLoginEvent({ challenge });
    t += CHALLENGE_TTL_MS + 1;
    expect(st.verifyLoginEvent({ event: evt, challenge })).toBeNull();
  });
});

describe('createSessionTokens — verifyLoginEvent structure checks', () => {
  function st() { return createSessionTokens({ verifyEventSig: () => true }); }

  it('accepts a well-formed event and returns the hex pubkey', () => {
    const s = st();
    const { challenge } = s.issueChallenge();
    const evt = signLoginEvent({ challenge });
    expect(s.verifyLoginEvent({ event: evt, challenge })).toBe(PUBKEY);
  });

  it('rejects the wrong event kind', () => {
    const s = st();
    const { challenge } = s.issueChallenge();
    const evt = signLoginEvent({ challenge, kind: 1 });
    expect(s.verifyLoginEvent({ event: evt, challenge })).toBeNull();
  });

  it('rejects a mismatched challenge tag', () => {
    const s = st();
    const { challenge } = s.issueChallenge();
    const evt = signLoginEvent({ challenge: 'f'.repeat(64) });
    expect(s.verifyLoginEvent({ event: evt, challenge })).toBeNull();
  });

  it('rejects a non-POST method', () => {
    const s = st();
    const { challenge } = s.issueChallenge();
    const evt = signLoginEvent({ challenge, method: 'GET' });
    expect(s.verifyLoginEvent({ event: evt, challenge })).toBeNull();
  });

  it('rejects when the signature verifier says no', () => {
    const s = createSessionTokens({ verifyEventSig: () => false });
    const { challenge } = s.issueChallenge();
    const evt = signLoginEvent({ challenge });
    expect(s.verifyLoginEvent({ event: evt, challenge })).toBeNull();
  });

  it('verifies a genuinely-signed event with the real schnorr verifier', () => {
    const s = createSessionTokens(); // default verifyNostrEventSig
    const { challenge } = s.issueChallenge();
    const evt = signLoginEvent({ challenge });
    expect(s.verifyLoginEvent({ event: evt, challenge })).toBe(PUBKEY);
    // A tampered event must fail the real verifier.
    const { challenge: c2 } = s.issueChallenge();
    const bad = signLoginEvent({ challenge: c2 });
    bad.sig = 'b'.repeat(128);
    expect(s.verifyLoginEvent({ event: bad, challenge: c2 })).toBeNull();
  });
});

describe('createSessionTokens — tokens', () => {
  it('issues a token, stores ONLY its sha256, and never the raw token', () => {
    const st = createSessionTokens();
    const token = st.issueToken(PUBKEY);
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    // The raw token must not be a key or value anywhere in the store.
    const keys = [...st._tokenStore.keys()];
    expect(keys).not.toContain(token);
    expect(keys).toContain(sha256Hex(token));
    for (const rec of st._tokenStore.values()) {
      expect(JSON.stringify(rec)).not.toContain(token);
      expect(rec.pubkey).toBe(PUBKEY);
    }
  });

  it('verifyToken returns the bound pubkey for a valid token', () => {
    const st = createSessionTokens();
    const token = st.issueToken(PUBKEY);
    expect(st.verifyToken(token)).toBe(PUBKEY);
  });

  it('verifyToken rejects an unknown token', () => {
    const st = createSessionTokens();
    expect(st.verifyToken('nope')).toBeNull();
    expect(st.verifyToken('')).toBeNull();
    expect(st.verifyToken(null)).toBeNull();
  });

  it('verifyToken rejects an expired token and purges it', () => {
    let t = 1000;
    const st = createSessionTokens({ now: () => t });
    const token = st.issueToken(PUBKEY);
    t += TOKEN_TTL_MS + 1;
    expect(st.verifyToken(token)).toBeNull();
    expect(st._tokenStore.size).toBe(0);
  });

  it('issueToken rejects a malformed (non-hex64) pubkey', () => {
    const st = createSessionTokens();
    expect(st.issueToken('npub1xxx')).toBeNull();
    expect(st.issueToken('')).toBeNull();
  });
});

describe('createSessionTokens — cleanup', () => {
  it('purges expired challenges and tokens but keeps live ones', () => {
    let t = 1000;
    const st = createSessionTokens({ now: () => t, verifyEventSig: () => true });
    const { challenge: expiring } = st.issueChallenge();
    const expiredToken = st.issueToken(PUBKEY);
    t += TOKEN_TTL_MS + 1;
    const liveToken = st.issueToken(PUBKEY);
    const { challenge: liveChallenge } = st.issueChallenge();
    st.cleanup();
    expect(st._challengeStore.has(expiring)).toBe(false);
    expect(st._challengeStore.has(liveChallenge)).toBe(true);
    expect(st.verifyToken(expiredToken)).toBeNull();
    expect(st.verifyToken(liveToken)).toBe(PUBKEY);
  });
});
