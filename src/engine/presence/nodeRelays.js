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
//   - readNodeRelays returns [] when none configured (configured-only). The
//     effective list (readEffectiveNodeRelays) falls back to the curated
//     DEFAULT_NODE_RELAYS — the single list the whole game uses (ADR-0081).
//   - The curated STARTER defaults (DEFAULT_NODE_RELAYS below) are an EXPLICIT,
//     separate seam (readEffectiveNodeRelays), NOT a silent fallback inside
//     readNodeRelays — so the configured-only reader + its tests stay intact.
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

// DEFAULT_NODE_RELAYS — the single curated Torii starter relay list used when
// the operator has NOT configured their own set (ADR-0081). This is now the ONE
// list the whole game connects to — profile reads, login, leaderboard reads,
// presence-discovery reads, AND presence/heartbeat publish — so a fresh install
// works with zero config and the operator can override the whole list from the
// Relay settings tab. Public relays are fine here: popular relays give more
// reach + discovery. What is gated is not the relay but the ACTION — every
// publish (heartbeat, gamestr score, access settings) still requires its own
// explicit user opt-in/click before anything is signed or sent (see ADR-0081).
// wss ONLY (operator-identity-bearing, never plaintext). Verified live at the
// WebSocket level (REQ + EOSE) on 2026-08-27.
export const DEFAULT_NODE_RELAYS = Object.freeze([
  'wss://main.relay.gamestr.io',   // gaming notes + presence (Torii ecosystem)
  'wss://relay.plebeian.market',   // marketplace presence (Torii ecosystem)
  'wss://relay.routstr.com',       // routstr network relay (Torii ecosystem)
  'wss://nos.lol',                 // popular general relay — good for reach
  'wss://relay.vertexlab.io',      // NIP-45 profile aggregator
]);

// readEffectiveNodeRelays(opts) → the validated wss:// relay set the whole game
// uses (reads AND publish): the operator's configured node relays if any, else
// the curated DEFAULT_NODE_RELAYS (ADR-0081). This is the single relay-list
// source of truth. readNodeRelays() stays configured-only (it still returns []
// when none configured — the Relay tab uses it to detect the usingDefaults
// banner state); the effective-defaults fallback is an EXPLICIT, separate seam
// so the behaviour change is auditable + reversible. Returns a fresh array
// (never the frozen constant) so callers cannot mutate the defaults. Pure;
// never throws.
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
