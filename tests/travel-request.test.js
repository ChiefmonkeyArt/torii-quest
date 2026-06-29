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
import { GATEWAY_KIND, GATEWAY_TOPIC } from '../src/engine/gateway/gatewayRead.js';

const TRAV = 'b'.repeat(64);   // traveller pubkey
const HOST = '9'.repeat(64);   // host pubkey
const EVIL = 'c'.repeat(64);  // a third party / wrong host

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
      spawn: 'https://quest-torii.pplx.app',
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

describe('verifyHandoff (SEC-2)', () => {
  function makeAccept({ hostPubkey = HOST, travellerPubkey = TRAV, referencesRequestId = 'ev-req', spawn = 'https://foreign.example.com', accepted = true } = {}) {
    return { hostPubkey, travellerPubkey, referencesRequestId, spawn, accepted };
  }

  it('clears a correctly-attributed accept (host-matched, structural)', () => {
    const v = verifyHandoff({
      response: makeAccept({ referencesRequestId: 'ev-req' }),
      expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.ok).toBe(true);
    expect(v.trusted).toBe(true);
    expect(v.trust).toBe('host-matched');
    expect(v.errors).toHaveLength(0);
  });

  it('fails closed on a deny', () => {
    const v = verifyHandoff({
      response: makeAccept({ accepted: false }),
      expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('not an accept'))).toBe(true);
  });

  it('fails closed when the response references a different request id', () => {
    const v = verifyHandoff({
      response: makeAccept({ referencesRequestId: 'someone-elses-req' }),
      expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('request id'))).toBe(true);
  });

  it('fails closed when signed by the wrong host', () => {
    const v = verifyHandoff({
      response: makeAccept({ hostPubkey: EVIL }),
      expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('host'))).toBe(true);
  });

  it('fails closed when not addressed to our traveller pubkey', () => {
    const v = verifyHandoff({
      response: makeAccept({ travellerPubkey: EVIL }),
      expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('traveller'))).toBe(true);
  });

  it('fails closed on a non-https / absent spawn', () => {
    const v = verifyHandoff({
      response: makeAccept({ spawn: 'http://insecure.example.com' }),
      expectedRequestId: 'ev-req', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV,
    });
    expect(v.trusted).toBe(false);
    expect(v.errors.some((e) => e.includes('spawn'))).toBe(true);
  });

  it('rejects malformed expectations (ok:false)', () => {
    expect(verifyHandoff({ response: makeAccept(), expectedRequestId: '', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV }).ok).toBe(false);
    expect(verifyHandoff({ response: null, expectedRequestId: 'x', expectedHostPubkey: HOST, expectedTravellerPubkey: TRAV }).ok).toBe(false);
  });
});
