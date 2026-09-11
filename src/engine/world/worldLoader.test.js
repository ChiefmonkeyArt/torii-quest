// src/engine/world/worldLoader.test.js — locks the Phase 0 world manifest loader
// (resolveWorldManifest). Pure vitest: inject a fake fetchImpl so the leaf
// touches no network, plus real `Response` fixtures to prove the actual runtime
// (browser fetch path) now resolves the body instead of falling back. Verifies
// the feature-flag fallback contract — every failure mode resolves to
// { fallback:'legacy' } so the host falls back to buildArena() rather than
// crashing. No three/DOM.
import { describe, it, expect } from 'vitest';
import { resolveWorldManifest, readWorldIdFromDom } from './worldLoader.js';

// A valid manifest the fake fetchImpl returns.
const VALID_MANIFEST = {
  version: 1,
  id: 'gateway-blank',
  name: 'Torii Gateway — Blank',
  sky: { type: 'space', color: '#05050f', stars: true },
  platform: { type: 'cloud', size: 40 },
  gateway: { position: [0, 0, -8] },
  spawn: { position: [0, 0, 0] },
  lights: [{ kind: 'ambient', intensity: 0.6 }],
};

// A manifest that opts into the legacy renderer (the chiefmonkey-template path).
const LEGACY_MANIFEST = { version: 1, id: 'chiefmonkey-template', name: 'Chiefmonkey Template', legacy: true };

// fakeFetch(handler) — builds a synchronous fake fetchImpl. The handler is
// called with the url and returns either a response object ({ ok, status,
// body }) or throws. The loader `await`s the fetch result, so a synchronous
// plain-value return is passed through unchanged by `await`.
function fakeFetch(handler) {
  return (url) => handler(url);
}

function okResponse(body) { return { ok: true, status: 200, body }; }
function notFoundResponse() { return { ok: false, status: 404 }; }

// realResponse(json, status) — a genuine Node `Response` with a well-formed
// JSON body, mirroring what the browser fetch path hands the loader.
function realResponse(json, status = 200) {
  return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
}

