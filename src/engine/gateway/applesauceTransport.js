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

/** Default cap on waiting for slow relays once the first relay has answered. */
export const STRAGGLE_MS = 1500;

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
    let sub = null, done = false, graceTimer = null, straggleTimer = null;
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
          if (msg && msg.type === 'EOSE' && !straggleTimer && straggleMs > 0) straggleTimer = setTimeout(finish, straggleMs);
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
