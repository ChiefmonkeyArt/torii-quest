// src/engine/world/worldLoader.test.js — locks the Phase 0 world manifest loader
// (resolveWorldManifest). Pure vitest: inject a fake fetchImpl so the leaf
// touches no network. Verifies the feature-flag fallback contract — every
// failure mode resolves to { fallback:'legacy' } so the host falls back to
// buildArena() rather than crashing. No three/DOM.
import { describe, it, expect } from 'vitest';
import { resolveWorldManifest } from './worldLoader.js';

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
// body }) or throws. Synchronous so resolveWorldManifest's sync branch handles
// it directly (no thenable) — keeps the test deterministic and promise-free.
function fakeFetch(handler) {
  return (url) => handler(url);
}

function okResponse(body) { return { ok: true, status: 200, body }; }
function notFoundResponse() { return { ok: false, status: 404 }; }

describe('resolveWorldManifest — valid manifest', () => {
  it('returns { ok:true, fallback:"none" } for a valid non-legacy manifest', () => {
    const fetchImpl = fakeFetch(() => okResponse(VALID_MANIFEST));
    const r = resolveWorldManifest({ worldId: 'gateway-blank', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('none');
    expect(r.world.id).toBe('gateway-blank');
    expect(r.source).toBe('gateway-blank');
  });

  it('builds the manifest URL from the injected origin + worldId', () => {
    let fetchedUrl = '';
    const fetchImpl = fakeFetch((url) => { fetchedUrl = url; return okResponse(VALID_MANIFEST); });
    resolveWorldManifest({ worldId: 'gw', fetchImpl, origin: 'https://torii.example' });
    expect(fetchedUrl).toBe('https://torii.example/quest/worlds/gw/world.json');
  });
});

describe('resolveWorldManifest — 404 → fallback:legacy', () => {
  it('falls back to legacy on a 404', () => {
    const fetchImpl = fakeFetch(() => notFoundResponse());
    const r = resolveWorldManifest({ worldId: 'missing', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });
});

describe('resolveWorldManifest — invalid JSON → fallback:legacy', () => {
  it('falls back to legacy when the body is not a world object', () => {
    const fetchImpl = fakeFetch(() => okResponse('not-json-object'));
    const r = resolveWorldManifest({ worldId: 'bad', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when the body is an array', () => {
    const fetchImpl = fakeFetch(() => okResponse([1, 2, 3]));
    const r = resolveWorldManifest({ worldId: 'bad', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when the body is null', () => {
    const fetchImpl = fakeFetch(() => okResponse(null));
    const r = resolveWorldManifest({ worldId: 'bad', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });
});

describe('resolveWorldManifest — blank worldId → fallback:legacy', () => {
  it('falls back to legacy when worldId is blank', () => {
    const r = resolveWorldManifest({ worldId: '', fetchImpl: () => okResponse(VALID_MANIFEST), origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when worldId is undefined', () => {
    const r = resolveWorldManifest({ fetchImpl: () => okResponse(VALID_MANIFEST), origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('does not call fetch when worldId is blank', () => {
    let called = false;
    const fetchImpl = () => { called = true; return okResponse(VALID_MANIFEST); };
    resolveWorldManifest({ worldId: '', fetchImpl, origin: 'https://host.example' });
    expect(called).toBe(false);
  });
});

describe('resolveWorldManifest — legacy:true manifest → ok + fallback:legacy', () => {
  it('returns ok:true with fallback:"legacy" for a valid legacy manifest', () => {
    const fetchImpl = fakeFetch(() => okResponse(LEGACY_MANIFEST));
    const r = resolveWorldManifest({ worldId: 'chiefmonkey-template', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(true);
    expect(r.fallback).toBe('legacy');
    expect(r.world.legacy).toBe(true);
    expect(r.world.id).toBe('chiefmonkey-template');
  });
});

describe('resolveWorldManifest — invalid manifest → ok:false + errors', () => {
  it('returns ok:false with fallback:legacy and errors for an invalid manifest', () => {
    const fetchImpl = fakeFetch(() => okResponse({ id: 'x', name: 'X' })); // missing version
    const r = resolveWorldManifest({ worldId: 'bad', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
    expect(Array.isArray(r.errors)).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('resolveWorldManifest — never throws', () => {
  it('does not throw when fetch throws', () => {
    const fetchImpl = fakeFetch(() => { throw new Error('network down'); });
    expect(() => resolveWorldManifest({ worldId: 'x', fetchImpl, origin: 'https://host.example' })).not.toThrow();
    const r = resolveWorldManifest({ worldId: 'x', fetchImpl, origin: 'https://host.example' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });

  it('falls back to legacy when origin is blank', () => {
    const r = resolveWorldManifest({ worldId: 'x', fetchImpl: () => okResponse(VALID_MANIFEST), origin: '' });
    expect(r.ok).toBe(false);
    expect(r.fallback).toBe('legacy');
  });
});
