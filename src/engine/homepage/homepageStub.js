// engine/homepage/homepageStub.js — Phase 0g "Gateway setup" overlay. A
// three-free DOM module (mirrors toriiMenu.js: pure DOM, no `three` import,
// browser-only, fail-safe). It presents the 4 operator/visitor entry actions
// in one cohesive place. 3 of 4 actions are ALREADY BUILT — this slice is the
// UI panel + wiring, NOT a reimplementation of the actions:
//   1. Choose Blank            → onChooseWorld('gateway-blank')      (owner-only)
//   2. Use My World as Template → onChooseWorld('chiefmonkey-template') (owner-only)
//   3. Visit a Node            → onVisitNodeDirectory()             (everyone)
//   4. Publish My Node         → onPublishNode() (the existing heartbeat path; owner-only)
//
// The stub is a PRESENTATION layer only: main.js owns ALL the data + every
// action. `openHomepageStub(state, callbacks)` renders from the snapshot main.js
// passes in; the stub never fetches, never signs, never publishes, never
// navigates, never reloads on its own — every action delegates to a
// host-injected callback. Never fakes data; never renders mock worlds.
//
// Constraints by construction (mirrors toriiMenu.js):
//   - DISPLAY + CLICK ONLY. createElement + textContent + addEventListener. No
//     innerHTML for world data, no eval, no fetch, no signing, no relay publish.
//   - Lazily built DOM (created on first open, reused after). ESC / × button /
//     backdrop click closes. The host is told via onClose so it can resume play.
//   - NO timer primitives (the regression-check allowlist is closed; src/engine
//     is not on it). No three/DOM globals at import time — only `document` is
//     touched inside _build(), which is only called by main.js (the shell), so
//     the pure leaves stay node-safe.
//   - Fail-safe DOM: missing document / no body → every public call is a no-op
//     (never throws into the game loop).
//
// Gating (CRITICAL): guests/non-owners must NOT mutate torii.world.active.
// For non-owners the owner cards (Choose Blank, Use Template, Publish) are
// DISABLED + hinted ("Log in as the node owner to configure this node.");
// only Visit a Node stays enabled for everyone.
//
// Auto-open gating helper: setShownThisSession() / hasShownThisSession() use a
// sessionStorage flag (`torii.homepage.stub.shown`) so the optional auto-open
// after login happens ONCE per session per browser. main.js decides WHEN to
// auto-open (isOwner && !activeWorld && !shown); this module only owns the flag.
//
// Shape (mirrors toriiMenu.js):
//   openHomepageStub(state, callbacks)
//     state     → { isOwner, isLoggedIn, activeWorld, heartbeatStatus }
//     callbacks → { onChooseWorld, onVisitNodeDirectory, onPublishNode, onClose }
//   closeHomepageStub()  — programmatic close (calls onClose once)
//   isHomepageStubOpen() — boolean
//   setShownThisSession() / hasShownThisSession() — sessionStorage flag helpers

export const HOMEPAGE_STUB_VERSION = 1;

const SHOWN_KEY = 'torii.homepage.stub.shown';

let _el = null;
let _open = false;
let _onClose = null;
let _scene = null;            // { unmount } | null — the 3D scene handle
let _sceneMounting = false;  // guard so a rapid close→open doesn't double-mount

// _doc() → the document object or null. Fail-safe: a missing document
// (node/SSR/test) returns null so every public call is a no-op (never throws
// into the loop). Uses globalThis.document (not the bare global) so a missing
// binding does not raise a ReferenceError in non-browser envs.
function _doc() {
  try {
    return (typeof globalThis !== 'undefined' && globalThis.document) ? globalThis.document : null;
  } catch {
    return null;
  }
}

// The 4 cards. `owner` cards are disabled+hinted for non-owners; `visit` is
// always enabled. Each card carries the callback name + (for Choose-world
// cards) the worldId main.js's onChooseWorld expects.
const CARDS = [
  { id: 'blank', icon: '⬜', label: 'Choose Blank', hint: 'Start from an empty gateway world.', kind: 'owner', worldId: 'gateway-blank', cb: 'onChooseWorld' },
  { id: 'template', icon: '🗺️', label: 'Use My World as Template', hint: 'Seed the gateway from your world.', kind: 'owner', worldId: 'chiefmonkey-template', cb: 'onChooseWorld' },
  { id: 'visit', icon: '⛩', label: 'Visit a Node', hint: 'Open the live node directory.', kind: 'visit', cb: 'onVisitNodeDirectory' },
  { id: 'publish', icon: '📡', label: 'Publish My Node', hint: 'Heartbeat presence (needs signer consent).', kind: 'owner', cb: 'onPublishNode' },
];

