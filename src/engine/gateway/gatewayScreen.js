// engine/gateway/gatewayScreen.js — the in-world TORII GATEWAY app screen (v0.2.263).
//
// Shown when a player presses F at an armed torii gateway (the explicit confirm
// step). It is the "what a user experiences when using a torii gateway" surface:
// a proper app screen listing who is online in their instance of Torii Quest,
// with a travel affordance per world.
//
// Mockup-quality for now (v0.2.263): real online worlds passed by the host (from
// the live kind:30078 relay scan) are listed first and are clickable when the
// player is logged in. The screen ALWAYS shows the live state — no fake worlds:
//   - scanning / querying-relays → a live "Searching for worlds…" row (spinner)
//   - empty result, not scanning → an honest empty-state row ("No other worlds
//     online yet." + a hint)
//   - offline (no account) → the existing "Login to travel…" row
// Clicking a real world delegates to the host-injected onTravel(world).
// (Phase 0 removed the PREVIEW mock npubs: the screen is never blank, but it is
// also never fake — it reflects the real relay state.)
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
//   openGatewayScreen({ worlds, scanStatus, canTravel, onTravel, onClose })
//     worlds:     [{ pubkey?, shortPubkey?, title?, zoneType?, zoneId? }]  (real, live)
//     scanStatus: 'idle' | 'scanning' | 'offline'
//     canTravel:  boolean (host says the player is logged in / travel-capable)
//     onTravel(world): host travel callback for a REAL world row click
//     onClose():       host callback when the screen is dismissed (× / ESC / backdrop)
//   closeGatewayScreen()  — programmatic close (calls onClose once)
//   isGatewayScreenOpen() — boolean

export const GATEWAY_SCREEN_VERSION = 1;

let _el = null;
let _open = false;
let _onClose = null;

function _build() {
  if (_el) return _el;
  // Backdrop — fixed, dims the world behind. Clicking it closes (treated as a
  // dismiss, same as ESC / ×). pointerEvents auto so it can receive that click.
  const backdrop = document.createElement('div');
  backdrop.id = 'gateway-screen';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Torii gateway — worlds online');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '70',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(circle at 50% 40%, rgba(20,18,40,0.78), rgba(8,8,18,0.92))',
    backdropFilter: 'blur(3px)',
    fontFamily: 'monospace',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative',
    width: 'min(560px, 92vw)',
    maxHeight: '86vh', overflow: 'auto',
    background: 'linear-gradient(160deg, rgba(26,22,48,0.98), rgba(16,16,30,0.98))',
    border: '1.5px solid rgba(139,92,246,0.55)',
    borderRadius: '14px',
    boxShadow: '0 0 50px rgba(139,92,246,0.35), 0 0 24px rgba(76,201,240,0.25), 0 8px 30px rgba(0,0,0,0.6)',
    color: '#f4f9ff',
    padding: '22px 24px 20px',
  });

  // Header
  const head = document.createElement('div');
  Object.assign(head.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' });
  const title = document.createElement('div');
  title.textContent = '⛩  TORII GATEWAY';
  Object.assign(title.style, { fontSize: '20px', letterSpacing: '4px', fontWeight: 'bold', color: '#e9d5ff', textShadow: '0 0 14px rgba(196,181,253,0.7)' });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close gateway screen');
  Object.assign(closeBtn.style, {
    background: 'transparent', color: '#c4b5fd', border: '1px solid rgba(196,181,253,0.4)',
    borderRadius: '8px', fontSize: '22px', lineHeight: '1', width: '34px', height: '34px',
    cursor: 'pointer', padding: '0', transition: 'background 0.15s, color 0.15s',
  });
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.background = 'rgba(196,181,253,0.15)'; closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#c4b5fd'; });
  closeBtn.addEventListener('click', _close);
  head.append(title, closeBtn);

  const subtitle = document.createElement('div');
  subtitle.textContent = 'Worlds online in your instance of Torii Quest';
  Object.assign(subtitle.style, { fontSize: '11px', letterSpacing: '1px', color: '#9ca3af', marginBottom: '14px', textTransform: 'uppercase' });

  // Status badge (scan state + count)
  const badge = document.createElement('div');
  badge.id = 'gateway-screen-badge';
  Object.assign(badge.style, {
    display: 'inline-block', fontSize: '10px', letterSpacing: '1.5px',
    color: '#f7931a', border: '1px solid rgba(247,147,26,0.45)', borderRadius: '4px',
    padding: '2px 8px', marginBottom: '14px',
  });

  // Rows container
  const list = document.createElement('div');
  list.id = 'gateway-screen-list';
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '6px' });

  // Footer hint
  const hint = document.createElement('div');
  hint.textContent = 'ESC to close · click a world to travel';
  Object.assign(hint.style, { fontSize: '10px', letterSpacing: '1px', color: '#6b7280', marginTop: '16px', textAlign: 'center', textTransform: 'uppercase' });

  card.append(head, subtitle, badge, list, hint);
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
  row.className = clickable ? 'gw-screen-row gw-screen-clickable' : 'gw-screen-row';
  row.setAttribute('role', clickable ? 'button' : 'listitem');
  if (clickable) { row.setAttribute('tabindex', '0'); row.setAttribute('aria-label', `travel to ${_worldLabel(w)}`); }
  Object.assign(row.style, {
    display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '0 12px',
    alignItems: 'center',
    padding: '9px 12px', borderRadius: '8px',
    background: 'rgba(139,92,246,0.08)',
    border: '1px solid rgba(139,92,246,0.28)',
    cursor: clickable ? 'pointer' : 'default',
    transition: 'background 0.12s, border-color 0.12s',
  });
  if (clickable) {
    const hover = () => { row.style.background = 'rgba(139,92,246,0.18)'; row.style.borderColor = 'rgba(196,181,253,0.6)'; };
    const unhover = () => { row.style.background = 'rgba(139,92,246,0.08)'; row.style.borderColor = 'rgba(139,92,246,0.28)'; };
    row.addEventListener('mouseenter', hover); row.addEventListener('mouseleave', unhover);
    row.addEventListener('focus', hover); row.addEventListener('blur', unhover);
    const go = () => { try { onTravel(w); } finally { _close(); } };
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  }

  // Dot
  const dot = document.createElement('div');
  Object.assign(dot.style, { width: '8px', height: '8px', borderRadius: '50%', background: '#4cc9f0', boxShadow: '0 0 8px rgba(76,201,240,0.8)' });

  // Label + npub
  const lab = document.createElement('div');
  const name = document.createElement('div');
  name.textContent = _worldLabel(w);
  Object.assign(name.style, { fontSize: '13px', color: '#e9d5ff', letterSpacing: '0.5px' });
  const npub = document.createElement('div');
  npub.textContent = w.shortPubkey || (w.pubkey ? w.pubkey.slice(0, 16) + '…' : '—');
  Object.assign(npub.style, { fontSize: '10px', color: '#6b7280', marginTop: '1px', wordBreak: 'break-all' });
  lab.append(name, npub);

  // Type tag
  const tag = document.createElement('div');
  tag.textContent = w.zoneType || 'world';
  Object.assign(tag.style, { fontSize: '10px', letterSpacing: '1px', color: '#c4b5fd', textTransform: 'uppercase', justifySelf: 'end' });

  row.append(dot, lab, tag);
  return row;
}

