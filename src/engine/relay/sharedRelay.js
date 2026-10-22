// ADR-0140 stage 3 (v0.2.918): one shared relay layer for every Nostr read,
// publish and Plebeian subscription. A tiny entry-side registry: until the lazy
// Applesauce chunk has loaded (on idle, ADR-0142) and its pool has started,
// sharedRelay() is null and every caller keeps its direct-WebSocket path. Once
// registered, callers reuse the pool's one socket per relay.
//   shared = { request(relays, filters, opts) → {events, used, failed},
//              publish(url, event, opts) → {ok, relay, accepted, error, reason?},
//              subscribe(relays, filters, onEvent) → unsubscribe }
let _shared = null;

export function setSharedRelay(s) {
  _shared = s && typeof s === 'object' && typeof s.request === 'function' ? s : null;
}

export function sharedRelay() { return _shared; }
