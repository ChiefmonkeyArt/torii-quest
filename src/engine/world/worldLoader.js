// engine/world/worldLoader.js — resolve + validate a data-driven world manifest
// (Phase 0, open-world foundation). The loader half of the world layer: given a
// world id, it fetches the manifest at `<base>worlds/<worldId>/world.json` (where
// <base> is the Vite deploy base — `/` in dev, `/quest/` on the Suite mount), runs
// it through validateWorld, and tells the caller whether to render from data
// (fallback:'none') or fall back to the legacy buildArena() path (fallback:
// 'legacy'). This is the feature-flag seam: only when a world id is present
// does the loader attempt a data-driven load; absent → the legacy path runs
// unchanged, so nothing breaks.
//
// PURE + node-safe CORE: resolveWorldManifest takes an INJECTED fetchImpl and an
// INJECTED baseUrl — it never reads window/location and never touches the DOM.
// The manifest URL is built via assetUrl('worlds/<id>/world.json') so it resolves
// in BOTH dev (vite base '/') AND prod (nginx/Suite base '/quest/'). A thin
// browser wrapper in main.js can pass the global `fetch`; tests pass a fake
// fetchImpl + a fake baseUrl. It never throws — every failure mode (blank id,
// fetch error, non-200, invalid JSON, invalid manifest) resolves to
// { ok:false, fallback:'legacy' } so the host falls back to buildArena() rather
// than crashing on a bad/missing manifest.
//
// The ONE DOM-touching helper, readWorldIdFromDom(), is co-located here but is
// clearly marked below — the pure core does NOT depend on it. It reads the
// `<meta name="torii-world">` content, which is the feature flag: a world id
// present → data-driven load; absent → legacy path.

import { validateWorld } from './worldSchema.js';
import { assetUrl } from '../../assetUrl.js';

function _isBlank(v) { return v == null || v === ''; }

// _manifestUrl(worldId, baseUrl) → string. Builds the base-relative manifest URL
// `<base>worlds/<worldId>/world.json` where <base> is the injected `baseUrl` (a
// Vite deploy base — `/` in dev, `/quest/` on the Suite mount) or, when not
// injected, whatever assetUrl() resolves from import.meta.env.BASE_URL. The
// browser path passes no baseUrl so this delegates to assetUrl() (the single
// source of truth for base-relative asset paths, already used across the
// codebase); tests inject a fixed baseUrl so the URL shape is deterministic
// without depending on import.meta.env. The injected-base branch mirrors
// assetUrl()'s normalisation (strip leading slashes, ensure trailing slash) so
// both paths produce the identical URL shape. Pure; never throws.
function _manifestUrl(worldId, baseUrl) {
  const rel = `worlds/${worldId}/world.json`;
  if (_isBlank(baseUrl) || typeof baseUrl !== 'string') {
    // Browser path — let assetUrl read import.meta.env.BASE_URL (dev '/' or prod '/quest/').
    return assetUrl(rel);
  }
  // Test path — inject a fixed base so the URL is deterministic in node.
  const stripped = rel.replace(/^\/+/, '');
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return `${normalizedBase}${stripped}`;
}

// resolveWorldManifest({ worldId, fetchImpl, baseUrl }) → { ok, world, source,
// fallback, errors? }. Pure; never throws.
//   worldId    — string; blank → { ok:false, fallback:'legacy' } (caller uses buildArena).
//   fetchImpl  — optional; defaults to the global `fetch`. Injected so tests
//                can stub it and the leaf never imports a transport.
//   baseUrl    — optional string; the Vite deploy base used to build the manifest
//                URL (defaults to import.meta.env.BASE_URL, falling back to '/'
//                when that is unset — e.g. vitest's node env). The browser path
//                passes nothing and lets assetUrl read import.meta.env.BASE_URL;
//                tests inject a fixed baseUrl so the URL shape is deterministic.
//                Never read from window inside this leaf — it is injected.
//
// The manifest URL is `assetUrl('worlds/<worldId>/world.json')` (base-relative)
// so it resolves in dev (vite base '/') and prod (Suite base '/quest/'). When a
// `baseUrl` is passed it overrides import.meta.env.BASE_URL inside assetUrl via
// a local helper so the pure core stays deterministic in node tests.
//
// Returns:
//   { ok:false, fallback:'legacy' }            — blank id / fetch fail / non-200 / invalid JSON
//   { ok:false, fallback:'legacy', errors }    — manifest present but invalid
//   { ok:true,  world, fallback:'legacy' }      — manifest valid but world.legacy === true
//                                                  (renderer should still use buildArena)
//   { ok:true,  world, fallback:'none' }        — manifest valid; render from data
export function resolveWorldManifest({ worldId, fetchImpl, baseUrl } = {}) {
  if (_isBlank(worldId) || typeof worldId !== 'string') {
    return { ok: false, fallback: 'legacy' };
  }
  const fetchFn = typeof fetchImpl === 'function' ? fetchImpl : (typeof fetch === 'function' ? fetch : null);
  if (!fetchFn) return { ok: false, fallback: 'legacy' };

  const url = _manifestUrl(worldId, baseUrl);
  let res;
  try {
    res = fetchFn(url);
    // Support both Promise-returning fetch (browser/node) and a synchronous
    // fake (tests). A synchronous fake returns a plain object; we detect a
    // thenable to decide whether to await.
    if (res && typeof res.then === 'function') {
      // Async path — return a promise that resolves to the same shape. We
      // can't `await` here without making the function async, so wrap it.
      return _resolveAsync(res, worldId, url);
    }
  } catch {
    return { ok: false, fallback: 'legacy' };
  }
  return _fromResponse(res, worldId);
}

