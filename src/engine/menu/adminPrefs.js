// engine/menu/adminPrefs.js — pure localStorage helpers for the owner-only
// admin panel of the persistent Torii menu (Phase 0c). Two owner-preview prefs
// are persisted in localStorage so an operator can preview switching the
// homepage world + toggling their node's heartbeat presence WITHOUT a server
// endpoint. Both are clearly PREVIEW / this-browser-only: the Suite `active`
// pointer is the node-wide source of truth for the homepage world, and the
// heartbeat intent is surfaced for an explicit signer-consented publish later.
//
//   torii.world.active       — the preview homepage world id (slug). Read by
//                              worldLoader.readWorldIdFromDom BEFORE the
//                              `<meta name="torii-world">` so an owner can flip
//                              the homepage world and reload to preview it.
//   torii.heartbeat.intent   — 'on' | 'off'. The owner's node-presence intent.
//                              Default 'off'. Enabling does NOT auto-publish; it
//                              only sets the intent (the first publish needs
//                              explicit signer consent, surfaced by main.js).
//
// PURE + node-safe: the storage is INJECTED (default globalThis.localStorage)
// so tests pass a fake and the leaf never imports a DOM/window global. Guards
// for no-localStorage environments (SSR / restricted browsers) by returning
// the defaults. Never throws — a thrown storage op degrades to the default.

const ACTIVE_WORLD_KEY = 'torii.world.active';
const HEARTBEAT_INTENT_KEY = 'torii.heartbeat.intent';
const GAMESTR_ENABLED_KEY = 'torii.gamestr.enabled';
//   torii.gamestr.enabled   — '1' | '0'. The operator's runtime opt-in for the
//                            gamestr.io score publish (kind 30762). Default off.
//                            This is a RUNTIME override on top of the build-time
//                            GAMESTR_ENABLED config const; main.js publishes when
//                            (GAMESTR_ENABLED || getGamestrEnabled()). Off by
//                            default; the actual publish still requires the
//                            player's explicit NIP-07 consent (PUBLISH MY SCORE).

// Phase 0d: node-relay config helpers live in presence/nodeRelays.js (one
// source of truth — pure, node-safe, wss-only validation). Re-exported here so
// the menu/main.js composition root imports all owner-admin prefs from the
// single adminPrefs seam. The localStorage key is `torii.node.relays`.
export { getNodeRelays, setNodeRelays, readNodeRelays } from '../presence/nodeRelays.js';

// _storage(s) → the injected storage or null. Tolerates a missing
// globalThis.localStorage (SSR / disabled storage) without throwing.
function _storage(s) {
  const store = s === undefined ? globalThis.localStorage : s;
  if (!store || typeof store.getItem !== 'function' || typeof store.setItem !== 'function') {
    return null;
  }
  return store;
}

// getHeartbeatIntent(storage?) → 'on' | 'off'. Default 'off'. Pure; never throws.
export function getHeartbeatIntent(storage) {
  try {
    const store = _storage(storage);
    if (!store) return 'off';
    const v = store.getItem(HEARTBEAT_INTENT_KEY);
    return v === 'on' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

// setHeartbeatIntent(v, storage?) → void. Coerces to 'on'/'off' (anything else →
// 'off'). Never throws; a failing setItem is silently ignored (the read still
// returns the default). Pure.
export function setHeartbeatIntent(v, storage) {
  try {
    const store = _storage(storage);
    if (!store) return;
    store.setItem(HEARTBEAT_INTENT_KEY, v === 'on' ? 'on' : 'off');
  } catch {
    /* storage disabled / quota — ignore; read still returns the default */
  }
}

// getGamestrEnabled(storage?) → boolean. The operator's runtime gamestr opt-in
// (overrides the build-time GAMESTR_ENABLED const). Default false. Pure; never
// throws.
export function getGamestrEnabled(storage) {
  try {
    const store = _storage(storage);
    if (!store) return false;
    return store.getItem(GAMESTR_ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

// setGamestrEnabled(v, storage?) → void. Coerces to a stored '1'/'0'. Never
// throws. Pure.
export function setGamestrEnabled(v, storage) {
  try {
    const store = _storage(storage);
    if (!store) return;
    store.setItem(GAMESTR_ENABLED_KEY, v === true || v === 'on' ? '1' : '0');
  } catch {
    /* storage disabled / quota — ignore */
  }
}

// getActiveWorld(storage?) → string. The stored homepage world id, or '' when
// absent/blank/no-storage. Pure; never throws.
export function getActiveWorld(storage) {
  try {
    const store = _storage(storage);
    if (!store) return '';
    const v = store.getItem(ACTIVE_WORLD_KEY);
    if (typeof v !== 'string') return '';
    const trimmed = v.trim();
    return trimmed;
  } catch {
    return '';
  }
}

// setActiveWorld(id, storage?) → void. Stores the world id (or clears it when
// blank). Never throws. Pure.
export function setActiveWorld(id, storage) {
  try {
    const store = _storage(storage);
    if (!store) return;
    const v = typeof id === 'string' ? id.trim() : '';
    if (v === '') store.removeItem(ACTIVE_WORLD_KEY);
    else store.setItem(ACTIVE_WORLD_KEY, v);
  } catch {
    /* storage disabled / quota — ignore */
  }
}
