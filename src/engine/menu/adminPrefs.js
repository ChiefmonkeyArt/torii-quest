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
