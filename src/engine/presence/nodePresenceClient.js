import { readGateways } from '../gateway/gatewayRead.js';
import { verifyNostrEventSig } from '../crypto/nostrSig.js';

// Same-origin, one-event RAM cache. Kick refresh without awaiting it on UI paths.
export function createNodePresenceCache({
  fetchImpl = (...args) => fetch(...args), now = Date.now,
  origin = globalThis.location?.origin,
} = {}) {
  let events = [], inFlight = false;
  async function refresh(httpBase) {
    if (inFlight || !httpBase) return;
    try { if (!origin || new URL(httpBase, origin).origin !== origin) return; } catch { return; }
    inFlight = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetchImpl(`${httpBase}/node-presence`, {
        signal: controller.signal, cache: 'no-store', credentials: 'same-origin',
      });
      if (!response.ok) return;
      // Our server guarantees a <9 KiB body. Bound the streamed response too.
      const reader = response.body.getReader();
      let text = '', bytes = 0;
      const decoder = new TextDecoder();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > 10000) { await reader.cancel(); return; }
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { reader.releaseLock(); }
      const body = JSON.parse(text);
      if (!Array.isArray(body.events) || body.events.length > 1) return;
      events = body.events.filter(event => verifyNostrEventSig(event));
    } catch { /* absence/failure is invisible to players */ }
    finally { clearTimeout(timeout); inFlight = false; }
  }
  function worlds(ourPubkey = '') {
    const sec = Math.floor(now() / 1000);
    const live = events.filter(e => {
      const expiry = Number(e.tags?.find(t => t[0] === 'expiration')?.[1]);
      return e.created_at <= sec + 60 && e.created_at >= sec - 1200
        && expiry > sec && expiry <= e.created_at + 1200;
    });
    return readGateways(live, { nowSec: sec }).gateways.filter(w => w.pubkey !== ourPubkey && w.owner !== ourPubkey);
  }
  return { refresh, worlds };
}

export function mergeNodeWorlds(existing, verified) {
  // Match by signed event author + zone, not an arbitrary self-asserted owner.
  const key = w => `${w.pubkey}:${w.zoneId}`;
  const out = new Map(existing.map(w => [key(w), w]));
  for (const w of verified) out.set(key(w), w);
  return [...out.values()];
}
