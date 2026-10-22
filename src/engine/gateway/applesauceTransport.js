// ADR-0140: the Applesauce relay layer (applesauce-relay RelayPool) behind the
// same fanoutReq contract: request(relays, filters, {timeoutMs, graceMs,
// retries}) → Promise<{events, used, failed}>.
//
// Why: one persistent pool (sockets kept alive between directory refreshes,
// reconnect/backoff handled by the library) instead of a fresh WebSocket per
// relay per scan. Loaded ONLY by dynamic import from the gateway read path, so
// it never lands in the entry or arena chunks. Any failure falls back to the
// supplied fallback transport (fanoutReq), so the directory can't get worse.
import { createReqCollector } from './reqCollector.js';
// Re-exported so the live controller ships in this lazy chunk, not the entry.
export { createLiveWorlds } from './liveWorlds.js';

let _poolPromise = null;

/** Lazily build one shared RelayPool. Injectable for tests. */
export function getPool(load = () => import('applesauce-relay')) {
  if (!_poolPromise) {
    _poolPromise = Promise.resolve().then(load).then((m) => new m.RelayPool({ keepAlive: 60000, requestReconnect: 0 }))
      .catch((e) => { _poolPromise = null; throw e; });
  }
  return _poolPromise;
}
export function _resetPoolForTests() { _poolPromise = null; }

/** Default cap on waiting for slow relays once a relay has answered WITH events
 * (v0.2.911: 3 s, the library's own grace; an empty early EOSE never starts it). */
export const STRAGGLE_MS = 3000;

/**
 * Split relays into ones worth asking and ones the pool already knows are in a
 * reconnect backoff (`ready === false`). Applesauce makes a REQ to a not-ready
 * relay hang until it reconnects, so asking it would stall the whole scan
 * (measured: 3–10 s per warm scan with one dead relay).
 */
export function partitionReady(pool, relays) {
  const ask = [], skip = [];
  const map = pool && pool.relays instanceof Map ? pool.relays : null;
  for (const url of relays) {
    let rel = null;
    if (map) { rel = map.get(url) || null; if (!rel) for (const [k, v] of map) { if (relayKeyEq(k, url)) { rel = v; break; } } }
    if (rel && rel.ready === false) skip.push(url); else ask.push(url);
  }
  return { ask, skip };
}
const relayKeyEq = (a, b) => String(a).replace(/\/+$/, '').toLowerCase() === String(b).replace(/\/+$/, '').toLowerCase();

/**
 * One REQ round over `pool.req`. Resolves when every relay has settled, at the
 * deadline, or `straggleMs` after the first EOSE (slow relays then count as
 * failed, like applesauce's own completeAfterIdle grace). When every relay has
 * settled on an EOSE, waits graceMs for late events (fanoutReq semantics).
 */
export function reqRound(pool, relays, filters, collector, { timeoutMs = 4000, graceMs = 0, straggleMs = STRAGGLE_MS } = {}) {
  return new Promise((resolve) => {
    let sub = null, done = false, graceTimer = null, straggleTimer = null, sawEvents = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(deadline); clearTimeout(graceTimer); clearTimeout(straggleTimer);
      try { if (sub) sub.unsubscribe(); } catch { /* already closed */ }
      resolve();
    };
    const deadline = setTimeout(finish, Math.max(1, timeoutMs));
    try {
      sub = pool.req(relays, filters).subscribe({
        next: (msg) => {
          if (msg && msg.type === 'EVENT') sawEvents = true;
          if (msg && msg.type === 'EOSE' && sawEvents && !straggleTimer && straggleMs > 0) straggleTimer = setTimeout(finish, straggleMs);
          if (collector.onMessage(msg)) {
            if (graceMs > 0 && msg && msg.type === 'EOSE' && !graceTimer) graceTimer = setTimeout(finish, graceMs);
            else if (!graceTimer) finish();
          }
        },
        error: () => { for (const r of relays) collector.onMessage({ type: 'ERROR', from: r }); finish(); },
        complete: finish,
      });
    } catch { for (const r of relays) collector.onMessage({ type: 'ERROR', from: r }); finish(); }
    if (done && sub) { try { sub.unsubscribe(); } catch { /* closed */ } }
  });
}

/**
 * Build a fanoutReq-shaped request backed by Applesauce, with a fallback.
 * `opts.getPool` is injectable for tests.
 */
