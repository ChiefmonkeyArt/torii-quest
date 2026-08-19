// tests/handshake-controller.test.js — locks the live handshake state machine (P1, v0.2.252;
// real BIP-340 arming, S1 v0.2.263).
// Proves the controller: publishes a signed travel request (traveller), arms the
// hop only on a SEC-2 + S1 crypto-verified accept (and NOT on a deny / wrong host /
// wrong request / fake sig), surfaces incoming requests (host), and publishes a
// signed accept response. All transports are fakes; the controller is DOM-free.
import { describe, it, expect } from 'vitest';
import { createHandshakeController } from '../src/engine/gateway/handshakeController.js';
import {
  buildTravelRequest, buildTravelResponse, extractTravelRequest,
} from '../src/engine/gateway/travelRequest.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { GATEWAY_KIND, GATEWAY_TOPIC } from '../src/engine/gateway/gatewayRead.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const TRAV_SK = hexToBytes('22'.repeat(32));
const HOST_SK = hexToBytes('11'.repeat(32));
const EVIL_SK = hexToBytes('33'.repeat(32));
const TRAV = bytesToHex(schnorr.getPublicKey(TRAV_SK));
const HOST = bytesToHex(schnorr.getPublicKey(HOST_SK));
const EVIL = bytesToHex(schnorr.getPublicKey(EVIL_SK));

const RELAYS = ['wss://relay.damus.io'];

// Real NIP-07-style signer: compute the canonical event id and BIP-340 schnorr
// sign it, locking the pubkey to the signing key.
function realSigner(sk) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  return async (unsigned) => {
    const evt = { ...unsigned, pubkey };
    const id = nostrEventId(evt);
    const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
    return { ok: true, event: { ...evt, id, sig }, error: null };
  };
}
// Sign an arbitrary unsigned event object directly (for poll fakes).
function realSign(unsigned, sk, { envelopeHost } = {}) {
  const pubkey = envelopeHost || bytesToHex(schnorr.getPublicKey(sk));
  const evt = { ...unsigned, pubkey };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}
const fakePublish = async (relays) => ({ accepted: relays.length, used: relays, failed: [] });

function world(pubkey = HOST, zoneId = 'foreign-arena', title = 'Foreign Arena') {
  return { pubkey, zoneId, title, shortPubkey: pubkey.slice(0, 8) };
}

// Build a real host-signed accept referencing the traveller's published request.
function signedAccept(publishedReq, { signSk = HOST_SK, envelopeHost, spawn = 'https://foreign.example.com', accepted = true } = {}) {
  const request = extractTravelRequest(publishedReq).request;
  const built = buildTravelResponse({ hostPubkey: HOST, request, accepted, spawn, relays: RELAYS });
  return realSign(built.event, signSk, { envelopeHost });
}

