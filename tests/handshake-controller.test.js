// tests/handshake-controller.test.js — locks the live handshake state machine (P1, v0.2.252).
// Proves the controller: publishes a signed travel request (traveller), arms the
// hop only on a SEC-2-verified accept (and NOT on a deny / wrong host / wrong
// request), surfaces incoming requests (host), and publishes a signed accept
// response. All transports are fakes; the controller is DOM-free.
import { describe, it, expect } from 'vitest';
import { createHandshakeController } from '../src/engine/gateway/handshakeController.js';
import {
  buildTravelRequest, buildTravelResponse, extractTravelRequest,
} from '../src/engine/gateway/travelRequest.js';
import { GATEWAY_KIND, GATEWAY_TOPIC } from '../src/engine/gateway/gatewayRead.js';

const TRAV = 'b'.repeat(64);
const HOST = '9'.repeat(64);
const EVIL = 'c'.repeat(64);
const EV = 'a'.repeat(64); // deterministic event id

const RELAYS = ['wss://relay.damus.io'];

// Fake sign: NIP-07 sets id + sig + locks pubkey to the signer.
function fakeSign(signer) {
  return async (unsigned) => ({ ok: true, event: { ...unsigned, pubkey: signer, id: EV, sig: 'd'.repeat(128) }, error: null });
}
const fakePublish = async (relays) => ({ accepted: relays.length, used: relays, failed: [] });

function world(pubkey = HOST, zoneId = 'foreign-arena', title = 'Foreign Arena') {
  return { pubkey, zoneId, title, shortPubkey: pubkey.slice(0, 8) };
}

describe('handshakeController — traveller side', () => {
  it('publishes a signed travel request and enters pending', async () => {
    let published = null;
    const sign = fakeSign(TRAV);
    const publish = async (relays, event) => { published = event; return fakePublish(relays); };
    const c = createHandshakeController({ request: async () => ({ events: [], used: [], failed: [] }), sign, publish, relays: RELAYS, ourPubkey: TRAV });
    const r = await c.requestTravel(world());
    expect(r.ok).toBe(true);
    expect(published.kind).toBe(GATEWAY_KIND);
    expect(published.pubkey).toBe(TRAV);
    expect(published.tags).toContainEqual(['p', HOST]);
    expect(c.view().mode).toBe('pending');
  });

  it('arms the hop only on a SEC-2-verified accept', async () => {
    // The accept the host will return from the poll: references our request event
    // id (EV), signed by HOST, addressed to TRAV, https spawn.
    const acceptEvent = (() => {
      const built = buildTravelResponse({
        hostPubkey: HOST,
        request: { travellerPubkey: TRAV, eventId: EV, toZone: 'foreign-arena', requestId: 'req-1' },
        accepted: true, spawn: 'https://foreign.example.com', relays: RELAYS,
      });
      return { ...built.event, pubkey: HOST, id: EV, sig: 'd'.repeat(128) };
    })();
    const request = async () => ({ events: [acceptEvent], used: RELAYS, failed: [] });
    const c = createHandshakeController({ request, sign: fakeSign(TRAV), publish: fakePublish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world());
    expect(c.view().mode).toBe('pending');
    await c.tick();
    expect(c.snapshot().armed).not.toBeNull();
    expect(c.view().mode).toBe('armed');
    expect(c.view().badge).toBe('LIVE · JUMP READY');
  });

  it('does NOT arm on a deny', async () => {
    const denyEvent = (() => {
      const built = buildTravelResponse({
        hostPubkey: HOST,
        request: { travellerPubkey: TRAV, eventId: EV, toZone: 'z', requestId: 'r' },
        accepted: false,
      });
      return { ...built.event, pubkey: HOST, id: EV, sig: 'd'.repeat(128) };
    })();
    const c = createHandshakeController({ request: async () => ({ events: [denyEvent], used: [], failed: [] }), sign: fakeSign(TRAV), publish: fakePublish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world());
    await c.tick();
    expect(c.snapshot().armed).toBeNull();
    expect(c.view().mode).toBe('pending'); // still awaiting a real accept
  });

  it('does NOT arm on an accept signed by the wrong host', async () => {
    const evilAccept = (() => {
      const built = buildTravelResponse({
        hostPubkey: EVIL,
        request: { travellerPubkey: TRAV, eventId: EV, toZone: 'z', requestId: 'r' },
        accepted: true, spawn: 'https://foreign.example.com',
      });
      return { ...built.event, pubkey: EVIL, id: EV, sig: 'd'.repeat(128) };
    })();
    const c = createHandshakeController({ request: async () => ({ events: [evilAccept], used: [], failed: [] }), sign: fakeSign(TRAV), publish: fakePublish, relays: RELAYS, ourPubkey: TRAV });
    await c.requestTravel(world(HOST)); // we asked HOST
    await c.tick();
    expect(c.snapshot().armed).toBeNull(); // EVIL's accept must not arm
  });

  it('no-ops cleanly when not logged in', async () => {
    const c = createHandshakeController({ request: async () => ({ events: [], used: [], failed: [] }), sign: fakeSign(TRAV), publish: fakePublish, relays: RELAYS, ourPubkey: '' });
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
    const reqEvent = (() => {
      const built = buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'quest-torii', fromZone: 'foreign', requestId: 'req-1' });
      return { ...built.event, pubkey: TRAV, id: EV, sig: 'd'.repeat(128) };
    })();
    let publishedResponse = null;
    const request = async () => ({ events: [reqEvent], used: [], failed: [] });
    const publish = async (relays, event) => { publishedResponse = event; return fakePublish(relays); };
    const c = createHandshakeController({ request, sign: fakeSign(HOST), publish, relays: RELAYS, ourPubkey: HOST });
    await c.tick();
    expect(c.view().mode).toBe('incoming');
    expect(c.view().actions).toEqual(expect.arrayContaining(['accept', 'deny']));
    const r = await c.respondIncoming(true, { spawn: 'https://quest-torii.pplx.app' });
    expect(r.ok).toBe(true);
    expect(publishedResponse.pubkey).toBe(HOST); // host signs
    expect(publishedResponse.tags).toContainEqual(['state', 'accepted']);
    expect(publishedResponse.tags).toContainEqual(['e', EV]); // references the request
    expect(publishedResponse.tags).toContainEqual(['p', TRAV]); // addressed to traveller
    expect(c.view().mode).toBe('scan'); // incoming cleared after responding
  });

  it('publishes a deny', async () => {
    const reqEvent = (() => {
      const built = buildTravelRequest({ travellerPubkey: TRAV, toHostPubkey: HOST, toZone: 'z', requestId: 'r' });
      return { ...built.event, pubkey: TRAV, id: EV, sig: 'd'.repeat(128) };
    })();
    let publishedResponse = null;
    const c = createHandshakeController({
      request: async () => ({ events: [reqEvent], used: [], failed: [] }),
      sign: fakeSign(HOST),
      publish: async (relays, event) => { publishedResponse = event; return fakePublish(relays); },
      relays: RELAYS, ourPubkey: HOST,
    });
    await c.tick();
    const r = await c.respondIncoming(false);
    expect(r.ok).toBe(true);
    expect(publishedResponse.tags).toContainEqual(['state', 'denied']);
  });
});