// _storage() → the sessionStorage-like object or null. Tolerates a missing
// globalThis.sessionStorage (SSR / disabled storage) without throwing.
function _storage() {
  try {
    const s = globalThis.sessionStorage;
    if (!s || typeof s.getItem !== 'function' || typeof s.setItem !== 'function') return null;
    return s;
  } catch {
    return null;
  }
}

// hasShownThisSession() → bool. True once setShownThisSession() has marked the
// flag for this browser session. Never throws (missing/broken storage → false).
export function hasShownThisSession() {
  try {
    const s = _storage();
    if (!s) return false;
    return s.getItem(SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

// setShownThisSession() → void. Marks the auto-open flag for this session so
// it never auto-opens twice. Never throws (a failing setItem is silently
// ignored; the read still returns its prior value).
export function setShownThisSession() {
  try {
    const s = _storage();
    if (!s) return;
    s.setItem(SHOWN_KEY, '1');
  } catch {
    /* storage disabled / quota — ignore */
  }
}

function _build() {
  if (_el) return _el;
  // Fail-safe: a missing document (node/SSR/test) -> no-op, never throws into
  // the loop. _doc() reads globalThis.document (not the bare global) so a
  // missing binding does not raise a ReferenceError in non-browser envs.
  const doc = _doc();
  if (!doc || typeof doc.createElement !== 'function') return null;
  const backdrop = doc.createElement('div');
  backdrop.id = 'torii-homepage-stub';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Gateway setup — choose your homepage world');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '210',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(circle at 50% 40%, rgba(20,18,40,0.45), rgba(6,6,16,0.62))',
    backdropFilter: 'blur(3px)',
    fontFamily: 'monospace',
  });

  // 3D scene mount target — a full-bleed layer BEHIND the card. homepageScene.js
  // creates its own <canvas> inside this host + sizes it via ResizeObserver.
  // pointerEvents:none so clicks fall through to the backdrop/card as before.
  const sceneHost = _doc().createElement('div');
  sceneHost.id = 'torii-homepage-stub-scene';
  Object.assign(sceneHost.style, {
    position: 'absolute', inset: '0', zIndex: '0', overflow: 'hidden', pointerEvents: 'none',
  });

  const card = _doc().createElement('div');
  Object.assign(card.style, {
    position: 'relative', zIndex: '1',
    width: 'min(560px, 94vw)',
    maxHeight: '88vh', overflow: 'auto',
    background: 'linear-gradient(160deg, rgba(26,22,48,0.78), rgba(16,16,30,0.82))',
    backdropFilter: 'blur(10px)',
    border: '1.5px solid rgba(139,92,246,0.55)',
    borderRadius: '14px',
    boxShadow: '0 0 50px rgba(139,92,246,0.35), 0 0 24px rgba(76,201,240,0.25), 0 8px 30px rgba(0,0,0,0.6)',
    color: '#f4f9ff',
    padding: '22px 24px 20px',
  });

  // Header
  const head = _doc().createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' });
  const title = _doc().createElement('div');
  title.textContent = '⛩  GATEWAY SETUP';
  Object.assign(title.style, { fontSize: '20px', letterSpacing: '4px', fontWeight: 'bold', color: '#e9d5ff', textShadow: '0 0 14px rgba(196,181,253,0.7)' });
  const closeBtn = _doc().createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close Gateway setup');
  Object.assign(closeBtn.style, {
    background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.4)',
    borderRadius: '8px', fontSize: '22px', lineHeight: '1', width: '34px', height: '34px',
    cursor: 'pointer', padding: '0', transition: 'background 0.15s, color 0.15s',
  });
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(196,181,253,0.15)'; closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#c4b5fd'; });
  closeBtn.addEventListener('click', _close);
  head.append(title, closeBtn);

  const subtitle = _doc().createElement('div');
  subtitle.textContent = 'Choose your homepage world · visit nodes · publish presence';
  Object.assign(subtitle.style, { fontSize: '11px', letterSpacing: '1px', color: '#9ca3af', marginBottom: '14px', textTransform: 'uppercase' });

  // Active-world status badge
  const badge = _doc().createElement('div');
  badge.id = 'torii-homepage-stub-badge';
  Object.assign(badge.style, {
    display: 'inline-block', fontSize: '10px', letterSpacing: '1.5px',
    color: '#4cc9f0', border: '1px solid rgba(76,201,240,0.45)', borderRadius: '4px',
    padding: '2px 8px', marginBottom: '14px',
  });

  // Cards container
  const list = _doc().createElement('div');
  list.id = 'torii-homepage-stub-list';
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '10px' });

  // Footer hint
  const hint = _doc().createElement('div');
  hint.textContent = 'ESC to close · owner actions need the node owner signed in';
  Object.assign(hint.style, { fontSize: '10px', letterSpacing: '1px', color: '#6b7280', marginTop: '16px', textAlign: 'center', textTransform: 'uppercase' });

  card.append(head, subtitle, badge, list, hint);
  backdrop.append(sceneHost, card);

  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) _close(); });
  card.addEventListener('click', (e) => e.stopPropagation());

  if (doc.body && typeof doc.body.appendChild === 'function') {
    doc.body.appendChild(backdrop);
  } else {
    return null;
  }
  _el = backdrop;
  return backdrop;
}

