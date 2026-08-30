// engine/napplets/avatarNappletHandlers.js — nap-torii-avatar v0 message handlers
// for the Torii Quest shell (ADR-0083). MOSTLY PURE + node-safe: no DOM, no Three,
// no direct network, no signing, no wallet.
//
// The handlers broker read + proposed-write access to the player's character event
// (proposed kind 35100 addressable, d="torii-character"). WRITE is gated by a
// per-napplet `requires` tag: the surface config must list `torii-avatar-write` for
// avatar.propose to be dispatched, otherwise the handlers return `unsupported`.
//
// The handlers never sign, never publish, never touch a Nostr relay directly —
// avatar.propose forwards the proposed patch + provenance to an injected callback
// (`proposeCharacterChange`). The shell owns signing, consent UX, contrib-tag
// stamping, and relay publish; if the callback is absent, propose fails cleanly.
//
// v0 surface subset:
//   avatar.get        — "give me the current character view-model"
//   avatar.subscribe  — "push me the character view-model on every change"
//   avatar.unsubscribe
//   avatar.propose    — "here is a proposed patch; ask the owner"
//   avatar.revert     — "roll my proposed patch back" (only my own)

import {
  splitType, resultEnvelope, errorEnvelope, AVATAR_NAMESPACE,
} from './nappletEnvelope.js';

// createAvatarHandlers({
//   getCharacter, subscribeCharacter, unsubscribeCharacter,
//   proposeCharacterChange, revertProposal,
//   getSurfaceConfig,
// }) → { dispatch(fullType, data, surfaceId, id), releaseSurface(surfaceId) }.
//
// Injected callbacks:
//   getCharacter(surfaceId) → { characterKey, contrib: [{ dTag, aggregateHash }...] }
//   subscribeCharacter(surfaceId, onChange) → { subscriptionId, close }
//   unsubscribeCharacter(surfaceId, subscriptionId) → boolean
//   proposeCharacterChange(surfaceId, patch, identity)
//     → Promise<{ proposalId, ok, reason? }>  (identity = { dTag, aggregateHash })
//   revertProposal(surfaceId, proposalId) → Promise<{ ok }>
//   getSurfaceConfig(surfaceId) → { requires: string[], ... }  (from surface config)
export function createAvatarHandlers({
  getCharacter,
  subscribeCharacter,
  unsubscribeCharacter,
  proposeCharacterChange,
  revertProposal,
  getSurfaceConfig,
} = {}) {
  const subs = new Map(); // surfaceId → Map<subscriptionId, closeFn>

  function ensureMap(surfaceId) {
    let m = subs.get(surfaceId);
    if (!m) { m = new Map(); subs.set(surfaceId, m); }
    return m;
  }

  function requiresWrite(surfaceId) {
    if (typeof getSurfaceConfig !== 'function') return false;
    const cfg = getSurfaceConfig(surfaceId);
    if (!cfg || !Array.isArray(cfg.requires)) return false;
    return cfg.requires.indexOf('torii-avatar-write') !== -1;
  }

  function dispatch(fullType, data, surfaceId, id, identity) {
    const parts = splitType(fullType);
    if (!parts || parts.ns !== AVATAR_NAMESPACE) return null;
    const type = fullType;
    const action = parts.action;

    if (action === 'get') {
      if (typeof getCharacter !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no getCharacter callback bound');
      const view = getCharacter(surfaceId);
      if (!view) return errorEnvelope(type, id, 'no-character', 'no character loaded');
      return resultEnvelope(type, id, {
        characterKey: typeof view.characterKey === 'string' ? view.characterKey : null,
        contrib: Array.isArray(view.contrib) ? view.contrib.slice() : [],
      });
    }

    if (action === 'subscribe') {
      if (typeof subscribeCharacter !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no subscribeCharacter callback bound');
      const map = ensureMap(surfaceId);
      try {
        const sub = subscribeCharacter(surfaceId, /* onChange */ () => { /* pushed by surface */ });
        if (!sub || typeof sub.subscriptionId !== 'string' || typeof sub.close !== 'function')
          return errorEnvelope(type, id, 'bad-callback', 'subscribeCharacter must return {subscriptionId, close}');
        map.set(sub.subscriptionId, sub.close);
        return resultEnvelope(type, id, { subscriptionId: sub.subscriptionId });
      } catch (err) {
        return errorEnvelope(type, id, 'subscribe-failed', String(err && err.message || err));
      }
    }

    if (action === 'unsubscribe') {
      const subscriptionId = data && data.subscriptionId;
      if (typeof subscriptionId !== 'string' || !subscriptionId)
        return errorEnvelope(type, id, 'bad-request', 'data.subscriptionId is required');
      const map = subs.get(surfaceId);
      const close = map && map.get(subscriptionId);
      if (!close)
        return errorEnvelope(type, id, 'unknown-subscription', 'no such subscription for this surface');
      try { close(); } catch (_) { /* isolate */ }
      map.delete(subscriptionId);
      if (typeof unsubscribeCharacter === 'function') {
        try { unsubscribeCharacter(surfaceId, subscriptionId); } catch (_) { /* isolate */ }
      }
      return resultEnvelope(type, id, { ok: true });
    }

    if (action === 'propose') {
      if (!requiresWrite(surfaceId))
        return errorEnvelope(type, id, 'unsupported', 'surface does not carry torii-avatar-write requires tag');
      if (typeof proposeCharacterChange !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no proposeCharacterChange callback bound');
      const patch = data && data.patch;
      if (!patch || typeof patch !== 'object')
        return errorEnvelope(type, id, 'bad-request', 'data.patch is required');
      return { __async: true, promise: Promise.resolve(
        proposeCharacterChange(surfaceId, patch, identity || null),
      ).then(
        (r) => resultEnvelope(type, id, {
          proposalId: (r && r.proposalId) || null,
          ok: !!(r && r.ok),
          reason: (r && r.reason) || null,
        }),
        (err) => errorEnvelope(type, id, 'propose-failed', String(err && err.message || err)),
      )};
    }

    if (action === 'revert') {
      if (!requiresWrite(surfaceId))
        return errorEnvelope(type, id, 'unsupported', 'surface does not carry torii-avatar-write requires tag');
      if (typeof revertProposal !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no revertProposal callback bound');
      const proposalId = data && data.proposalId;
      if (typeof proposalId !== 'string' || !proposalId)
        return errorEnvelope(type, id, 'bad-request', 'data.proposalId is required');
      return { __async: true, promise: Promise.resolve(
        revertProposal(surfaceId, proposalId),
      ).then(
        (r) => resultEnvelope(type, id, { ok: !!(r && r.ok) }),
        (err) => errorEnvelope(type, id, 'revert-failed', String(err && err.message || err)),
      )};
    }

    return null; // silently ignored per NIP-5D §capability
  }

  function releaseSurface(surfaceId) {
    const map = subs.get(surfaceId);
    if (!map) return;
    for (const close of map.values()) { try { close(); } catch (_) { /* isolate */ } }
    map.clear();
    subs.delete(surfaceId);
  }

  return { dispatch, releaseSurface };
}
