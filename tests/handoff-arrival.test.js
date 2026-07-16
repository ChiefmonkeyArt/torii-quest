// tests/handoff-arrival.test.js — locks the arrival crypto gate + ACC-2a follow gate (v0.2.399).
// Proves readArrivingTraveller parses the spawn-URL npub, verifyArrival seats ONLY a
// real BIP-340-signed request authored by the arriving npub and addressed to this host,
// public mode preserves the old anon fallback, and follows-only mode is additive:
// the visitor must be crypto-verified AND follow the owner, with relay/missing-list
// failures denying closed rather than silently seating as anon.
import { describe, it, expect, beforeEach } from 'vitest';
import {
  readArrivingTraveller,
  verifyArrival,
  seatArrivalDecision,
  TRAVELLER_PARAM,
  ARRIVAL_MODE_PUBLIC,
  ARRIVAL_MODE_FOLLOWS_ONLY,
  FOLLOW_POLICY_OWNER_FOLLOWS_VISITOR,
  extractFollowedPubkeys,
  readLatestFollowSet,
  decideArrivalAdmission,
  __resetFollowGraphCache,
} from '../src/engine/gateway/handoffArrival.js';
import { buildTravelRequest, extractTravelRequest } from '../src/engine/gateway/travelRequest.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const TRAV_SK = hexToBytes('22'.repeat(32));
const HOST_SK = hexToBytes('11'.repeat(32));
const EVIL_SK = hexToBytes('33'.repeat(32));
const TRAV = bytesToHex(schnorr.getPublicKey(TRAV_SK));
const HOST = bytesToHex(schnorr.getPublicKey(HOST_SK));
const EVIL = bytesToHex(schnorr.getPublicKey(EVIL_SK));
const RELAYS = ['wss://relay.one', 'wss://relay.two'];

function realSign(unsigned, sk) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = { ...unsigned, pubkey };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

function signedRequest({ travellerSk = TRAV_SK, toHost = HOST } = {}) {
  const built = buildTravelRequest({
    travellerPubkey: bytesToHex(schnorr.getPublicKey(travellerSk)),
    toHostPubkey: toHost,
    toZone: 'foreign-arena',
    fromZone: 'quest-torii',
    requestId: 'req-1',
  });
  return extractTravelRequest(realSign(built.event, travellerSk)).request;
}

function followEvent(author, followed = [], createdAt = 1) {
  return {
    id: `${author.slice(0, 8)}-${createdAt}`,
    kind: 3,
    pubkey: author,
    created_at: createdAt,
    tags: followed.map((pk) => ['p', pk]),
    content: '',
  };
}

beforeEach(() => {
  __resetFollowGraphCache();
});

describe('readArrivingTraveller', () => {
  it('reads a valid hex64 traveller pubkey from the spawn URL', () => {
    const url = `https://host-b.example.com/?${TRAVELLER_PARAM}=${TRAV}`;
    const r = readArrivingTraveller(url);
    expect(r.ok).toBe(true);
    expect(r.pubkey).toBe(TRAV);
  });

  it('returns ok:false (no throw) for missing / non-hex / bad inputs', () => {
    expect(readArrivingTraveller('https://host-b.example.com/').ok).toBe(false);
    expect(readArrivingTraveller(`https://h/?${TRAVELLER_PARAM}=not-a-key`).ok).toBe(false);
    expect(readArrivingTraveller('not a url').ok).toBe(false);
    expect(readArrivingTraveller('').ok).toBe(false);
    expect(readArrivingTraveller(null).ok).toBe(false);
  });
});

