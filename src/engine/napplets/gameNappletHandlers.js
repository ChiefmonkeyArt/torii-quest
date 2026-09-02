// engine/napplets/gameNappletHandlers.js — nap-torii-game v0 message handlers for
// the Torii Quest shell (ADR-0082). MOSTLY PURE + node-safe: no DOM, no Three, no
// direct network, no signing, no wallet, no travel navigation, no payment execution.
//
// The handlers are the shell-side dispatcher for `game.*` messages from a mounted
// game napplet. They return outbound envelopes for the surface to post back. Any
// side-effect that crosses the trust boundary (relay publish, subscribe, actual
// navigation) is delegated to injected callbacks — the handlers never touch the
// network themselves, so they stay unit-testable with plain stubs.
//
// v0 surface subset:
//   game.host.info          — "what shell am I running under?" (fires-and-returns)
//   game.player.get         — "who is the local player right now?" (pubkey + display)
//   game.event.publish      — "publish this event on my behalf" (consent-gated)
//   game.event.subscribe    — "subscribe me to these kinds/authors" (relay-mediated)
//   game.event.unsubscribe  — matched by subscriptionId
//   game.exit               — "close me and give control back to the shell"
// Deferred (return `unsupported` so a napplet degrades cleanly):
//   game.player.subscribe / game.player.unsubscribe (presence stream)
//   game.visit                                       (open-travel to another world)

import {
  splitType, resultEnvelope, errorEnvelope, GAME_NAMESPACE,
} from './nappletEnvelope.js';

