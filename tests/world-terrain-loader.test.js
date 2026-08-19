// tests/world-terrain-loader.test.js — locks the Phase 0k.5 terrain source loader
// (worldTerrainLoader.js). Pure vitest with injected mock transport (no real
// network / no Vite import analysis). Verifies: .json sources are fetched + parsed
// (no code execution — safe for arbitrary worlds), .js sources are dynamically
// imported (code execution — trusted templates only), errors throw (so
// buildWorldTerrain falls back to the platform collider), + URL resolution.
import { describe, it, expect } from 'vitest';
import { makeTerrainLoader } from '../src/engine/world/worldTerrainLoader.js';

const HEIGHTS = [0, 1, 2, 3, 4, 5];

// A mock fetch returning a JSON response with the given body + status.
function mockFetchJson(body, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

describe('makeTerrainLoader — .json sources (fetch + parse, no code execution)', () => {
  it('fetches the .json source + returns { heights } from the parsed body', async () => {
    const calls = [];
    const loader = makeTerrainLoader({
      worldId: 'chiefmonkey-template',
      fetchImpl: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => ({ heights: HEIGHTS }) }; },
      resolveUrl: (s, wid) => `mock://${wid}/${s}`,
    });
    const mod = await loader('./terrain.json');
    expect(calls[0]).toBe('mock://chiefmonkey-template/./terrain.json');
    expect(mod.heights).toBe(HEIGHTS);
  });

  it('throws on a non-200 response (so buildWorldTerrain falls back)', async () => {
    const loader = makeTerrainLoader({
      worldId: 'w',
      fetchImpl: async () => ({ ok: false, status: 404 }),
      resolveUrl: (s) => `mock://${s}`,
    });
    await expect(loader('./terrain.json')).rejects.toThrow(/HTTP 404/);
  });

  it('throws when fetch rejects (network error)', async () => {
    const loader = makeTerrainLoader({
      worldId: 'w',
      fetchImpl: async () => { throw new Error('network down'); },
      resolveUrl: (s) => `mock://${s}`,
    });
    await expect(loader('./terrain.json')).rejects.toThrow(/network down/);
  });

  it('throws when the body does not parse to an object', async () => {
    const loader = makeTerrainLoader({
      worldId: 'w',
      fetchImpl: async () => ({ ok: true, status: 200, json: async () => null }),
      resolveUrl: (s) => `mock://${s}`,
    });
    await expect(loader('./terrain.json')).rejects.toThrow(/did not parse/);
  });

  it('falls back to globalThis.fetch when fetchImpl is not a function (defensive)', async () => {
    // Node 18+ has a global fetch, so fetchImpl:null still resolves to it. The
    // guard exists for fetch-less environments (old browsers); here we just
    // verify the fallback doesn't throw synchronously — the fetch itself
    // fails on a bare relative URL, which is the expected node behaviour.
    const loader = makeTerrainLoader({ worldId: 'w', fetchImpl: null, resolveUrl: (s) => s });
    await expect(loader('./terrain.json')).rejects.toThrow(); // fetch fails on the relative URL
  });
});

describe('makeTerrainLoader — .js sources (dynamic import, trusted templates only)', () => {
  it('imports the module + returns its namespace (heights OR buildHeightfieldArray)', async () => {
    const calls = [];
    const loader = makeTerrainLoader({
      worldId: 'w',
      importModule: async (url) => { calls.push(url); return { buildHeightfieldArray: () => HEIGHTS }; },
      resolveUrl: (s, wid) => `mock://${wid}/${s}`,
    });
    const mod = await loader('./terrain.js');
    expect(calls[0]).toBe('mock://w/./terrain.js');
    expect(typeof mod.buildHeightfieldArray).toBe('function');
  });

  it('throws when importModule rejects (bad module / 404)', async () => {
    const loader = makeTerrainLoader({
      worldId: 'w',
      importModule: async () => { throw new Error('module not found'); },
      resolveUrl: (s) => `mock://${s}`,
    });
    await expect(loader('./terrain.js')).rejects.toThrow(/module not found/);
  });

  it('throws when importModule is unavailable for a .js source', async () => {
    const loader = makeTerrainLoader({ worldId: 'w', importModule: null, resolveUrl: (s) => s });
    await expect(loader('./terrain.js')).rejects.toThrow(/importModule unavailable/);
  });
});

describe('makeTerrainLoader — URL resolution', () => {
  it('default resolveUrl builds worlds/<worldId>/<source> (base-relative)', async () => {
    const calls = [];
    const loader = makeTerrainLoader({
      worldId: 'chiefmonkey-template',
      importModule: async (url) => { calls.push(url); return { heights: HEIGHTS }; },
    });
    await loader('./terrain.js');
    expect(calls[0]).toBe('worlds/chiefmonkey-template/./terrain.js');
  });

  it('falls back to a bare relative path when worldId is absent', async () => {
    const calls = [];
    const loader = makeTerrainLoader({
      importModule: async (url) => { calls.push(url); return { heights: HEIGHTS }; },
    });
    await loader('./terrain.js');
    expect(calls[0]).toBe('./terrain.js');
  });

  it('uses the injected resolveUrl (so the host can apply assetUrl base resolution)', async () => {
    const calls = [];
    const loader = makeTerrainLoader({
      worldId: 'w',
      importModule: async (url) => { calls.push(url); return { heights: HEIGHTS }; },
      resolveUrl: (s, wid) => `/quest/worlds/${wid}/${s}`,
    });
    await loader('./terrain.js');
    expect(calls[0]).toBe('/quest/worlds/w/./terrain.js');
  });
});