describe('verifyArrival — seats only a crypto-verified request', () => {
  it('seats the arriving npub when the signed request verifies + is addressed to us', () => {
    const v = verifyArrival({ arrivingPubkey: TRAV, request: signedRequest(), expectedHostPubkey: HOST });
    expect(v.ok).toBe(true);
    expect(v.seated).toBe(true);
    expect(v.trust).toBe('crypto-verified');
    expect(v.npub).toBe(TRAV);
    expect(v.errors).toHaveLength(0);
  });

  it('fails CLOSED when the request carries no signature', () => {
    const built = buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'r' });
    const unsigned = extractTravelRequest({ ...built.event, id: 'a'.repeat(64) }).request;
    const v = verifyArrival({ arrivingPubkey: TRAV, request: unsigned, expectedHostPubkey: HOST });
    expect(v.seated).toBe(false);
    expect(v.trust).toBe('unverified');
    expect(v.npub).toBe(null);
  });

  it('fails CLOSED on a tampered body (id no longer binds content)', () => {
    const req = signedRequest();
    const tampered = { ...req, signed: { ...req.signed, content: JSON.stringify({ to: 'evil-zone' }) } };
    const v = verifyArrival({ arrivingPubkey: TRAV, request: tampered, expectedHostPubkey: HOST });
    expect(v.seated).toBe(false);
    expect(v.errors).toContain('schnorr signature verification failed');
  });

  it('fails CLOSED when the request was addressed to a DIFFERENT host', () => {
    const req = signedRequest({ toHost: EVIL });
    const v = verifyArrival({ arrivingPubkey: TRAV, request: req, expectedHostPubkey: HOST });
    expect(v.seated).toBe(false);
    expect(v.errors).toContain('request was not addressed to this host');
  });

  it('fails CLOSED when the URL npub does not match the request signer (impersonation)', () => {
    const v = verifyArrival({ arrivingPubkey: EVIL, request: signedRequest(), expectedHostPubkey: HOST });
    expect(v.seated).toBe(false);
  });

  it('rejects malformed inputs with ok:false', () => {
    expect(verifyArrival({ arrivingPubkey: 'nope', request: signedRequest(), expectedHostPubkey: HOST }).ok).toBe(false);
    expect(verifyArrival({ arrivingPubkey: TRAV, request: null, expectedHostPubkey: HOST }).ok).toBe(false);
    expect(verifyArrival({ arrivingPubkey: TRAV, request: signedRequest(), expectedHostPubkey: 'nope' }).ok).toBe(false);
  });
});

describe('seatArrivalDecision', () => {
  it('seats AS the npub on a crypto-verified verdict', () => {
    const d = seatArrivalDecision({ seated: true, npub: TRAV, trust: 'crypto-verified' });
    expect(d).toEqual({ identity: TRAV, anon: false });
  });

  it('fails closed to anon on any unverified verdict', () => {
    expect(seatArrivalDecision({ seated: false, npub: null })).toEqual({ identity: null, anon: true });
    expect(seatArrivalDecision({ seated: true, npub: 'not-hex' })).toEqual({ identity: null, anon: true });
    expect(seatArrivalDecision(null)).toEqual({ identity: null, anon: true });
  });
});

describe('follow graph parsing + cache', () => {
  it('extractFollowedPubkeys reads hex p-tags and ignores other tags', () => {
    const parsed = extractFollowedPubkeys({
      kind: 3,
      pubkey: TRAV,
      tags: [['p', HOST], ['e', 'ignored'], ['p', EVIL], ['p', 'not-hex']],
    }, TRAV);
    expect(parsed.ok).toBe(true);
    expect([...parsed.followedPubkeys]).toEqual([HOST, EVIL]);
  });

  it('readLatestFollowSet parses the latest kind:3 p tags and caches within the TTL', async () => {
    let calls = 0;
    const request = async () => {
      calls++;
      return {
        events: [
          followEvent(TRAV, [EVIL], 10),
          followEvent(TRAV, [HOST, EVIL], 20),
        ],
        used: RELAYS,
        failed: [],
      };
    };

    const first = await readLatestFollowSet({
      request,
      relays: RELAYS,
      subjectPubkey: TRAV,
      visitorPubkey: TRAV,
      ownerPubkey: HOST,
      mode: ARRIVAL_MODE_FOLLOWS_ONLY,
      cacheTtlMs: 1000,
      nowMs: 100,
    });
    const second = await readLatestFollowSet({
      request,
      relays: RELAYS,
      subjectPubkey: TRAV,
      visitorPubkey: TRAV,
      ownerPubkey: HOST,
      mode: ARRIVAL_MODE_FOLLOWS_ONLY,
      cacheTtlMs: 1000,
      nowMs: 500,
    });

    expect(first.ok).toBe(true);
    expect(first.cached).toBe(false);
    expect(first.followedPubkeys.has(HOST)).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.cached).toBe(true);
    expect(second.followedPubkeys.has(HOST)).toBe(true);
    expect(calls).toBe(1);
  });

  it('readLatestFollowSet refreshes after the TTL expires', async () => {
    let calls = 0;
    const request = async () => {
      calls++;
      return {
        events: [followEvent(TRAV, calls === 1 ? [HOST] : [EVIL], 20 + calls)],
        used: RELAYS,
        failed: [],
      };
    };

    const first = await readLatestFollowSet({
      request,
      relays: RELAYS,
      subjectPubkey: TRAV,
      visitorPubkey: TRAV,
      ownerPubkey: HOST,
      mode: ARRIVAL_MODE_FOLLOWS_ONLY,
      cacheTtlMs: 1000,
      nowMs: 100,
    });
    const second = await readLatestFollowSet({
      request,
      relays: RELAYS,
      subjectPubkey: TRAV,
      visitorPubkey: TRAV,
      ownerPubkey: HOST,
      mode: ARRIVAL_MODE_FOLLOWS_ONLY,
      cacheTtlMs: 1000,
      nowMs: 1201,
    });

    expect(first.followedPubkeys.has(HOST)).toBe(true);
    expect(second.cached).toBe(false);
    expect(second.followedPubkeys.has(HOST)).toBe(false);
    expect(second.followedPubkeys.has(EVIL)).toBe(true);
    expect(calls).toBe(2);
  });
});

