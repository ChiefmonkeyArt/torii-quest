// tests/character-publish.test.js — locks the create round-trip write half and
// the Blossom upload path (both in src/nostr.js): publishCharacter (build →
// sign → verify → fan-out), buildBlossomAuthEvent (NIP-98), and uploadBlossom
// (NIP-98 auth + PUT). Signing/publish/fetch are injected so the tests run in
// node with no NIP-07 extension or live relay.
import { describe, it, expect, afterEach } from 'vitest';
import {
  publishCharacter, buildBlossomAuthEvent, uploadBlossom,
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

describe('buildBlossomAuthEvent', () => {
  it('builds a NIP-98 auth event over the upload URL', () => {
    const e = buildBlossomAuthEvent('https://blossom.example/', 'PUT', { createdAt: 1700000000 });
    expect(e.kind).toBe(BLOSSOM_AUTH_KIND);
    expect(e.created_at).toBe(1700000000);
    expect(e.tags).toContainEqual(['u', 'https://blossom.example/upload']);
    expect(e.tags).toContainEqual(['method', 'PUT']);
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
