// engine/gateway/gatewayScreen.js — the in-world TORII GATEWAY app screen.
//
// Shown when a player presses F at an armed torii gateway (the explicit confirm
// step). It is the "what a user experiences when using a torii gateway" surface:
// an in-place, smoked-glass panel listing who is live in their instance of Torii
// Quest, split into three columns — Friends (mutual follows), Follows (people you
// follow), and Games (instances that have published a game).
//
// ADR-0054 (v0.2.676): the screen no longer opens on a blacked-out full-screen
// backdrop. It opens IN PLACE — the world stays fully visible behind a
// translucent smoked-glass card, so the player never loses sight of where they
// are. The single flat "worlds online" list is replaced by the three columns.
//
// BROWSE LOOP (v0.2.865): a directory row no longer travels on click. Clicking a row
// PEEKS at that world — the host opens the destination world's live mirror into the
// panel's preview canvas, the row is highlighted, and the commit bar arms. Clicking
// another row just switches the peek. The commit bar's 入 (ENTER) button walks through
// into the currently-peered world (the ONLY way to travel). The ✕ in the header steps
// away from the gate and resumes play / shop (cancel, no swap). There is NO Esc-to-
// browse step: switching is clicking the next name, backing away is the ✕.
//
// Constraints by construction:
//   - DISPLAY + CLICK ONLY. createElement + textContent + addEventListener. No
//     innerHTML, no eval, no fetch, no signing, no relay publish from here.
//   - No auto-navigation: proximity never opens this screen — only an explicit F
//     press (armed) does, via the host. A row click calls onPeek; only 入 calls
//     onCommit. Neither is invoked unless the player is travel-capable.
//   - Lazily built DOM (created on first open, reused after). ✕ / ESC / backdrop
//     click closes. The host is told via onClose so it can resume play.
//
// Shape:
//   openGatewayScreen({ friends, following, games, scanStatus, canTravel, onPeek, onCommit, onClose })
//     friends:    [{ pubkey?, shortPubkey?, title?, zoneType?, zoneId? }]  (mutual follows)
//     following:  [{ ... }]  (people you follow, not mutual)
//     games:      [{ ... }]  (instances that have published a game)
//     scanStatus: 'idle' | 'scanning' | 'offline'
//     canTravel:  boolean (host says the player is logged in / travel-capable)
//     onPeek(world):   host peer callback for a REAL world row click (NO travel)
//     onCommit():      host walk-through callback for the 入 (enter) button (travel)
//     onClose():       host callback when the screen is dismissed (✕ / ESC / backdrop)
//   closeGatewayScreen()  — programmatic close (calls onClose once)
//   isGatewayScreenOpen() — boolean
//   getGatewayPreviewCanvas() — the panel preview <canvas> (host blits the mirror in)
//   isGatewayCommitting() — true while a peek is armed (入 bar visible)

import { worldDirectoryLabel } from './gatewayRead.js';

export const GATEWAY_SCREEN_VERSION = 3;

let _el = null;
let _open = false;
let _onClose = null;
let _onPeek = null;
let _onCommit = null;
let _peeking = null;      // the world record currently peered at (or null)
let _previewCanvas = null;
let _commitBar = null;
let _commitLabel = null;
let _commitBtn = null;

