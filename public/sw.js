// sw.js — Torii Quest Service Worker
// Strategy: cache-first for GLBs/images/fonts, network-first for JS/CSS/HTML.
// On install: precache the big IMMUTABLE binary assets only — NEVER the HTML shell.
// On activate: purge old cache versions.

// CACHE_VERSION tracks the app VERSION (src/config.js) so every shipped version
// bump mints a fresh cache name and the activate handler purges the prior version's
// assets — no stale assets after an asset-changing deploy. Bump in lockstep with the
// other version markers; regression-check [5] FAILS if this does not embed the current
// EXPECTED_VERSION (so it can never silently rot back to a stale literal like 'tq-v1').
const CACHE_VERSION = 'tq-v0.2.230-alpha';
const CACHE_NAME    = `torii-quest-${CACHE_VERSION}`;

// Static assets to precache on install — ONLY immutable binary assets whose URL never
// changes between deploys (GLBs/textures, ~7MB that would otherwise re-download every
// visit). The HTML app shell ('/') is DELIBERATELY NOT precached: index.html pins the
// content-hashed `/assets/index-<hash>.js` bundle, so a precached shell becomes a
// time-bomb — after a redeploy mints a new bundle hash, a stale cached shell points at
// an `/assets/index-<oldhash>.js` that 404s, the app bundle never executes, and every
// title-screen button (LOGIN / ENTER ARENA) goes inert while the static HTML still
// renders (v0.2.226 entry-flow regression — see entry-flow report). The shell is always
// network-first (cached only opportunistically by networkFirst for offline fallback,
// inside this VERSION-named cache that is purged each deploy, so shell+bundle in cache
// always stay a consistent pair).
const PRECACHE_ASSETS = [
  '/wall-texture.webp',
  '/bitcoin-b.png',
  '/banker-rigged.glb',
  '/chiefmonkey6.glb',
  '/nostrich3.glb',
  '/torii-gate.glb',
  '/gun-steampunk.glb',
];

// ── Install — precache all static assets ─────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for tabs to close
  );
});

// ── Activate — purge stale caches ────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('torii-quest-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim()) // take control of all open tabs immediately
  );
});

// ── Fetch — route by asset type ───────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Only handle same-origin requests
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // Cache-first: GLBs, images, fonts — these never change between deploys
  if (isStaticAsset(path)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Network-first: JS bundles, CSS, HTML — may update on deploy
  event.respondWith(networkFirst(event.request));
});

function isStaticAsset(path) {
  return path.endsWith('.glb')
    || path.endsWith('.webp')
    || path.endsWith('.jpg')
    || path.endsWith('.png')
    || path.endsWith('.woff2')
    || path.endsWith('.wasm'); // Rapier WASM
}

// Cache-first: serve from cache, fall back to network, store result
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Asset unavailable offline', { status: 503 });
  }
}

// Network-first: try network, fall back to cache
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || new Response('Offline', { status: 503 });
  }
}
