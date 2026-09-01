# ADR-0083 — Napplet avatar shell scaffold

**Status:** Accepted · **Date:** 2026-08-30
**Deciders:** chiefmonkey
**Related:** ADR-0057 (world surface shell), ADR-0082 (game host shell), [nap-torii-avatar v0](https://www.perplexity.ai/computer/tasks/340057be-94d5-4511-b671-081be607f69c)

## Context

`nap-torii-avatar v0` defines a small read/write API against the player's character event (proposed kind 35100 addressable, `d="torii-character"`, one per npub for v0). The character itself is deliberately NOT a napplet — it is a signed Nostr event that napplets (sticker studio, face forge, animation loader) write to via `avatar.propose`. The world and game shells cover their own namespaces; nothing has been built for `avatar` yet.

Write must be opt-in per napplet, not per session, so a random world napplet cannot silently rewrite the player's character. The v0 spec expresses this as a `requires: ['torii-avatar-write']` tag on the surface config; without it, `avatar.propose` and `avatar.revert` are unsupported and the shell will not surface a consent prompt.

## Decision

1. **`avatar` namespace, handlers-first.** Add `AVATAR_NAMESPACE = 'avatar'` to `nappletEnvelope.js` and a `createAvatarHandlers()` dispatcher. Reuse `NappletSurface` and `NappletGameHost` for actual mounting — an avatar tool is either a surface panel (booth) or a fullscreen napplet — so no dedicated host is needed in v0.

2. **v0 method surface.** Dispatch `avatar.get`, `avatar.subscribe`, `avatar.unsubscribe`, `avatar.propose`, `avatar.revert`. All missing callbacks return `unsupported` so a napplet degrades cleanly.

3. **`torii-avatar-write` requires gate.** `avatar.propose` and `avatar.revert` are only dispatched when the surface config declares the `torii-avatar-write` requires tag. This is enforced in the handlers (not the shell UI) so it holds even if the UI is bypassed.

4. **Shell owns signing and provenance.** The handlers never sign, publish, or touch a relay directly — `avatar.propose` forwards `(surfaceId, patch, identity)` to `proposeCharacterChange`. The shell is responsible for asking the owner, stamping the mandatory `contrib` tag with `(dTag, aggregateHash)` of the requesting napplet, signing, and publishing. If the owner declines, the callback returns `{ ok: false, reason }` and the napplet sees a normal error.

5. **No wiring in Torii Quest yet.** This ADR lands the scaffold + tests only. Converting the sticker studio to a `torii-avatar-write` napplet, and adding the proposal ledger + owner consent UX, are separate later ADRs.

## Consequences

- **Enables:** the sticker studio, face forge, and animation loader to be built as independently distributed napplets that write the character event through one contract.
- **Forecloses:** any napplet writing the character event directly. Every write must pass the requires gate and the shell's owner-consent path.
- **Trade-offs:** the handlers depend on the surface config carrying `requires`; existing world surface configs do not yet emit it. The wiring ADR must extend the world/avatar surface config shape.
- **Enforcement:** unit tests cover the requires gate, unsupported-action degradation, per-surface subscription scoping, and async propose/revert envelope routing.

## Alternatives considered

- **Global write consent per session.** Rejected — impossible to reason about which napplet contributed which change (the mandatory `contrib` tag would lose meaning) and impossible to revoke selectively.
- **Character as a napplet.** Rejected earlier in the design — it is a signed Nostr event that napplets write to, not a sandboxed applet with its own scene.

## Notes

Files added: `src/engine/napplets/avatarNappletSrcdoc.js`, `src/engine/napplets/avatarNappletHandlers.js`. Tests: `tests/napplets/avatar-napplet-handlers.test.js`. `NAPPLET_NAMESPACES` in `nappletEnvelope.js` now enumerates all three v0 namespaces.
