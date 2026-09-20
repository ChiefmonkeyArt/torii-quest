// world-resolver.test.js — locks the world-as-data resolve path (ADR-0117):
// the world-reference contract (worldReference.js) + the resolve half
// (worldResolver.js). Node-pure; uses the REAL schnorr verifier end-to-end.
import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';
import { sha256Hex } from '../../src/engine/world/worldResolver.js';
import {
  parseWorldReference, buildWorldReferenceUnsigned, buildWorldFilter,
  WORLD_REF_KIND, WORLD_REF_TOPIC, DEFAULT_BLOSSOM_SERVER,
} from '../../src/engine/world/worldReference.js';
import {
  resolveWorldReference, discoverWorldReference, resolveWorldByNpub,
} from '../../src/engine/world/worldResolver.js';

const SK = hexToBytes('b2'.repeat(32));
const PUBKEY = bytesToHex(schnorr.getPublicKey(SK));
const RELAY = 'wss://bekka.world/mp';

const WORLD_JSON = JSON.stringify({ version: 1, id: 'bekka-world', name: 'Bekka World' });
const MANIFEST_HASH = sha256Hex(WORLD_JSON);

// Sign a raw event (adds pubkey + id + sig) — mirrors the session-token test helper.
function signEvent(evt, sk = SK) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const id = nostrEventId({ ...evt, pubkey });
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...evt, pubkey, id, sig };
}

function unsignedWorldRef({ manifestHash = MANIFEST_HASH, createdAt = 1_700_000_000 } = {}) {
  return buildWorldReferenceUnsigned({
    worldId: 'bekka-world', manifestHash, relay: RELAY, version: '1.2.3', nowMs: createdAt * 1000,
  });
}
function signedWorldRef(over = {}) {
  return signEvent({ ...unsignedWorldRef(), ...over });
}

describe('worldReference — parse/build/filter', () => {
  it('parses a valid signed event into a clean model', () => {
    const ref = parseWorldReference(signedWorldRef());
    expect(ref.pubkey).toBe(PUBKEY);
    expect(ref.worldId).toBe('bekka-world');
    expect(ref.manifestHash).toBe(MANIFEST_HASH);
    expect(ref.relays).toContain(RELAY);
    expect(ref.version).toBe('1.2.3');
  });

  it('rejects wrong kind / bad pubkey / missing manifest / bad hash', () => {
    expect(parseWorldReference(signedWorldRef({ kind: 1 }))).toBeNull();
    // parse checks shape only (the resolver verifies the signature), so a raw
    // malformed event with a non-hex pubkey is enough to exercise the guard.
    expect(parseWorldReference({ kind: WORLD_REF_KIND, pubkey: 'zz'.repeat(32), created_at: 1, tags: [], content: '' })).toBeNull();
    const noManifest = { kind: WORLD_REF_KIND, pubkey: PUBKEY, created_at: 1, tags: [['d', 'w'], ['t', WORLD_REF_TOPIC], ['relay', RELAY]], content: '' };
    expect(parseWorldReference(noManifest)).toBeNull();
    const badHash = { kind: WORLD_REF_KIND, pubkey: PUBKEY, created_at: 1, tags: [['manifest', 'nope'], ['relay', RELAY]], content: '' };
    expect(parseWorldReference(badHash)).toBeNull();
    expect(parseWorldReference(null)).toBeNull();
  });

  it('rejects a reference with no relay and no blossom server', () => {
    const unsigned = {
      kind: WORLD_REF_KIND, created_at: 1, content: '',
      tags: [['d', 'w'], ['t', WORLD_REF_TOPIC], ['manifest', MANIFEST_HASH]],
    };
    expect(parseWorldReference(signEvent(unsigned))).toBeNull();
  });

  it('builds an unsigned event and returns null for a bad manifest hash', () => {
    const u = unsignedWorldRef();
    expect(u.kind).toBe(WORLD_REF_KIND);
    const tags = Object.fromEntries(u.tags.map(([k, v]) => [k, v]));
    expect(tags.manifest).toBe(MANIFEST_HASH);
    expect(buildWorldReferenceUnsigned({ manifestHash: 'not-a-hash' })).toBeNull();
  });

  it('buildWorldFilter emits kind + topic + authors', () => {
    expect(buildWorldFilter({ authors: [PUBKEY], limit: 24 })).toEqual({
      kinds: [WORLD_REF_KIND], '#t': [WORLD_REF_TOPIC], authors: [PUBKEY], limit: 24,
    });
  });

  // ADR-0122: a beacon-signed reference stamps the owner as a `p` tag, and parse
  // surfaces it as `owner` so npub-based discovery can attribute it to the owner.
  it('stamps an owner p tag and omits it when the owner is absent/malformed', () => {
    const stamped = buildWorldReferenceUnsigned({
      worldId: 'bekka-world', manifestHash: MANIFEST_HASH, relay: RELAY, owner: PUBKEY,
    });
    const pTags = stamped.tags.filter((t) => t[0] === 'p');
    expect(pTags).toEqual([['p', PUBKEY.toLowerCase()]]);
    // owner omitted when absent or not valid hex64.
    expect(buildWorldReferenceUnsigned({ manifestHash: MANIFEST_HASH, relay: RELAY }).tags
      .filter((t) => t[0] === 'p')).toHaveLength(0);
    expect(buildWorldReferenceUnsigned({ manifestHash: MANIFEST_HASH, relay: RELAY, owner: 'not-hex' }).tags
      .filter((t) => t[0] === 'p')).toHaveLength(0);
  });

  it('parseWorldReference attributes owner from the p tag, else the signer', () => {
    // Beacon-signed: p-tag names a different owner than the signer.
    const ownerHex = 'ab'.repeat(32);
    const beaconEvt = signEvent(buildWorldReferenceUnsigned({
      worldId: 'bekka-world', manifestHash: MANIFEST_HASH, relay: RELAY, owner: ownerHex,
    }));
    const parsedBeacon = parseWorldReference(beaconEvt);
    expect(parsedBeacon.owner).toBe(ownerHex);
    expect(parsedBeacon.pubkey).toBe(PUBKEY); // signer (beacon), not owner

    // Client-signed: no p-tag → owner is the signer.
    const clientEvt = signedWorldRef();
    expect(parseWorldReference(clientEvt).owner).toBe(PUBKEY);
    // A p-tag equal to the signer collapses to the signer.
    const selfTagged = signEvent(buildWorldReferenceUnsigned({
      worldId: 'bekka-world', manifestHash: MANIFEST_HASH, relay: RELAY, owner: PUBKEY,
    }));
    expect(parseWorldReference(selfTagged).owner).toBe(PUBKEY);
  });
});