// createGameHandlers({
//   worldNpub, worldLabel, hostVersion,
//   getPlayer, publishEvent, subscribeEvents, unsubscribeEvents, exitGame,
// }) → { dispatch(fullType, data, surfaceId, id) } returns outbound envelope | null.
//
// Injected callbacks (all optional — missing ones return `unsupported`):
//   getPlayer(surfaceId) → { pubkey, npub, display } | null
//   publishEvent(surfaceId, event) → Promise<{ id, ok, relays }> | { id, ok }
//   subscribeEvents(surfaceId, filter, onEvent) → { subscriptionId, close }
//   unsubscribeEvents(surfaceId, subscriptionId) → boolean
//   exitGame(surfaceId, reason) → boolean
export function createGameHandlers({
  worldNpub,
  worldLabel,
  hostVersion = '0.1.0',
  getPlayer,
  publishEvent,
  subscribeEvents,
  unsubscribeEvents,
  exitGame,
} = {}) {
  // Per-surface subscription table so a napplet unsubscribing on exit does not leak
  // sockets from a previous mount. Keyed surfaceId → Map<subscriptionId, closeFn>.
  const subs = new Map();

  function ensureSurfaceMap(surfaceId) {
    let m = subs.get(surfaceId);
    if (!m) { m = new Map(); subs.set(surfaceId, m); }
    return m;
  }

  function dispatch(fullType, data, surfaceId, id) {
    const parts = splitType(fullType);
    if (!parts || parts.ns !== GAME_NAMESPACE) return null; // not our namespace
    const type = fullType;
    const action = parts.action;

    if (action === 'host.info') {
      return resultEnvelope(type, id, {
        worldNpub, worldLabel, hostVersion,
        surfaceId,
        capabilities: [
          'game.host.info',
          'game.player.get',
          'game.event.publish',
          'game.event.subscribe',
          'game.event.unsubscribe',
          'game.exit',
        ],
      });
    }

    if (action === 'player.get') {
      if (typeof getPlayer !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no getPlayer callback bound');
      const p = getPlayer(surfaceId);
      if (!p) return errorEnvelope(type, id, 'no-player', 'no local player identity');
      return resultEnvelope(type, id, {
        pubkey: typeof p.pubkey === 'string' ? p.pubkey : null,
        npub: typeof p.npub === 'string' ? p.npub : null,
        display: typeof p.display === 'string' ? p.display : null,
      });
    }

    if (action === 'player.subscribe' || action === 'player.unsubscribe')
      return errorEnvelope(type, id, 'unsupported', 'player presence stream is deferred (ADR-0082)');

    if (action === 'event.publish') {
      if (typeof publishEvent !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no publishEvent callback bound');
      const ev = data && data.event;
      if (!ev || typeof ev !== 'object')
        return errorEnvelope(type, id, 'bad-request', 'data.event is required');
      // The shell owns signing + relay routing + consent; the napplet only proposes.
      const outcome = publishEvent(surfaceId, ev);
      // Callback may be sync or async — the surface caller awaits.
      return { __async: true, promise: Promise.resolve(outcome).then(
        (r) => resultEnvelope(type, id, {
          id: (r && r.id) || null,
          ok: !!(r && r.ok),
          relays: (r && Array.isArray(r.relays)) ? r.relays.slice() : [],
        }),
        (err) => errorEnvelope(type, id, 'publish-failed', String(err && err.message || err)),
      )};
    }

    if (action === 'event.subscribe') {
      if (typeof subscribeEvents !== 'function')
        return errorEnvelope(type, id, 'unsupported', 'no subscribeEvents callback bound');
      const filter = data && data.filter;
      if (!filter || typeof filter !== 'object')
        return errorEnvelope(type, id, 'bad-request', 'data.filter is required');
      const map = ensureSurfaceMap(surfaceId);
      try {
        // The shell pushes each event back as an `event` push (surface adds channelId).
        const sub = subscribeEvents(surfaceId, filter, /* onEvent */ () => { /* pushed by surface */ });
        if (!sub || typeof sub.subscriptionId !== 'string' || typeof sub.close !== 'function')
          return errorEnvelope(type, id, 'bad-callback', 'subscribeEvents must return {subscriptionId, close}');
        map.set(sub.subscriptionId, sub.close);
        return resultEnvelope(type, id, { subscriptionId: sub.subscriptionId });
      } catch (err) {
        return errorEnvelope(type, id, 'subscribe-failed', String(err && err.message || err));
      }
    }

    if (action === 'event.unsubscribe') {
      const subscriptionId = data && data.subscriptionId;
      if (typeof subscriptionId !== 'string' || !subscriptionId)
        return errorEnvelope(type, id, 'bad-request', 'data.subscriptionId is required');
      const map = subs.get(surfaceId);
      const close = map && map.get(subscriptionId);
      if (!close)
        return errorEnvelope(type, id, 'unknown-subscription', 'no such subscription for this surface');
      try { close(); } catch (_) { /* isolate */ }
      map.delete(subscriptionId);
      if (typeof unsubscribeEvents === 'function') {
        try { unsubscribeEvents(surfaceId, subscriptionId); } catch (_) { /* isolate */ }
      }
      return resultEnvelope(type, id, { ok: true });
    }

    if (action === 'visit')
      return errorEnvelope(type, id, 'unsupported', 'game.visit is deferred (ADR-0082)');

    if (action === 'exit') {
      const reason = (data && typeof data.reason === 'string') ? data.reason : 'napplet-exit';
      let ok = true;
      if (typeof exitGame === 'function') {
        try { ok = !!exitGame(surfaceId, reason); } catch (_) { ok = false; }
      }
      // Best-effort teardown of any live subscriptions for this surface.
      const map = subs.get(surfaceId);
      if (map) {
        for (const close of map.values()) { try { close(); } catch (_) { /* isolate */ } }
        map.clear();
      }
      return resultEnvelope(type, id, { ok });
    }

    // Unknown game.* action — silently ignored per NIP-5D §capability.
    return null;
  }

  // Shell-side hook so a NappletGameHost can drop a surface's subscription table
  // when the iframe is destroyed.
  function releaseSurface(surfaceId) {
    const map = subs.get(surfaceId);
    if (!map) return;
    for (const close of map.values()) { try { close(); } catch (_) { /* isolate */ } }
    map.clear();
    subs.delete(surfaceId);
  }

  return { dispatch, releaseSurface };
}