export function openGatewayScreen({ worlds = [], scanStatus = 'idle', canTravel = false, onTravel = null, onClose = null } = {}) {
  const el = _build();
  _onClose = onClose;

  const badge = el.querySelector('#gateway-screen-badge');
  const list = el.querySelector('#gateway-screen-list');
  list.replaceChildren();

  const real = Array.isArray(worlds) ? worlds.filter((w) => w && typeof w === 'object') : [];

  let badgeText = '';
  if (scanStatus === 'scanning') badgeText = '● SCANNING RELAYS…';
  else if (scanStatus === 'offline') badgeText = '● OFFLINE';
  else if (real.length) badgeText = `● ONLINE · ${real.length} WORLD${real.length === 1 ? '' : 'S'}`;
  else badgeText = '● NO WORLDS ONLINE';
  badge.textContent = badgeText;

  // Live scanning state: a "Searching for worlds…" row with a spinner dot.
  // Shown while relays are queried and no real worlds are listed yet.
  if (scanStatus === 'scanning' && !real.length) {
    const row = document.createElement('div');
    row.textContent = 'Searching for worlds…';
    Object.assign(row.style, { fontSize: '12px', color: '#9ca3af', padding: '8px 12px' });
    const spin = document.createElement('div');
    Object.assign(spin.style, { width: '8px', height: '8px', borderRadius: '50%',
      background: '#f7931a', boxShadow: '0 0 8px rgba(247,147,26,0.8)', justifySelf: 'start' });
    row.prepend(spin);
    list.append(row);
  }

  // Real worlds first (clickable when canTravel).
  for (const w of real.slice(0, 24)) list.append(_rowDom(w, canTravel, onTravel));

  // Honest empty state: not scanning, no real worlds → tell the player no
  // other worlds are online yet (never fake worlds). A login hint when logged
  // out; a discovery hint when logged in.
  if (!real.length && scanStatus !== 'scanning') {
    const row = document.createElement('div');
    row.textContent = scanStatus === 'offline' ? 'Login to travel…' : 'No other worlds online yet.';
    Object.assign(row.style, { fontSize: '12px', color: '#9ca3af', padding: '8px 12px' });
    list.append(row);
    if (scanStatus !== 'offline') {
      const hint = document.createElement('div');
      hint.textContent = 'Publish your world presence to be discoverable.';
      Object.assign(hint.style, { fontSize: '10px', color: '#6b7280', marginTop: '4px', padding: '0 12px' });
      list.append(hint);
    }
  }

  if (!canTravel && real.length) {
    const note = document.createElement('div');
    note.textContent = 'login with nostr to travel';
    Object.assign(note.style, { fontSize: '10px', color: '#f7931a', marginTop: '8px', textAlign: 'center', letterSpacing: '1px' });
    list.append(note);
  }

  _open = true;
  el.style.display = 'flex';
  // Focus the card for ESC key handling accessibility.
  el.querySelector('button')?.focus?.();
}

export function closeGatewayScreen() { _close(); }
export function isGatewayScreenOpen() { return _open; }