describe('resolveWorldManifest — valid manifest', () => {
  it('returns ok:true fallback:"none" for a valid non-legacy manifest', async () => {
    const fetchImpl = fakeFetch(() => okResponse(VALID_MANIFEST));
    const r = await resolveWorldManifest({ worldId: 'gateway-blank', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('none');
    expect(r.world.id).toBe('gateway-blank');
    expect(r.source).toBe('gateway-blank');
  });

  it('resolves a real fetch Response body (the F1 async-body defect)', async () => {
    // The actual runtime passes the browser `fetch`, which resolves a real
    // Response whose json() is a Promise. Before the async refactor this
    // produced fallback:"legacy" for a perfectly valid manifest.
    const fetchImpl = () => realResponse(VALID_MANIFEST);
    const r = await resolveWorldManifest({ worldId: 'gateway-blank', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('none');
    expect(r.world.id).toBe('gateway-blank');
  });

  it('builds the manifest URL from the injected baseUrl + worldId (dev base /)', async () => {
    let fetchedUrl = '';
    const fetchImpl = fakeFetch((url) => { fetchedUrl = url; return okResponse(VALID_MANIFEST); });
    await resolveWorldManifest({ worldId: 'gw', fetchImpl, baseUrl: '/' });
    expect(fetchedUrl).toBe('/worlds/gw/world.json');
  });

  it('builds the manifest URL from the injected baseUrl + worldId (Suite base /quest/)', async () => {
    let fetchedUrl = '';
    const fetchImpl = fakeFetch((url) => { fetchedUrl = url; return okResponse(VALID_MANIFEST); });
    await resolveWorldManifest({ worldId: 'gw', fetchImpl, baseUrl: '/quest/' });
    expect(fetchedUrl).toBe('/quest/worlds/gw/world.json');
  });
});

describe('resolveWorldManifest — HTTP failure → fallback:legacy', () => {
  it('falls back to legacy on a 404', async () => {
    const fetchImpl = fakeFetch(() => notFoundResponse());
    const r = await resolveWorldManifest({ worldId: 'missing', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy on a real 404 Response', async () => {
    const fetchImpl = () => realResponse({}, 404);
    const r = await resolveWorldManifest({ worldId: 'missing', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });
});

describe('resolveWorldManifest — body/rejection → fallback:legacy', () => {
  it('falls back to legacy when the body is not a world object', async () => {
    const fetchImpl = fakeFetch(() => okResponse('not-json-object'));
    const r = await resolveWorldManifest({ worldId: 'bad', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when the body is an array', async () => {
    const fetchImpl = fakeFetch(() => okResponse([1, 2, 3]));
    const r = await resolveWorldManifest({ worldId: 'bad', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when the body is null', async () => {
    const fetchImpl = fakeFetch(() => okResponse(null));
    const r = await resolveWorldManifest({ worldId: 'bad', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when the async json() promise rejects', async () => {
    const fetchImpl = () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } });
    const r = await resolveWorldManifest({ worldId: 'bad', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when the async fetch promise rejects', async () => {
    const fetchImpl = () => Promise.reject(new Error('network down'));
    const r = await resolveWorldManifest({ worldId: 'x', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });
});

describe('resolveWorldManifest — blank worldId → fallback:legacy', () => {
  it('falls back to legacy when worldId is blank', async () => {
    const r = await resolveWorldManifest({ worldId: '', fetchImpl: () => okResponse(VALID_MANIFEST), baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when worldId is undefined', async () => {
    const r = await resolveWorldManifest({ fetchImpl: () => okResponse(VALID_MANIFEST), baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('does not call fetch when worldId is blank', async () => {
    let called = false;
    const fetchImpl = () => { called = true; return okResponse(VALID_MANIFEST); };
    await resolveWorldManifest({ worldId: '', fetchImpl, baseUrl: '/' });
    expect(called).toBe(false);
  });
});

describe('resolveWorldManifest — legacy:true manifest → ok + fallback:legacy', () => {
  it('returns ok:true with fallback:"legacy" for a valid legacy manifest', async () => {
    const fetchImpl = fakeFetch(() => okResponse(LEGACY_MANIFEST));
    const r = await resolveWorldManifest({ worldId: 'chiefmonkey-template', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('legacy');
    expect(r.world.legacy).toBe(true);
    expect(r.world.id).toBe('chiefmonkey-template');
  });
});

describe('resolveWorldManifest — invalid manifest → ok:false + errors', () => {
  it('returns ok:false with fallback:legacy and errors for an invalid manifest', async () => {
    const fetchImpl = fakeFetch(() => okResponse({ id: 'x', name: 'X' })); // missing version
    const r = await resolveWorldManifest({ worldId: 'bad', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
    expect(Array.isArray(r.errors)).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('resolveWorldManifest — never rejects', () => {
  it('resolves fallback:legacy when fetch throws synchronously', async () => {
    const fetchImpl = fakeFetch(() => { throw new Error('network down'); });
    const r = await resolveWorldManifest({ worldId: 'x', fetchImpl, baseUrl: '/' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('delegates to assetUrl when baseUrl is blank (browser path)', async () => {
    // A blank baseUrl is NOT a failure: the loader delegates to assetUrl(), which
    // reads import.meta.env.BASE_URL (defaulting to '/'). In the node test env that
    // is '/' so the URL is '/worlds/x/world.json' — the fake fetch sees it and the
    // manifest resolves. This locks the base-relative contract: blank baseUrl is
    // the browser path, not an error.
    let fetchedUrl = '';
    const fetchImpl = fakeFetch((url) => { fetchedUrl = url; return okResponse(VALID_MANIFEST); });
    const r = await resolveWorldManifest({ worldId: 'x', fetchImpl, baseUrl: '' });
    expect(fetchedUrl).toBe('/worlds/x/world.json');
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('none');
  });
});

describe('readWorldIdFromDom — localStorage override (Phase 0c)', () => {
  // A minimal fake Storage for the injected `storage` arg.
  function fakeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => { map.set(k, String(v)); },
      removeItem: (k) => { map.delete(k); },
      clear: () => { map.clear(); },
    };
  }

  it('returns the localStorage `torii.world.active` override first', () => {
    const storage = fakeStorage({ 'torii.world.active': 'gateway-blank' });
    expect(readWorldIdFromDom(storage)).toBe('gateway-blank');
  });

  it('trims whitespace from the localStorage override', () => {
    const storage = fakeStorage({ 'torii.world.active': '  chiefmonkey-template  ' });
    expect(readWorldIdFromDom(storage)).toBe('chiefmonkey-template');
  });

  it('falls back to the meta tag when the override is blank', () => {
    const storage = fakeStorage({ 'torii.world.active': '   ' });
    // No document in node → falls through to '' (no meta tag either).
    expect(readWorldIdFromDom(storage)).toBe('');
  });

  it('falls back when the override key is absent', () => {
    const storage = fakeStorage({});
    expect(readWorldIdFromDom(storage)).toBe('');
  });

  it('returns "" when no storage is injected and no localStorage exists (node)', () => {
    // In the node test env globalThis.localStorage is undefined → returns ''.
    expect(readWorldIdFromDom()).toBe('');
  });

  it('never throws on a broken storage (getItem throws)', () => {
    const broken = { getItem: () => { throw new Error('denied'); } };
    expect(() => readWorldIdFromDom(broken)).not.toThrow();
    expect(readWorldIdFromDom(broken)).toBe('');
  });

  it('never throws when storage is null', () => {
    expect(() => readWorldIdFromDom(null)).not.toThrow();
  });
});