// Async branch: a real (thenable) fetch response. Resolves to the same result
// shape as the sync branch. Never rejects — every rejection → fallback:'legacy'.
function _resolveAsync(resPromise, worldId, url) {
  return resPromise
    .then((res) => _fromResponse(res, worldId))
    .catch(() => ({ ok: false, fallback: 'legacy' }));
}

// _fromResponse(res, worldId) — shared sync handling of a fetched response
// object (works for both real fetch Response and a test fake). Returns the
// result shape. Never throws.
function _fromResponse(res, worldId) {
  if (!res || res.ok === false || (typeof res.status === 'number' && !(res.status >= 200 && res.status < 300))) {
    return { ok: false, fallback: 'legacy' };
  }
  // Read the body. Support res.json() (Promise or plain value) and a pre-parsed
  // res.body. A test fake may provide either.
  let json;
  try {
    if (typeof res.json === 'function') {
      const j = res.json();
      // Synchronous fake returns a plain value/object; real fetch returns a
      // thenable. We can't await in this sync helper, so a thenable is handled
      // by the async branch above (resolveWorldManifest only calls this
      // directly for sync fakes). If we somehow get a thenable here, treat the
      // body as unreadable → fall back.
      if (j && typeof j.then === 'function') {
        return { ok: false, fallback: 'legacy' };
      }
      json = j;
    } else if ('body' in res) {
      json = res.body;
    } else {
      return { ok: false, fallback: 'legacy' };
    }
  } catch {
    return { ok: false, fallback: 'legacy' };
  }

  if (json == null || typeof json !== 'object' || Array.isArray(json)) {
    return { ok: false, fallback: 'legacy' };
  }

  const v = validateWorld(json);
  if (!v.ok) {
    return { ok: false, fallback: 'legacy', errors: v.errors };
  }
  if (v.world.legacy === true) {
    return { ok: true, world: v.world, source: worldId, fallback: 'legacy' };
  }
  return { ok: true, world: v.world, source: worldId, fallback: 'none' };
}

// ── DOM-touching helper (the ONLY function in this file that may touch the DOM)
// ──────────────────────────────────────────────────────────────────────────────
// readWorldIdFromDom(storage?) → string. Phase 0c: FIRST checks the localStorage
// `torii.world.active` override (via the injected `storage`, default
// globalThis.localStorage) so an owner can preview switching the homepage world
// without a server endpoint; if set + non-blank, returns it. Otherwise falls back
// to the `<meta name="torii-world">` content — the feature flag: a world id
// present → data-driven load; absent → the legacy buildArena() path runs unchanged.
//
// This is clearly a PREVIEW / this-browser-only override: the Suite `active`
// pointer is the node-wide source of truth. The pure core (resolveWorldManifest)
// does NOT call this — a browser wrapper in main.js reads the meta and passes the
// id in. Co-locating it here keeps the world layer's DOM seam in one file rather
// than scattering it through the shell. The `storage` arg keeps the pure leaf
// testable in node (tests pass a fake Storage); never throws.
export function readWorldIdFromDom(storage) {
  // Phase 0c: localStorage `torii.world.active` override takes precedence.
  try {
    const store = storage === undefined ? globalThis.localStorage : storage;
    if (store && typeof store.getItem === 'function') {
      const v = store.getItem('torii.world.active');
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
  } catch {
    /* no localStorage / disabled — fall through to the meta tag */
  }
  if (typeof document === 'undefined' || !document) return '';
  try {
    const meta = document.querySelector('meta[name="torii-world"]');
    const v = meta && meta.getAttribute('content');
    if (typeof v === 'string' && v.trim() !== '') return v.trim();
  } catch {
    /* no document / querySelector unavailable — treat as no flag */
  }
  return '';
}
