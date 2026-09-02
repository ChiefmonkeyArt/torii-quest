# ADR-0005: Service worker registration and precache are deploy-base aware

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `public/sw.js`, `src/main.js`, `src/config.js` (VERSION),
  `tools/regression-check.mjs` (rule #21)

## Context

The app ships at two different deploy bases: `/` on S3-style static
hosting, `/quest/` on the VPS (`chiefmonkey.art/quest/`). A service
worker hard-coded to `/sw.js` and precaching `/index.html` would fail on
the VPS. Additionally, every version bump must bust the SW's cache; a
stale precache after deploy is a "why isn't my fix live" incident
waiting to happen.

## Decision

1. **Registration** goes through `import.meta.env.BASE_URL` (Vite's
   deploy base), not a hard-coded `/sw.js`.
2. **Precache manifest** uses base-aware URLs (via `assetUrl()` where
   applicable).
3. **`CACHE_VERSION`** in `public/sw.js` embeds the current app
   `VERSION` (e.g. `'tq-v0.2.621-alpha'`). Every version bump therefore
   invalidates the SW cache automatically.
4. **`CACHE_NAME`** is derived: `` `torii-quest-${CACHE_VERSION}` ``.

## Consequences

- **Enables:** the same build works at both deploy bases; every deploy
  automatically evicts the old cache; the SW's activate step can prune
  stale caches by prefix match on `torii-quest-`.
- **Forecloses:** hard-coding paths inside the SW; forgetting to bump
  `CACHE_VERSION` on release (regression check #5 enforces the version-
  string presence).
- **Trade-offs:** every version bump forces a fresh precache download on
  each client's first visit after deploy. We accept this — the
  alternative (stale bytes served after a "successful" deploy) is worse.
- **Enforcement:** `tools/regression-check.mjs` rule #21 checks that SW
  registration and precache paths are deploy-base aware. Rule #5
  ensures `CACHE_VERSION` matches `EXPECTED_VERSION`.

## Alternatives considered

- **No service worker**: rejected — the offline-friendly precache is
  worth the complexity for a game that runs long sessions.
- **Registrationless SW via `<link>`**: rejected — SW scope rules make
  this brittle at nested deploy bases like `/quest/`.
- **Manual CACHE_VERSION**: rejected — humans forget. Tying it to the
  app VERSION makes it impossible to forget.

## Notes

The SW normalisation experiment in v0.2.620 (intercepting versioned
`torii-entry.js?v=<stamp>` URLs) is **NOT** in this baseline (reset to
v0.2.605). Any future SW logic beyond the deploy-base contract needs a
new ADR.
