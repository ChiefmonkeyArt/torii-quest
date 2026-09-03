// engine/settings/settingsPanel.js — the new SETTINGS PANEL (v0.3). Replaces
// the old toriiMenu.js overlay from the title-screen settings button. A
// three-free DOM overlay (mirrors toriiMenu.js / gatewayScreen.js: pure DOM,
// no `three` import, browser-only, fail-safe), but with a nav-left/
// content-right shell (Continuum-styled) instead of a single scroll list.
//
// SIX tabs (v0.2.712: Access re-added after Relay; was four in v0.4;
//   v0.2.718: Character added after Profile):
//   Profile at the top, Relay added after Heartbeat, Access at the foot:
//   1. Profile — standard Nostr kind:0 fields for this Quest installation's
//      identity (display name, bio, avatar, website, NIP-05, lightning
//      address). Placed first/top since identity is the first thing an
//      owner customises.
//   2. Character — the Character Forge: create/load the player's playable
//      character (a signed kind-35100 event). Rendered by
//      engine/settings/characterForgePanel.js; main.js owns the read/create
//      round-trips.
//   3. Gateway Setup — hosts the 2 world-choice cards (Choose Blank / Use My
//      World as Template) from the former 4-card homepageStub.js. "Visit a
//      Node" was already dropped per design direction: in-world travel
//      already has a home at the physical Torii Gateway inside the NAP
//      zone, so a second UI-level node directory is redundant.
//   4. Heartbeat — hosts the "Publish my node's presence" toggle/status,
//      previously the 3rd Gateway Setup card. Same underlying state/
//      callback (main.js's onPublishNode / heartbeatStatus), just its own
//      tab so it isn't buried inside the world-choice list.
//   5. Relay — view/add/remove the wss:// relays this node publishes
//      presence to (engine/presence/nodeRelays.js, reused as-is).
//   6. Access — admin access-control surface (arrival authority + write
//      authority) backed by the signed kind:30078 settings event. The full
//      view-model + renderer live in engine/ui/instanceSettings.js (built
//      v0.2.358, hidden since v0.2.676, re-surfaced here in v0.2.712 per
//      "make the settings panel feel complete + useful"). main.js owns the
//      read/save relay round-trips; this module only hosts the tab.
//
// No node-directory tab (dropped by design decision). The old toriiMenu.js's
// live node-directory list (friends/following/games/all + admin scan) is not
// migrated here — main.js may still reference it for the in-game KeyM quick
// menu separately; this module does not touch that call site.
//
// v0.2.712: the Instance Settings admin surface (arrival-mode / write-policy
// controls) is RESTORED here as the "Access" tab — the underlying access-control
// logic in engine/gateway/handoffArrival.js + writeAuthority.js was untouched
// while the editing UI was hidden (v0.2.676–v0.2.711), so enforcement stayed live.
// instanceSettings.js (view-model + renderer) is now imported + rendered by
// main.js as the 'access' tab; its read/save relay round-trips reuse the
// existing readLatestAccessSettings / publishAccessSettings (nostr.js).
//
// The panel is a PRESENTATION + TAB-SWITCH layer only: main.js owns every
// callback and piece of state for every tab. This module never fetches,
// signs, publishes, or navigates on its own.
//
// Constraints by construction (mirrors toriiMenu.js):
//   - DISPLAY + CLICK ONLY. createElement + textContent/innerHTML-of-trusted-
//     static-markup + addEventListener. No eval, no fetch, no signing, no
//     relay publish performed by this module itself.
//   - Lazily built DOM (created on first open, reused after). ESC / × button /
//     backdrop click closes. The host is told via onClose so it can resume play.
//   - No timer primitives. No three/DOM globals at import time — only
//     `document` is touched inside _build(), called only by main.js.
//   - Fail-safe DOM: missing document / no body → every public call is a
//     no-op (never throws into the game loop).
//
// Shape:
//   openSettingsPanel({ initialTab?, onClose })
//     initialTab → 'profile' | 'gateway' | 'heartbeat' | 'relay' | 'access' (defaults to 'profile')
//     onClose()  — host callback when the panel is dismissed
//   closeSettingsPanel()        — programmatic close (calls onClose once)
//   isSettingsPanelOpen()       — boolean
//   getActiveSettingsTab()      — 'profile' | 'gateway' | 'heartbeat' | 'relay' | 'access'
//   setActiveSettingsTab(tab)   — switch tabs programmatically (re-renders)
//   renderActiveSettingsTab()   — re-render whichever tab is open from fresh
//                                  host content (main.js calls this after any
//                                  state change instead of reaching into DOM)
//   registerSettingsTabRenderer(tab, renderFn) — main.js supplies the render
//     function for each tab's content (returns an HTML string). Keeps this
//     module decoupled from instanceSettings.js / the gateway-setup state.

export const SETTINGS_PANEL_VERSION = 3;

// getSettingsTabIds() — the ordered list of settings-tab ids (pure; no DOM).
// Exposed so the tab inventory is unit-testable without a DOM environment —
// main.js registers a renderer for each id, so a missing id here is a wiring
// bug the suite can catch.
export function getSettingsTabIds() {
  return TABS.map((t) => t.id);
}

// v0.4: Profile added at the TOP of the nav column per design direction, and
// Relay added after Heartbeat. v0.2.712: Access re-added at the foot of the
// nav (admin/advanced — surfaces the existing signed kind:30078 access-control
// surface that was hidden since v0.2.676). Order here IS the on-screen nav order.
const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'character', label: 'Character' },
  { id: 'gateway', label: 'Gateway Setup' },
  { id: 'heartbeat', label: 'Heartbeat' },
  { id: 'relay', label: 'Relay' },
  { id: 'access', label: 'Access' },
];

