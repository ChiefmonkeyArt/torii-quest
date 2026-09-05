// @vitest-environment jsdom
// tests/author-headless-client.test.js — locks the client wrapper around the
// POST /mp/character/headless endpoint (v0.2.767-alpha). The wrapper is pure at
// the edges (fetch, sessionStorage) so we drive both with fakes and assert:
//   * URL is derived from resolveMpHttpBase() and lands on /character/headless
//   * Authorization: Bearer <token> is sent
//   * Content-Type: model/gltf-binary is sent
//   * File bytes are forwarded raw (not JSON-wrapped)
//   * 200 → { ok:true, blob, sha256 } derived from the X-Headless-Sha256 header
//   * 4xx JSON → { ok:false, error, detail }
//   * Missing sha256 header → { ok:false, error:'no-sha256-header' }

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { requestHeadlessVariant } from '../src/engine/character/authorHeadless.js';
import { SESSION_TOKEN_KEY } from '../src/engine/multiplayer/sessionAuth.js';

// jsdom provides sessionStorage + a mutable window.location. We inject a
// deterministic host so resolveMpHttpBase() returns a known base.
beforeEach(() => {
  try { window.sessionStorage.clear(); } catch { /* noop */ }
  Object.defineProperty(window, 'location', {
    value: { host: 'chiefmonkey.art', protocol: 'https:' },
    writable: true,
  });
  window.sessionStorage.setItem(SESSION_TOKEN_KEY, 'test-bearer-token');
});

function fakeFile(bytes = new Uint8Array([1, 2, 3, 4])) {
  return new Blob([bytes], { type: 'model/gltf-binary' });
}

function okResponse(bytes, sha256) {
  return {
    ok: true,
    status: 200,
    headers: { get: (name) => (name.toLowerCase() === 'x-headless-sha256' ? sha256 : null) },
    blob: async () => new Blob([bytes], { type: 'model/gltf-binary' }),
  };
}
function errResponse(status, body) {
  return {
    ok: false,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

describe('requestHeadlessVariant', () => {
  it('POSTs raw bytes to /mp/character/headless with bearer + content-type', async () => {
    const fetchImpl = vi.fn(async () => okResponse(new Uint8Array([9, 9]), 'a'.repeat(64)));
    const file = fakeFile();
    const res = await requestHeadlessVariant(file, { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.sha256).toBe('a'.repeat(64));
    expect(res.blob).toBeInstanceOf(Blob);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://chiefmonkey.art/mp/character/headless');
    expect(init.method).toBe('POST');
    expect(init.headers['Authorization']).toBe('Bearer test-bearer-token');
    expect(init.headers['Content-Type']).toBe('model/gltf-binary');
    // File bytes are forwarded raw (not wrapped in JSON).
    expect(init.body).toBe(file);
  });

  it('returns error on 4xx with server error/detail', async () => {
    const fetchImpl = vi.fn(async () => errResponse(422, { ok: false, error: 'no-head-joint', detail: 'missing Head' }));
    const res = await requestHeadlessVariant(fakeFile(), { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-head-joint');
    expect(res.detail).toBe('missing Head');
    expect(res.blob).toBeNull();
  });

  it('returns error when the sha256 header is missing', async () => {
    const fetchImpl = vi.fn(async () => okResponse(new Uint8Array([1]), null));
    const res = await requestHeadlessVariant(fakeFile(), { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-sha256-header');
  });

  it('returns error when no session token is present', async () => {
    window.sessionStorage.removeItem(SESSION_TOKEN_KEY);
    const fetchImpl = vi.fn(async () => okResponse(new Uint8Array([1]), 'a'.repeat(64)));
    const res = await requestHeadlessVariant(fakeFile(), { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-session-token');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('normalises the sha256 header to lower-case', async () => {
    const upper = 'B'.repeat(64);
    const fetchImpl = vi.fn(async () => okResponse(new Uint8Array([1]), upper));
    const res = await requestHeadlessVariant(fakeFile(), { fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.sha256).toBe('b'.repeat(64));
  });

  it('rejects a non-File input', async () => {
    const fetchImpl = vi.fn();
    const res = await requestHeadlessVariant(null, { fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('file-required');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
