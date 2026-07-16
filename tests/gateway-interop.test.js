// tests/gateway-interop.test.js — P3 two-instance interop proof (v0.2.274).
// The cross-host n2n hop, end to end, WITHOUT two real hosts: two independent
// handshake-controller instances (instance A = traveller, instance B = host), each
// with its own BIP-340 keypair, talking over ONE shared in-memory relay. We drive the
// full live flow — A requests → B surfaces + accepts → A verifies (SEC-2/S1) + arms →
// A jumps carrying its npub on the spawn URL → B reads the inbound npub and SEATS A as
// its verified nostr identity — and assert the schnorr signature gates the seating:
// a tampered/forged/unsigned hop arrives as ANON, never seated.
//
// This is the testable form of the P3 interop demo (GATEWAY_PROTOCOL §6/§9 step 3): a
// destination that verifies WHO is arriving by pubkey + signature, with no central
// router and no shared memory between the two instances beyond the relay + the URL.
import { describe, it, expect } from 'vitest';
import { createHandshakeController } from '../src/engine/gateway/handshakeController.js';
import { appendTraveller, hardenSpawnUrl } from '../src/engine/gateway/urlHarden.js';
import { nostrEventId } from '../src/engine/crypto/nostrSig.js';
import { ARRIVAL_MODE_FOLLOWS_ONLY } from '../src/engine/gateway/handoffArrival.js';
import { ACCESS_SETTINGS_KIND, ACCESS_SETTINGS_SCHEMA_VERSION, buildAccessSettingsDTag } from '../src/nostr.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';

const A_SK = hexToBytes('22'.repeat(32)); // traveller (instance A)
const B_SK = hexToBytes('11'.repeat(32)); // host (instance B)
const A_PUB = bytesToHex(schnorr.getPublicKey(A_SK));
const B_PUB = bytesToHex(schnorr.getPublicKey(B_SK));
const RELAYS = ['wss://relay.interop.test'];
const B_SPAWN = 'https://host-b.example.com'; // B's spawn URL (a different host than A)

// ── A shared in-memory relay both instances publish to and read from ────────────
function createSharedRelay() {
  const store = [];
  // NIP-07-style signer bound to a secret key.
  const signerFor = (sk) => {
    const pubkey = bytesToHex(schnorr.getPublicKey(sk));
    return async (unsigned) => {
      const evt = { ...unsigned, pubkey };
      const id = nostrEventId(evt);
      const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
      return { ok: true, event: { ...evt, id, sig }, error: null };
    };
  };
  // fanoutPublish fake — append the signed event to the shared store.
  const publish = async (_relays, event) => { store.push(event); return { accepted: 1, used: _relays, failed: [] }; };
  // fanoutReq fake — return events whose tags satisfy the filter's #p (the only
  // filter the controller sets beyond kinds/#t). Mirrors a relay's single-letter
  // tag index: an event addressed (#p) to the querying pubkey is returned.
  const request = async (_relays, filters) => {
    const f = (filters && filters[0]) || {};
    const wantKinds = Array.isArray(f.kinds) ? f.kinds : null;
    const wantP = Array.isArray(f['#p']) ? f['#p'] : null;
    const wantD = Array.isArray(f['#d']) ? f['#d'] : null;
    const wantAuthors = Array.isArray(f.authors) ? f.authors : null;
    const events = store.filter((ev) => {
      if (wantKinds && !wantKinds.includes(ev.kind)) return false;
      if (wantAuthors && !wantAuthors.includes(ev.pubkey)) return false;
      if (wantP) {
        const pTags = (ev.tags || []).filter((t) => t[0] === 'p').map((t) => t[1]);
        if (!wantP.some((p) => pTags.includes(p))) return false;
      }
      if (wantD) {
        const dTags = (ev.tags || []).filter((t) => t[0] === 'd').map((t) => t[1]);
        if (!wantD.some((d) => dTags.includes(d))) return false;
      }
      return true;
    });
    return { events, used: _relays, failed: [] };
  };
  return { store, signerFor, publish, request };
}

function relaylessSign(sk, unsigned) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const evt = { ...unsigned, pubkey };
  const id = nostrEventId(evt);
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, id, sig };
}

function makeInstance(relay, sk) {
  return createHandshakeController({
    request: relay.request, sign: relay.signerFor(sk), publish: relay.publish,
    relays: RELAYS, ourPubkey: bytesToHex(schnorr.getPublicKey(sk)),
  });
}

function followEvent(author, followed = [], createdAt = 1) {
  return {
    id: `${author.slice(0, 8)}-follow-${createdAt}`,
    kind: 3,
    pubkey: author,
    created_at: createdAt,
    tags: followed.map((pk) => ['p', pk]),
    content: '',
  };
}

