// travel-token.test.js — locks the signed travel token (v0.2.847-alpha):
// the pure client verifier (src/engine/gateway/travelToken.js) and the server
// single-use authority (server/auth/travelToken.js). Node-pure; one case runs the
// REAL schnorr verifier end-to-end.
import { describe, it, expect } from 'vitest';
import {
  buildTravelUnsigned, verifyTravelEvent, signTravelToken,
  travelAudienceFromWebsite,
  TRAVEL_EVENT_KIND, TRAVEL_ACTION, TRAVEL_TTL_S,
} from '../../src/engine/gateway/travelToken.js';
import { createTravelTokens, defaultTravelAudienceUrl } from '../../server/auth/travelToken.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const SK = hexToBytes('a1'.repeat(32));
const PUBKEY = bytesToHex(schnorr.getPublicKey(SK));
const AUDIENCE = 'https://bekka.world/mp/travel';
const NOW_MS = 1_757_934_400_000; // fixed clock
const NOW_SEC = Math.floor(NOW_MS / 1000);

function signEvent({
  sk = SK, created = NOW_SEC, expiration = NOW_SEC + TRAVEL_TTL_S,
  action = TRAVEL_ACTION, audience = AUDIENCE, kind = TRAVEL_EVENT_KIND,
} = {}) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = {
    pubkey, kind, created_at: created, content: '',
    tags: [['u', audience], ['t', action], ['expiration', String(expiration)]],
  };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

describe('buildTravelUnsigned', () => {
  it('builds a kind:27235 event with u/t/expiration tags, addressed to the audience', () => {
    const u = buildTravelUnsigned({ audienceUrl: AUDIENCE, nowMs: NOW_MS });
    expect(u.kind).toBe(TRAVEL_EVENT_KIND);
    expect(u.created_at).toBe(NOW_SEC);
    expect(u.content).toBe('');
    const tags = Object.fromEntries(u.tags.map(([k, v]) => [k, v]));
    expect(tags.u).toBe(AUDIENCE);
    expect(tags.t).toBe(TRAVEL_ACTION);
    expect(Number(tags.expiration)).toBe(NOW_SEC + TRAVEL_TTL_S);
  });

  it('returns null for a blank audience', () => {
    expect(buildTravelUnsigned({ audienceUrl: '', nowMs: NOW_MS })).toBeNull();
  });
});

describe('travelAudienceFromWebsite', () => {
  it('derives origin + /mp/travel from a world website', () => {
    expect(travelAudienceFromWebsite('https://bekka.world/')).toBe('https://bekka.world/mp/travel');
    expect(travelAudienceFromWebsite('https://bekka.world/quest/')).toBe('https://bekka.world/mp/travel');
  });

  it('returns empty for an unparseable website', () => {
    expect(travelAudienceFromWebsite('')).toBe('');
    expect(travelAudienceFromWebsite('not a url')).toBe('');
  });
});

describe('verifyTravelEvent', () => {
  it('accepts a valid signed event addressed to the audience', () => {
    const evt = signEvent();
    const r = verifyTravelEvent({ event: evt, audienceUrl: AUDIENCE, nowMs: NOW_MS });
    expect(r.ok).toBe(true);
    expect(r.pubkey).toBe(PUBKEY);
  });

  it('rejects a mismatched audience', () => {
    const evt = signEvent({ audience: 'https://other.world/mp/travel' });
    expect(verifyTravelEvent({ event: evt, audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('bad-audience');
  });

  it('rejects a non-travel action', () => {
    const evt = signEvent({ action: 'post' });
    expect(verifyTravelEvent({ event: evt, audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('bad-action');
  });

  it('rejects an expired token', () => {
    const evt = signEvent({ expiration: NOW_SEC - 1 });
    expect(verifyTravelEvent({ event: evt, audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('expired');
  });

  it('rejects a stale (future-dated beyond skew) token', () => {
    const evt = signEvent({ created: NOW_SEC + 99999 });
    expect(verifyTravelEvent({ event: evt, audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('stale');
  });

  it('rejects a tampered event (bad signature)', () => {
    const evt = signEvent();
    const tampered = { ...evt, content: 'tampered' }; // id/sig no longer match
    expect(verifyTravelEvent({ event: tampered, audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('bad-sig');
  });

  it('rejects a non-event / wrong kind', () => {
    expect(verifyTravelEvent({ event: null, audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('bad-event');
    expect(verifyTravelEvent({ event: signEvent({ kind: 1 }), audienceUrl: AUDIENCE, nowMs: NOW_MS }).reason).toBe('bad-kind');
  });
});

describe('signTravelToken', () => {
  it('returns the signed event when the signer agrees', async () => {
    const unsigned = buildTravelUnsigned({ audienceUrl: AUDIENCE, nowMs: NOW_MS });
    const signed = await signTravelToken({ unsigned, signEvent: async () => signEvent() });
    expect(signed.pubkey).toBe(PUBKEY);
    expect(signed.sig).toMatch(/^[0-9a-f]{128}$/);
  });

  it('returns null on a missing signer or rejection', async () => {
    const unsigned = buildTravelUnsigned({ audienceUrl: AUDIENCE, nowMs: NOW_MS });
    expect(await signTravelToken({ unsigned })).toBeNull();
    expect(await signTravelToken({ unsigned, signEvent: async () => { throw new Error('denied'); } })).toBeNull();
  });
});

describe('createTravelTokens (server single-use)', () => {
  it('verifies + consumes a valid token, and rejects a replay of the same event.id', () => {
    const auth = createTravelTokens({ audienceUrl: AUDIENCE, now: () => NOW_MS });
    const spy = { consumed: auth._consumedStore };
    const evt = signEvent();
    expect(auth.verifyAndConsume(evt)).toBe(PUBKEY);
    expect(spy.consumed.has(evt.id)).toBe(true);
    // Replay the SAME token → fail (single-use).
    expect(auth.verifyAndConsume(evt)).toBeNull();
  });

  it('rejects a token addressed to a different audience', () => {
    const auth = createTravelTokens({ audienceUrl: AUDIENCE, now: () => NOW_MS });
    const evt = signEvent({ audience: 'https://other.world/mp/travel' });
    expect(auth.verifyAndConsume(evt)).toBeNull();
  });

  it('rejects an expired token against the injected clock', () => {
    const auth = createTravelTokens({ audienceUrl: AUDIENCE, now: () => NOW_MS + 600_000 });
    const evt = signEvent(); // expires at NOW_SEC + 300, but clock is +600s
    expect(auth.verifyAndConsume(evt)).toBeNull();
  });
});

describe('defaultTravelAudienceUrl', () => {
  it('derives origin + /mp/travel from QUEST_PUBLIC_URL', () => {
    expect(defaultTravelAudienceUrl({ QUEST_PUBLIC_URL: 'https://bekka.world/quest/' })).toBe('https://bekka.world/mp/travel');
  });

  it('prefers an explicit TRAVEL_AUDIENCE_URL', () => {
    expect(defaultTravelAudienceUrl({ TRAVEL_AUDIENCE_URL: 'https://x/mp/travel', QUEST_PUBLIC_URL: 'https://y/' })).toBe('https://x/mp/travel');
  });

  it('returns empty when unconfigured', () => {
    expect(defaultTravelAudienceUrl({})).toBe('');
  });
});