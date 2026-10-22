// ADR-0145 slice 1: whose shop the NAP boards show, and which events count.
// Pure helpers; no I/O.
import { verifyNostrEventSig } from '../crypto/nostrSig.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * The world's owner, as the browser knows it: `window.__toriiHostPubkey`, then
 * `<meta name="torii-host-pubkey">` (what the node injects), then the build-time
 * ADMIN_PUBKEY_HEX (server env only, '' in browsers). → hex64 or ''.
 */
export function resolveBoardOwner({ win = globalThis.window, doc = globalThis.document, adminHex = '' } = {}) {
  try {
    const w = win && typeof win.__toriiHostPubkey === 'string' ? win.__toriiHostPubkey.trim().toLowerCase() : '';
    if (HEX64.test(w)) return w;
  } catch { /* no window */ }
  try {
    const meta = doc && typeof doc.querySelector === 'function' ? doc.querySelector('meta[name="torii-host-pubkey"]') : null;
    const v = meta && typeof meta.getAttribute === 'function' ? String(meta.getAttribute('content') || '').trim().toLowerCase() : '';
    if (HEX64.test(v)) return v;
  } catch { /* no document */ }
  const a = typeof adminHex === 'string' ? adminHex.trim().toLowerCase() : '';
  return HEX64.test(a) ? a : '';
}

const coord = (e) => {
  let d = null;
  for (const t of e.tags || []) if (Array.isArray(t) && t[0] === 'd') { d = String(t[1] == null ? '' : t[1]); break; }
  return d == null ? 'id:' + e.id : e.kind + ':' + e.pubkey + ':' + d;
};

/**
 * Merge per-relay event lists: only events BY `owner` with a valid signature,
 * newest per replaceable coordinate (kind:pubkey:d). Relays can't inject or
 * forge listings into someone's stall.
 */
export function mergeOwnerEvents(lists, owner) {
  const best = new Map();
  if (!HEX64.test(owner || '')) return [];
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || e.pubkey !== owner || !verifyNostrEventSig(e)) continue;
      const k = coord(e);
      const prev = best.get(k);
      if (!prev || (e.created_at || 0) > (prev.created_at || 0)) best.set(k, e);
    }
  }
  return [...best.values()];
}