function accessEvent({ instanceId = 'host-b.example.com/', arrivalMode = 'public', followPolicy = 'visitor-follows-owner', createdAt = 1 } = {}) {
  return relaylessSign(B_SK, {
    kind: ACCESS_SETTINGS_KIND,
    created_at: createdAt,
    tags: [['d', buildAccessSettingsDTag(instanceId)]],
    content: JSON.stringify({
      schemaVersion: ACCESS_SETTINGS_SCHEMA_VERSION,
      instanceId,
      ownerPubkey: B_PUB,
      arrivalMode,
      followPolicy,
      updatedAt: new Date(createdAt * 1000).toISOString(),
    }),
  });
}

// Drive the handshake A→B up to A's armed accept. Returns { A, B }.
async function runHandshake(relay) {
  const A = makeInstance(relay, A_SK); // traveller
  const B = makeInstance(relay, B_SK); // host
  // A requests travel to B's world.
  const reqRes = await A.requestTravel({ pubkey: B_PUB, zoneId: 'host-b-arena', title: 'Host B' });
  expect(reqRes.ok).toBe(true);
  // B polls, surfaces the incoming request, and accepts with its spawn URL.
  await B.tick();
  expect(B.view().mode).toBe('incoming');
  const acc = await B.respondIncoming(true, { spawn: B_SPAWN });
  expect(acc.ok).toBe(true);
  // A polls, verifies B's signed accept (SEC-2 + S1), and arms the hop.
  await A.tick();
  return { A, B };
}