function _build() {
  if (_el) return _el;
  // Backdrop — fixed but TRANSPARENT: the world stays fully visible behind the
  // panel (no blackout, no dimming). Clicking it closes (treated as a dismiss,
  // same as ESC / ×). pointerEvents auto so it can receive that click.
  const backdrop = document.createElement('div');
  backdrop.id = 'gateway-screen';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Torii gateway');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '70',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'transparent',
    fontFamily: 'monospace',
  });

  // Smoked-glass card — translucent + blurred, so the world reads through it.
  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative',
    width: 'min(780px, 94vw)',
    maxHeight: '86vh', overflow: 'auto',
    background: 'rgba(14, 16, 28, 0.58)',
    backdropFilter: 'blur(16px) saturate(1.15)',
    WebkitBackdropFilter: 'blur(16px) saturate(1.15)',
    border: '1px solid rgba(196,181,253,0.28)',
    borderRadius: '16px',
    boxShadow: '0 12px 40px rgba(0,0,0,0.45)',
    color: '#f4f9ff',
    padding: '18px 20px 16px',
  });

  // Header
  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' });
  const title = document.createElement('div');
  title.textContent = '⛩  TORII GATEWAY';
  Object.assign(title.style, { fontSize: '18px', letterSpacing: '3px', fontWeight: 'bold', color: '#e9d5ff', textShadow: '0 0 12px rgba(196,181,253,0.6)' });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Step away from the gate');
  closeBtn.title = 'Step away from the gate';
  Object.assign(closeBtn.style, {
    background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.4)',
    borderRadius: '8px', fontSize: '20px', lineHeight: '1', width: '34px', height: '34px',
    cursor: 'pointer', padding: '0', transition: 'background 0.15s, color 0.15s',
  });
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(196,181,253,0.15)'; closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#c4b5fd'; });
  closeBtn.addEventListener('click', _close);
  head.append(title, closeBtn);

  // Preview pane — hidden until a world is peeked. The canvas is the destination
  // world's live mirror; the host blits the mirror render-target into it each frame
  // (or on each peek). A caption shows who is being peered at, and the 入 commit
  // button arms/walks through.
  const preview = document.createElement('div');
  preview.style.display = 'none';
  preview.style.marginBottom = '12px';
  const cap = document.createElement('div');
  cap.style.display = 'flex';
  cap.style.alignItems = 'center';
  cap.style.justifyContent = 'space-between';
  cap.style.marginBottom = '6px';
  const capLabel = document.createElement('div');
  Object.assign(capLabel.style, { fontSize: '11px', letterSpacing: '1px', color: '#a5b0c5', textTransform: 'uppercase' });
  const commitBtn = document.createElement('button');
  commitBtn.type = 'button';
  commitBtn.disabled = true;
  commitBtn.setAttribute('aria-label', 'Enter this world');
  Object.assign(commitBtn.style, {
    background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
    color: '#fff', border: '1px solid rgba(196,181,253,0.5)',
    borderRadius: '8px', fontSize: '14px', letterSpacing: '2px', fontWeight: 'bold',
    padding: '6px 16px', cursor: 'pointer', transition: 'filter 0.15s, opacity 0.15s',
  });
  commitBtn.addEventListener('mouseenter', () => { commitBtn.style.filter = 'brightness(1.12)'; });
  commitBtn.addEventListener('mouseleave', () => { commitBtn.style.filter = 'none'; });
  commitBtn.addEventListener('click', _commit);
  cap.append(capLabel, commitBtn);
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    display: 'block', width: '100%', height: '180px',
    borderRadius: '12px', background: '#0b0e18',
    border: '1px solid rgba(76,201,240,0.35)',
    boxShadow: '0 0 18px rgba(76,201,240,0.25) inset',
    objectFit: 'cover',
  });
  preview.append(cap, canvas);
  _commitBar = preview;
  _commitLabel = capLabel;
  _commitBtn = commitBtn;
  _previewCanvas = canvas;

  // Columns container — three equal columns: Friends | Follows | Games.
  const cols = document.createElement('div');
  cols.id = 'gateway-screen-cols';
  Object.assign(cols.style, { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' });

  // Footer hint
  const hint = document.createElement('div');
  hint.textContent = 'click a world to look · 入 to enter · ✕ to step away';
  Object.assign(hint.style, { fontSize: '10px', letterSpacing: '1px', color: '#6b7280', marginTop: '14px', textAlign: 'center', textTransform: 'uppercase' });

  card.append(head, preview, cols, hint);
  backdrop.append(card);

  // Backdrop click (not card) closes — stop card clicks from bubbling.
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) _close(); });
  card.addEventListener('click', (e) => e.stopPropagation());

  document.body.appendChild(backdrop);
  _el = backdrop;
  return backdrop;
}

function _close() {
  if (!_open) return;
  _open = false;
  const el = _build();
  el.style.display = 'none';
  const cb = _onClose;
  _onClose = null;
  _clearPeek();
  if (typeof cb === 'function') { try { cb(); } catch { /* host close is best-effort */ } }
}

