// tests/character-publish.test.js — locks the create round-trip write half and
// the Blossom upload path (both in src/nostr.js): publishCharacter (build →
// sign → verify → fan-out), buildBlossomAuthEvent (BUD-11), and uploadBlossom
// (BUD-11 auth + PUT). Signing/publish/fetch are injected so the tests run in
// node with no NIP-07 extension or live relay.
import { describe, it, expect, afterEach } from 'vitest';
import {
  publishCharacter, publishProfileMetadata, buildBlossomAuthEvent, uploadBlossom,
  BLOSSOM_AUTH_KIND, DEFAULT_BLOSSOM_SERVER,
} from '../src/nostr.js';
import { presetToManifest, getCharacterPreset } from '../src/engine/character/characterPresets.js';

const PK = 'e'.repeat(64);
const SHA = 'a'.repeat(64);

const okSign = async (unsigned) => ({
  ok: true, error: null,
  event: { ...unsigned, id: 'f'.repeat(64), sig: 'g'.repeat(128), pubkey: PK },
});
const okPublish = async (relays, event) => ({ accepted: 1, used: ['wss://relay.example'], failed: [] });

const manifest = presetToManifest(getCharacterPreset('chiefmonkey'));

describe('publishCharacter', () => {
  it('builds, signs, verifies and publishes a valid character', async () => {
    const res = await publishCharacter(manifest, {
      sign: okSign, publish: okPublish, relays: ['wss://relay.example'],
    });
    expect(res.ok).toBe(true);
    expect(res.accepted).toBe(1);
    expect(res.used).toEqual(['wss://relay.example']);
    expect(res.event.kind).toBe(35100);
    expect(res.event.pubkey).toBe(PK);
  });

  it('fails closed when no relay accepts', async () => {
    const res = await publishCharacter(manifest, {
      sign: okSign, publish: async () => ({ accepted: 0, used: [], failed: ['wss://relay.example'] }),
      relays: ['wss://relay.example'],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-relay-accepted');
  });

  it('fails when the signer is unavailable', async () => {
    const res = await publishCharacter(manifest, { sign: null, publish: okPublish, relays: ['wss://x'] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('nip-07-unavailable');
  });

  it('fails when the signed event does not parse to a valid character', async () => {
    const badSign = async () => ({ ok: true, error: null, event: { kind: 0, tags: [], content: '', pubkey: PK } });
    const res = await publishCharacter(manifest, { sign: badSign, publish: okPublish, relays: ['wss://x'] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('signed-character-invalid');
  });
});

describe('publishProfileMetadata (F01 — publish the signed event, not the envelope)', () => {
  const unsigned = { kind: 0, created_at: 1700000000, content: '{}', tags: [] };

  it('publishes the signed .event and reports ok when a relay accepts', async () => {
    let publishedEvent = null;
    const publish = async (relays, event) => { publishedEvent = event; return { accepted: 1, used: ['wss://r'], failed: [] }; };
    const res = await publishProfileMetadata(unsigned, { sign: okSign, publish, relays: ['wss://r'] });
    expect(res.ok).toBe(true);
    expect(res.accepted).toBe(1);
    // The published payload must be the signed EVENT (has id/sig), not the
    // { ok, event, error } envelope the bug was passing.
    expect(publishedEvent.id).toBe('f'.repeat(64));
    expect(publishedEvent.sig).toBe('g'.repeat(128));
    expect(publishedEvent.kind).toBe(0);
    expect(res.event.id).toBe('f'.repeat(64));
  });

  it('fails closed when the signer rejects, without calling publish', async () => {
    let published = false;
    const res = await publishProfileMetadata(unsigned, {
      sign: async () => ({ ok: false, event: null, error: 'nip-07-rejected' }),
      publish: async () => { published = true; return { accepted: 0, used: [], failed: [] }; },
      relays: ['wss://r'],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('nip-07-rejected');
    expect(published).toBe(false);
  });

  it('fails closed when every relay rejects', async () => {
    const res = await publishProfileMetadata(unsigned, {
      sign: okSign,
      publish: async () => ({ accepted: 0, used: [], failed: ['wss://r'] }),
      relays: ['wss://r'],
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-relay-accepted');
  });

  it('requires a built profile event', async () => {
    const res = await publishProfileMetadata(null, { sign: okSign, publish: okPublish, relays: ['wss://r'] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('profile-event-required');
  });
});

describe('buildBlossomAuthEvent', () => {
  it('builds a BUD-11 auth event scoped to the upload action + blob hash', () => {
    const sha = 'a'.repeat(64);
    const e = buildBlossomAuthEvent('https://blossom.example/', 'PUT', { createdAt: 1700000000, sha256: sha });
    expect(e.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(e.kind).toBe(24242); // BUD-11, not NIP-98's 27235
    expect(e.created_at).toBe(1700000000);
    expect(e.tags).toContainEqual(['t', 'upload']);
    expect(e.tags).toContainEqual(['x', sha]);
    expect(e.tags).toContainEqual(['expiration', String(1700000000 + 300)]);
    // u/method kept as harmless scope hints.
    expect(e.tags).toContainEqual(['u', 'https://blossom.example/upload']);
    expect(e.tags).toContainEqual(['method', 'PUT']);
    expect(e.content).toBe('Upload Blob');
  });

  it('omits the x tag when no sha256 is supplied (invalid/absent scope)', () => {
    const e = buildBlossomAuthEvent('https://blossom.example/', 'PUT', {});
    expect(e.tags.some((t) => t[0] === 'x')).toBe(false);
  });
});

describe('uploadBlossom', () => {
  const file = { arrayBuffer: async () => new ArrayBuffer(8) };
  const realFetch = globalThis.fetch;

  afterEach(() => { globalThis.fetch = realFetch; });

  it('uploads and returns the content-addressed sha256', async () => {
    globalThis.fetch = async (url, init) => ({
      ok: true, status: 200,
      json: async () => ({ sha256: SHA, url: `${DEFAULT_BLOSSOM_SERVER}/${SHA}` }),
    });
    const res = await uploadBlossom(file, { sign: okSign });
    expect(res.ok).toBe(true);
    expect(res.sha256).toBe(SHA);
  });

  it('scopes the auth token x-tag + X-SHA-256 header to the exact blob hash', async () => {
    let signedEvent = null;
    let fetchInit = null;
    globalThis.fetch = async (url, init) => {
      fetchInit = init;
      return { ok: true, status: 200, json: async () => ({ sha256: SHA, url: `${DEFAULT_BLOSSOM_SERVER}/${SHA}` }) };
    };
    const capturingSign = async (unsigned) => { signedEvent = unsigned; return okSign(unsigned); };
    await uploadBlossom(file, { sign: capturingSign });

    // The token's x tag is the REAL sha256 of the uploaded bytes (8 zero bytes),
    // not the server's echo SHA. bytesToHex(sha256(new Uint8Array(8))) is deterministic.
    const xTag = signedEvent.tags.find((t) => t[0] === 'x');
    expect(xTag).toBeTruthy();
    expect(xTag[1]).toMatch(/^[0-9a-f]{64}$/);
    expect(xTag[1]).not.toBe(SHA);
    expect(signedEvent.tags).toContainEqual(['t', 'upload']);
    expect(signedEvent.kind).toBe(24242);
    // The PUT also carries the X-SHA-256 header so stricter servers can enforce it.
    expect(fetchInit.headers['X-SHA-256']).toBe(xTag[1]);
  });

  it('fails when no file is provided', async () => {
    const res = await uploadBlossom(null, { sign: okSign });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('file-required');
  });

  it('fails when the upload HTTP call errors', async () => {
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const res = await uploadBlossom(file, { sign: okSign });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('upload-http-500');
  });

  it('fails when the response carries no sha256', async () => {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const res = await uploadBlossom(file, { sign: okSign });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('upload-no-sha256');
  });
});
