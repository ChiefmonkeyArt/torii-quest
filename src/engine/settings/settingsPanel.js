// engine/settings/settingsPanel.js — the new SETTINGS PANEL (v0.3). Replaces
// the old toriiMenu.js overlay from the title-screen settings button. A
// three-free DOM overlay (mirrors toriiMenu.js / gatewayScreen.js: pure DOM,
// no `three` import, browser-only, fail-safe), but with a nav-left/
// content-right shell (Continuum-styled) instead of a single scroll list.
//
// Exactly TWO tabs:
//   1. Instance Settings — hosts the EXISTING buildInstanceSettingsModel /
//      renderInstanceSettingsPanel view (unchanged render logic, migrated
//      container). main.js still owns all state + the save/change/submit
//      wiring; this module only gives it a content pane to render into.
//   2. Gateway Setup — hosts 3 of the 4 former homepageStub.js cards (Choose
//      Blank / Use My World as Template / Publish My Node). "Visit a Node"
//      is DROPPED per design direction: in-world travel already has a home
//      at the physical Torii Gateway inside the NAP zone, so a second
//      UI-level node directory is redundant, not a regression.
//
// No node-directory tab (dropped by design decision). The old toriiMenu.js's
// live node-directory list (friends/following/games/all + admin scan) is not
// migrated here — main.js may still reference it for the in-game KeyM quick
// menu separately; this module does not touch that call site.
//
// The panel is a PRESENTATION + TAB-SWITCH layer only: main.js owns every
// callback and piece of state for both tabs. This module never fetches,
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
//     initialTab → 'instance' | 'gateway' (defaults to 'instance')
//     onClose()  — host callback when the panel is dismissed
//   closeSettingsPanel()        — programmatic close (calls onClose once)
//   isSettingsPanelOpen()       — boolean
//   getActiveSettingsTab()      — 'instance' | 'gateway'
//   setActiveSettingsTab(tab)   — switch tabs programmatically (re-renders)
//   renderActiveSettingsTab()   — re-render whichever tab is open from fresh
//                                  host content (main.js calls this after any
//                                  state change instead of reaching into DOM)
//   registerSettingsTabRenderer(tab, renderFn) — main.js supplies the render
//     function for each tab's content (returns an HTML string). Keeps this
//     module decoupled from instanceSettings.js / the gateway-setup state.

export const SETTINGS_PANEL_VERSION = 1;

const TABS = [
  { id: 'instance', label: 'Instance Settings' },
  { id: 'gateway', label: 'Gateway Setup' },
];

let _el = null;
let _open = false;
let _onClose = null;
let _activeTab = 'instance';
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
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '200',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(10,6,4,0.72)',
    backdropFilter: 'blur(3px)',
  });

  const card = doc.createElement('div');
  card.id = 'torii-settings-panel';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');
  card.setAttribute('aria-label', 'Settings');
  card.className = 'ts-card';

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

  const closeBtn = doc.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'ts-nav-close';
  closeBtn.textContent = '× Close';
  closeBtn.setAttribute('aria-label', 'Close settings');
  closeBtn.addEventListener('click', () => closeSettingsPanel());
  nav.append(closeBtn);

  const content = doc.createElement('div');
  content.className = 'ts-content';
  content.id = 'torii-settings-content';

  card.append(nav, content);
  backdrop.append(card);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeSettingsPanel(); });
  card.addEventListener('click', (e) => e.stopPropagation());

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

export function openSettingsPanel({ initialTab = 'instance', onClose = null } = {}) {
  if (!_doc()) return;
  const el = _build();
  if (!el) return;
  _onClose = typeof onClose === 'function' ? onClose : null;
  _activeTab = TABS.some((t) => t.id === initialTab) ? initialTab : 'instance';
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
export function _resetForTest() { _el = null; _open = false; _onClose = null; _activeTab = 'instance'; _renderers.clear(); }