function _commit() {
  if (!_peeking) return;
  const cb = _onCommit;
  if (typeof cb === 'function') { try { cb(); } catch { /* host commit is best-effort */ } }
}

function _clearPeek() {
  _peeking = null;
  if (_commitBar) _commitBar.style.display = 'none';
  if (_commitBtn) _commitBtn.disabled = true;
  _markActiveRow(null);
}

// _armPeek(w) — the shared peek body: highlight the row, arm the 入 commit bar, and
// delegate the mirror build to the host's onPeek. Used BOTH by a live row click and
// by peekGateWorld() (the title-screen / menu hand-off, which pre-peeks a world the
// player already picked before opening the browse screen).
function _armPeek(w) {
  if (typeof _onPeek !== 'function') return;
  _peeking = w;
  _markActiveRow(w && w.pubkey ? w.pubkey : '');
  if (_commitLabel) _commitLabel.textContent = `looking at ${_worldLabel(w)}`;
  if (_commitBtn) { _commitBtn.textContent = '入 · ENTER'; _commitBtn.disabled = false; }
  if (_commitBar) _commitBar.style.display = 'block';
  try { _onPeek(w); } catch { /* host peek is best-effort */ }
}

function _markActiveRow(pubkey) {
  if (!_el) return;
  _el.querySelectorAll('[data-gw-pubkey]').forEach((row) => {
    const active = !!pubkey && row.getAttribute('data-gw-pubkey') === pubkey;
    row.style.background = active ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.08)';
    row.style.borderColor = active ? 'rgba(196,181,253,0.7)' : 'rgba(139,92,246,0.22)';
  });
}

function _worldLabel(w) {
  // Owner display name first (NOT the world `title` which is the app name and identical
  // across every resident — see worldDirectoryLabel in gatewayRead.js).
  return worldDirectoryLabel(w);
}

function _rowDom(w, canTravel, onPeek) {
  const row = document.createElement('div');
  const clickable = canTravel && typeof onPeek === 'function';
  row.setAttribute('role', clickable ? 'button' : 'listitem');
  row.setAttribute('data-gw-pubkey', w.pubkey || '');
  if (clickable) { row.setAttribute('tabindex', '0'); row.setAttribute('aria-label', `look at ${_worldLabel(w)}`); }
  Object.assign(row.style, {
    display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0 8px',
    alignItems: 'center',
    padding: '7px 10px', borderRadius: '8px',
    background: 'rgba(139,92,246,0.08)',
    border: '1px solid rgba(139,92,246,0.22)',
    cursor: clickable ? 'pointer' : 'default',
    transition: 'background 0.12s, border-color 0.12s',
  });
  if (clickable) {
    const hover = () => { row.style.background = 'rgba(139,92,246,0.18)'; row.style.borderColor = 'rgba(196,181,253,0.55)'; };
    const unhover = () => {
      const active = _peeking && _peeking.pubkey === w.pubkey;
      row.style.background = active ? 'rgba(139,92,246,0.28)' : 'rgba(139,92,246,0.08)';
      row.style.borderColor = active ? 'rgba(196,181,253,0.7)' : 'rgba(139,92,246,0.22)';
    };
    row.addEventListener('mouseenter', hover); row.addEventListener('mouseleave', unhover);
    row.addEventListener('focus', hover); row.addEventListener('blur', unhover);
    const peek = () => {
      if (typeof onPeek !== 'function') return;
      _armPeek(w);
    };
    row.addEventListener('click', peek);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); peek(); } });
  }

  // Dot (live indicator)
  const dot = document.createElement('div');
  Object.assign(dot.style, { width: '7px', height: '7px', borderRadius: '50%', background: '#4cc9f0', boxShadow: '0 0 7px rgba(76,201,240,0.8)' });

  // Label + npub
  const lab = document.createElement('div');
  Object.assign(lab.style, { minWidth: '0' });
  const name = document.createElement('div');
  name.textContent = _worldLabel(w);
  Object.assign(name.style, { fontSize: '12px', color: '#e9d5ff', letterSpacing: '0.4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' });
  const npub = document.createElement('div');
  npub.textContent = w.shortPubkey || (w.pubkey ? w.pubkey.slice(0, 12) + '…' : '—');
  Object.assign(npub.style, { fontSize: '9px', color: '#6b7280', marginTop: '1px', wordBreak: 'break-all' });
  lab.append(name, npub);

  row.append(dot, lab);
  return row;
}

