// world-publisher.test.js — locks the PUBLISH half of world-as-data (ADR-0117)
// and proves the publish → resolve round-trip closes over the same content hash.
import { describe, it, expect } from 'vitest';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { nostrEventId } from '../../src/engine/crypto/nostrSig.js';
import { sha256Hex } from '../../src/engine/world/worldResolver.js';
import { resolveWorldReference } from '../../src/engine/world/worldResolver.js';
import { prepareWorldReference, publishWorldReference } from '../../src/engine/world/worldPublisher.js';

const SK = hexToBytes('b2'.repeat(32));
const PUBKEY = bytesToHex(schnorr.getPublicKey(SK));
const RELAY = 'wss://bekka.world/mp';
const WORLD_JSON = JSON.stringify({ version: 1, id: 'bekka-world', name: 'Bekka World' });

function signEvent(unsigned, sk = SK) {
  const pubkey = bytesToHex(schnorr.getPublicKey(sk));
  const id = nostrEventId({ ...unsigned, pubkey });
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), sk));
  return { ...unsigned, pubkey, id, sig };
}

const okUpload = async (text, expected) => ({ ok: true, sha256: expected });
const okSign = async (unsigned) => signEvent(unsigned);
const okPub = async () => ({ ok: true });

describe('prepareWorldReference', () => {
  it('hashes the manifest and builds the unsigned reference', () => {
    const p = prepareWorldReference({ worldJson: WORLD_JSON, worldId: 'bekka-world', relays: [RELAY], version: '1.2.3' });
    expect(p.manifestHash).toBe(sha256Hex(WORLD_JSON));
    expect(p.unsigned.kind).toBe(30078);
    const tags = Object.fromEntries(p.unsigned.tags.map(([k, v]) => [k, v]));
    expect(tags.manifest).toBe(p.manifestHash);
    expect(tags.relay).toBe(RELAY);
  });

  it('returns null for a non-string/empty manifest', () => {
    expect(prepareWorldReference({ worldJson: '' })).toBeNull();
    expect(prepareWorldReference({ worldJson: 42 })).toBeNull();
  });
});

describe('publishWorldReference', () => {
  it('publishes end-to-end with injected transports', async () => {
    let sawPub = null;
    const r = await publishWorldReference({
      worldJson: WORLD_JSON, worldId: 'bekka-world', relays: [RELAY],
      uploadBlob: okUpload, signEvent: okSign, relayPub: async (evt) => { sawPub = evt; return { ok: true }; },
    });
    expect(r.ok).toBe(true);
    expect(r.manifestHash).toBe(sha256Hex(WORLD_JSON));
    expect(r.referenceEvent).toBe(sawPub);
  });

  it('fails closed on upload / hash-mismatch / sign failure', async () => {
    const base = { worldJson: WORLD_JSON, relays: [RELAY], uploadBlob: okUpload, signEvent: okSign, relayPub: okPub };
    expect((await publishWorldReference({ ...base, uploadBlob: async () => ({ ok: false }) })).reason).toBe('upload-failed');
    expect((await publishWorldReference({ ...base, uploadBlob: async () => ({ ok: true, sha256: 'f'.repeat(64) }) })).reason).toBe('hash-mismatch');
    expect((await publishWorldReference({ ...base, signEvent: async () => ({}) })).reason).toBe('sign-failed');
  });

  it('round-trips: publish then resolve yields the same world', async () => {
    const pub = await publishWorldReference({
      worldJson: WORLD_JSON, worldId: 'bekka-world', relays: [RELAY],
      uploadBlob: okUpload, signEvent: okSign, relayPub: okPub,
    });
    expect(pub.ok).toBe(true);

    const resolved = await resolveWorldReference({
      referenceEvent: pub.referenceEvent, fetchBlob: async () => WORLD_JSON,
    });
    expect(resolved.ok).toBe(true);
    expect(resolved.world.id).toBe('bekka-world');
    expect(resolved.relays).toContain(RELAY);
  });
});