describe('P3 cross-host interop — traveller A jumps to host B carrying its npub', () => {
  it('arms A on B\'s crypto-verified accept, then B seats A by its verified npub', async () => {
    const relay = createSharedRelay();
    const { A, B } = await runHandshake(relay);

    // A is armed (only a real schnorr-verified accept arms the hop).
    const armed = A.snapshot().armed;
    expect(armed).toBeTruthy();
    expect(armed.spawn).toBe(`${B_SPAWN}/`);

    // A jumps: harden B's spawn URL + append A's npub (the cross-host hop URL).
    const hardened = hardenSpawnUrl(armed.spawn);
    expect(hardened.ok).toBe(true);
    const jump = appendTraveller(hardened.url, A_PUB);
    expect(jump.ok).toBe(true);
    expect(jump.url).toContain(`torii-traveller=${A_PUB}`);

    // B receives the inbound hop URL. B has A's signed request in its accepted set
    // (same session) — seat A by its crypto-verified nostr identity.
    const admit = await B.admitArrival(jump.url);
    expect(admit.seated).toBe(true);
    expect(admit.trust).toBe('crypto-verified');
    expect(admit.npub).toBe(A_PUB);
    expect(admit.anon).toBe(false);
  });

  it('cold-load B (no session memory) still seats A by re-reading the signed request from the relay', async () => {
    const relay = createSharedRelay();
    await runHandshake(relay); // A published a signed request to the shared relay

    // A fresh host-B instance with NO accepted-traveller memory (models a cold page load).
    const Bcold = makeInstance(relay, B_SK);
    const jumpUrl = `${B_SPAWN}/?torii-traveller=${A_PUB}`;

    // Re-read A's signed request addressed to B from the relay and inject it.
    const { events } = await relay.request(RELAYS, [{ '#p': [B_PUB], authors: [A_PUB] }]);
    const { readTravelRequests } = await import('../src/engine/gateway/travelRequest.js');
    const request = readTravelRequests(events).requests.find((r) => r.travellerPubkey === A_PUB);
    expect(request).toBeTruthy();

    const admit = await Bcold.admitArrival(jumpUrl, { request });
    expect(admit.seated).toBe(true);
    expect(admit.npub).toBe(A_PUB);
  });

  it('fails CLOSED — an impostor URL with no matching signed request arrives as anon', async () => {
    const relay = createSharedRelay();
    const { B } = await runHandshake(relay);
    // EVIL crafts a URL claiming to be a pubkey B never accepted.
    const EVIL = bytesToHex(schnorr.getPublicKey(hexToBytes('33'.repeat(32))));
    const admit = await B.admitArrival(`${B_SPAWN}/?torii-traveller=${EVIL}`);
    expect(admit.seated).toBe(false);
    expect(admit.anon).toBe(true);
    expect(admit.npub).toBe(null);
  });

  it('fails CLOSED — a tampered signed request injected on a cold load is refused', async () => {
    const relay = createSharedRelay();
    await runHandshake(relay);
    const Bcold = makeInstance(relay, B_SK);
    const { events } = await relay.request(RELAYS, [{ '#p': [B_PUB], authors: [A_PUB] }]);
    const { readTravelRequests } = await import('../src/engine/gateway/travelRequest.js');
    const req = readTravelRequests(events).requests.find((r) => r.travellerPubkey === A_PUB);
    // Tamper the signed content so the id no longer binds → schnorr verify fails.
    const tampered = { ...req, signed: { ...req.signed, content: JSON.stringify({ to: 'evil' }) } };
    const admit = await Bcold.admitArrival(`${B_SPAWN}/?torii-traveller=${A_PUB}`, { request: tampered });
    expect(admit.seated).toBe(false);
    expect(admit.anon).toBe(true);
  });

  it('follows-only seats a visitor who follows the owner and denies one who does not', async () => {
    const relay = createSharedRelay();
    const { A, B } = await runHandshake(relay);
    relay.store.push(followEvent(A_PUB, [B_PUB], 50));

    const armed = A.snapshot().armed;
    const jump = appendTraveller(hardenSpawnUrl(armed.spawn).url, A_PUB);
    const admitFollowing = await B.admitArrival(jump.url, { arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY });
    expect(admitFollowing.seated).toBe(true);
    expect(admitFollowing.denied).toBe(false);
    expect(admitFollowing.npub).toBe(A_PUB);

    const C_SK = hexToBytes('44'.repeat(32));
    const C_PUB = bytesToHex(schnorr.getPublicKey(C_SK));
    const relay2 = createSharedRelay();
    const C = makeInstance(relay2, C_SK);
    const B2 = makeInstance(relay2, B_SK);
    const reqRes = await C.requestTravel({ pubkey: B_PUB, zoneId: 'host-b-arena', title: 'Host B' });
    expect(reqRes.ok).toBe(true);
    await B2.tick();
    const acc = await B2.respondIncoming(true, { spawn: B_SPAWN });
    expect(acc.ok).toBe(true);
    await C.tick();
    const armed2 = C.snapshot().armed;
    const jump2 = appendTraveller(hardenSpawnUrl(armed2.spawn).url, C_PUB);
    const admitNotFollowing = await B2.admitArrival(jump2.url, { arrivalMode: ARRIVAL_MODE_FOLLOWS_ONLY });
    expect(admitNotFollowing.seated).toBe(false);
    expect(admitNotFollowing.denied).toBe(true);
    expect(admitNotFollowing.anon).toBe(false);
  });

  it('persisted follows-only denies a non-follower across hosts', async () => {
    const relay = createSharedRelay();
    const C_SK = hexToBytes('44'.repeat(32));
    const C_PUB = bytesToHex(schnorr.getPublicKey(C_SK));
    const C = makeInstance(relay, C_SK);
    const B = makeInstance(relay, B_SK);
    relay.store.push(accessEvent({ instanceId: 'host-b.example.com/', arrivalMode: 'follows-only', createdAt: 90 }));
    const reqRes = await C.requestTravel({ pubkey: B_PUB, zoneId: 'host-b-arena', title: 'Host B' });
    expect(reqRes.ok).toBe(true);
    await B.tick();
    const acc = await B.respondIncoming(true, { spawn: B_SPAWN });
    expect(acc.ok).toBe(true);
    await C.tick();
    const armed = C.snapshot().armed;
    const jump = appendTraveller(hardenSpawnUrl(armed.spawn).url, C_PUB);
    const admit = await B.admitArrival(jump.url, { instanceId: 'host-b.example.com/', arrivalMode: 'public' });
    expect(admit.arrivalMode).toBe(ARRIVAL_MODE_FOLLOWS_ONLY);
    expect(admit.seated).toBe(false);
    expect(admit.denied).toBe(true);
    expect(admit.anon).toBe(false);
  });

  it('host B refuses to ACCEPT an unsigned/forged incoming request (gate before seating)', async () => {
    const relay = createSharedRelay();
    const B = makeInstance(relay, B_SK);
    // Publish a request to B that is NOT validly signed (forged sig).
    const { buildTravelRequest } = await import('../src/engine/gateway/travelRequest.js');
    const built = buildTravelRequest({ travellerPubkey: A_PUB, toHostPubkey: B_PUB, toZone: 'z', requestId: 'forged' });
    relay.store.push({ ...built.event, pubkey: A_PUB, id: 'a'.repeat(64), sig: 'd'.repeat(128) });
    await B.tick();
    expect(B.view().mode).toBe('incoming');
    const acc = await B.respondIncoming(true, { spawn: B_SPAWN });
    expect(acc.ok).toBe(false); // forged request can never be accepted into the seatable set
  });
});
