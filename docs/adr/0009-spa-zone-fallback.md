# ADR-0009: `index.html` SPA fallback for `/zone/*` deep-links

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `VPS_INSTALL.md`, `HANDOFF.md`,
  `tools/zoneFallbackReadiness.mjs`,
  `tools/regression-check.mjs` (rule #15)

## Context

The gateway travel feature pushes same-origin `/zone/<slug>` URLs (the
v0.2.181 portal hop). These are not real files on disk — they are
routes handled by the SPA at runtime. Without a fallback, a hard reload
or shared deep-link returns 404 and the player loses their session.

## Decision

The origin server serves `dist/index.html` (unchanged) for any
`/zone/*` request that is not a real file. Concretely:

- **Caddy**: `try_files {path} /index.html`
- **Nginx**: `try_files $uri $uri/ /index.html;`
- **S3-style host**: `_redirects` / equivalent SPA fallback rule

The SPA reads `location.pathname`, detects the `/zone/<slug>` prefix,
and resolves the target zone at boot.

No static file may be published under `/zone/*` (that would shadow the
fallback). `dist/` must contain `index.html` for the fallback to work.

## Consequences

- **Enables:** deep-links to zones survive reload and sharing; portal
  hops resolve consistently.
- **Forecloses:** publishing anything under `/zone/*` as a real static
  file; any per-zone server-side rendering.
- **Trade-offs:** initial navigation to a zone URL requires a full app
  boot (SPA client) — acceptable for a game with a warm cache.
- **Enforcement:** `tools/regression-check.mjs` rule #15 fails if the
  install docs don't document the fallback, or (when `dist/` exists) if
  the built route shape can't rely on it.

## Alternatives considered

- **Hash-based routing (`#/zone/<slug>`)**: rejected — worse for
  sharing, worse for edge caching, worse for indexers.
- **Per-zone static pages**: rejected — combinatorial explosion and
  loses the "boot once, hop many" property.

## Notes

Deployed VPS lives at `chiefmonkey.art/quest/`. The base is `/quest/`;
zone URLs resolve to `chiefmonkey.art/quest/zone/<slug>`. ADR-0005's
deploy-base contract ensures this composes cleanly.