function _close() {
  if (!_open) return;
  _open = false;
  if (_scene) { try { _scene.unmount(); } catch { /* best-effort */ } _scene = null; }
  const el = _build();
  if (el) el.style.display = 'none';
  const cb = _onClose;
  _onClose = null;
  if (typeof cb === 'function') { try { cb(); } catch { /* host close is best-effort */ } }
}

// _publishLabel(heartbeatStatus) — a short, honest label for the Publish card
// that reuses the existing heartbeat status string so blocked/paused states
// stay consistent with the menu's heartbeat toggle. Never invents a state.
function _publishLabel(heartbeatStatus) {
  const s = typeof heartbeatStatus === 'string' ? heartbeatStatus : 'off';
  if (s === 'off') return 'Publish my node presence (OFF)';
  if (s === 'live') return 'Publish my node presence (LIVE)';
  if (s === 'idle') return 'Publish my node presence (idle — awaiting first publish)';
  if (s === 'publishing') return 'Publishing…';
  if (s === 'stale') return 'Republish overdue (stale)';
  // Blocked / paused states surface verbatim so the operator sees the same
  // reason the menu shows (blocked:no-signer / blocked:no-node-relay /
  // paused:wallet-requires-approval / failed:…).
  return `Publish my node presence (${s})`;
}

// _cardDom(card, state, callbacks) — one card. Owner cards are disabled +
// hinted for non-owners (they must NOT mutate torii.world.active). Visit is
// always enabled. Click → the matching callback (best-effort; never throws
// into the loop). No innerHTML for data.
function _cardDom(card, state, callbacks) {
  const row = _doc().createElement('div');
  Object.assign(row.style, {
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0 12px',
    alignItems: 'center',
    padding: '12px 14px', borderRadius: '8px',
    background: 'rgba(139,92,246,0.08)',
    border: '1px solid rgba(139,92,246,0.28)',
  });

  const icon = _doc().createElement('div');
  icon.textContent = card.icon || '•';
  Object.assign(icon.style, { fontSize: '18px', justifySelf: 'center' });

  const body = _doc().createElement('div');

  const label = _doc().createElement('div');
  Object.assign(label.style, { fontSize: '13px', color: '#e9d5ff', letterSpacing: '0.5px' });

  const sub = _doc().createElement('div');
  Object.assign(sub.style, { fontSize: '10px', color: '#9ca3af', marginTop: '2px' });

  const isOwner = state.isOwner === true;
  const ownerCard = card.kind === 'owner';
  const enabled = !ownerCard || isOwner;

  if (card.id === 'publish') {
    label.textContent = _publishLabel(state.heartbeatStatus);
    sub.textContent = card.hint;
  } else {
    label.textContent = card.label;
    sub.textContent = card.hint;
  }

  // The action button. Disabled when the card is owner-only AND the viewer is
  // not the owner — so a guest click can never reach onChooseWorld /
  // onPublishNode (fail-closed on the gate, not on the callback).
  const btn = _doc().createElement('button');
  btn.type = 'button';
  btn.textContent = card.id === 'visit' ? 'Open' : (card.id === 'publish' ? 'Toggle' : 'Choose');
  btn.disabled = !enabled;
  btn.setAttribute('aria-label', card.label);
  Object.assign(btn.style, {
    fontSize: '11px', letterSpacing: '1px', padding: '5px 12px', borderRadius: '6px',
    cursor: enabled ? 'pointer' : 'default',
    background: enabled ? 'rgba(139,92,246,0.25)' : 'rgba(139,92,246,0.10)',
    color: enabled ? '#e9d5ff' : '#6b7280',
    border: '1px solid rgba(139,92,246,0.45)',
    justifySelf: 'end', alignSelf: 'center',
  });

  if (enabled) {
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(139,92,246,0.4)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(139,92,246,0.25)'; });
    btn.addEventListener('click', () => {
      const cb = callbacks && typeof callbacks[card.cb] === 'function' ? callbacks[card.cb] : null;
      if (!cb) return;
      try {
        if (card.cb === 'onChooseWorld') cb(card.worldId);
        else cb();
      } catch {
        /* host action is best-effort; never throw into the loop */
      }
    });
  }

  body.append(label, sub);
  row.append(icon, body, btn);
  // Place the button on its own column via a 3-track grid for alignment.
  row.style.gridTemplateColumns = 'auto 1fr auto';

  // Non-owner hint for owner cards: explain WHY they are disabled so the
  // operator knows to log in as the node owner (never silently gated).
  if (ownerCard && !isOwner) {
    const gate = _doc().createElement('div');
    gate.textContent = 'Log in as the node owner to configure this node.';
    Object.assign(gate.style, {
      gridColumn: '1 / -1', fontSize: '10px', color: '#f7931a', marginTop: '6px',
      letterSpacing: '0.5px',
    });
    row.append(gate);
  }

  return row;
}

