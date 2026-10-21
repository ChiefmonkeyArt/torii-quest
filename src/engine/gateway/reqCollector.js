// ADR-0140: pure accounting for a multi-relay REQ, shared by the Applesauce
// transport. Feeds applesauce-relay GroupReqMessage objects
// ({type:'OPEN'|'EVENT'|'EOSE'|'CLOSED'|'ERROR', from, event?}) and produces the
// fanoutReq-shaped result {events, used, failed} (deduped by id, relay order
// preserved). No I/O, never throws.

/** Same key for 'wss://nos.lol' and 'wss://nos.lol/'. */
export function relayKey(url) {
  if (typeof url !== 'string' || !url) return '';
  try { const u = new URL(url); return (u.protocol + '//' + u.host + u.pathname).replace(/\/+$/, '').toLowerCase(); } catch { return url.trim().replace(/\/+$/, '').toLowerCase(); }
}

const MAX_EVENTS = 2000;

export function createReqCollector(relays) {
  const list = (Array.isArray(relays) ? relays : []).filter((r) => typeof r === 'string' && r);
  const byKey = new Map(list.map((r) => [relayKey(r), { url: r, state: 'pending', count: 0 }]));
  const seen = new Set();
  const events = [];
  let firstEoseAt = 0;
  return {
    /** Feed one message. Returns true when every relay has settled. */
    onMessage(msg, now = Date.now()) {
      if (!msg || typeof msg !== 'object') return this.settled();
      const r = byKey.get(relayKey(msg.from));
      if (!r) return this.settled();
      if (msg.type === 'EVENT') {
        const e = msg.event;
        if (r.state === 'pending' || r.state === 'eose') r.count++;
        if (e && typeof e.id === 'string' && !seen.has(e.id) && events.length < MAX_EVENTS) { seen.add(e.id); events.push(e); }
      } else if (msg.type === 'EOSE') {
        if (r.state === 'pending') r.state = 'eose';
        if (!firstEoseAt) firstEoseAt = now;
      } else if (msg.type === 'CLOSED' || msg.type === 'ERROR') {
        if (r.state === 'pending') r.state = r.count ? 'eose' : 'failed';
      }
      return this.settled();
    },
    settled() { for (const r of byKey.values()) if (r.state === 'pending') return false; return true; },
    firstEoseAt() { return firstEoseAt; },
    /** Relays still pending, as given (for a retry round). */
    pending() { return [...byKey.values()].filter((r) => r.state === 'pending').map((r) => r.url); },
    failedUrls() { return [...byKey.values()].filter((r) => r.state === 'failed').map((r) => r.url); },
    /** Mark a relay as retryable again (used before a retry round). */
    reopen(url) { const r = byKey.get(relayKey(url)); if (r && r.state === 'failed') r.state = 'pending'; },
    /** Pending relays at the deadline count as failed, like fanoutReq timeouts. */
    result() {
      const used = [], failed = [];
      for (const r of byKey.values()) {
        if (r.count > 0) used.push(r.url);
        else if (r.state !== 'eose') failed.push(r.url);
      }
      return { events: events.slice(), used, failed };
    },
  };
}
