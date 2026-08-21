# ADR-0003: CSP delivered as HTTP header — nonce-free, strict-dynamic disabled, inline bootstrap sha256

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `tools/csp.mjs`, `dist/_headers`, `VPS_INSTALL.md`,
  `tools/regression-check.mjs` (rule #16)

## Context

The game must satisfy a strict Content-Security-Policy that (a) forbids
third-party script/style/font origins, (b) allows the inline bootstrap
that `import()`s the entry chunk from a versioned URL, and (c) survives
across three delivery paths without drift: the S3-style static host
(`dist/_headers`), the Vite preview server, and the VPS Caddy/Nginx
configs. Historical `<meta>` CSPs were fragile: they only cover the
document itself, not resources loaded via HTTP responses, and edge
caches sometimes strip or reorder them.

## Decision

The CSP ships **as an HTTP response header** in every delivery path,
derived from the single source of truth `tools/csp.mjs`. Specifically:

1. `dist/_headers` is written at build time by the Vite plugin using
   `CSP_VALUE`, with the inline bootstrap sha256 recomputed from the
   emitted `dist/index.html`.
2. The Vite preview server uses the same value.
3. The Caddy and Nginx server blocks in `VPS_INSTALL.md` document the
   same policy verbatim.

Concrete constraints:

- **No `<meta>` CSP** anywhere in `index.html` or `dist/index.html`.
- **No `'strict-dynamic'`** — Chrome ignores host allowlists when it is
  present but does not propagate the inline bootstrap hash's trust
  through `import()` for our module graph.
- **One inline bootstrap** in `index.html`, allow-listed via its
  sha256-in-quotes hash-source. Any change to that inline bootstrap
  changes its hash; the build plugin recomputes it automatically at
  `writeBundle`.
- **No `gstatic.com`** or other third-party script/style/font origin.
  Draco is vendored (see ADR-0004).
- `connect-src` lists Nostr relay WSS origins + `https://api.github.com`
  (release check, GET-only). Nothing else.

## Consequences

- **Enables:** origin server enforces the same policy the bundle assumes;
  edge caches cannot silently drop it; the policy is greppable in one
  file.
- **Forecloses:** any new third-party script/style/font origin (would
  need an ADR-update). Any change to the inline bootstrap requires the
  hash to update (automatic at build time). Adding `'strict-dynamic'`
  is off the table.
- **Trade-offs:** operators deploying via a custom nginx/caddy must
  keep the header block in sync with `tools/csp.mjs`. The regression
  check flags drift.
- **Enforcement:** `tools/regression-check.mjs` rule #16 fails if:
  `<meta>` CSP appears, `gstatic.com` appears, Draco is missing from
  `public/draco/`, `tools/csp.mjs` lacks required directives, or (when
  `dist/` exists) the built bootstrap sha drifts from `CSP_VALUE`.

## Alternatives considered

- **`<meta>` CSP**: rejected — doesn't cover cross-origin resource
  loads, unreliable through edge caches, hard to reason about.
- **`'strict-dynamic'` + nonces**: rejected — Chrome-specific behaviour
  breaks our `import()`-driven entry chunk; per-request nonces are
  incompatible with static hosting.
- **Nonce-based CSP served by a live app server**: rejected — the game
  is deployable as static files. Adding an app server just for CSP is
  disproportionate.

## Notes

Recomputing the inline sha at `writeBundle` from the *emitted* HTML
means the bootstrap can be edited (e.g. to add build stamps) without
manual hash maintenance. This was validated in v0.2.620 before the
crosshair/ESC reset.
