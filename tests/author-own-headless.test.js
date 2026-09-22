// @vitest-environment jsdom
// tests/author-own-headless.test.js — locks the on-demand headless authoring for a
// logged-in player whose kind-35100 manifest has a mesh but NO mesh.headlessHash
// (v0.2.882-alpha, "second real player sees chiefmonkey's feet").
//
// Pure at the edges: fetch, requestHeadlessVariant and URL.createObjectURL are all
// injected so this drives the whole fetch→author→object-URL chain with fakes and
// asserts:
//   * the player's OWN mesh GLB URL is fetched, not any built-in asset
//   * a headless variant is requested from the returned blob
//   * the returned blob becomes a bytes-transparent object URL
//   * every failure mode degrades to { ok:false } without throwing
//   * revokeHeadlessUrl only revokes blob: URLs (never https/asset paths) and is
//     idempotent

import { describe, it, expect, vi } from 'vitest';
import { authorOwnHeadless, revokeHeadlessUrl } from '../src/engine/character/authorOwnHeadless.js';

function meshResponse(bytes) {
  return {
    ok: true,
    status: 200,
    blob: async () => new Blob([bytes], { type: 'model/gltf-binary' }),
  };
}

function okAuthor(blobBytes) {
  return async () => ({
    ok: true,
    blob: new Blob([blobBytes], { type: 'model/gltf-binary' }),
    sha256: 'b'.repeat(64),
    error: null,
    detail: null,
  });
}

describe('authorOwnHeadless', () => {
  it('fetches the player\'s own mesh, authors it, and returns a session-local object URL', async () => {
    const fetchImpl = vi.fn(async () => meshResponse(new Uint8Array([1, 2, 3])));
    const requestHeadless = vi.fn(okAuthor(new Uint8Array([9, 8, 7])));
    const createObjectUrl = vi.fn((b) => `blob:fake-${b.size}`);

    const res = await authorOwnHeadless({
      meshUrl: 'https://blossom.primal.net/feedface',
      fetchImpl,
      requestHeadless,
      createObjectUrl,
    });

    expect(res.ok).toBe(true);
    expect(res.url).toBe('blob:fake-3');
    expect(fetchImpl).toHaveBeenCalledWith('https://blossom.primal.net/feedface');
    // The authored blob came from the fetched mesh blob, never a built-in asset.
    expect(requestHeadless).toHaveBeenCalledTimes(1);
    const authoredArg = requestHeadless.mock.calls[0][0];
    expect(await authoredArg.arrayBuffer()).toEqual(new Uint8Array([1, 2, 3]).buffer);
  });

  it('uses its own mesh URL — no fallback to any built-in FP body', async () => {
    const fetchImpl = vi.fn(async () => meshResponse(new Uint8Array([5])));
    const res = await authorOwnHeadless({
      meshUrl: 'https://blossom.primal.net/ownmesh',
      fetchImpl,
      requestHeadless: okAuthor(new Uint8Array([6])),
      createObjectUrl: (b) => `blob:x-${b.size}`,
    });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://blossom.primal.net/ownmesh');
  });

  it('degrades to ok:false when the mesh fetch fails (no throw)', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 404, blob: async () => new Blob() }));
    const res = await authorOwnHeadless({
      meshUrl: 'https://blossom.primal.net/x',
      fetchImpl,
      requestHeadless: okAuthor(new Uint8Array([1])),
      createObjectUrl: (b) => `blob:x-${b.size}`,
    });
    expect(res.ok).toBe(false);
    expect(res.url).toBeNull();
    expect(res.error).toBe('mesh-fetch-http-404');
  });

  it('degrades to ok:false when authoring fails (no throw)', async () => {
    const fetchImpl = vi.fn(async () => meshResponse(new Uint8Array([1])));
    const requestHeadless = vi.fn(async () => ({ ok: false, blob: null, sha256: null, error: 'no-head-joint', detail: 'missing Head' }));
    const res = await authorOwnHeadless({
      meshUrl: 'https://blossom.primal.net/x',
      fetchImpl,
      requestHeadless,
      createObjectUrl: (b) => `blob:x-${b.size}`,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-head-joint');
    expect(res.detail).toBe('missing Head');
  });

  it('rejects a missing/empty mesh URL before any network work (no throw)', async () => {
    const fetchImpl = vi.fn(async () => meshResponse(new Uint8Array([1])));
    const res = await authorOwnHeadless({
      meshUrl: '',
      fetchImpl,
      requestHeadless: okAuthor(new Uint8Array([1])),
      createObjectUrl: (b) => `blob:x-${b.size}`,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-mesh-url');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails soft when the player has no session token (defaults to the real author, no throw)', async () => {
    // requestHeadless defaults to the real session-gated wrapper; with no stored
    // token it returns no-session-token and authorOwnHeadless degrades to ok:false.
    window.sessionStorage.removeItem('tq.mp.sessionToken');
    const fetchImpl = vi.fn(async () => meshResponse(new Uint8Array([1])));
    const res = await authorOwnHeadless({
      meshUrl: 'https://x/y',
      fetchImpl,
      createObjectUrl: (b) => `blob:x-${b.size}`,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('no-session-token');
  });

  it('returns ok:false when object-URL creation is unavailable (no network fetch)', async () => {
    const fetchImpl = vi.fn(async () => meshResponse(new Uint8Array([1])));
    const res = await authorOwnHeadless({
      meshUrl: 'https://x/y',
      fetchImpl,
      requestHeadless: okAuthor(new Uint8Array([1])),
      createObjectUrl: undefined,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toBe('object-url-unavailable');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('revokeHeadlessUrl', () => {
  it('revokes only blob: URLs and never throws', () => {
    const revoke = vi.fn();
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = revoke;
    try {
      revokeHeadlessUrl('blob:fake-1');
      expect(revoke).toHaveBeenCalledWith('blob:fake-1');
      revoke.mockClear();

      // https Blossom URLs + repo-relative asset paths are left alone.
      revokeHeadlessUrl('https://blossom.primal.net/abcd');
      revokeHeadlessUrl('/chiefmonkey-headless.glb');
      revokeHeadlessUrl(null);
      revokeHeadlessUrl(undefined);
      revokeHeadlessUrl('');
      expect(revoke).not.toHaveBeenCalled();
    } finally {
      URL.revokeObjectURL = original;
    }
  });

  it('is idempotent when revoke throws', () => {
    const throwing = vi.fn(() => { throw new Error('nope'); });
    const original = URL.revokeObjectURL;
    URL.revokeObjectURL = throwing;
    try {
      expect(() => revokeHeadlessUrl('blob:fake-2')).not.toThrow();
      // Second call is also safe.
      expect(() => revokeHeadlessUrl('blob:fake-2')).not.toThrow();
    } finally {
      URL.revokeObjectURL = original;
    }
  });
});