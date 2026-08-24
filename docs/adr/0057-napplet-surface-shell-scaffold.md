# ADR-0057 — Napplet world-surface shell scaffold

**Status:** Accepted · **Version:** v0.2.682-alpha · **Date:** 2026-08-25

## Context

Torii's napplet architecture ([torii-napplet-architecture](https://www.perplexity.ai/projects/torii-8qN21IWsQ7.yuEGH9oNihw)) turns Quest into a trusted host shell for
independently distributed Nostr applets. The v0 design is split into three capability
contracts — `nap-torii-world` (in-world surface napplets), `nap-torii-game` (game
napplets that own their scene), `nap-torii-avatar` (character read/write). Three NAP
drafts exist (2026-08-21) but nothing is implemented in the Quest codebase yet, and the
existing `src/engine/world/proofSurface*` layer is spec-only / inert: it describes where
panels sit in the NAP zone but mounts no live content.

The NAP implementation order's step 1 is the shell scaffold: a component that mounts a
sandboxed iframe, injects `window.napplet.*`, validates every inbound message by
`MessageEvent.source`, and brokers capability requests. This ADR lands that scaffold for
the **world** surface only.

## Decision

1. **World surface only — defer the game host.** This ADR implements `NappletSurface`
   (the `nap-torii-world` host). `NappletGameHost` (relay pool, per-napplet consent gate,
   `game.event.publish`/`subscribe`, fullscreen/zone lifecycle) is deferred to
   ADR-0058+. The shared envelope + identity + srcdoc core is shaped so the game host
   can reuse it.

2. **DOM-overlay iframe, not iframe-to-texture.** The live napplet iframe mounts in the
   DOM; the existing Three.js proof panels stay inert visual anchors. v0 deliberately does
   NOT attempt CanvasTexture / HTMLMesh / WebXR embedding — research confirms WebXR
   immersive sessions render only the WebGL canvas, not the DOM, so embedding a live
   interactive iframe inside a 3D scene is unsolved. The v0 proof is a flat surface panel
   (the product panel), which is a DOM overlay, so this gap does not block v0.

3. **NIP-5D trust boundary.** Each napplet mounts in an `<iframe sandbox="allow-scripts">`
   with **no `allow-same-origin`** (opaque origin). The shell validates every inbound
   `postMessage` by `MessageEvent.source` (the iframe's `contentWindow`), never by
   `event.origin`. Identity is the `(dTag, aggregateHash)` tuple from the NIP-5A manifest
   (kind 35129); the shell binds that tuple to the iframe's source.

4. **`srcdoc` bootstrap.** The iframe loads a generated `srcdoc` that bootstraps
   `window.napplet.world` with the six v0 methods (`attach.get`, `pose.subscribe`,
   `pose.unsubscribe`, `emit`, `visit`, `zone.list`). Each method posts a typed envelope
   to `window.parent` and returns a Promise that resolves on the matching `.result` /
   rejects on `.error`. The bootstrap never reads `parent.document`.

5. **No live surfaces converted yet.** Every surface stays `enabled: false` (test-only).
   The product-panel and leaderboard conversions are separate later ADRs. Nothing in
   this increment makes the existing proof surfaces actionable.

6. **Module decomposition** (all under `src/engine/napplets/`):
   - `nappletEnvelope.js` — pure: `validateEnvelope`, `resultEnvelope`, `errorEnvelope`,
     `splitType`, `isResultType`/`isErrorType`. Unknown types silently ignored.
   - `nappletIdentity.js` — pure: `(dTag, aggregateHash)` normalize + key.
   - `nappletSrcdoc.js` — pure: `buildWorldSrcdoc()` returns the in-iframe HTML;
     `WORLD_METHODS` is the single source of truth for the method surface.
   - `worldNappletHandlers.js` — mostly pure: implements `world.attach.get`,
     `world.zone.list`, allow-listed `world.emit`; returns `unsupported` for
     `pose.*`/`visit`.
   - `worldNappletSurfaceConfig.js` — frozen per-surface config keyed by the existing
     proof surface ids; does NOT mutate `proofSurfaceSpecs.js` (keeps its inert contract).
   - `NappletSurface.js` — browser-only, DI of `window`/`document`: creates the sandboxed
     iframe, registers the source, routes source-validated messages, `destroy()` cleanup.

7. **Deferred (v0 non-goals, parked for later ADRs):** `NappletGameHost`, real manifest
   relay resolver, real Blossom fetch + hash verifier, product-panel / leaderboard /
   sticker-studio conversion, `world.visit` navigation, `world.pose.subscribe`, signing
   broker, wallet / Cashu, character event kind, any change that makes proof surfaces live.

## Consequences

- The trusted-shell boundary for flat surface napplets is now provable in unit tests
  with dependency-injected stubs — no jsdom, no real relay, no Blossom, no signing.
- Adding a world method is a one-line change to `WORLD_METHODS` (both sides share it).
- The scaffold is live-mountable but dormant; flipping a surface on is a future ADR's
  decision, not a config flag anyone can trip by accident.
- `proofSurfaceSpecs.js` and its inert invariants are untouched.

## Open questions (park for the conversion ADRs)

- Does `world.pose.update` need to land before the sticker-studio napplet, or can the
  product-panel proof ship without it? (Draft leans: ship without.)
- Which Nostr kind holds the assembled character? Not decided (working proposal:
  addressable kind `35100`, `d: "torii-character"`).
- Does `world.emit kind=purchase` carry Cashu tokens, or is that strictly
  `nap-cashu-wallet`'s job? (Draft leans strict.)

## Tests

39 new tests under `tests/napplets/`: envelope (14), srcdoc (7), world handlers (12),
NappletSurface boundary (6). Full suite: 3338 passing / 263 files.

---

**Author:** chiefmonkey · **Draft date:** 2026-08-25 ·
**Next step:** convert the product panel into the first `nap-torii-world` napplet
(smallest existing surface) to validate the whole stack against real 3D + DOM constraints.