describe('handshakeController — traveller side', () => {
  it('publishes a signed travel request and enters pending', async () => {
    let published = null;
    const publish = async (relays, event) => { published = event; return fakePublish(relays); };
    const c = createHandshakeController({ request: async () => ({ events: [], used: [], failed: [] }), sign: realSigner(TRAV_SK), publish, relays: RELAYS, ourPubkey: TRAV });
    const r = await c.requestTravel(world());
    expect(r.ok).toBe(true);
    expect(published.kind).toBe(GATEWAY_KIND);
    expect(published.pubkey).toBe(TRAV);
    expect(published.tags).toContainEqual(['p', HOST]);
    expect(c.view().mode).toBe('pending');
  });

  it('arms the hop only on a SEC-2 + S1 crypto-verified accept', async () => {
    let published = null;
    const publish = async (relays, event) => { published = event; return fakePublish(relays); };
    // The poll returns the host's real schnorr-signed accept referencing our request.
    const request = async () => ({ events: published ? [signedAccept(published)] : [], used: RELAYS, failed: [] });
    const c = createHandshakeController({ request, sign: realSigner(TRAV_SK), publish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world());
    expect(c.view().mode).toBe('pending');
    await c.tick();
    expect(c.snapshot().armed).not.toBeNull();
    expect(c.view().mode).toBe('armed');
    expect(c.view().badge).toBe('LIVE · JUMP READY');
  });

  it('does NOT arm on an accept with a forged (invalid) signature', async () => {
    let published = null;
    const publish = async (relays, event) => { published = event; return fakePublish(relays); };
    // Envelope claims HOST but the signature is EVIL's — schnorr verify must fail.
    const request = async () => ({ events: published ? [signedAccept(published, { signSk: EVIL_SK, envelopeHost: HOST })] : [], used: RELAYS, failed: [] });
    const c = createHandshakeController({ request, sign: realSigner(TRAV_SK), publish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world());
    await c.tick();
    expect(c.snapshot().armed).toBeNull(); // a bad sig must not arm
    expect(c.view().mode).toBe('pending');
  });

  it('does NOT arm on a deny', async () => {
    let published = null;
    const publish = async (relays, event) => { published = event; return fakePublish(relays); };
    const request = async () => ({ events: published ? [signedAccept(published, { accepted: false })] : [], used: [], failed: [] });
    const c = createHandshakeController({ request, sign: realSigner(TRAV_SK), publish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world());
    await c.tick();
    expect(c.snapshot().armed).toBeNull();
    expect(c.view().mode).toBe('pending'); // still awaiting a real accept
  });

  it('does NOT arm on an accept signed by the wrong host', async () => {
    let published = null;
    const publish = async (relays, event) => { published = event; return fakePublish(relays); };
    // Fully EVIL-signed accept (envelope + sig both EVIL) — wrong host.
    const request = async () => ({ events: published ? [signedAccept(published, { signSk: EVIL_SK })] : [], used: [], failed: [] });
    const c = createHandshakeController({ request, sign: realSigner(TRAV_SK), publish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world(HOST)); // we asked HOST
    await c.tick();
    expect(c.snapshot().armed).toBeNull(); // EVIL's accept must not arm
  });

  it('no-ops cleanly when not logged in', async () => {
    const c = createHandshakeController({ request: async () => ({ events: [], used: [], failed: [] }), sign: realSigner(TRAV_SK), publish: fakePublish, relays: RELAYS, ourPubkey: '' });
    const r = await c.requestTravel(world());
    expect(r.ok).toBe(false);
    expect(r.error).toBe('not-logged-in');
    await c.tick(); // must not throw
    expect(c.view().mode).toBe('scan');
  });
});

describe('handshakeController — host side', () => {
  it('surfaces an incoming request and publishes a signed accept', async () => {
    // A traveller (TRAV) sent us (HOST) a request addressed to HOST.
    const reqEvent = realSign(
      buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'quest-torii', fromZone: 'foreign', requestId: 'req-1' }).event,
      TRAV_SK,
    );
    let publishedResponse = null;
    const request = async () => ({ events: [reqEvent], used: [], failed: [] });
    const publish = async (relays, event) => { publishedResponse = event; return fakePublish(relays); };
    const c = createHandshakeController({ request, sign: realSigner(HOST_SK), publish, relays: RELAYS, ourPubkey: HOST });
    await c.tick();
    expect(c.view().mode).toBe('incoming');
    expect(c.view().actions).toEqual(expect.arrayContaining(['accept', 'deny']));
    const r = await c.respondIncoming(true, { spawn: 'https://chiefmonkey.art/quest' });
    expect(r.ok).toBe(true);
    expect(publishedResponse.pubkey).toBe(HOST); // host signs
    expect(publishedResponse.tags).toContainEqual(['state', 'accepted']);
    expect(publishedResponse.tags).toContainEqual(['e', reqEvent.id]); // references the request
    expect(publishedResponse.tags).toContainEqual(['p', TRAV]); // addressed to traveller
    expect(c.view().mode).toBe('scan'); // incoming cleared after responding
  });

  it('publishes a deny', async () => {
    const reqEvent = realSign(
      buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'r' }).event,
      TRAV_SK,
    );
    let publishedResponse = null;
    const c = createHandshakeController({
      request: async () => ({ events: [reqEvent], used: [], failed: [] }),
      sign: realSigner(HOST_SK),
      publish: async (relays, event) => { publishedResponse = event; return fakePublish(relays); },
      relays: RELAYS, ourPubkey: HOST,
    });
    await c.tick();
    const r = await c.respondIncoming(false);
    expect(r.ok).toBe(true);
    expect(publishedResponse.tags).toContainEqual(['state', 'denied']);
  });
});
