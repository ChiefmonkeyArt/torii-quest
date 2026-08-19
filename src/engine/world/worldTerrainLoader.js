// engine/world/worldTerrainLoader.js — the I/O half of data-driven terrain loading.
// Turns a validated `terrain.source` path (a relative .js/.json under the world
// manifest's dir `worlds/<worldId>/`) into the module object buildWorldTerrain
// expects ({ heights } or { buildHeightfieldArray }).
//
// .json sources are FETCHED + PARSED (no code execution — safe for arbitrary user
// worlds). .js sources are DYNAMICALLY IMPORTED (code execution — OK for TRUSTED
// built-in templates only; worldSchema._safeDataSourcePath forbids `..` + protocol
// so a .js source can't escape the world dir, but it still RUNS — only point it at
// templates you trust).
//
// INJECTED transport (fetchImpl + importModule + resolveUrl) so this module stays
// testable with mocks in vitest's node env (no real network / no Vite import
// analysis). The browser path in arenaRuntime passes the global fetch + a
// `(url) => import(url)` wrapper + assetUrl-based URL resolution.

// makeTerrainLoader({ worldId, fetchImpl, importModule, resolveUrl }) → async loadTerrainSource(source)
//   worldId      — the active world id (the manifest dir under worlds/).
//   fetchImpl    — optional; defaults to globalThis.fetch. Used for .json sources.
//   importModule — optional; (url) => Promise<module>. Used for .js sources.
//                  Browser: (url) => import(/* @vite-ignore */ url). Tests inject a mock.
//   resolveUrl   — optional; (source, worldId) => string. Defaults to a base-relative
//                  path `worlds/<worldId>/<source>` (the host resolves this against the
//                  Vite deploy base via assetUrl() at the call site). Injected so tests
//                  don't depend on import.meta.env.BASE_URL.
//
// Returns `loadTerrainSource(source)` — async, resolves to the module object.
// Throws on any failure (the source is absent, the fetch fails, the import rejects,
// the .json doesn't parse) — buildWorldTerrain catches that + returns a structured
// failure so arenaRuntime falls back to the platform collider (the ground never
// vanishes). Never returns a half-loaded module.
export function makeTerrainLoader({ worldId, fetchImpl, importModule, resolveUrl } = {}) {
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl
    : (typeof fetch === 'function' ? fetch : null);
  const resolve = typeof resolveUrl === 'function' ? resolveUrl : _defaultResolveUrl;
  return async function loadTerrainSource(source) {
    const url = resolve(source, worldId);
    if (typeof source === 'string' && source.endsWith('.json')) {
      if (!fetchFn) throw new Error('terrain loader: fetch unavailable for .json source');
      let res;
      try {
        res = await fetchFn(url);
      } catch (err) {
        throw new Error(`terrain .json fetch failed: ${err && err.message ? err.message : String(err)}`);
      }
      if (!res || !res.ok || (typeof res.status === 'number' && !(res.status >= 200 && res.status < 300))) {
        throw new Error(`terrain .json fetch failed: HTTP ${res && res.status ? res.status : 'unknown'}`);
      }
      let data;
      try {
        data = typeof res.json === 'function' ? await res.json() : res.body;
      } catch (err) {
        throw new Error(`terrain .json parse failed: ${err && err.message ? err.message : String(err)}`);
      }
      if (!data || typeof data !== 'object') {
        throw new Error('terrain .json did not parse to an object');
      }
      return { heights: data.heights };
    }
    // .js — dynamic import (code execution; trusted built-in templates only).
    if (typeof importModule !== 'function') {
      throw new Error('terrain loader: importModule unavailable for .js source');
    }
    return await importModule(url);
  };
}

function _defaultResolveUrl(source, worldId) {
  // Base-relative: `worlds/<worldId>/<source>`. The host (arenaRuntime) resolves
  // this against the Vite deploy base via assetUrl() at the call site so it works
  // in dev ('/') + prod ('/quest/'). Here we just build the relative path.
  const dir = worldId ? `worlds/${worldId}/` : '';
  return `${dir}${source}`;
}
