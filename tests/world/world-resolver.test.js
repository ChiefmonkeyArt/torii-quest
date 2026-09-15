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
});