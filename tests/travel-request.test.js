// tests/travel-request.test.js — locks the n2n signed handshake (P1, v0.2.252).
// Proves buildTravelRequest/extractTravelRequest/readTravelRequests + the host
// buildTravelResponse/extractTravelResponse/readTravelResponses round-trip a
// sanitised request↔response, and that verifyHandoff (SEC-2) clears only a
// correctly-attributed accept and fails closed on every mismatch.
import { describe, it, expect } from 'vitest';
import {
  buildTravelRequest, extractTravelRequest, readTravelRequests,
  buildTravelResponse, extractTravelResponse, readTravelResponses,
  TRAVEL_STATE,
} from '../src/engine/gateway/travelRequest.js';
import { verifyHandoff } from '../src/engine/gateway/handoffVerify.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { GATEWAY_KIND, GATEWAY_TOPIC } from '../src/engine/gateway/gatewayRead.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

// Real BIP-340 keypairs (S1) — derive nostr-style X-only pubkeys (hex64) from
// fixed secret keys so the suite is deterministic and self-contained.
const HOST_SK = hexToBytes('11'.repeat(32));
const TRAV_SK = hexToBytes('22'.repeat(32));
const EVIL_SK = hexToBytes('33'.repeat(32));
const HOST = bytesToHex(schnorr.getPublicKey(HOST_SK)); // host pubkey
const TRAV = bytesToHex(schnorr.getPublicKey(TRAV_SK)); // traveller pubkey
const EVIL = bytesToHex(schnorr.getPublicKey(EVIL_SK)); // a third party / wrong host

// realSign(unsigned, sk) — compute the NIP-01 id and sign it with BIP-340 schnorr
// (what a real nostr signer / NIP-07 extension does), locking pubkey to the key.
function realSign(unsigned, sk) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = { ...unsigned, pubkey };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

function signedFrom(unsigned, signer) {
  // Simulate NIP-07: the extension sets id + sig and locks pubkey to the signer.
  return { ...unsigned, pubkey: signer, id: 'a'.repeat(64), sig: 'd'.repeat(128) };
}

describe('buildTravelRequest', () => {
  it('builds a valid unsigned kind-30078 request addressed to the host', () => {
    const { ok, event, errors, requestId } = buildTravelRequest({
      travellerPubkey: TRAV,
      toHostPubkey: HOST,
      toZone: 'foreign-arena',
      fromZone: 'quest-torii',
      playerNpub: 'npub1' + 'a'.repeat(56),
      relays: ['wss://relay.damus.io'],
      spawn: 'https://chiefmonkey.art/quest',
      requestId: 'req-1',
    });
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(requestId).toBe('req-1');
    expect(event.kind).toBe(GATEWAY_KIND);
    expect(event.pubkey).toBe(TRAV); // traveller signs
    expect(event.tags).toContainEqual(['d', 'req-1']);
    expect(event.tags).toContainEqual(['t', GATEWAY_TOPIC]);
    expect(event.tags).toContainEqual(['state', TRAVEL_STATE.REQUEST]);
    expect(event.tags).toContainEqual(['p', HOST]); // addressed to host
    expect(event.tags).toContainEqual(['to', 'foreign-arena']);
    const content = JSON.parse(event.content);
    expect(content.to).toBe('foreign-arena');
    expect(content.relays).toEqual(['wss://relay.damus.io/']);
  });

  it('rejects a missing traveller / host pubkey / toZone', () => {
    expect(buildTravelRequest({ toHostPubkey: HOST, toZone: 'z' }).ok).toBe(false);
    expect(buildTravelRequest({ travellerPubkey: TRAV, toZone: 'z' }).ok).toBe(false);
    expect(buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST }).ok).toBe(false);
  });

  it('generates a request id when none is given', () => {
    const { ok, requestId } = buildTravelRequest({
      travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z',
    });
    expect(ok).toBe(true);
    expect(typeof requestId).toBe('string');
    expect(requestId.startsWith('req-')).toBe(true);
  });
});

