// engine/menu/toriiMenu.js — the persistent TORII MENU (Phase 0c). A three-free
// DOM overlay that opens from BOTH the title screen (the burger button) AND from
// inside the game (KeyM), showing the live node directory in four sections + an
// owner-only admin panel. It mirrors gatewayScreen.js's DOM/style pattern + its
// open/close/isOpen + onClose + pause-on-open + resume-on-close lifecycle, but is
// a SEPARATE element with its own state so the two surfaces never collide.
//
// The menu is a PRESENTATION layer only: main.js owns ALL the data (the live
// presence scan, the contact partition, the owner detection, the admin prefs).
// `getState()` returns the full snapshot the menu renders from; the menu never
// fetches, never signs, never publishes, never navigates on its own — every
// action delegates to a host-injected callback (onTravel / onToggleHeartbeat /
// onSetActiveWorld). Never fakes data; never renders mock worlds.
//
// Constraints by construction (mirrors gatewayScreen.js):
//   - DISPLAY + CLICK ONLY. createElement + textContent + addEventListener. No
//     innerHTML for world data, no eval, no fetch, no signing, no relay publish.
//   - Lazily built DOM (created on first open, reused after). ESC / × button /
//     backdrop click closes. The host is told via onClose so it can resume play.
//   - No setTimeout timer (the regression-check allowlist is closed). No three/DOM
//     globals at import time — only `document` is touched inside _build(), which
//     is only called by main.js (the shell), so the pure leaves stay node-safe.
//
// Shape (mirrors gatewayScreen.js):
//   openToriiMenu({ getState, onClose })
//     getState() → { scanStatus, canTravel, friends, following, games, all,
//                     isOwner, admin: {...}, onTravel }
//     onClose()  — host callback when the menu is dismissed (× / ESC / backdrop)
//   closeToriiMenu()  — programmatic close (calls onClose once)
//   isToriiMenuOpen() — boolean

export const TORII_MENU_VERSION = 1;

let _el = null;
let _open = false;
let _onClose = null;
let _getState = null;

