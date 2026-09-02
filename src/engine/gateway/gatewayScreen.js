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
// Constraints by construction:
//   - DISPLAY + CLICK ONLY. createElement + textContent + addEventListener. No
//     innerHTML, no eval, no fetch, no signing, no relay publish from here.
//   - No auto-navigation: proximity never opens this screen — only an explicit F
//     press (armed) does, via the host. A travel click only calls onTravel.
//   - Lazily built DOM (created on first open, reused after). ESC / × button /
//     backdrop click closes. The host is told via onClose so it can resume play.
//
// Shape:
//   openGatewayScreen({ friends, following, games, scanStatus, canTravel, onTravel, onClose })
//     friends:    [{ pubkey?, shortPubkey?, title?, zoneType?, zoneId? }]  (mutual follows)
//     following:  [{ ... }]  (people you follow, not mutual)
//     games:      [{ ... }]  (instances that have published a game)
//     scanStatus: 'idle' | 'scanning' | 'offline'
//     canTravel:  boolean (host says the player is logged in / travel-capable)
//     onTravel(world): host travel callback for a REAL world row click
//     onClose():       host callback when the screen is dismissed (× / ESC / backdrop)
//   closeGatewayScreen()  — programmatic close (calls onClose once)
//   isGatewayScreenOpen() — boolean

export const GATEWAY_SCREEN_VERSION = 2;

let _el = null;
let _open = false;
let _onClose = null;

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
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close gateway screen');
  Object.assign(closeBtn.style, {
    background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.4)',
    borderRadius: '8px', fontSize: '20px', lineHeight: '1', width: '32px', height: '32px',
    cursor: 'pointer', padding: '0', transition: 'background 0.15s, color 0.15s',
  });
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(196,181,253,0.15)'; closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#c4b5fd'; });
  closeBtn.addEventListener('click', _close);
  head.append(title, closeBtn);

  // Columns container — three equal columns: Friends | Follows | Games.
  const cols = document.createElement('div');
  cols.id = 'gateway-screen-cols';
  Object.assign(cols.style, { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' });

  // Footer hint
  const hint = document.createElement('div');
  hint.textContent = 'ESC to close · click a world to travel';
  Object.assign(hint.style, { fontSize: '10px', letterSpacing: '1px', color: '#6b7280', marginTop: '14px', textAlign: 'center', textTransform: 'uppercase' });

  card.append(head, cols, hint);
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
  if (typeof cb === 'function') { try { cb(); } catch { /* host close is best-effort */ } }
}

function _worldLabel(w) {
  return w.title || w.shortPubkey || w.zoneId || 'world';
}

function _rowDom(w, canTravel, onTravel) {
  const row = document.createElement('div');
  const clickable = canTravel && typeof onTravel === 'function';
  row.setAttribute('role', clickable ? 'button' : 'listitem');
  if (clickable) { row.setAttribute('tabindex', '0'); row.setAttribute('aria-label', `travel to ${_worldLabel(w)}`); }
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
    const unhover = () => { row.style.background = 'rgba(139,92,246,0.08)'; row.style.borderColor = 'rgba(139,92,246,0.22)'; };
    row.addEventListener('mouseenter', hover); row.addEventListener('mouseleave', unhover);
    row.addEventListener('focus', hover); row.addEventListener('blur', unhover);
    const go = () => { try { onTravel(w); } finally { _close(); } };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
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

function _columnDom(title, worlds, canTravel, onTravel, emptyHint) {
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
    for (const w of worlds.slice(0, 24)) col.append(_rowDom(w, canTravel, onTravel));
  }

  return col;
}

export function openGatewayScreen({ friends = [], following = [], games = [], scanStatus = 'idle', canTravel = false, onTravel = null, onClose = null } = {}) {
  const el = _build();
  _onClose = onClose;

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
    cols.append(_columnDom('Friends', f, canTravel, onTravel, 'no mutual friends online'));
    cols.append(_columnDom('Follows', fo, canTravel, onTravel, scanStatus === 'offline' ? 'login to see follows' : 'no followed worlds online'));
    cols.append(_columnDom('Games', g, canTravel, onTravel, 'no games online'));
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
