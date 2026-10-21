// ADR-0140: choose the relay transport for the gateway directory read path
// (world records + their owners' profiles). Pure: inputs are injected.
//   - default: GATEWAY_TRANSPORT from config
//   - override (operator testing): ?gateway-transport=fanout|applesauce, or
//     localStorage 'torii.gatewayTransport'. The URL param wins and is not stored.
export const GATEWAY_TRANSPORTS = Object.freeze(['fanout', 'applesauce']);
export const GATEWAY_TRANSPORT_KEY = 'torii.gatewayTransport';
export const GATEWAY_TRANSPORT_PARAM = 'gateway-transport';

export function resolveGatewayTransport({ fallback = 'fanout', search = '', storage = null } = {}) {
  const pick = (v) => (typeof v === 'string' && GATEWAY_TRANSPORTS.includes(v.trim().toLowerCase()) ? v.trim().toLowerCase() : '');
  let fromUrl = '';
  try { fromUrl = pick(new URLSearchParams(typeof search === 'string' ? search : '').get(GATEWAY_TRANSPORT_PARAM)); } catch { /* ignore */ }
  if (fromUrl) return fromUrl;
  let stored = '';
  try { stored = pick(storage && typeof storage.getItem === 'function' ? storage.getItem(GATEWAY_TRANSPORT_KEY) : ''); } catch { /* storage blocked */ }
  return stored || pick(fallback) || 'fanout';
}

/**
 * Gateway request getter. `get()` is synchronous and returns the best transport
 * loaded so far: fanout until Applesauce has loaded, Applesauce after. The
 * first get() schedules the Applesauce load through `schedule` (an idle
 * callback in the browser), so the ~50 KB gzip lazy chunk never competes with
 * the cold load (ADR-0142). Any load failure pins fanout for the session.
 * `ready()` resolves with the final transport (tests, debugging).
 */
// ADR-0140 stage 2 cadences (kept here so the entry chunk needs no lazy import).
/** While live, the full rescan only prunes expiry + refreshes friends: 60 s, not 10 s. */
export const LIVE_PRESENCE_POLL_MS = 60000;
/** How often the shell re-evaluates whether the live subscription is wanted. */
export const LIVE_CHECK_MS = 1000;
/** Stand-in until the lazy chunk (with the real controller) has loaded. */
const NO_LIVE = Object.freeze({ active: false, received: 0, events: () => [], setWanted() {}, stop() {} });

export function createGatewayRequestGetter({ mode = 'fanout', fanout, loadApplesauce, schedule = (fn) => fn(), onLiveEvents = null }) {
  let current = fanout;
  let live = null;
  let liveWorlds = NO_LIVE;
  let loading = null;
  const start = () => {
    if (loading) return loading;
    if (mode !== 'applesauce' || typeof loadApplesauce !== 'function') { loading = Promise.resolve(current); return loading; }
    loading = new Promise((resolve) => {
      const run = () => {
        Promise.resolve().then(loadApplesauce)
          .then((m) => {
            current = m.createApplesauceRequest({ fallback: fanout });
            live = typeof m.createLiveSubscribe === 'function' ? m.createLiveSubscribe() : null;
            if (live && typeof m.createLiveWorlds === 'function' && typeof onLiveEvents === 'function') {
              liveWorlds = m.createLiveWorlds({ getSubscribe: () => live, onEvents: onLiveEvents });
            }
          })
          .catch(() => { current = fanout; live = null; liveWorlds = NO_LIVE; })
          .then(() => resolve(current));
      };
      try { schedule(run); } catch { run(); }
    });
    return loading;
  };
  return {
    get() { start(); return current; },
    /** ADR-0140 stage 2: the live subscribe function, or null until loaded / on fanout. */
    live() { return live; },
    /** The live-directory controller (lazy), or an inert stand-in. */
    liveWorlds() { return liveWorlds; },
    ready() { return start(); },
    get active() { return current === fanout ? 'fanout' : 'applesauce'; },
  };
}