export function createApplesauceRequest({ fallback = null, getPool: gp = getPool } = {}) {
  return async function applesauceRequest(relays, filters, opts = {}) {
    const list = (Array.isArray(relays) ? relays : (relays ? [relays] : [])).filter((r) => typeof r === 'string' && r);
    const fl = Array.isArray(filters) ? filters : [filters];
    const timeoutMs = Number.isFinite(opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : 4000;
    const graceMs = Number.isFinite(opts.graceMs) && opts.graceMs > 0 ? opts.graceMs : 0;
    const retries = Number.isFinite(opts.retries) && opts.retries > 0 ? Math.min(3, Math.floor(opts.retries)) : 0;
    if (!list.length) return { events: [], used: [], failed: [] };
    let pool;
    try { pool = await gp(); } catch {
      return fallback ? fallback(relays, filters, opts) : { events: [], used: [], failed: list.slice() };
    }
    const c = createReqCollector(list);
    const first = partitionReady(pool, list);
    for (const u of first.skip) c.onMessage({ type: 'ERROR', from: u });
    if (first.ask.length) await reqRound(pool, first.ask, fl, c, { timeoutMs, graceMs });
    for (let i = 0; i < retries; i++) {
      // Retry only relays that failed fast and are not in backoff.
      const { ask } = partitionReady(pool, [...c.failedUrls(), ...c.pending()]);
      if (!ask.length) break;
      for (const u of ask) c.reopen(u);
      await reqRound(pool, ask, fl, c, { timeoutMs, graceMs });
    }
    return c.result();
  };
}

/**
 * ADR-0140 stage 2: live subscribe on the shared pool.
 * subscribe(relays, filters, onEvent) → unsubscribe (synchronous). The pool
 * dedupes across relays and resubscribes after reconnects; events are handed
 * on raw, and the caller verifies them.
 */
/** Long-lived: keep retrying a dropped relay (5 s apart), reset after success. */
export const LIVE_SUB_OPTIONS = Object.freeze({ reconnect: Object.freeze({ count: 20, delay: 5000, resetOnSuccess: true }) });

export function createLiveSubscribe({ getPool: gp = getPool } = {}) {
  return function subscribeLive(relays, filters, onEvent) {
    let cancelled = false, sub = null;
    const list = (Array.isArray(relays) ? relays : []).filter((r) => typeof r === 'string' && r);
    const fl = Array.isArray(filters) ? filters : [filters];
    if (!list.length || typeof onEvent !== 'function') return () => {};
    Promise.resolve().then(() => gp()).then((pool) => {
      if (cancelled) return;
      sub = pool.subscription(list, fl, { reconnect: { ...LIVE_SUB_OPTIONS.reconnect } }).subscribe({
        next: (e) => { if (e && typeof e === 'object' && typeof e.id === 'string') { try { onEvent(e); } catch { /* sink errors stay local */ } } },
        error: () => { sub = null; },
      });
      if (cancelled && sub) { try { sub.unsubscribe(); } catch { /* closed */ } }
    }).catch(() => { /* library unavailable: the 10 s scan still runs */ });
    return () => { cancelled = true; try { if (sub) sub.unsubscribe(); } catch { /* closed */ } sub = null; };
  };
}

/** Per-relay publish cap on the shared pool (matches publishEvent's default). */
export const SHARED_PUBLISH_TIMEOUT_MS = 5000;

/**
 * ADR-0140 stage 3 (v0.2.918): the shared relay layer registered with
 * engine/relay/sharedRelay.js. Every Nostr read, publish and Plebeian
 * subscription reuses this pool's single socket per relay. Same result
 * contracts as fanoutReq / publishEvent, and the same trust: callers still
 * verify every event. Falls back to the direct paths if the pool is unusable.
 */
export function createSharedRelay({ fallbackRequest = null, fallbackPublish = null, getPool: gp = getPool } = {}) {
  const request = createApplesauceRequest({ fallback: fallbackRequest, getPool: gp });
  const subscribe = createLiveSubscribe({ getPool: gp });
  async function publish(url, event, opts = {}) {
    const timeoutMs = Number.isFinite(opts && opts.timeoutMs) && opts.timeoutMs > 0 ? opts.timeoutMs : SHARED_PUBLISH_TIMEOUT_MS;
    let pool;
    try { pool = await gp(); } catch {
      return fallbackPublish ? fallbackPublish(url, event, opts) : { ok: false, relay: url, accepted: false, error: 'no-pool' };
    }
    if (partitionReady(pool, [url]).skip.length) return { ok: false, relay: url, accepted: false, error: 'cooling-down' };
    let timer = null;
    try {
      const r = await Promise.race([
        pool.relay(url).publish(event, { retries: 0, reconnect: false, timeout: timeoutMs }),
        new Promise((res) => { timer = setTimeout(() => res(null), timeoutMs + 250); }),
      ]);
      if (!r) return { ok: false, relay: url, accepted: false, error: 'timeout' };
      if (r.ok) return { ok: true, relay: url, accepted: true, error: null };
      const reason = String(r.message == null ? '' : r.message).slice(0, 160);
      return reason ? { ok: true, relay: url, accepted: false, error: 'rejected', reason } : { ok: true, relay: url, accepted: false, error: 'rejected' };
    } catch (e) {
      const reason = String((e && e.message) || '').slice(0, 160);
      return reason ? { ok: false, relay: url, accepted: false, error: 'error', reason } : { ok: false, relay: url, accepted: false, error: 'error' };
    } finally { if (timer) clearTimeout(timer); }
  }
  return { kind: 'applesauce', request, publish, subscribe };
}
