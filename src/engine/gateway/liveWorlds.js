// ADR-0140 stage 2: a held directory subscription. While the world list is
// visible, one live subscription streams heartbeats (the current set as a
// backfill, then new ones as they are published). The controller only buffers
// and batches raw events; the caller re-reads them through worldsFromEvents
// (signature check, liveness, sanitising), so pushed events get exactly the
// same trust as scanned ones. No timers; never throws.

export const LIVE_MAX_EVENTS = 400;

const isEvent = (e) => !!e && typeof e === 'object' && typeof e.id === 'string' && e.id.length === 64
  && typeof e.pubkey === 'string' && Number.isInteger(e.created_at);

/**
 * @param {object} o
 * @param {() => (null | ((relays, filters, onEvent) => () => void))} o.getSubscribe
 *        the live subscribe function, or null while it is unavailable (fanout).
 * @param {(events: object[]) => (void | Promise<void>)} o.onEvents  batched sink.
 */
export function createLiveWorlds({ getSubscribe, onEvents }) {
  const byKey = new Map(); // pubkey:d → newest event (replaceable, so newest wins)
  let stop = null, relaysKey = '', flushing = false, dirty = false, received = 0;

  const keyOf = (e) => {
    let d = '';
    for (const t of e.tags || []) if (Array.isArray(t) && t[0] === 'd') { d = String(t[1] || ''); break; }
    return e.pubkey + ':' + d;
  };

  async function flush() {
    if (flushing) { dirty = true; return; }
    flushing = true;
    try {
      do {
        dirty = false;
        try { await onEvents([...byKey.values()]); } catch { /* sink is best-effort */ }
      } while (dirty);
    } finally { flushing = false; }
  }

  function onEvent(e) {
    if (!isEvent(e)) return;
    received++;
    const k = keyOf(e);
    const prev = byKey.get(k);
    if (prev && prev.created_at >= e.created_at) return;
    byKey.delete(k);
    byKey.set(k, e);
    while (byKey.size > LIVE_MAX_EVENTS) byKey.delete(byKey.keys().next().value);
    flush();
  }

  function halt() {
    if (stop) { try { stop(); } catch { /* already closed */ } }
    stop = null; relaysKey = '';
  }

  return {
    /** Idempotent; cheap enough to call every frame. */
    setWanted(want, relays, filters) {
      const list = Array.isArray(relays) ? relays.filter((r) => typeof r === 'string' && r) : [];
      const k = list.join(',');
      if (!want || !list.length) { if (stop) halt(); return; }
      if (stop && k === relaysKey) return;
      const sub = typeof getSubscribe === 'function' ? getSubscribe() : null;
      if (typeof sub !== 'function') { if (stop) halt(); return; }
      halt();
      try { stop = sub(list, filters, onEvent) || null; relaysKey = stop ? k : ''; } catch { stop = null; relaysKey = ''; }
    },
    get active() { return !!stop; },
    get received() { return received; },
    events() { return [...byKey.values()]; },
    stop: halt,
  };
}
