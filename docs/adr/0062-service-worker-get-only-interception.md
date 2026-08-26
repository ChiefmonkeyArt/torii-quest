# ADR-0062 — Service worker only intercepts GET requests

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** chiefmonkey
- **Related:** `public/sw.js`, `tests/sw-app-shell.test.js`, ADR (entry-flow regression guard for the app shell)

## Context

The service worker's fetch handler routed every same-origin request through
`networkFirst()` (or `cacheFirst()` for static assets) with no HTTP-method
check. Both helpers end with `cache.put(request, response.clone())` for any
`response.ok`. The Cache API's `put()` only accepts GET requests — any
POST/PUT/DELETE throws `TypeError: Failed to execute 'put' on 'Cache': Request
method 'POST' is unsupported`.

This was invisible during normal play until a same-origin POST started firing
repeatedly in a `requestAnimationFrame` loop — almost certainly the kami
auto-capture path (`arenaRuntime.js`, `POST /mp/kami/autocap`, once per
captured frame; the minified stack trace `Ge.vr.type` in a `requestAnimationFrame`
chain matches that call site, though the minified bundle line was not
byte-confirmed against source). Each captured frame produced an uncaught
`TypeError` in the service worker console ~every 75 frames, flooding the
log and masking every other diagnostic signal during the ADR-0061 napplet
investigation. Other same-origin POSTs that would hit the same path if they
fired: session auth (`POST /mp/session`) and admin update checks.

This is a genuine defect, not a benign warning: uncaught promise rejections in
the service worker, repeated dozens of times per second of kami recording,
and a real risk that a future same-origin POST would silently never get
cached-or-served correctly (it would always fall through to the network,
which is the correct behavior anyway — but only by accident of the throw,
not by design).

## Decision

Add an early `method === 'GET'` guard in the fetch handler, before any
`respondWith(...)` call. Non-GET requests return early and pass straight
through to the browser's default network handling — they are never intercepted,
never reach `cacheFirst()` / `networkFirst()`, and never call `cache.put()`.

```js
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (event.request.method !== 'GET') return;   // ← new guard
  const path = url.pathname;
  if (isStaticAsset(path)) { event.respondWith(cacheFirst(event.request)); return; }
  event.respondWith(networkFirst(event.request));
});
```

`cacheFirst()` and `networkFirst()` are left untouched — they are only ever
called with GET requests now, so their `cache.put()` calls are safe.

## Consequences

- **Enables:** same-origin POSTs (kami auto-capture, session auth, admin
  updates) now reach the network cleanly with no service-worker interference
  and no console errors.
- **Forecloses:** no future code path may add a non-GET request to the SW's
  interception surface. Any new strategy that legitimately needs to handle
  non-GET (e.g. background sync) must be added explicitly and deliberately,
  not by removing this guard.
- **Trade-offs:** none. Non-GET requests are never cacheable by the Cache API
  anyway; the previous behavior only ever did the right thing (pass through to
  network) by accident of throwing. This makes it explicit and silent.
- **Enforcement:** new contract test in `tests/sw-app-shell.test.js` asserts
  the fetch handler contains a `event.request.method !== 'GET'` guard that
  appears before any `respondWith(...)` call. Verified to fail when the guard
  is removed, pass when it is restored.

## Alternatives considered

- **Guard inside `cacheFirst()` / `networkFirst()` instead (check
  `request.method === 'GET'` before `cache.put()`):** rejected — this would
  silently swallow the POST (still returning the response, just not caching it)
  and hide the fact that the SW is intercepting requests it has no business
  touching. The fetch-handler guard is clearer: non-GET requests are simply
  not the service worker's concern at all.
- **Whitelist specific same-origin POST paths to pass through:** rejected —
  brittle and requires the SW to know about every POST endpoint. The
  method-based guard is exhaustive and future-proof.

## Notes

- Discovered while diagnosing ADR-0061: the repeating `sw.js:132` TypeError
  dominated the v0.2.690 retest console log and made it hard to see whether
  the napplet fix had worked. The napplet fix (ADR-0061) was confirmed
  separately and is unrelated; this ADR addresses only the service-worker
  caching error.
- The specific recurring trigger (kami auto-capture) only fires while kami
  mode is actively recording, but the defect exists for any same-origin POST
  at any time. The fix is general.