let _el = null;
let _open = false;
let _onClose = null;
// v0.4: default landing tab moved to 'profile' (now the top-of-column tab).
let _activeTab = 'profile';
const _renderers = new Map(); // tab id -> () => htmlString

function _doc() {
  try {
    return (typeof globalThis !== 'undefined' && globalThis.document) ? globalThis.document : null;
  } catch {
    return null;
  }
}

function _build() {
  if (_el) return _el;
  const doc = _doc();
  if (!doc || typeof doc.createElement !== 'function') return null;

  const backdrop = doc.createElement('div');
  backdrop.id = 'torii-settings-backdrop';
  backdrop.setAttribute('role', 'presentation');
  // v0.2.739: dim + blur the backdrop so the amber home-screen doesn't
  // bleed through around the neutral settings panel. Modal-standard
  // behaviour (opaque scrim), keeps the panel reading as a proper
  // "settings page" rather than an overlay pane.
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '200',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(6, 8, 10, 0.72)',
    backdropFilter: 'blur(8px)',
    webkitBackdropFilter: 'blur(8px)',
  });

  const card = doc.createElement('div');
  card.id = 'torii-settings-panel';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Settings');
  card.className = 'ts-card';

  // No explicit ✕ close button — the panel closes on backdrop click ("click
  // anywhere outside") and ESC, which the user prefers over a dedicated
  // close control.
  const nav = doc.createElement('div');
  nav.className = 'ts-nav';

  const brand = doc.createElement('div');
  brand.className = 'ts-brand';
  brand.textContent = '⛩ SETTINGS';
  nav.append(brand);

  const navList = doc.createElement('div');
  navList.className = 'ts-nav-list';
  for (const tab of TABS) {
    const item = doc.createElement('button');
    item.type = 'button';
    item.className = 'ts-nav-item';
    item.dataset.tab = tab.id;
    item.textContent = tab.label;
    item.addEventListener('click', () => setActiveSettingsTab(tab.id));
    navList.append(item);
  }
  nav.append(navList);

  const content = doc.createElement('div');
  content.className = 'ts-content';
  content.id = 'torii-settings-content';

  card.append(nav, content);
  backdrop.append(card);

  // Close-on-backdrop: guarded by `e.target === backdrop` so clicks INSIDE the
  // card never close the panel. Do NOT stopPropagation() here — main.js routes
  // every settings action button (save-profile / remove-relay / publish-node /
  // choose-world / character actions / access form) through a document-level
  // delegated click listener scoped to #torii-settings-content; stopping
  // propagation on the card was swallowing those clicks so no button ever fired.
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSettingsPanel(); });

  if (doc.body && typeof doc.body.appendChild === 'function') {
    doc.body.appendChild(backdrop);
  } else {
    return null;
  }
  _el = backdrop;

  // Own ESC-to-close (mirrors homepageStub.js's capture-phase pattern) so the
  // panel is self-contained — the host doesn't need a separate keydown wire.
  doc.addEventListener('keydown', (e) => {
    if (!_open || e.code !== 'Escape' || e.repeat) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    closeSettingsPanel();
  }, true);

  return backdrop;
}

function _renderNavActiveState() {
  const el = _el;
  if (!el) return;
  const items = el.querySelectorAll('.ts-nav-item');
  items.forEach((it) => {
    const isActive = it.dataset.tab === _activeTab;
    it.classList.toggle('is-active', isActive);
  });
}

// registerSettingsTabRenderer(tab, renderFn) — main.js supplies a () =>
// htmlString function per tab. Called lazily every time that tab needs a
// render (open, tab switch, or an explicit renderActiveSettingsTab() call
// after state changes) so the content is always fresh, never stale/cached.
export function registerSettingsTabRenderer(tab, renderFn) {
  if (typeof renderFn === 'function') _renderers.set(tab, renderFn);
}

// renderActiveSettingsTab() — re-render whichever tab is currently showing,
// from its registered renderer. No-op if the panel isn't open (mirrors
// instanceSettings.js's own _rerenderInstanceSettingsPanel guard).
export function renderActiveSettingsTab() {
  if (!_open || !_el) return;
  const content = _el.querySelector('#torii-settings-content');
  if (!content) return;
  const renderFn = _renderers.get(_activeTab);
  content.innerHTML = typeof renderFn === 'function' ? (renderFn() || '') : '';
}

export function setActiveSettingsTab(tab) {
  if (!TABS.some((t) => t.id === tab)) return;
  _activeTab = tab;
  _renderNavActiveState();
  renderActiveSettingsTab();
}

export function getActiveSettingsTab() {
  return _activeTab;
}

export function openSettingsPanel({ initialTab = 'profile', onClose = null } = {}) {
  if (!_doc()) return;
  const el = _build();
  if (!el) return;
  _onClose = typeof onClose === 'function' ? onClose : null;
  _activeTab = TABS.some((t) => t.id === initialTab) ? initialTab : 'profile';
  _open = true;
  el.style.display = 'flex';
  _renderNavActiveState();
  renderActiveSettingsTab();
  el.querySelector('.ts-nav-item.is-active')?.focus?.();
}

export function closeSettingsPanel() {
  if (!_open) return;
  _open = false;
  if (_el) _el.style.display = 'none';
  const cb = _onClose;
  _onClose = null;
  if (typeof cb === 'function') { try { cb(); } catch { /* host close is best-effort */ } }
}

export function isSettingsPanelOpen() { return _open; }

// _resetForTest() — TEST ONLY. Mirrors homepageStub.js's helper so the lazily
// built singleton does not leak across vitest cases. Never call from
// production code.
export function _resetForTest() { _el = null; _open = false; _onClose = null; _activeTab = 'profile'; _renderers.clear(); }
