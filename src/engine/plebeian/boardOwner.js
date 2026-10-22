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

// ── ADR-0145 store source (v0.2.916, owner decision 2026-10-22) ──────────────
// The NAP store shows the instance owner's shop by default. The owner can
// instead point it at ANOTHER seller's npub, or build a CUSTOM store from
// individual products and auctions. Both are one owner-signed NIP-51 set:
//   kind 30003, d "torii-nap-store"
//   ["p", <seller hex>]            → show that seller's shop
//   ["a", "30402|30408:<pk>:<d>"]  → custom store: exactly these items
// No tags (or no event) → the owner's own shop. `a` wins over `p`.
export const STORE_KIND = 30003;
export const STORE_D = 'torii-nap-store';
export const STORE_MAX_ITEMS = 24;
const ITEM_RE = /^(30402|30408):([0-9a-f]{64}):(.{1,256})$/;

/** Owner-default config. */
export function ownerStore(owner) { return { mode: 'owner', seller: owner, items: [] }; }

/** Pure: one candidate event → config, or null if it isn't a valid owner store. */
export function parseStoreConfig(e, owner) {
  if (!e || e.kind !== STORE_KIND || e.pubkey !== owner || !HEX64.test(owner || '')) return null;
  const tags = Array.isArray(e.tags) ? e.tags : [];
  if (!tags.some((t) => Array.isArray(t) && t[0] === 'd' && t[1] === STORE_D)) return null;
  if (!verifyNostrEventSig(e)) return null;
  const items = [];
  let seller = '';
  for (const t of tags) {
    if (!Array.isArray(t)) continue;
    if (t[0] === 'a' && typeof t[1] === 'string' && ITEM_RE.test(t[1]) && !items.includes(t[1]) && items.length < STORE_MAX_ITEMS) items.push(t[1]);
    else if (t[0] === 'p' && !seller && typeof t[1] === 'string' && HEX64.test(t[1])) seller = t[1];
  }
  if (items.length) return { mode: 'custom', seller: '', items };
  if (seller && seller !== owner) return { mode: 'seller', seller, items: [] };
  return ownerStore(owner);
}

/** Pure: newest valid owner store event wins; none → owner default. */
export function resolveStoreConfig(events, owner) {
  let best = null, bestAt = -1;
  for (const e of Array.isArray(events) ? events : []) {
    const c = parseStoreConfig(e, owner);
    if (c && (e.created_at || 0) > bestAt) { best = c; bestAt = e.created_at || 0; }
  }
  return best || ownerStore(owner);
}

export const storeKey = (c) => (c ? c.mode + '|' + c.seller + '|' + c.items.join(',') : '');

/** Pure: REQ filters for one listing kind under a config. → filter[] */
export function storeFilters(config, kind) {
  if (!config) return [];
  if (config.mode !== 'custom') return HEX64.test(config.seller || '') ? [{ authors: [config.seller], kinds: [kind], limit: 500 }] : [];
  const byAuthor = new Map();
  for (const c of config.items) {
    const m = ITEM_RE.exec(c);
    if (!m || Number(m[1]) !== kind) continue;
    if (!byAuthor.has(m[2])) byAuthor.set(m[2], []);
    byAuthor.get(m[2]).push(m[3]);
  }
  return [...byAuthor].map(([pk, ds]) => ({ authors: [pk], kinds: [kind], '#d': ds, limit: ds.length * 4 }));
}

/** Pure: merge per-relay lists under a config (signature-checked, newest per item). */
export function mergeStoreEvents(lists, config) {
  if (!config) return [];
  if (config.mode !== 'custom') return mergeOwnerEvents(lists, config.seller);
  const allowed = new Set(config.items);
  const best = new Map();
  for (const list of Array.isArray(lists) ? lists : []) {
    for (const e of Array.isArray(list) ? list : []) {
      if (!e || typeof e !== 'object') continue;
      const k = coord(e);
      if (!allowed.has(k) || !verifyNostrEventSig(e)) continue;
      const prev = best.get(k);
      if (!prev || (e.created_at || 0) > (prev.created_at || 0)) best.set(k, e);
    }
  }
  return [...best.values()];
}

/** Pure: unsigned store event from operator input ({ seller?, items? }). */
export function buildStoreEvent({ seller = '', items = [], nowSec = Math.floor(Date.now() / 1000), toHex, toCoord } = {}) {
  const errors = [];
  const tags = [['d', STORE_D], ['title', 'Torii NAP Zone store']];
  const coords = [];
  for (const it of Array.isArray(items) ? items : []) {
    const c = toCoord(it);
    if (!c || !ITEM_RE.test(c)) { errors.push('not a product/auction naddr or coordinate: ' + String(it).slice(0, 40)); continue; }
    if (!coords.includes(c)) coords.push(c);
  }
  if (coords.length > STORE_MAX_ITEMS) errors.push(`at most ${STORE_MAX_ITEMS} items`);
  for (const c of coords.slice(0, STORE_MAX_ITEMS)) tags.push(['a', c]);
  if (seller) { const h = toHex(seller); if (h) tags.push(['p', h]); else errors.push('seller must be an npub or hex pubkey'); }
  return { ok: !errors.length, errors, event: { kind: STORE_KIND, created_at: nowSec, tags, content: '' } };
}
