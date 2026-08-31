# ADR-0085 — Sticker studio as avatar napplet (wiring-only)

**Status:** Proposed · **Date:** 2026-08-31
**Deciders:** chiefmonkey
**Related:** ADR-0083 (avatar shell), ADR-0084 (arena wiring), ADR-0086 (release-time napplet identity, deferred)

## Context

ADR-0083 landed the `nap-torii-avatar` shell (`createAvatarHandlers`, `avatar.*` namespace, `torii-avatar-write` requires gate) but wired it to nothing. The sticker studio still writes the character directly: `fireStickerAtNpc` in `stickerNpc.js` mutates the Three scene graph via `Object3D.attach`, and any character-key change flows through `playerModel.js`'s `setCharacter` — with no napplet boundary, no requires gate, and no contrib provenance recorded on the character event.

Two things need proving before the studio is trustworthy as *"one avatar napplet among many"*: (1) the studio advertises a stable napplet identity that will show up in the character event's mandatory `contrib` tag and (2) every character mutation flows through `avatar.propose` — which the handlers only dispatch when the surface carries `torii-avatar-write`. Doing (1) and (2) now — while the studio is still local — lets us verify the requires gate against a first-party consumer before any third-party sticker napplet arrives.

**Full sandboxing (SkinnedMesh raycast inside a sandboxed iframe with a snapshot-based avatar API) is deliberately out of scope for this ADR.** It needs a whole snapshot-and-diff protocol for skinned meshes and is a separate later ADR (ADR-0089, deferred). Wiring-only lets us fix the requires-gate contract now and sandbox later.

## Decision

1. **Add `stickerStudioNappletRegistration.js`.** A pure factory `createStickerStudioAvatarNappletRegistration({ getCharacterView, subscribeCharacterChanges, proposeCharacterPatch, revertCharacterProposal })` returns `{ identity, surfaceId: 'sticker-studio-local', handlers, dispatch(type, data, id) }` — the studio wired as an avatar napplet through `createAvatarHandlers`.

2. **Stable studio identity.** `dTag = 'sticker-studio'`, `aggregateHash = 'sticker-studio@v0-wiring'`. As with the arena registration (ADR-0084), the hash is a placeholder for now; the release pipeline replaces it under ADR-0086.

3. **The registration declares its own requires tag.** `getSurfaceConfig` returns `{ requires: ['torii-avatar-write'] }` — the handlers enforce the gate, not the UI. Any local caller invoking `avatar.propose` on this registration passes the gate; any surface that forgets the tag gets `unsupported` and cannot mutate the character.

4. **Shell owns signing, consent, contrib-tag stamping.** `avatar.propose` calls the shell's `proposeCharacterPatch(patch, identity)`; the shell asks the owner, signs the character event (proposed kind 35100 addressable, `d="torii-character"`), stamps the mandatory contrib tag with the studio's `(dTag, aggregateHash)`, and publishes. The studio never signs and never publishes.

5. **No changes to `stickerNpc.js`, `playerModel.js`, or the studio bootstrap in this ADR.** Wiring the registration into the actual studio path lands as a separate wiring PR once this contract-only PR merges and the avatar shell (ADR-0083) has settled in main.

## Consequences

- **Enables:** face forge, animation loader, and third-party sticker napplets to plug into the character event through exactly the same contract — every mutation goes through the gate, every mutation is provenance-tagged.
- **Forecloses:** silent character mutation from any napplet without the requires tag. The gate is in the handlers; the UI cannot bypass it.
- **Trade-offs:** the sticker studio is still not sandboxed. This ADR does not stop the studio from mutating the Three scene graph directly; it only ensures that everything the studio does *through the avatar contract* is legal. Full sandboxing follows in ADR-0089.
- **Enforcement:** unit tests cover identity constants, `avatar.get` binding, requires-gate enforcement on propose/revert, contrib-identity stamping, subscription scoping, and async error routing.

## Alternatives considered

- **Sandbox the studio in this ADR.** Rejected — see the "out of scope" note. Doing wiring first lets both directions converge on the same contract.
- **Enforce the requires gate at the UI layer.** Rejected — a UI-only gate is trivially bypassable. Enforcing in the handlers means every path through the contract is gated.
- **Skip contrib provenance for now.** Rejected — the whole point of the identity constants is that the release pipeline can flip them to real bundle hashes without any consumer change.

## Notes

Files added: `src/engine/napplets/stickerStudioNappletRegistration.js`. Tests: `tests/napplets/sticker-studio-napplet-registration.test.js`.