describe('resolveWorldReference', () => {
  it('resolves a signed reference to a validated world (fetch by hash)', async () => {
    const fetchBlob = async (url) => {
      expect(url).toBe(`${DEFAULT_BLOSSOM_SERVER}/${MANIFEST_HASH}`);
      return WORLD_JSON;
    };
    const r = await resolveWorldReference({ referenceEvent: signedWorldRef(), fetchBlob });
    expect(r.ok).toBe(true);
    expect(r.world.id).toBe('bekka-world');
    expect(r.manifestHash).toBe(MANIFEST_HASH);
    expect(r.relays).toContain(RELAY);
  });

  it('fails closed on a hash mismatch (content integrity)', async () => {
    const r = await resolveWorldReference({
      referenceEvent: signedWorldRef(), fetchBlob: async () => 'tampered content',
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('hash-mismatch');
  });

  it('fails closed on a fetch failure', async () => {
    const r = await resolveWorldReference({
      referenceEvent: signedWorldRef(), fetchBlob: async () => null,
    });
    expect(r.reason).toBe('fetch-failed');
  });

  it('fails closed on a schema-invalid manifest', async () => {
    const bad = JSON.stringify({ version: 2 });
    const badHash = sha256Hex(bad);
    const ref = signedWorldRef({ tags: unsignedWorldRef({ manifestHash: badHash }).tags });
    const r = await resolveWorldReference({ referenceEvent: ref, fetchBlob: async () => bad });
    expect(r.reason).toBe('invalid-world');
  });

  it('fails closed on a bad signature (forged reference)', async () => {
    const forged = { ...signedWorldRef(), content: 'forged' }; // id/sig no longer bind
    const r = await resolveWorldReference({ referenceEvent: forged, fetchBlob: async () => WORLD_JSON });
    expect(r.reason).toBe('bad-sig');
  });
});

describe('discoverWorldReference + resolveWorldByNpub', () => {
  it('picks the newest valid signed reference and skips invalid events', async () => {
    const oldRef = signedWorldRef({ created_at: 100 });
    const newRef = signedWorldRef({ created_at: 200 });
    const garbage = { kind: WORLD_REF_KIND, pubkey: '00'.repeat(32), created_at: 300, tags: [], content: '' };
    const relayReqFn = async () => ({ ok: true, events: [garbage, oldRef, newRef] });
    const found = await discoverWorldReference({ pubkeyHex: PUBKEY, relays: ['wss://r'], relayReqFn });
    expect(found.id).toBe(newRef.id);
  });

  it('resolveWorldByNpub discovers then resolves end-to-end', async () => {
    const ref = signedWorldRef();
    const relayReqFn = async () => ({ ok: true, events: [ref] });
    const r = await resolveWorldByNpub({
      pubkeyHex: PUBKEY, relays: ['wss://r'], relayReqFn, fetchBlob: async () => WORLD_JSON,
    });
    expect(r.ok).toBe(true);
    expect(r.world.id).toBe('bekka-world');
  });

  it('resolveWorldByNpub fails cleanly on a bad npub', async () => {
    const r = await resolveWorldByNpub({ npub: 'not-a-real-npub' });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('bad-npub');
  });

  // ADR-0122: the reference may be signed by a node beacon (not the owner), so
  // discovery must attribute it via the p tag. This is the exact blank-peek bug.
  it('discovers a beacon-signed reference via its owner p tag', async () => {
    const beaconSk = hexToBytes('c3'.repeat(32));
    const beaconPubkey = bytesToHex(schnorr.getPublicKey(beaconSk));
    const beaconRef = signEvent(buildWorldReferenceUnsigned({
      worldId: 'bekka-world', manifestHash: MANIFEST_HASH, relay: RELAY,
      owner: PUBKEY, nowMs: 1_700_000_000_000,
    }), beaconSk);
    expect(beaconRef.pubkey).toBe(beaconPubkey);          // signed by beacon, not owner
    expect(beaconRef.pubkey).not.toBe(PUBKEY);

    const relayReqFn = async () => ({ ok: true, events: [beaconRef] });
    const found = await discoverWorldReference({ pubkeyHex: PUBKEY, relays: ['wss://r'], relayReqFn });
    expect(found).toBeTruthy();
    expect(found.id).toBe(beaconRef.id);
  });

  it('still discovers a client-signed reference (owner == author)', async () => {
    const ref = signedWorldRef();
    const relayReqFn = async () => ({ ok: true, events: [ref] });
    const found = await discoverWorldReference({ pubkeyHex: PUBKEY, relays: ['wss://r'], relayReqFn });
    expect(found).toBeTruthy();
    expect(found.id).toBe(ref.id);
  });

  it('ignores references whose owner p tag and author are both different', async () => {
    const otherSk = hexToBytes('d4'.repeat(32));
    const other = signEvent(buildWorldReferenceUnsigned({
      worldId: 'other-world', manifestHash: MANIFEST_HASH, relay: RELAY,
      owner: 'ef'.repeat(32),
    }), otherSk);
    const relayReqFn = async () => ({ ok: true, events: [other] });
    const found = await discoverWorldReference({ pubkeyHex: PUBKEY, relays: ['wss://r'], relayReqFn });
    expect(found).toBeNull();
  });

  it('newest valid attributed reference wins; bad-sig/malformed still skipped', async () => {
    const beaconSk = hexToBytes('c3'.repeat(32));
    const oldRef = signEvent(buildWorldReferenceUnsigned({
      worldId: 'bekka-world', manifestHash: MANIFEST_HASH, relay: RELAY,
      owner: PUBKEY, nowMs: 100_000,
    }), beaconSk);
    const newRef = signEvent(buildWorldReferenceUnsigned({
      worldId: 'bekka-world', manifestHash: MANIFEST_HASH, relay: RELAY,
      owner: PUBKEY, nowMs: 200_000,
    }), beaconSk);
    // A forged newer event (tampered content breaks the sig) must NOT win.
    const forged = { ...newRef, created_at: 300_000, content: 'forged' };
    const malformed = { kind: WORLD_REF_KIND, pubkey: '00'.repeat(32), created_at: 400_000, tags: [], content: '' };
    const relayReqFn = async () => ({ ok: true, events: [malformed, forged, oldRef, newRef] });
    const found = await discoverWorldReference({ pubkeyHex: PUBKEY, relays: ['wss://r'], relayReqFn });
    expect(found.id).toBe(newRef.id);
  });
});