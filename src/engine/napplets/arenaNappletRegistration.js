// engine/napplets/arenaNappletRegistration.js — registers the Torii Quest arena as
// a nap-torii-game v0 napplet (ADR-0084). WIRING-ONLY: the arena keeps its existing
// direct-Three/Rapier runtime for now — this module gives it a game.* identity and
// dispatcher so anything that treats a game as a napplet (leaderboards, player
// discovery, cross-game plumbing, third-party embedders) sees the arena through
// exactly the same contract as a sandboxed third-party would.
//
// The dispatcher is `createGameHandlers` (ADR-0082), unchanged. What this module
// adds is:
//  - a stable arena identity: dTag "torii-arena", aggregateHash from the release.
//  - a `player.get` binding to the live pubkey/character.
//  - a shell-owned `publishEvent` binding: game napplets never sign or hit relays;
//    they hand the shell an unsigned event, the shell signs via NIP-07 and fans out
//    via the existing multi-relay publish path.
//  - a `subscribeEvents` binding that funnels a relay filter through the same
//    fanout REQ machinery the shell already uses, isolated per surface so exit
//    tears it down.
//  - a `exit` binding that unmounts arena presence cleanly.
//
// PURE + node-safe: no DOM, no Three, no Nostr — every side-effect crosses the
// boundary through an injected callback and is unit-testable with plain stubs.

import { createGameHandlers } from './gameNappletHandlers.js';
import { normalizeIdentity } from './nappletIdentity.js';

export const ARENA_NAPPLET_IDENTITY = Object.freeze({
  dTag: 'torii-arena',
  // Aggregate hash captured at napplet-registration time. Bumped by the release
  // pipeline when the arena bundle changes (see ADR-0086, deferred). For now it's
  // the semver line so an incorrect stamp shows up in the contrib tag immediately.
  aggregateHash: 'torii-arena@v0-wiring',
});

// createArenaGameNappletRegistration({
//   worldNpub, worldLabel, hostVersion,
//   getLocalPlayer,            // () → { pubkey, npub, display } | null
//   signAndPublishEvent,       // (unsignedEvent) → Promise<{ id, ok, relays }>
//   openRelaySubscription,     // (filter, onEvent) → { subscriptionId, close }
//   onArenaExit,               // (reason) → boolean
// }) → { identity, surfaceId, handlers, dispatch }
//
// Returns the wired handlers and a shell-facing dispatch(type, data, id) that any
// caller (leaderboard adapter, third-party embed) can invoke as if the arena were
// a mounted iframe napplet. The surfaceId is fixed for the local arena mount so
// subscription state is isolated per arena session.
export function createArenaGameNappletRegistration({
  worldNpub,
  worldLabel,
  hostVersion = '0.1.0',
  surfaceId = 'arena-local',
  getLocalPlayer,
  signAndPublishEvent,
  openRelaySubscription,
  onArenaExit,
} = {}) {
  if (typeof worldNpub !== 'string' || !worldNpub)
    throw new Error('arenaNappletRegistration: worldNpub is required');

  const identity = normalizeIdentity(ARENA_NAPPLET_IDENTITY);

  const handlers = createGameHandlers({
    worldNpub,
    worldLabel: worldLabel || 'Torii Arena',
    hostVersion,
    getPlayer: typeof getLocalPlayer === 'function'
      ? (_surf) => getLocalPlayer()
      : undefined,
    publishEvent: typeof signAndPublishEvent === 'function'
      ? (_surf, ev) => Promise.resolve(signAndPublishEvent(ev))
      : undefined,
    subscribeEvents: typeof openRelaySubscription === 'function'
      ? (_surf, filter, onEvent) => {
        const sub = openRelaySubscription(filter, onEvent);
        if (!sub || typeof sub.subscriptionId !== 'string' || typeof sub.close !== 'function')
          throw new Error('openRelaySubscription must return {subscriptionId, close}');
        return sub;
      }
      : undefined,
    exitGame: typeof onArenaExit === 'function'
      ? (_surf, reason) => !!onArenaExit(reason)
      : undefined,
  });

  function dispatch(type, data, id) {
    return handlers.dispatch(type, data, surfaceId, id);
  }

  return { identity, surfaceId, handlers, dispatch };
}
