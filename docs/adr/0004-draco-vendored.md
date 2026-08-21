# ADR-0004: Draco decoder vendored at `/draco/` — never gstatic

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `public/draco/`, `src/playerModel.js`, `src/napNpc.js`,
  ADR-0003 (CSP), `tools/regression-check.mjs` (rule #16)

## Context

Draco-compressed GLBs need a WASM+JS decoder pair at runtime. The default
Three.js recipe points `setDecoderPath()` at `https://www.gstatic.com/…`,
which forces a third-party origin into `script-src`/`connect-src` and is
incompatible with the CSP we require (ADR-0003). It also introduces a
runtime dependency on Google's CDN.

## Decision

The Draco decoder is vendored into the repo under `public/draco/` and
served from the same origin as the app. Every `DRACOLoader` call uses
`setDecoderPath(assetUrl('/draco/'))` so the path is deploy-base aware
(ADR-0005).

## Consequences

- **Enables:** the CSP has no third-party origin; Draco works offline
  and on the VPS without external network dependencies.
- **Forecloses:** referencing `gstatic.com` (or any other third-party
  Draco host) anywhere in `src/` or `index.html`.
- **Trade-offs:** the vendored files add ~250 KB to the repo. We accept
  this in exchange for CSP simplicity and reliability.
- **Enforcement:** `tools/regression-check.mjs` rule #16 fails the build
  if `public/draco/` is missing, if `setDecoderPath` does not use
  `assetUrl('/draco/')`, or if `gstatic.com` appears in `src/` or
  `index.html`.

## Alternatives considered

- **Load from gstatic.com**: rejected — requires opening the CSP and
  taking a third-party runtime dependency.
- **Bundle Draco into the JS entry chunk**: rejected — increases first-
  paint download for players who never load a Draco-compressed asset.

## Notes

`assetUrl()` prefixes the deploy base (e.g. `/quest/` on the VPS),
which is why the path must go through it and not be hard-coded as
`/draco/` (ADR-0005).
