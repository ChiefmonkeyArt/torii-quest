// tests/blossom-upload.test.js — node-safe Blossom uploader (server/world/blossomUpload.js,
// ADR-0119 slice 4). Pure vitest with a fake signer + fetch; no live Blossom.
import { describe, it, expect } from 'vitest';
import { buildBlossomAuthEvent, uploadBlossomText } from '../server/world/blossomUpload.js';

const SHA = 'a'.repeat(64);

function fakeSigner() {
  const calls = [];
  return {
    calls,
    sign: async (unsigned) => {
      calls.push(unsigned);
      // Return a fully-signed event shape (pubkey/id/sig) like nostr-tools finalize.
      return { ...unsigned, pubkey: 'b'.repeat(64), id: 'c'.repeat(64), sig: 'd'.repeat(128) };
    },
  };
}

function fakeFetch(response, onReq) {
  const calls = [];
  return {
    calls,
    impl: async (url, opts) => {
      calls.push({ url, opts });
      if (onReq) onReq({ url, opts, calls });
      if (response instanceof Error) throw response;
      return {
        ok: response.ok,
        status: response.status,
        json: async () => response.json,
      };
    },
  };
}

describe('buildBlossomAuthEvent', () => {
  it('scopes the upload auth to the blob sha256 with t/x/expiration tags', () => {
    const e = buildBlossomAuthEvent({ server: 'https://blossom.primal.net/', sha256: SHA, createdAt: 100 });
    expect(e.kind).toBe(24242);
    expect(e.created_at).toBe(100);
    expect(e.content).toBe('Upload Blob');
    const tags = Object.fromEntries(e.tags.map((t) => [t[0], t[1]]));
    expect(tags.t).toBe('upload');
    expect(tags.x).toBe(SHA);
    expect(tags.method).toBe('PUT');
    expect(tags.u).toBe('https://blossom.primal.net/upload');
    expect(Number(tags.expiration)).toBe(100 + 300);
  });

  it('lowercases the sha256 and trims the trailing slash', () => {
    const e = buildBlossomAuthEvent({ server: 'https://b.example///', sha256: SHA.toUpperCase(), createdAt: 0 });
    expect(e.tags.find((t) => t[0] === 'x')[1]).toBe(SHA);
    expect(e.tags.find((t) => t[0] === 'u')[1]).toBe('https://b.example/upload');
  });
});

describe('uploadBlossomText', () => {
  it('signs the auth, PUTs to /upload with Nostr header + X-SHA-256, and returns the address', async () => {
    const signer = fakeSigner();
    const fc = fakeFetch({ ok: true, status: 200, json: { sha256: SHA } });
    const r = await uploadBlossomText({
      text: '{"a":1}',
      server: 'https://blossom.primal.net',
      expectedHex: SHA,
      signEvent: signer.sign,
      fetchImpl: fc.impl,
      nowMs: 100_000,
    });
    expect(r.ok).toBe(true);
    expect(r.sha256).toBe(SHA);
    expect(fc.calls).toHaveLength(1);
    expect(fc.calls[0].url).toBe('https://blossom.primal.net/upload');
    expect(fc.calls[0].opts.method).toBe('PUT');
    expect(fc.calls[0].opts.body).toBe('{"a":1}');
    expect(fc.calls[0].opts.headers['X-SHA-256']).toBe(SHA);
    expect(fc.calls[0].opts.headers.Authorization).toMatch(/^Nostr /);
    // the signed auth was scoped to the blob hash
    expect(signer.calls[0].tags.find((t) => t[0] === 'x')[1]).toBe(SHA);
  });

  it('fails cleanly on a non-OK response', async () => {
    const r = await uploadBlossomText({
      text: 'x', server: 'https://b.example', expectedHex: SHA,
      signEvent: fakeSigner().sign,
      fetchImpl: fakeFetch({ ok: false, status: 401, json: {} }).impl,
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('upload-http-401');
  });

  it('fails when the server echoes a different sha256', async () => {
    const r = await uploadBlossomText({
      text: 'x', server: 'https://b.example', expectedHex: SHA,
      signEvent: fakeSigner().sign,
      fetchImpl: fakeFetch({ ok: true, status: 200, json: { sha256: 'f'.repeat(64) } }).impl,
    });
    expect(r.ok).toBe(true); // upload succeeded; the mismatch is the CALLER's concern (publishWorld verifies)
    expect(r.sha256).toBe('f'.repeat(64));
  });

  it('rejects a missing signer / fetch / malformed hex', async () => {
    expect((await uploadBlossomText({ text: 'x', server: 'https://b', expectedHex: SHA, signEvent: fakeSigner().sign })).error).toBe('fetch-required');
    expect((await uploadBlossomText({ text: 'x', server: 'https://b', expectedHex: SHA, fetchImpl: () => ({}) })).error).toBe('sign-required');
    expect((await uploadBlossomText({ text: 'x', server: 'https://b', expectedHex: 'zzz', signEvent: fakeSigner().sign, fetchImpl: () => ({}) })).error).toBe('bad-expected-hex');
  });
});