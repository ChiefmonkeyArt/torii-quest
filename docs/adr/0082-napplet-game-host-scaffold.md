# ADR-0082 — Napplet game-host shell scaffold

**Status:** Accepted · **Date:** 2026-08-30
**Deciders:** chiefmonkey
**Related:** ADR-0057 (world surface shell), ADR-0058 (product panel conversion), ADR-0083 (avatar shell), [nap-torii-game v0](https://www.perplexity.ai/computer/tasks/340057be-94d5-4511-b671-081be607f69c)

## Context

ADR-0057 landed the `nap-torii-world` shell (`NappletSurface`) and ADR-0058 proved it end-to-end with the product panel. The two other v0 NAPs — `nap-torii-game` (napplets that own their scene) and `nap-torii-avatar` (character read/write) — remained unbuilt. `src/engine/napplets/nappletEnvelope.js` marked `game` as a future namespace but no dispatcher, srcdoc, or host existed. Repackaging the Torii Quest arena as its own napplet, and mounting third-party games, both require a game host before either can be proved.

The world shell's design (sandboxed `srcdoc` iframe, source-validated postMessage, per-mount channelId nonce, hardened CSP) already generalizes to a game host; the only differences are the namespace it dispatches, whether the iframe fills the viewport by default, and that some `game.*` actions are inherently async (relay publish).

## Decision

1. **Introduce a symmetric `game` shell.** Add `GAME_NAMESPACE = 'game'` to `nappletEnvelope.js`, a `buildGameSrcdoc()` bootstrap exposing `window.napplet.game.<method>()`, a `createGameHandlers()` dispatcher for the v0 subset, and a `createNappletGameHost()` mounter mirroring `NappletSurface` — same trust boundary, same channelId enforcement.

2. **v0 method surface.** Dispatch `game.host.info`, `game.player.get`, `game.event.publish`, `game.event.subscribe`, `game.event.unsubscribe`, `game.exit`. Defer `game.player.subscribe`/`unsubscribe` (presence stream) and `game.visit` — both return `unsupported` so a napplet degrades cleanly.

3. **Async handler protocol.** A handler may return `{ __async: true, promise }` for actions that cannot resolve synchronously (relay publish, propose). The host awaits the promise and posts the resolved envelope with the correct channelId. Sync returns stay a plain envelope, unchanged from ADR-0057.

4. **No behaviour wired in Torii Quest yet.** This ADR lands the scaffold + tests only. Repackaging the arena as a `torii-game` napplet, wiring `publishEvent` to the leaderboard relay pool, and adding the `game.visit` executor are separate later ADRs. No existing surface is converted.

## Consequences

- **Enables:** the arena to be packaged as a `nap-torii-game` napplet without touching the trust boundary; third-party games can mount inside a Quest shell with the same guarantees as the product panel; nap-torii-avatar can share the async handler protocol.
- **Forecloses:** in-shell direct signing from a game napplet — publish always goes through the injected `publishEvent` callback, so signing + consent + contrib-tag stamping stay shell-owned.
- **Trade-offs:** two hosts to maintain (`NappletSurface` and `NappletGameHost`) — kept in sync by shared envelope, identity, and channelId helpers.
- **Enforcement:** unit tests cover source validation, channelId enforcement, per-surface subscription scoping, unsupported-action degradation, and async publish envelope routing.

## Alternatives considered

- **Unify one host for `world` + `game`.** Rejected — a game napplet needs viewport fill and async event routing on day one, and a `nap-torii-world` napplet is a surface panel that must not fill the viewport. Splitting keeps each host's contract legible.
- **Pass raw `sign`/`publish` primitives to the napplet.** Rejected — that would put a signing key inside the sandbox on the wrong side of the trust boundary. Every relay hit stays shell-brokered.

## Notes

Files added: `src/engine/napplets/gameNappletSrcdoc.js`, `src/engine/napplets/gameNappletHandlers.js`, `src/engine/napplets/NappletGameHost.js`. Tests: `tests/napplets/game-napplet-handlers.test.js`, `tests/napplets/game-napplet-host.test.js`.
