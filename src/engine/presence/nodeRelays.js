// engine/presence/nodeRelays.js — Phase 0d node-relay config reader. PURE +
// node-safe: NO DOM, NO WebSocket, NO setTimeout, NO fetch. The storage and
// metaGetter are INJECTED so tests pass fakes and the leaf never imports a
// DOM/window global. Guards for no-localStorage / no-document environments
// (SSR / restricted browsers) by returning []. Never throws.
//
// Constrained by construction:
//   - readNodeRelays({ metaGetter, storage }) → a deduped, validated wss://
//     URL array (capped 8). Sources (in order, merged + deduped): localStorage
//     `torii.node.relays` (comma/newline-separated), then
//     `<meta name="torii-relays" content="wss://...">` (comma-separated).
//   - NEVER falls back to `RELAYS` (the big public relays). Returns [] when
//     none configured → the caller (main.js) treats the heartbeat as
//     blocked:no-node-relay and publishes NOTHING. This is the explicit
//     public-relay regression guard this slice forbids.
//   - The curated trusted Torii STARTER defaults (DEFAULT_NODE_RELAYS below)
//     are an EXPLICIT, separate seam (readEffectiveNodeRelays), NOT a silent
//     fallback inside readNodeRelays — so the guard + its tests stay intact.
//   - wss ONLY (no plaintext ws://) on the node-publish surface — a node
//     presence event is operator-identity-bearing, never plaintext.

export const NODE_RELAYS_KEY = 'torii.node.relays';
export const NODE_RELAYS_META = 'torii-relays';
export const NODE_RELAYS_CAP = 8;

// _storage(s) → the injected storage or null. Tolerates a missing
// globalThis.localStorage (SSR / disabled storage) without throwing.
function _storage(s) {
  const store = s === undefined ? globalThis.localStorage : s;
  if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') {
    return null;
  }
  return store;
}

// _safeWssUrl(raw) → a wss URL string or null. Pure, never throws.
// Mirrors worldPresence._safeWss: wss ONLY, no credentials, hostname required.
function _safeWssUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'wss:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

// _parseList(raw) → split a raw string on commas/newlines into trimmed tokens.
function _parseList(raw) {
  if (typeof raw !== 'string' || raw === '') return [];
  return raw.split(/[,\n\r]+/).map((t) => t.trim()).filter((t) => t !== '');
}

// _mergeDedup(arrays) → a deduped array of validated wss URLs, capped at
// NODE_RELAYS_CAP. Earlier arrays win on duplicates. Pure.
function _mergeDedup(arrays) {
  const out = [];
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      const u = _safeWssUrl(r);
      if (u && !out.includes(u) && out.length < NODE_RELAYS_CAP) out.push(u);
    }
  }
  return out;
}

// readNodeRelays({ metaGetter, storage }) → a deduped, validated wss:// URL
// array (capped at NODE_RELAYS_CAP). Sources merged in order: localStorage
// `torii.node.relays` first, then `<meta name="torii-relays">`. NEVER falls
// back to public RELAYS. Returns [] when none configured. Pure; never throws.
export function readNodeRelays(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const storage = _storage(o.storage);
  const metaGetter = typeof o.metaGetter === 'function' ? o.metaGetter : null;

  let localRaw = '';
  try {
    if (storage) {
      const v = storage.getItem(NODE_RELAYS_KEY);
      localRaw = typeof v === 'string' ? v : '';
    }
  } catch {
    localRaw = '';
  }

  let metaRaw = '';
  try {
    if (metaGetter) {
      const v = metaGetter(NODE_RELAYS_META);
      metaRaw = typeof v === 'string' ? v : '';
    }
  } catch {
    metaRaw = '';
  }

  return _mergeDedup([_parseList(localRaw), _parseList(metaRaw)]);
}

// DEFAULT_NODE_RELAYS — curated trusted Torii starter relays used when the
// operator has NOT configured their own node-relay set (ADR-0076). These are
// Torii-ecosystem relays (gaming + marketplace + routstr presence), NOT the
// big public RELAYS (damus/nos.lol/nostr.band/primal) the public-relay
// regression guard forbids. Presence publishes to these trusted relays so a
// fresh install can beacon + be discoverable with zero config; the operator
// can override via the Relay settings tab. wss ONLY (operator-identity-
// bearing, never plaintext). Verified live at the WebSocket level
// (REQ + EOSE) on 2026-08-27 — relay.routstr.com is the Routstr network relay
// (docs.routstr.com), used for Torii-agent + presence discovery.
export const DEFAULT_NODE_RELAYS = Object.freeze([
  'wss://main.relay.gamestr.io',   // gaming notes + presence (Torii ecosystem)
  'wss://relay.plebeian.market',   // marketplace presence (Torii ecosystem)
  'wss://relay.routstr.com',       // routstr network relay (Torii ecosystem)
]);

// readEffectiveNodeRelays(opts) → the validated wss:// relay set the heartbeat
// actually publishes to: the operator's configured node relays if any, else the
// curated DEFAULT_NODE_RELAYS (ADR-0076). This is the publish + relay-tab
// source of truth. readNodeRelays() stays configured-only (it still returns []
// when none configured — the public-relay guard + its tests are untouched);
// the effective-defaults fallback is an EXPLICIT, separate seam so the behaviour
// change is auditable + reversible. Returns a fresh array (never the frozen
// constant) so callers cannot mutate the defaults. Pure; never throws.
export function readEffectiveNodeRelays(opts = {}) {
  const configured = readNodeRelays(opts);
  return configured.length ? configured : [...DEFAULT_NODE_RELAYS];
}

// setNodeRelays(str, storage) → void. Validates + writes localStorage
// `torii.node.relays` with the deduped, validated wss URLs (comma-joined).
// Empty/blank → removes the key (clears the configured set). Never throws; a
// failing setItem is silently ignored (read still returns the prior value).
// Pure.
export function setNodeRelays(str, storage) {
  try {
    const store = _storage(storage);
    if (!store) return;
    const tokens = _parseList(typeof str === 'string' ? str : '');
    const urls = _mergeDedup([tokens]);
    if (urls.length === 0) {
      store.removeItem(NODE_RELAYS_KEY);
    } else {
      store.setItem(NODE_RELAYS_KEY, urls.join(','));
    }
  } catch {
    /* storage disabled / quota — ignore; read still returns the prior value */
  }
}

// getNodeRelays(storage) → string. The raw stored relay string (for the menu's
// Node settings input display). '' when absent/no-storage. Pure; never throws.
export function getNodeRelays(storage) {
  try {
    const store = _storage(storage);
    if (!store) return '';
    const v = store.getItem(NODE_RELAYS_KEY);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}
