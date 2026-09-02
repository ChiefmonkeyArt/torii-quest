// engine/napplets/stickerStudioNappletRegistration.js — registers the Torii Quest
// sticker studio as a nap-torii-avatar v0 write napplet (ADR-0085). WIRING-ONLY:
// the studio keeps its existing SkinnedMesh raycast + Object3D.attach path (see
// [concepts/sticker-skin-system]). This module gives it an avatar.* identity, a
// dispatcher, and the `torii-avatar-write` requires gate — so every character
// mutation flows through the same contract a third-party sticker napplet would.
//
// The dispatcher is `createAvatarHandlers` (ADR-0083), unchanged. What this module
// adds is:
//  - a stable studio identity: dTag "sticker-studio", aggregateHash from the release.
//  - the `torii-avatar-write` requires gate, enforced by the handlers.
//  - an `avatar.get` binding to the live character view + contrib chain.
//  - an `avatar.propose` binding: the studio hands the shell a patch, the shell
//    asks the owner, signs the character event (proposed kind 35100 addressable,
//    d="torii-character"), stamps the mandatory contrib tag with this identity,
//    and publishes. The studio never signs, never publishes, never touches a relay.
//  - an `avatar.revert` binding that rolls its own proposal back.
//
// PURE + node-safe: no DOM, no Three, no Nostr — every side-effect crosses the
// boundary through an injected callback and is unit-testable with plain stubs.

import { createAvatarHandlers } from './avatarNappletHandlers.js';
import { normalizeIdentity } from './nappletIdentity.js';

export const STICKER_STUDIO_NAPPLET_IDENTITY = Object.freeze({
  dTag: 'sticker-studio',
  // Aggregate hash captured at napplet-registration time. Bumped by the release
  // pipeline when the studio bundle changes (see ADR-0086, deferred). For now it's
  // the semver line so an incorrect stamp shows up in the contrib tag immediately.
  aggregateHash: 'sticker-studio@v0-wiring',
});

// The requires tag that gates avatar.propose / avatar.revert. Enforced by the
// handlers (ADR-0083), not just the UI.
export const REQUIRES_AVATAR_WRITE = 'torii-avatar-write';

// createStickerStudioAvatarNappletRegistration({
//   getCharacterView,          // () → { characterKey, contrib: [{dTag,aggregateHash}...] } | null
//   subscribeCharacterChanges, // (onChange) → { subscriptionId, close }
//   proposeCharacterPatch,     // (patch, identity) → Promise<{ proposalId, ok, reason? }>
//   revertCharacterProposal,   // (proposalId) → Promise<{ ok }>
// }) → { identity, surfaceId, handlers, dispatch }
export function createStickerStudioAvatarNappletRegistration({
  surfaceId = 'sticker-studio-local',
  getCharacterView,
  subscribeCharacterChanges,
  proposeCharacterPatch,
  revertCharacterProposal,
} = {}) {
  const identity = normalizeIdentity(STICKER_STUDIO_NAPPLET_IDENTITY);

  const handlers = createAvatarHandlers({
    getCharacter: typeof getCharacterView === 'function'
      ? (_surf) => getCharacterView()
      : undefined,
    subscribeCharacter: typeof subscribeCharacterChanges === 'function'
      ? (_surf, onChange) => subscribeCharacterChanges(onChange)
      : undefined,
    proposeCharacterChange: typeof proposeCharacterPatch === 'function'
      ? (_surf, patch, requestIdentity) => Promise.resolve(
        proposeCharacterPatch(patch, requestIdentity || identity),
      )
      : undefined,
    revertProposal: typeof revertCharacterProposal === 'function'
      ? (_surf, proposalId) => Promise.resolve(revertCharacterProposal(proposalId))
      : undefined,
    // Surface config carries the requires tag; the handler enforces it.
    getSurfaceConfig: (_surf) => ({ requires: [REQUIRES_AVATAR_WRITE] }),
  });

  function dispatch(type, data, id) {
    return handlers.dispatch(type, data, surfaceId, id, identity);
  }

  return { identity, surfaceId, handlers, dispatch };
}