function _columnDom(title, worlds, canTravel, onPeek, emptyHint) {
  const col = document.createElement('div');
  Object.assign(col.style, { display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '0' });

  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '6px', borderBottom: '1px solid rgba(196,181,253,0.18)' });
  const t = document.createElement('div');
  t.textContent = title;
  Object.assign(t.style, { fontSize: '11px', letterSpacing: '1.5px', color: '#c4b5fd', textTransform: 'uppercase', fontWeight: 'bold' });
  const n = document.createElement('div');
  n.textContent = String(worlds.length);
  Object.assign(n.style, { fontSize: '10px', color: '#a5b0c5', background: 'rgba(139,92,246,0.16)', borderRadius: '8px', padding: '1px 7px' });
  head.append(t, n);
  col.append(head);

  if (!worlds.length) {
    const empty = document.createElement('div');
    empty.textContent = emptyHint;
    Object.assign(empty.style, { fontSize: '11px', color: '#6b7280', padding: '8px 4px' });
    col.append(empty);
  } else {
    for (const w of worlds.slice(0, 24)) col.append(_rowDom(w, canTravel, onPeek));
  }

  return col;
}

export function openGatewayScreen({ friends = [], following = [], games = [], scanStatus = 'idle', canTravel = false, onPeek = null, onCommit = null, onClose = null } = {}) {
  const el = _build();
  _onClose = onClose;
  _onPeek = onPeek;
  _onCommit = onCommit;
  _clearPeek();

  const cols = el.querySelector('#gateway-screen-cols');
  cols.replaceChildren();

  const f = Array.isArray(friends) ? friends.filter((w) => w && typeof w === 'object') : [];
  const fo = Array.isArray(following) ? following.filter((w) => w && typeof w === 'object') : [];
  const g = Array.isArray(games) ? games.filter((w) => w && typeof w === 'object') : [];

  // While scanning with nothing discovered yet, show a single honest "searching"
  // row across the columns (never fake worlds).
  if (scanStatus === 'scanning' && !f.length && !fo.length && !g.length) {
    const row = document.createElement('div');
    row.textContent = 'Searching for live worlds…';
    Object.assign(row.style, { fontSize: '12px', color: '#9ca3af', padding: '10px 4px', gridColumn: '1 / -1' });
    cols.append(row);
  } else {
    cols.append(_columnDom('Friends', f, canTravel, onPeek, 'no mutual friends online'));
    cols.append(_columnDom('Follows', fo, canTravel, onPeek, scanStatus === 'offline' ? 'login to see follows' : 'no followed worlds online'));
    cols.append(_columnDom('Games', g, canTravel, onPeek, 'no games online'));
  }

  if (!canTravel && (f.length || fo.length || g.length)) {
    const note = document.createElement('div');
    note.textContent = 'login with nostr to travel';
    Object.assign(note.style, { fontSize: '10px', color: '#f7931a', marginTop: '10px', textAlign: 'center', letterSpacing: '1px' });
    cols.append(note);
  }

  _open = true;
  el.style.display = 'flex';
  // Focus the card for ESC key handling accessibility.
  el.querySelector('button')?.focus?.();
}

export function closeGatewayScreen() { _close(); }
export function isGatewayScreenOpen() { return _open; }
export function getGatewayPreviewCanvas() { return _previewCanvas; }
export function isGatewayCommitting() { return !!_peeking; }

// peekGateWorld(world) — pre-peek a world from OUTSIDE (title-screen/menu hand-off).
// Same body as a row click (highlight + arm 入 + host onPeek) so the player who
// picked a world in the Torii menu lands here ALREADY looking at it, then walks
// through with 入 or steps away with ✕. No-op when the screen is closed.
export function peekGateWorld(world) {
  if (!_open || !world) return;
  _armPeek(world);
}