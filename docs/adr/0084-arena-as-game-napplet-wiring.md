# ADR-0084 — Arena as game napplet (wiring-only)

**Status:** Accepted · **Date:** 2026-08-31
**Deciders:** chiefmonkey
**Related:** ADR-0082 (game host shell), ADR-0085 (sticker studio wiring), ADR-0086 (release-time napplet identity, deferred)

## Context

ADR-0082 landed the `nap-torii-game` shell (`createGameHandlers`, `NappletGameHost`, `game.*` namespace) but wired it to nothing. The arena runtime is still a first-class shell citizen: `createArenaRuntime(hooks)` in `arenaRuntime.js` runs Three + Rapier directly in the main window, imports the multiplayer socket, signs and publishes events through `main.js`'s `signEvent`/`fanoutPublish`.

Two things need proving before the arena is trustworthy as *"one napplet among many"*: (1) the arena advertises a stable napplet identity and (2) every capability it needs (player identity, event publish, event subscribe, exit) flows through the `game.*` contract instead of direct calls. Doing (1) and (2) now — while the arena is still local — lets us verify the contract with a first-party consumer before any third-party game arrives.

**Full sandboxing (Three + Rapier inside a sandboxed iframe with only DOM/postMessage access) is deliberately out of scope for this ADR.** It would double the bundle cost, need a whole WebGL bridge design, and take weeks. It is a separate later ADR (ADR-0088, deferred). Wiring-only lets us fix the contract now and sandbox later.

## Decision

1. **Add `arenaNappletRegistration.js`.** A pure factory `createArenaGameNappletRegistration({ worldNpub, worldLabel, getLocalPlayer, signAndPublishEvent, openRelaySubscription, onArenaExit })` returns `{ identity, surfaceId: 'arena-local', handlers, dispatch(type, data, id) }` — the arena wired as a game napplet through `createGameHandlers`.

2. **Stable arena identity.** `dTag = 'torii-arena'`, `aggregateHash = 'torii-arena@v0-wiring'`. The hash is a semver placeholder for now; the release pipeline will replace it with a real bundle hash under ADR-0086. Any incorrect stamp shows up in a contrib tag immediately, which is the point.

3. **Shell owns signing + relay hits.** `game.event.publish` calls the shell's `signAndPublishEvent(unsignedEvent)`; the arena registration never signs and never touches a relay directly. This is the same discipline the sticker studio (ADR-0085) follows for `avatar.propose`.

4. **No changes to `arenaRuntime.js`, `main.js`, or the arena bootstrap in this ADR.** Wiring the registration into the actual boot path (passing real callbacks, initialising it after `_arena` is created) lands as a separate wiring PR once this contract-only PR merges and the game-host shell (ADR-0082) has settled in main.

## Consequences

- **Enables:** leaderboards, cross-game plumbing, third-party embedders, and Continuum can talk to the arena through exactly the same envelope as any other game napplet — no arena-specific bindings anywhere.
- **Forecloses:** the arena signing or publishing directly from within a napplet contract. Every event still passes through the shell's existing `signEvent`/`fanoutPublish` — no new signing path.
- **Trade-offs:** the arena runtime is still not sandboxed. This ADR does not stop the arena from doing anything a napplet couldn't do; it only ensures that everything the arena does *through the contract* is legal. Full sandboxing follows in ADR-0088.
- **Enforcement:** unit tests cover the identity constants, the requires-a-worldNpub throw, unsupported-callback degradation, shell-brokered publish, subscription open/close scoping, and exit.

## Alternatives considered

- **Sandbox the arena in this ADR.** Rejected — see the "out of scope" note above. Doing wiring first lets both directions converge on the same contract instead of designing the sandbox first and refactoring the contract.
- **Skip the registration and wire the arena straight to the shell later.** Rejected — it would leave the game host shell (ADR-0082) with no first-party consumer, which is exactly the risk that keeps third-party napplets fragile.

## Notes

Files added: `src/engine/napplets/arenaNappletRegistration.js`. Tests: `tests/napplets/arena-napplet-registration.test.js`.