describe('extractTravelRequest / readTravelRequests', () => {
  it('round-trips a signed request into a sanitised model', () => {
    const built = buildTravelRequest({
      travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'foreign-arena',
      fromZone: 'quest-torii', requestId: 'req-1',
    });
    const signed = signedFrom(built.event, TRAV);
    const r = extractTravelRequest(signed);
    expect(r.ok).toBe(true);
    expect(r.request.requestId).toBe('req-1');
    expect(r.request.travellerPubkey).toBe(TRAV);
    expect(r.request.hostPubkey).toBe(HOST);
    expect(r.request.toZone).toBe('foreign-arena');
    expect(r.request.eventId).toBe(signed.id);
  });

  it('rejects a non-request state and wrong kind/topic', () => {
    const built = buildTravelRequest({
      travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'req-1',
    });
    const wrongState = { ...built.event, tags: built.event.tags.map((t) => t[0] === 'state' ? ['state', 'accepted'] : t) };
    expect(extractTravelRequest(wrongState).ok).toBe(false);
    const wrongKind = { ...built.event, kind: 1 };
    expect(extractTravelRequest(wrongKind).ok).toBe(false);
  });

  it('readTravelRequests collects valid + skips malformed', () => {
    const b = buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'req-1' });
    const evs = [signedFrom(b.event, TRAV), { kind: 1 }, { garbage: true }];
    const r = readTravelRequests(evs);
    expect(r.count).toBe(1);
    expect(r.skipped).toHaveLength(2);
  });
});

describe('buildTravelResponse', () => {
  it('builds an accept response that references the request + addresses the traveller', () => {
    const req = buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'req-1' });
    const signedReq = signedFrom(req.event, TRAV);
    const extracted = extractTravelRequest(signedReq).request;
    const { ok, event, errors } = buildTravelResponse({
      hostPubkey: HOST, request: extracted, accepted: true,
      spawn: 'https://foreign.example.com', relays: ['wss://relay.damus.io'],
    });
    expect(ok).toBe(true);
    expect(errors).toHaveLength(0);
    expect(event.pubkey).toBe(HOST); // host signs
    expect(event.tags).toContainEqual(['state', TRAVEL_STATE.ACCEPTED]);
    expect(event.tags).toContainEqual(['e', signedReq.id]); // references the request event id
    expect(event.tags).toContainEqual(['p', TRAV]); // addressed to traveller
  });

  it('builds a deny response', () => {
    const req = extractTravelRequest(signedFrom(
      buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'req-1' }).event, TRAV)).request;
    const { ok, event } = buildTravelResponse({ hostPubkey: HOST, request: req, accepted: false });
    expect(ok).toBe(true);
    expect(event.tags).toContainEqual(['state', TRAVEL_STATE.DENIED]);
  });

  it('requires the request model + a hex host signer', () => {
    expect(buildTravelResponse({ hostPubkey: HOST, accepted: true }).ok).toBe(false);
    expect(buildTravelResponse({ hostPubkey: 'nothex', request: {}, accepted: true }).ok).toBe(false);
  });
});

describe('extractTravelResponse / readTravelResponses', () => {
  it('round-trips an accept into a sanitised response model', () => {
    const req = extractTravelRequest(signedFrom(
      buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'req-1' }).event, TRAV)).request;
    const built = buildTravelResponse({
      hostPubkey: HOST, request: req, accepted: true, spawn: 'https://foreign.example.com',
    });
    const signed = signedFrom(built.event, HOST);
    const r = extractTravelResponse(signed);
    expect(r.ok).toBe(true);
    expect(r.response.accepted).toBe(true);
    expect(r.response.hostPubkey).toBe(HOST);
    expect(r.response.travellerPubkey).toBe(TRAV);
    expect(r.response.referencesRequestId).toBe(req.eventId);
    expect(r.response.spawn).toBe('https://foreign.example.com/');
  });
});