describe('decideArrivalAdmission', () => {
  const verifiedVerdict = () => verifyArrival({ arrivingPubkey: TRAV, request: signedRequest(), expectedHostPubkey: HOST });

  it('public mode preserves anon fallback for unverified arrivals', async () => {
    const admit = await decideArrivalAdmission({
      verdict: { ok: true, seated: false, trust: 'unverified', npub: null, errors: ['no-verified-request'] },
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_PUBLIC,
    });
    expect(admit.seated).toBe(false);
    expect(admit.anon).toBe(true);
    expect(admit.denied).toBe(false);
  });

  it('follows-only seats a crypto-verified visitor who follows the owner', async () => {
    const request = async () => ({ events: [followEvent(TRAV, [HOST, EVIL], 50)], used: RELAYS, failed: [] });
    const admit = await decideArrivalAdmission({
      verdict: verifiedVerdict(),
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY,
      request,
      relays: RELAYS,
    });
    expect(admit.seated).toBe(true);
    expect(admit.npub).toBe(TRAV);
    expect(admit.anon).toBe(false);
    expect(admit.denied).toBe(false);
  });

  it('follows-only denies a crypto-verified visitor who does not follow the owner', async () => {
    const request = async () => ({ events: [followEvent(TRAV, [EVIL], 50)], used: RELAYS, failed: [] });
    const admit = await decideArrivalAdmission({
      verdict: verifiedVerdict(),
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY,
      request,
      relays: RELAYS,
    });
    expect(admit.seated).toBe(false);
    expect(admit.anon).toBe(false);
    expect(admit.denied).toBe(true);
    expect(admit.error).toBe('access-denied');
  });

  it('follows-only fails closed to deny on relay error or missing follow list', async () => {
    const relayError = async () => { throw new Error('timeout'); };
    const denyOnError = await decideArrivalAdmission({
      verdict: verifiedVerdict(),
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY,
      request: relayError,
      relays: RELAYS,
    });
    expect(denyOnError.denied).toBe(true);
    expect(denyOnError.anon).toBe(false);
    expect(denyOnError.error).toBe('follow-graph-unavailable');

    const missingList = async () => ({ events: [], used: RELAYS, failed: [] });
    const denyOnMissingList = await decideArrivalAdmission({
      verdict: verifiedVerdict(),
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY,
      request: missingList,
      relays: RELAYS,
    });
    expect(denyOnMissingList.denied).toBe(true);
    expect(denyOnMissingList.anon).toBe(false);
    expect(denyOnMissingList.error).toBe('missing-follow-list');
  });

  it('visitor-follows-owner does not pass when only the owner follows the visitor', async () => {
    const request = async (_relays, filters) => {
      const author = filters[0].authors[0];
      if (author === TRAV) return { events: [followEvent(TRAV, [EVIL], 40)], used: RELAYS, failed: [] };
      if (author === HOST) return { events: [followEvent(HOST, [TRAV], 40)], used: RELAYS, failed: [] };
      return { events: [], used: RELAYS, failed: [] };
    };

    const defaultPolicy = await decideArrivalAdmission({
      verdict: verifiedVerdict(),
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY,
      request,
      relays: RELAYS,
    });
    expect(defaultPolicy.seated).toBe(false);
    expect(defaultPolicy.denied).toBe(true);
    expect(defaultPolicy.error).toBe('access-denied');

    const ownerPolicy = await decideArrivalAdmission({
      verdict: verifiedVerdict(),
      ownerPubkey: HOST,
      arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY,
      followPolicy: FOLLOW_POLICY_OWNER_FOLLOWS_VISITOR,
      request,
      relays: RELAYS,
    });
    expect(ownerPolicy.seated).toBe(true);
    expect(ownerPolicy.denied).toBe(false);
  });
});