function _build() {
  if (_el) return _el;
  const backdrop = document.createElement('div');
  backdrop.id = 'torii-menu';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Torii menu — worlds online + node settings');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '75',
    display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(circle at 50% 40%, rgba(20,18,40,0.82), rgba(8,8,18,0.94))',
    backdropFilter: 'blur(3px)',
    fontFamily: 'monospace',
  });

  const card = document.createElement('div');
  Object.assign(card.style, {
    position: 'relative',
    width: 'min(620px, 94vw)',
    maxHeight: '88vh', overflow: 'auto',
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
  title.textContent = '⛩  TORII MENU';
  Object.assign(title.style, { fontSize: '20px', letterSpacing: '4px', fontWeight: 'bold', color: '#e9d5ff', textShadow: '0 0 14px rgba(196,181,253,0.7)' });
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', 'Close Torii menu');
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
  subtitle.textContent = 'Live node directory · travel · node settings';
  Object.assign(subtitle.style, { fontSize: '11px', letterSpacing: '1px', color: '#9ca3af', marginBottom: '14px', textTransform: 'uppercase' });

  // Status badge (scan state)
  const badge = document.createElement('div');
  badge.id = 'torii-menu-badge';
  Object.assign(badge.style, {
    display: 'inline-block', fontSize: '10px', letterSpacing: '1.5px',
    color: '#f7931a', border: '1px solid rgba(247,147,26,0.45)', borderRadius: '4px',
    padding: '2px 8px', marginBottom: '14px',
  });

  // Sections container
  const list = document.createElement('div');
  list.id = 'torii-menu-list';
  Object.assign(list.style, { display: 'flex', flexDirection: 'column', gap: '10px' });

  // Footer hint
  const hint = document.createElement('div');
  hint.textContent = 'ESC to close · M to toggle · click Visit to travel';
  Object.assign(hint.style, { fontSize: '10px', letterSpacing: '1px', color: '#6b7280', marginTop: '16px', textAlign: 'center', textTransform: 'uppercase' });

  card.append(head, subtitle, badge, list, hint);
  backdrop.append(card);

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

// _sectionHeader(list, title) — a labelled section header inside the menu list.
function _sectionHeader(list, title) {
  const h = document.createElement('div');
  h.textContent = title;
  Object.assign(h.style, {
    fontSize: '11px', letterSpacing: '2px', color: '#c4b5fd', textTransform: 'uppercase',
    marginTop: '6px', marginBottom: '2px',
  });
  list.append(h);
}

// _emptyRow(list, text) — an honest empty-state line for a section.
function _emptyRow(list, text) {
  const row = document.createElement('div');
  row.textContent = text;
  Object.assign(row.style, { fontSize: '12px', color: '#9ca3af', padding: '6px 12px' });
  list.append(row);
}

// _rowDom(w, canTravel, onTravel) — one world row: label + npub + zoneType tag +
// a "Visit" button (→ onTravel) and a separate "Website" link when the world has
// a safe https website. Mirrors gatewayScreen's row DOM (no innerHTML for data).
function _rowDom(w, canTravel, onTravel) {
  const row = document.createElement('div');
  Object.assign(row.style, {
    display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: '0 10px',
    alignItems: 'center',
    padding: '9px 12px', borderRadius: '8px',
    background: 'rgba(139,92,246,0.08)',
    border: '1px solid rgba(139,92,246,0.28)',
  });

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

  // Visit button (only when canTravel + onTravel present)
  const visitBtn = document.createElement('button');
  visitBtn.type = 'button';
  visitBtn.textContent = 'Visit';
  visitBtn.disabled = !(canTravel && typeof onTravel === 'function');
  Object.assign(visitBtn.style, {
    fontSize: '11px', letterSpacing: '1px', padding: '4px 10px', borderRadius: '6px',
    cursor: visitBtn.disabled ? 'default' : 'pointer',
    background: visitBtn.disabled ? 'rgba(139,92,246,0.12)' : 'rgba(139,92,246,0.25)',
    color: visitBtn.disabled ? '#6b7280' : '#e9d5ff',
    border: '1px solid rgba(139,92,246,0.45)',
  });
  if (!visitBtn.disabled) {
    visitBtn.addEventListener('mouseenter', () => { visitBtn.style.background = 'rgba(139,92,246,0.4)'; });
    visitBtn.addEventListener('mouseleave', () => { visitBtn.style.background = 'rgba(139,92,246,0.25)'; });
    visitBtn.addEventListener('click', () => { try { onTravel(w); } finally { _close(); } });
  }

  row.append(dot, lab, tag, visitBtn);

  // Website link — only when the world carries a safe https website (already
  // validated by gatewayRead.extractGatewayFromEvent via safeProfileUrl, so a
  // hostile value can never smuggle in a javascript:/data: scheme). Opens in a
  // new tab with rel="noopener noreferrer". Rendered on its own line under the row.
  if (typeof w.website === 'string' && /^https:\/\//i.test(w.website)) {
    const linkRow = document.createElement('div');
    Object.assign(linkRow.style, { gridColumn: '1 / -1', marginTop: '4px' });
    const link = document.createElement('a');
    link.href = w.website;
    link.textContent = 'Website ↗';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    Object.assign(link.style, { fontSize: '10px', letterSpacing: '1px', color: '#4cc9f0', textDecoration: 'none' });
    link.addEventListener('mouseenter', () => { link.style.textDecoration = 'underline'; });
    link.addEventListener('mouseleave', () => { link.style.textDecoration = 'none'; });
    linkRow.append(link);
    row.append(linkRow);
  }

  return row;
}

// _renderSection(list, title, worlds, canTravel, onTravel, scanStatus, emptyHint)
// — renders a section header + up to ROW_CAP rows + an honest empty state.
function _renderSection(list, title, worlds, canTravel, onTravel, scanStatus, emptyHint) {
  _sectionHeader(list, title);
  const arr = Array.isArray(worlds) ? worlds.filter((w) => w && typeof w === 'object') : [];
  if (arr.length === 0) {
    _emptyRow(list, scanStatus === 'scanning' ? `${emptyHint} (scanning…)` : emptyHint);
    return;
  }
  const ROW_CAP = 24;
  for (const w of arr.slice(0, ROW_CAP)) list.append(_rowDom(w, canTravel, onTravel));
  const overflow = arr.length - ROW_CAP;
  if (overflow > 0) {
    const more = document.createElement('div');
    more.textContent = `+${overflow} more`;
    Object.assign(more.style, { fontSize: '10px', color: '#6b7280', padding: '2px 12px' });
    list.append(more);
  }
}

// _renderAdmin(list, admin) — the owner-only "Node settings" panel. Only called
// when getState().isOwner is true. Heartbeat toggle + active-world selector +
// scores read-only status. All actions delegate to host callbacks; the menu
// never publishes or reloads on its own.
function _renderAdmin(list, admin) {
  if (!admin || typeof admin !== 'object') return;
  _sectionHeader(list, 'Node settings');

  const panel = document.createElement('div');
  Object.assign(panel.style, {
    padding: '12px', borderRadius: '8px',
    background: 'rgba(247,147,26,0.06)',
    border: '1px solid rgba(247,147,26,0.3)',
    display: 'flex', flexDirection: 'column', gap: '10px',
  });

  // Heartbeat toggle
  const hbRow = document.createElement('div');
  Object.assign(hbRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' });
  const hbLabel = document.createElement('div');
  hbLabel.textContent = 'Publish my node presence (first publish needs signer consent).';
  Object.assign(hbLabel.style, { fontSize: '12px', color: '#e9d5ff', flex: '1 1 auto' });
  const hbBtn = document.createElement('button');
  hbBtn.type = 'button';
  const hbOn = admin.heartbeatIntent === 'on';
  hbBtn.textContent = hbOn ? 'ON' : 'OFF';
  Object.assign(hbBtn.style, {
    fontSize: '11px', letterSpacing: '1px', padding: '4px 12px', borderRadius: '6px', cursor: 'pointer',
    background: hbOn ? 'rgba(247,147,26,0.35)' : 'rgba(139,92,246,0.15)',
    color: hbOn ? '#f7931a' : '#9ca3af',
    border: `1px solid ${hbOn ? 'rgba(247,147,26,0.6)' : 'rgba(139,92,246,0.4)'}`,
  });
  if (typeof admin.onToggleHeartbeat === 'function') {
    hbBtn.addEventListener('click', () => { try { admin.onToggleHeartbeat(hbOn ? 'off' : 'on'); } catch { /* best-effort */ } });
  }
  hbRow.append(hbLabel, hbBtn);
  panel.append(hbRow);

  // Active homepage world selector
  const awRow = document.createElement('div');
  Object.assign(awRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' });
  const awLabel = document.createElement('div');
  awLabel.textContent = 'Homepage world (preview — this browser).';
  Object.assign(awLabel.style, { fontSize: '12px', color: '#e9d5ff', flex: '1 1 auto' });
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Homepage world');
  Object.assign(sel.style, {
    fontSize: '11px', padding: '3px 6px', borderRadius: '6px', cursor: 'pointer',
    background: 'rgba(16,16,30,0.9)', color: '#e9d5ff', border: '1px solid rgba(139,92,246,0.45)',
  });
  const current = typeof admin.activeWorld === 'string' ? admin.activeWorld : '';
  const avail = Array.isArray(admin.availableWorlds) ? admin.availableWorlds : [];
  // A "default" option (no override) so the owner can revert to the meta tag.
  const defOpt = document.createElement('option');
  defOpt.value = '';
  defOpt.textContent = '(default)';
  sel.append(defOpt);
  for (const w of avail) {
    if (!w || typeof w.id !== 'string') continue;
    const opt = document.createElement('option');
    opt.value = w.id;
    opt.textContent = w.name || w.id;
    if (w.id === current) opt.selected = true;
    sel.append(opt);
  }
  sel.value = current;
  if (typeof admin.onSetActiveWorld === 'function') {
    sel.addEventListener('change', () => { try { admin.onSetActiveWorld(sel.value); } catch { /* best-effort */ } });
  }
  awRow.append(awLabel, sel);
  panel.append(awRow);

  // Scores read-only status
  const scRow = document.createElement('div');
  Object.assign(scRow.style, { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' });
  const scLabel = document.createElement('div');
  scLabel.textContent = 'Scores';
  Object.assign(scLabel.style, { fontSize: '12px', color: '#e9d5ff', flex: '1 1 auto' });
  const scVal = document.createElement('div');
  const scoresOn = !!admin.scoresEnabled;
  scVal.textContent = scoresOn ? 'ON' : 'OFF';
  Object.assign(scVal.style, {
    fontSize: '11px', letterSpacing: '1px', padding: '4px 12px', borderRadius: '6px',
    color: scoresOn ? '#f7931a' : '#6b7280',
    border: `1px solid ${scoresOn ? 'rgba(247,147,26,0.5)' : 'rgba(107,114,128,0.4)'}`,
  });
  scRow.append(scLabel, scVal);
  panel.append(scRow);

  const scNote = document.createElement('div');
  scNote.textContent = 'Scores are toggled in admin settings.';
  Object.assign(scNote.style, { fontSize: '10px', color: '#6b7280', marginTop: '-4px' });
  panel.append(scNote);

  list.append(panel);
}

export function openToriiMenu({ getState = null, onClose = null } = {}) {
  const el = _build();
  _getState = typeof getState === 'function' ? getState : null;
  _onClose = onClose;

  const badge = el.querySelector('#torii-menu-badge');
  const list = el.querySelector('#torii-menu-list');
  list.replaceChildren();

  const st = _getState ? _getState() : {};
  const scanStatus = st.scanStatus || 'idle';
  const canTravel = !!st.canTravel;
  const onTravel = typeof st.onTravel === 'function' ? st.onTravel : null;

  let badgeText = '';
  const total = [st.friends, st.following, st.games, st.all].reduce(
    (n, a) => n + (Array.isArray(a) ? a.length : 0), 0);
  if (scanStatus === 'scanning') badgeText = '● SCANNING RELAYS…';
  else if (scanStatus === 'offline') badgeText = '● OFFLINE';
  else if (total) badgeText = `● ONLINE · ${total} NODE${total === 1 ? '' : 'S'}`;
  else badgeText = '● NO NODES ONLINE';
  badge.textContent = badgeText;

  // Scanning hint row when no worlds yet.
  if (scanStatus === 'scanning' && total === 0) {
    const row = document.createElement('div');
    row.textContent = 'Searching for worlds…';
    Object.assign(row.style, { fontSize: '12px', color: '#9ca3af', padding: '8px 12px' });
    const spin = document.createElement('div');
    Object.assign(spin.style, { width: '8px', height: '8px', borderRadius: '50%',
      background: '#f7931a', boxShadow: '0 0 8px rgba(247,147,26,0.8)', display: 'inline-block', marginRight: '8px' });
    row.prepend(spin);
    list.append(row);
  }

  // 1. Mutuals
  _renderSection(list, 'Mutuals', st.friends, canTravel, onTravel, scanStatus, 'No mutuals online yet');
  // 2. People you follow
  if (canTravel) {
    _renderSection(list, 'People you follow', st.following, canTravel, onTravel, scanStatus, 'No followed worlds online');
  } else {
    _sectionHeader(list, 'People you follow');
    _emptyRow(list, 'Log in to see who you follow.');
  }
  // 3. Games & experiences
  _renderSection(list, 'Games & experiences', st.games, canTravel, onTravel, scanStatus, 'No games online yet');
  // 4. All live nodes
  _renderSection(list, 'All live nodes', st.all, canTravel, onTravel, scanStatus, 'No other nodes online');

  // Owner-only admin panel
  if (st.isOwner) _renderAdmin(list, st.admin);

  if (!canTravel && total > 0) {
    const note = document.createElement('div');
    note.textContent = 'login with nostr to travel';
    Object.assign(note.style, { fontSize: '10px', color: '#f7931a', marginTop: '8px', textAlign: 'center', letterSpacing: '1px' });
    list.append(note);
  }

  _open = true;
  el.style.display = 'flex';
  el.querySelector('button')?.focus?.();
}

export function closeToriiMenu() { _close(); }
export function isToriiMenuOpen() { return _open; }