// openHomepageStub(state, callbacks) — renders the 4-card overlay. state +
// callbacks are owned by main.js (the stub is a pure renderer). Fail-safe:
// missing document → no-op. Returns nothing.
export function openHomepageStub(state = {}, callbacks = {}) {
  // Fail-safe: a missing document (node/SSR/test) → no-op, never throws into
  // the loop. Checked here too (not just in _build) because _el may be cached
  // from a prior open in a real browser, but the render path below needs a live
  // document to build cards.
  if (!_doc()) return;
  const el = _build();
  if (!el) return;

  const st = (state && typeof state === 'object') ? state : {};
  const cb = (callbacks && typeof callbacks === 'object') ? callbacks : {};
  _onClose = typeof cb.onClose === 'function' ? cb.onClose : null;

  const badge = el.querySelector('#torii-homepage-stub-badge');
  const list = el.querySelector('#torii-homepage-stub-list');
  list.replaceChildren();

  const isOwner = st.isOwner === true;
  const activeWorld = typeof st.activeWorld === 'string' && st.activeWorld !== '' ? st.activeWorld : null;
  if (badge) {
    badge.textContent = activeWorld
      ? `● ACTIVE WORLD · ${activeWorld}`
      : (isOwner ? '● NO ACTIVE WORLD (default)' : '● DEFAULT WORLD');
  }

  for (const card of CARDS) {
    list.append(_cardDom(card, st, cb));
  }

  if (!isOwner) {
    const note = _doc().createElement('div');
    note.textContent = 'Visit a Node is open to everyone; owner actions need the node owner signed in.';
    Object.assign(note.style, { fontSize: '10px', color: '#9ca3af', marginTop: '6px', textAlign: 'center', letterSpacing: '0.5px' });
    list.append(note);
  }

  _open = true;
  el.style.display = 'flex';
  _mountScene(el);
  el.querySelector('button')?.focus?.();
}

// _mountScene(el) — lazily import + mount the 3D homepage scene behind the card.
// Non-blocking + fail-safe: the import + WebGL probe are async, so the DOM cards
// are usable immediately. If three/WebGL is unavailable the scene never mounts
// + the backdrop gradient remains (the home surface still works). Never throws
// into the loop.

export function closeHomepageStub() { _close(); }
export function isHomepageStubOpen() { return _open; }

// _hasWebGL() → true only if a throwaway canvas can acquire a WebGL context.
// Used as a cheap capability gate before the dynamic import, so the 3D module
// is never requested in headless/jsdom envs. Never throws. (homepageScene.js
// does its own, stricter failIfMajorPerformanceCaveat probe before creating
// the renderer.)
function _hasWebGL() {
  try {
    const doc = _doc();
    if (!doc || typeof doc.createElement !== 'function') return false;
    const c = doc.createElement('canvas');
    return !!(c.getContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

// _mountScene — see above (hoisted function declaration so openHomepageStub can
// reference it before its definition in source order).
async function _mountScene(el) {
  if (_sceneMounting) return;
  _sceneMounting = true;
  try {
    const host = el.querySelector('#torii-homepage-stub-scene');
    if (!host) return;
    if (_scene) { try { _scene.unmount(); } catch { /* best-effort */ } _scene = null; }
    // Cheap browser-capability gate BEFORE the dynamic import: no WebGL context
    // → no three. This keeps the three chunk out of node/jsdom tests entirely
    // (jsdom has no WebGL) + avoids a pending async import leaking across cases.
    if (!_hasWebGL()) return;
    const mod = await import('./homepageScene.js');
    const handle = await mod.mountHomepageScene(host);
    // If the stub closed while we were importing, tear it straight down so no
    // orphan GL context / rAF lingers behind a hidden overlay.
    if (!_open || !_el) { if (handle) { try { handle.unmount(); } catch { /* best-effort */ } } return; }
    _scene = handle;
  } catch {
    /* no three / no WebGL / import failed — DOM gradient remains the backdrop */
  } finally {
    _sceneMounting = false;
  }
}

// _resetForTest() — TEST ONLY. Resets the module-internal DOM cache + open flag
// so the lazily-built singleton does not leak across vitest cases (isolate:false
// shares the module graph). Not imported by main.js; never call from production.
export function _resetForTest() { _el = null; _open = false; _onClose = null; _scene = null; _sceneMounting = false; }