describe('verifyHandoff (SEC-2 + S1 real BIP-340 schnorr)', () => {
  // Build a genuine host-signed accept through the real pipeline: traveller signs
  // a request → host builds + schnorr-signs an accept referencing it → extract the
  // sanitised response model (which now carries sig + signed for crypto verify).
  // Returns { response, expectedRequestId } ready for verifyHandoff. `signWith`
  // lets a test sign with a key OTHER than the envelope pubkey (forge attempt).
  function makeSignedAccept({ spawn = 'https://foreign.example.com', signWith = HOST_SK, envelopeHost } = {}) {
    const signedReq = realSign(
      buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'req-1' }).event,
      TRAV_SK,
    );
    const request = extractTravelRequest(signedReq).request;
    const built = buildTravelResponse({ hostPubkey: HOST, request, accepted: true, spawn });
    // Sign the host's accept. By default the envelope pubkey is the signer's; a
    // forge test can pin envelopeHost while signing with a different key.
    const signer = bytesToHex(schnorr.getPublicKey(signWith));
    const evt = { ...built.event, pubkey: envelopeHost || signer };
    const id = nostrEventId(evt);
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), signWith));
    const signed = { ...evt, id, sig };
    const response = extractTravelResponse(signed).response;
    return { response, expectedRequestId: signedReq.id };
  }

  it('(a) clears a valid BIP-340-signed accept → trust: crypto-verified', () => {
    const { response, expectedRequestId } = makeSignedAccept();
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.ok).toBe(true);
    expect(v.trusted).toBe(true);
    expect(v.trust).toBe('crypto-verified');
    expect(v.errors).toHaveLength(0);
  });

  it('(b) fails closed when the signed body is tampered after signing', () => {
    const { response, expectedRequestId } = makeSignedAccept();
    response.signed.content = response.signed.content.replace('foreign', 'evil-host'); // recomputed id no longer matches
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('schnorr'))).toBe(true);
  });

  it('(c) fails closed when the sig is from the wrong key (envelope says host)', () => {
    // Envelope pubkey claims HOST, but the signature was produced by EVIL's key.
    const { response, expectedRequestId } = makeSignedAccept({ signWith: EVIL_SK, envelopeHost: HOST });
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('schnorr'))).toBe(true);
  });

  it('(d) fails closed when the response carries no signature', () => {
    const { response, expectedRequestId } = makeSignedAccept();
    delete response.sig;
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('not crypto-signed'))).toBe(true);
  });

  it('(e) a structurally-valid but UNSIGNED accept no longer arms (no trusted:true)', () => {
    // The pre-S1 structural-only path: every structural field matches, but there
    // is no signature. This must NOT yield trusted:true anymore.
    const unsigned = {
      hostPubkey: HOST, travellerPubkey: TRAV, referencesRequestId: 'ev-req',
      spawn: 'https://foreign.example.com', accepted: true,
    };
    const v = verifyHandoff({
      response: unsigned, expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.trust).toBe('unverified');
    expect(v.errors.some((e) => e.includes('not crypto-signed'))).toBe(true);
  });

  it('fails closed on a deny', () => {
    const { response, expectedRequestId } = makeSignedAccept();
    response.accepted = false;
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('not an accept'))).toBe(true);
  });

  it('fails closed when the response references a different request id', () => {
    const { response } = makeSignedAccept();
    const v = verifyHandoff({
      response, expectedRequestId: 'a'.repeat(64), expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('request id'))).toBe(true);
  });

  it('fails closed when signed by the wrong host', () => {
    // Genuine accept fully signed by EVIL (envelope + sig both EVIL).
    const { response, expectedRequestId } = makeSignedAccept({ signWith: EVIL_SK });
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('host'))).toBe(true);
  });

  it('fails closed when not addressed to our traveller pubkey', () => {
    const { response, expectedRequestId } = makeSignedAccept();
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: EVIL,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('traveller'))).toBe(true);
  });

  it('fails closed on a non-https / absent spawn', () => {
    const { response, expectedRequestId } = makeSignedAccept({ spawn: 'http://insecure.example.com' });
    const v = verifyHandoff({
      response, expectedRequestId, expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('spawn'))).toBe(true);
  });

  it('rejects malformed expectations (ok:false)', () => {
    const { response } = makeSignedAccept();
    expect(verifyHandoff({ response, expectedRequestId: '', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV }).ok).toBe(false);
    expect(verifyHandoff({ response: null, expectedRequestId: 'x', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV }).ok).toBe(false);
  });
});
