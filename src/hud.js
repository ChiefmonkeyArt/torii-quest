// hud.js — ALL DOM updates live here. Nothing else touches the DOM.
import { state } from './state.js';
import { on, EV } from './events.js';
import { decideBossBarUpdate } from './bossBarState.js';
import { MARKER_MS, MARKER_VOID_MS } from './gamezone/client/feel.js';

// DOM refs — cached once
const $ = id => document.getElementById(id);
const elSats    = $('sb-sats'), elKills = $('sb-kills'), elHp = $('sb-hp');
const elAmmo    = $('ammo-cur'), elHpFill = $('healthbar-fill');
const elHitFlash= $('hit-flash'), elDeathMsg = $('death-msg'), elCross = $('crosshair');
const elKillFeed= $('killfeed');

// Prev-value guards — skip DOM write if unchanged
let _ph=-1,_pk=-1,_pp=-1,_pa='',_ps=-1;
let _hitTimer=0, _crossTimer=0, _bossFlashTimer=0;
let _bossBarEl = null, _bossBarNameEl = null, _bossBarTrackEl = null, _bossBarFillEl = null, _bossBarHpEl = null;
let _bossBarState = null;
let _prevBossHp = null;
let _bossId = '';
const BOSS_BAR_FILL = 'linear-gradient(90deg, rgba(150,20,24,0.98), rgba(218,54,28,0.99) 58%, rgba(255,154,60,0.99))';
const BOSS_BAR_FLASH = 'linear-gradient(90deg, rgba(255,245,214,0.98), rgba(255,140,78,0.99) 40%, rgba(255,72,36,0.99))';
const BOSS_FLASH_SECS = 0.18;

export function initHUD() {
  on(EV.HUD_UPDATE,    updateHUD);
  on(EV.BOT_KILLED,    d => { addKill(d && d.zone === 'head' ? '☠ HEADSHOT · NOSTRICH DOWN +5⚡' : '☠ NOSTRICH DOWN +5⚡', '#f7931a'); updateHUD(); });
  on(EV.PLAYER_HIT,    d => flashHit(d?.dmg || 25));
  // v0.2.229: keep aria-hidden in lockstep with .show so the always-in-DOM death
  // overlay only reaches the accessibility tree while a death is actually shown
  // (never on the TITLE screen before first entry — a cloud/AT smoke had been
  // reading "YOU DIED"/"Respawning..." as the live status pre-entry).
  on(EV.PLAYER_KILLED, () => { elDeathMsg.classList.add('show');    elDeathMsg.setAttribute('aria-hidden', 'false'); });
  on(EV.PLAYER_RESPAWN,() => { elDeathMsg.classList.remove('show'); elDeathMsg.setAttribute('aria-hidden', 'true');  });
}

export function updateHUD() {
  if (state.sats  !== _ps) { elSats.textContent  = state.sats;  _ps = state.sats;  }
  if (state.kills !== _pk) { elKills.textContent = state.kills; _pk = state.kills; }
  const hp = Math.max(0, Math.round(state.hp));
  if (hp !== _ph) {
    elHp.textContent = hp;
    const c = hp>60?'#44ff88':hp>30?'#ffcc00':'#ff4444';
    elHp.style.color = c; elHpFill.style.width=hp+'%'; elHpFill.style.background=c;
    _ph = hp;
  }
  const at = state.reloading ? 'R' : String(state.ammo);
  if (at !== _pa) {
    elAmmo.textContent = at;
    // v0.2.101: reload visual feedback — pulse the ammo readout and fade the
    // crosshair while reloading so the player feels the disarmed window.
    elAmmo.parentElement.classList.toggle('reloading', state.reloading);
    elCross.classList.toggle('reloading', state.reloading);
    _pa = at;
  }
}

export function flashHit(dmg=25) {
  const i = Math.min(1, dmg/50);
  elHitFlash.style.opacity = String(0.3+i*0.5);
  _hitTimer = 0.2+i*0.3;
}

export function flashCross() { elCross.classList.add('hit'); _crossTimer = 0.25; }

function _bossBarDom() {
  if (_bossBarEl) return _bossBarEl;
  _bossBarEl = document.createElement('div');
  _bossBarEl.id = 'boss-hp-bar';
  Object.assign(_bossBarEl.style, {
    position: 'fixed',
    top: '0px',
    left: '0px',
    transform: 'translate(-50%, -100%)',
    width: '360px',
    maxWidth: '72vw',
    padding: '7px 10px 8px',
    background: 'linear-gradient(180deg, rgba(30,7,8,0.92), rgba(12,4,5,0.84))',
    border: '1px solid rgba(255,120,88,0.52)',
    borderRadius: '10px',
    boxShadow: '0 10px 30px rgba(0,0,0,0.42), 0 0 24px rgba(130,18,18,0.22)',
    pointerEvents: 'none',
    opacity: '0',
    transition: 'opacity 0.22s ease',
    zIndex: '50',
  });
  const head = document.createElement('div');
  Object.assign(head.style, {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: '8px',
    marginBottom: '6px',
  });
  _bossBarNameEl = document.createElement('div');
  Object.assign(_bossBarNameEl.style, {
    color: '#ffd8c8',
    fontFamily: 'monospace',
    fontSize: '11px',
    fontWeight: 'bold',
    letterSpacing: '2px',
    textTransform: 'uppercase',
    textShadow: '0 0 12px rgba(255,124,96,0.72), 0 1px 2px rgba(0,0,0,0.82)',
    whiteSpace: 'nowrap',
  });
  _bossBarHpEl = document.createElement('div');
  Object.assign(_bossBarHpEl.style, {
    color: '#ffe7de',
    fontFamily: 'monospace',
    fontSize: '10px',
    fontWeight: 'bold',
    letterSpacing: '1px',
    textShadow: '0 0 10px rgba(255,140,112,0.42), 0 1px 2px rgba(0,0,0,0.82)',
    whiteSpace: 'nowrap',
  });
  head.appendChild(_bossBarNameEl);
  head.appendChild(_bossBarHpEl);
  _bossBarTrackEl = document.createElement('div');
  Object.assign(_bossBarTrackEl.style, {
    position: 'relative',
    height: '13px',
    overflow: 'hidden',
    background: 'rgba(18, 4, 5, 0.84)',
    border: '1px solid rgba(255,132,84,0.36)',
    borderRadius: '999px',
    boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.72), 0 0 12px rgba(255,92,48,0.08)',
  });
  _bossBarFillEl = document.createElement('div');
  Object.assign(_bossBarFillEl.style, {
    position: 'absolute',
    inset: '0',
    background: BOSS_BAR_FILL,
    transform: 'scaleX(1)',
    transformOrigin: 'left center',
    boxShadow: '0 0 14px rgba(255,98,54,0.28)',
  });
  _bossBarTrackEl.appendChild(_bossBarFillEl);
  _bossBarEl.appendChild(head);
  _bossBarEl.appendChild(_bossBarTrackEl);
  document.body.appendChild(_bossBarEl);
  return _bossBarEl;
}
function _clearBossFlash() {
  if (!_bossBarFillEl || !_bossBarTrackEl) return;
  _bossBarFillEl.style.background = BOSS_BAR_FILL;
  _bossBarFillEl.style.boxShadow = '0 0 14px rgba(255,98,54,0.28)';
  _bossBarTrackEl.style.borderColor = 'rgba(255,132,84,0.36)';
  _bossBarTrackEl.style.boxShadow = 'inset 0 1px 4px rgba(0,0,0,0.72), 0 0 12px rgba(255,92,48,0.08)';
}
function _positionBossBar(el, { screenX, screenY, anchored } = {}) {
  if (Number.isFinite(screenX)) el.style.left = `${Math.round(screenX)}px`;
  if (Number.isFinite(screenY)) el.style.top = `${Math.round(screenY)}px`;
  el.style.opacity = anchored === true ? '1' : '0';
}
export function setBossBar({ id = null, name, hp, maxHp, alive, screenX = null, screenY = null, anchored = false } = {}) {
  const prevHp = _prevBossHp;
  const prevBossId = _bossId;
  const next = decideBossBarUpdate(_bossBarState, { id, name, hp, maxHp, alive });
  if (!next.visible) { hideBossBar(); return; }
  _bossBarState = next;
  const el = _bossBarDom();
  _positionBossBar(el, { screenX, screenY, anchored });
  if (!next.changed) {
    _prevBossHp = next.hp;
    _bossId = next.identity;
    return;
  }
  _bossBarNameEl.textContent = next.name.toUpperCase();
  _bossBarHpEl.textContent = `${next.hp} / ${next.maxHp}`;
  _bossBarFillEl.style.transform = `scaleX(${next.pct})`;
  el.style.opacity = anchored === true ? '1' : '0';
  if (next.shouldFlash && prevBossId === next.identity && prevHp != null && next.hp < prevHp) {
    _bossFlashTimer = BOSS_FLASH_SECS;
    _bossBarFillEl.style.background = BOSS_BAR_FLASH;
    _bossBarFillEl.style.boxShadow = '0 0 18px rgba(255,158,96,0.95), 0 0 30px rgba(255,68,36,0.55)';
    _bossBarTrackEl.style.borderColor = 'rgba(255,224,176,0.86)';
    _bossBarTrackEl.style.boxShadow = 'inset 0 1px 4px rgba(0,0,0,0.72), 0 0 22px rgba(255,124,72,0.36)';
  }
  _prevBossHp = next.hp;
  _bossId = next.identity;
}
export function hideBossBar() {
  if (_bossFlashTimer > 0) _bossFlashTimer = 0;
  _clearBossFlash();
  if (_bossBarEl) _bossBarEl.style.opacity = '0';
  _bossBarState = null;
  _prevBossHp = null;
  _bossId = '';
}

// v0.2.113 — live aim/target reticle state, driven each frame by
// targetReticle.js. One of: 'none' | 'close' | 'on' | 'headshot'.
//   close    → orange crosshair (a bot is near the line of fire)
//   on       → green crosshair (a body shot would land)
//   headshot → green crosshair + 👌 OK hand (a head shot would land)
// Diff-guarded so we only touch classes on a state change. The 'hit' flash and
// 'reloading' fade are independent classes and compose on top of these.
let _reticleState = 'none';
export function setReticleState(s) {
  if (s === _reticleState) return;
  _reticleState = s;
  elCross.classList.toggle('aim-close', s === 'close');
  elCross.classList.toggle('aim-on',    s === 'on');
  elCross.classList.toggle('aim-head',  s === 'headshot');
}

// Build the kill-feed entry with safe DOM construction (textContent, not
// innerHTML) so feed text can never be parsed as markup.
export function addKill(text, color = '#f7931a') {
  const d = document.createElement('div');
  d.className = 'kill-entry';
  const span = document.createElement('span');
  span.style.color = color;
  span.textContent = text;
  d.appendChild(span);
  elKillFeed.appendChild(d);
  while(elKillFeed.children.length>6) elKillFeed.removeChild(elKillFeed.firstChild);
  setTimeout(()=>d.remove(), 5000);
}

// ── Combat feel (ADR-0131) ──────────────────────────────────────────────────
// Hit marker (4 diagonal ticks round the crosshair), floating damage numbers and
// damage-direction arcs. Every element is created once, pooled, and animated
// from tickHUD(dt) — no timers, no per-hit DOM creation, writes only while live.
const MARKER_STYLE = {
  body:     { color: 'rgba(255,255,255,0.95)', len: 8,  gap: 7,  glow: 'rgba(255,255,255,0.5)' },
  head:     { color: '#ffd23f',                len: 10, gap: 8,  glow: 'rgba(255,210,63,0.9)' },
  kill:     { color: '#ff3b30',                len: 12, gap: 9,  glow: 'rgba(255,59,48,0.9)' },
  headkill: { color: '#ff3b30',                len: 15, gap: 10, glow: 'rgba(255,210,63,1)' },
  sticker:  { color: '#ff7ad9',                len: 7,  gap: 8,  glow: 'rgba(255,122,217,0.9)' }, // NAP (ADR-0132)
};
let _hm = null, _hmBars = null, _hmT = 0, _hmDur = 0, _hmKind = '', _hmTok = 0;
function _hmDom() {
  if (_hm) return _hm;
  _hm = document.createElement('div');
  _hm.id = 'gz-hitmarker';
  _hm.setAttribute('aria-hidden', 'true');
  Object.assign(_hm.style, { position: 'fixed', top: '50%', left: '50%', width: '0', height: '0', pointerEvents: 'none', zIndex: '51', opacity: '0' });
  _hmBars = [];
  for (let i = 0; i < 4; i++) {
    const b = document.createElement('div');
    Object.assign(b.style, { position: 'absolute', left: '0', top: '0', width: '2px', borderRadius: '1px', transformOrigin: '50% 0' });
    _hm.appendChild(b); _hmBars.push(b);
  }
  document.body.appendChild(_hm);
  return _hm;
}
function _hmStyle(kind, scale) {
  const st = MARKER_STYLE[kind] || MARKER_STYLE.body;
  for (let i = 0; i < 4; i++) {
    const b = _hmBars[i];
    b.style.height = st.len + 'px';
    b.style.background = st.color;
    b.style.boxShadow = '0 0 4px ' + st.glow;
    b.style.transform = `translate(-1px, 0) rotate(${45 + i * 90}deg) translateY(${(st.gap * scale).toFixed(1)}px)`;
  }
}
/** Show the hit marker now. Returns a token for voidHitMarker. */
export function showHitMarker(kind) {
  _hmDom();
  _hmKind = MARKER_STYLE[kind] ? kind : 'body';
  _hmDur = (MARKER_MS[_hmKind] || 160) / 1000;
  _hmT = _hmDur;
  _hmStyle(_hmKind, 1.35);
  _hm.style.opacity = '1';
  return ++_hmTok;
}
/** The authority rejected the shot behind marker `tok` — pull it fast. */
export function voidHitMarker(tok) {
  if (tok !== _hmTok || _hmT <= 0) return false;
  _hmT = Math.min(_hmT, MARKER_VOID_MS / 1000);
  _hmDur = MARKER_VOID_MS / 1000;
  return true;
}
function _tickMarker(dt) {
  if (_hmT <= 0) return;
  _hmT = Math.max(0, _hmT - dt);
  const k = _hmDur > 0 ? _hmT / _hmDur : 0;
  _hm.style.opacity = _hmT > 0 ? Math.min(1, k * 1.6).toFixed(3) : '0';
  _hmStyle(_hmKind, 1 + 0.35 * k); // snaps out wide, settles in
}

const POP_N = 6, POP_S = 0.65;
let _pops = null, _popNext = 0;
function _popDom() {
  if (_pops) return _pops;
  _pops = [];
  for (let i = 0; i < POP_N; i++) {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed', top: '50%', left: '50%', pointerEvents: 'none', zIndex: '51', opacity: '0',
      font: '800 15px/1 system-ui, sans-serif', letterSpacing: '0.5px', whiteSpace: 'nowrap',
      textShadow: '0 1px 0 #000, 0 0 6px rgba(0,0,0,0.9)', willChange: 'transform, opacity',
    });
    document.body.appendChild(el);
    _pops.push({ el, t: 0, dx: 0, rise: 0, tok: 0 });
  }
  return _pops;
}
let _popTok = 0;
/**
 * Floating text beside the crosshair: damage numbers ('9' gold for a headshot,
 * '3' white for a body hit) and the kill reward ('+5⚡'). Returns a token.
 */
export function popCombatText(text, kind = 'body') {
  const pops = _popDom();
  const p = pops[_popNext]; _popNext = (_popNext + 1) % POP_N;
  p.t = POP_S; p.tok = ++_popTok;
  p.dx = 16 + ((_popTok * 7) % 13);
  p.rise = kind === 'reward' ? 42 : 30;
  p.el.textContent = text;
  p.el.style.color = kind === 'head' ? '#ffd23f' : kind === 'reward' ? '#f7931a' : kind === 'kill' ? '#ff6a5a' : kind === 'sticker' ? '#ff7ad9' : '#ffffff';
  p.el.style.fontSize = kind === 'reward' ? '18px' : kind === 'head' ? '17px' : kind === 'sticker' ? '14px' : '15px';
  p.el.style.opacity = '1';
  p.el.style.transform = `translate(${p.dx}px, -18px)`;
  return p.tok;
}
/** Remove a predicted damage number the authority rejected. */
export function voidCombatText(tok) {
  if (!_pops) return false;
  for (const p of _pops) if (p.tok === tok && p.t > 0) { p.t = 0; p.el.style.opacity = '0'; return true; }
  return false;
}
function _tickPops(dt) {
  if (!_pops) return;
  for (const p of _pops) {
    if (p.t <= 0) continue;
    p.t = Math.max(0, p.t - dt);
    const x = 1 - p.t / POP_S; // 0 → 1
    const ease = 1 - (1 - x) * (1 - x);
    p.el.style.transform = `translate(${p.dx}px, ${(-18 - p.rise * ease).toFixed(1)}px) scale(${(1.25 - 0.25 * Math.min(1, x * 4)).toFixed(3)})`;
    p.el.style.opacity = p.t > 0 ? Math.min(1, (p.t / POP_S) * 2.2).toFixed(3) : '0';
  }
}

const ARC_N = 4, ARC_S = 0.9;
let _arcs = null, _arcNext = 0;
function _arcDom() {
  if (_arcs) return _arcs;
  _arcs = [];
  for (let i = 0; i < ARC_N; i++) {
    const el = document.createElement('div');
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'fixed', top: '50%', left: '50%', width: '86px', height: '12px', marginLeft: '-43px', marginTop: '-6px',
      pointerEvents: 'none', zIndex: '49', opacity: '0', borderRadius: '50% 50% 0 0 / 100% 100% 0 0',
      background: 'linear-gradient(180deg, rgba(255,40,30,0.95), rgba(255,40,30,0))',
      filter: 'drop-shadow(0 0 6px rgba(255,0,0,0.7))', willChange: 'transform, opacity',
    });
    document.body.appendChild(el);
    _arcs.push({ el, t: 0, k: 1 });
  }
  return _arcs;
}
/**
 * Damage-direction arc: points from the crosshair toward whoever hit you.
 * `angle` radians, 0 = ahead (top), +π/2 = right (feel.screenAngleTo).
 */
export function showDamageDir(angle, intensity = 1) {
  if (!Number.isFinite(angle)) return;
  const arcs = _arcDom();
  const a = arcs[_arcNext]; _arcNext = (_arcNext + 1) % ARC_N;
  a.t = ARC_S; a.k = Math.max(0.35, Math.min(1, intensity));
  a.el.style.transform = `rotate(${angle.toFixed(4)}rad) translateY(-120px)`;
  a.el.style.opacity = a.k.toFixed(3);
}
function _tickArcs(dt) {
  if (!_arcs) return;
  for (const a of _arcs) {
    if (a.t <= 0) continue;
    a.t = Math.max(0, a.t - dt);
    a.el.style.opacity = a.t > 0 ? (a.k * Math.min(1, (a.t / ARC_S) * 1.8)).toFixed(3) : '0';
  }
}

/** Hide every combat-feel element at once (leaving the arena / world swap). */
export function clearCombatFeel() {
  _hmT = 0; if (_hm) _hm.style.opacity = '0';
  if (_pops) for (const p of _pops) { p.t = 0; p.el.style.opacity = '0'; }
  if (_arcs) for (const a of _arcs) { a.t = 0; a.el.style.opacity = '0'; }
}

export function tickHUD(dt) {
  _tickMarker(dt); _tickPops(dt); _tickArcs(dt);
  if (_hitTimer>0)   { _hitTimer=Math.max(0,_hitTimer-dt);   if(_hitTimer<=0) elHitFlash.style.opacity='0'; }
  if (_crossTimer>0) { _crossTimer=Math.max(0,_crossTimer-dt); if(_crossTimer<=0) elCross.classList.remove('hit'); }
  if (_bossFlashTimer>0) {
    _bossFlashTimer = Math.max(0, _bossFlashTimer - dt);
    if (_bossFlashTimer <= 0) _clearBossFlash();
  }
}

// ── NAP Zone indicator ──────────────────────────────────────────
// Created lazily on first call so we don't need to edit index.html. Soft
// purple/teal pill at the top of the screen reading "☮ NAP ZONE — PEACE".
// Crossfades in/out via CSS opacity transition.
let _napEl = null;
let _napOn = false;
let _napHideTimer = 0;
// How long (ms) the "NAP ZONE — PEACE" pill stays visible on entry before it
// auto-fades. It announces arrival without lingering on screen the whole time
// you're in the zone. Re-entering (leave + come back) shows it again.
const NAP_INDICATOR_AUTOHIDE_MS = 4000;
function _napDom() {
  if (_napEl) return _napEl;
  _napEl = document.createElement('div');
  _napEl.id = 'nap-indicator';
  _napEl.textContent = '☮  NAP ZONE — PEACE  ☮';
  Object.assign(_napEl.style, {
    position:      'fixed',
    top:           '56px',
    left:          '50%',
    transform:     'translateX(-50%)',
    padding:       '10px 26px',
    background:    'linear-gradient(90deg, rgba(139,92,246,0.62), rgba(76,201,240,0.62))',
    border:        '1.5px solid rgba(200,232,255,0.75)',
    borderRadius:  '999px',
    color:         '#f4f9ff',
    fontFamily:    'monospace',
    fontSize:      '15px',
    letterSpacing: '2px',
    fontWeight:    'bold',
    textShadow:    '0 0 10px rgba(200,232,255,0.95), 0 1px 2px rgba(0,0,0,0.8)',
    boxShadow:     '0 0 28px rgba(139,92,246,0.6), 0 2px 8px rgba(0,0,0,0.45)',
    pointerEvents: 'none',
    opacity:       '0',
    transition:    'opacity 0.4s ease',
    zIndex:        '50',
  });
  document.body.appendChild(_napEl);
  return _napEl;
}
export function setNapMode(on) {
  if (on === _napOn) return;
  _napOn = on;
  if (on) {
    // Entered the NAP zone: show the pill, then auto-fade after a few seconds.
    if (_napHideTimer) clearTimeout(_napHideTimer);
    _napDom().style.opacity = '1';
    _napHideTimer = setTimeout(() => {
      _napHideTimer = 0;
      if (_napOn) _napDom().style.opacity = '0'; // still in zone → fade out
    }, NAP_INDICATOR_AUTOHIDE_MS);
  } else {
    // Left the zone: cancel any pending auto-hide and fade out now.
    if (_napHideTimer) { clearTimeout(_napHideTimer); _napHideTimer = 0; }
    _napDom().style.opacity = '0';
  }
}

// ── Gateway portal prompt ───────────────────────────────────────
// Created lazily (like the NAP indicator) so we don't need to edit index.html.
// A soft pill near the bottom-centre reading the interact hint (e.g.
// "Press F to travel"). Crossfades in/out via CSS opacity; pure display — it
// never reads input or navigates. Driven by the v0.2.181 portal trigger.
let _portalEl = null;
let _portalOn = false;
function _portalDom() {
  if (_portalEl) return _portalEl;
  _portalEl = document.createElement('div');
  _portalEl.id = 'portal-prompt';
  Object.assign(_portalEl.style, {
    position:      'fixed',
    top:           '88px',            // v0.2.263: higher up, centred (was bottom:90px)
    left:          '50%',
    transform:     'translateX(-50%)',
    padding:       '11px 30px',
    background:    'linear-gradient(90deg, rgba(76,201,240,0.80), rgba(139,92,246,0.80))',
    border:        '1.5px solid rgba(220,242,255,0.92)',
    borderRadius:  '999px',
    color:         '#ffffff',
    fontFamily:    'monospace',
    fontSize:      '16px',
    letterSpacing: '1.5px',
    fontWeight:    'bold',
    textShadow:    '0 0 12px rgba(255,255,255,0.95), 0 0 22px rgba(200,232,255,0.9), 0 1px 2px rgba(0,0,0,0.85)',
    boxShadow:     '0 0 34px rgba(139,92,246,0.75), 0 0 18px rgba(76,201,240,0.7), 0 2px 8px rgba(0,0,0,0.5)',
    pointerEvents: 'none',
    opacity:       '0',
    transition:    'opacity 0.35s ease',
    zIndex:        '50',
  });
  document.body.appendChild(_portalEl);
  return _portalEl;
}
let _portalHideTimer = 0;
export function showPortalPrompt(text = 'Press F to travel') {
  const el = _portalDom();
  el.textContent = text;
  if (_portalHideTimer) clearTimeout(_portalHideTimer);
  _portalOn = true;
  el.style.opacity = '1';
  // v0.2.263: announce the gateway prompt on entering range, then fade it after
  // a couple of seconds so it doesn't linger. Re-entering range shows it again.
  _portalHideTimer = setTimeout(() => {
    _portalHideTimer = 0;
    if (_portalOn) { _portalOn = false; el.style.opacity = '0'; }
  }, NOTICE_AUTOHIDE_MS);
}
export function hidePortalPrompt() {
  if (_portalHideTimer) { clearTimeout(_portalHideTimer); _portalHideTimer = 0; }
  if (!_portalOn) return;
  _portalOn = false;
  _portalDom().style.opacity = '0';
}

// ── Flight-mode toggle notice ───────────────────────────────────
// Centred, transient banner shown when fly mode is toggled (F key / ToriiDebug).
// Reads exactly "Flight Mode ON" / "Flight Mode OFF", holds for 1s, then fades.
// Rapid re-toggles reset the timer and replace the text (never stacks).
let _flyNoticeEl = null;
let _flyNoticeTimer = 0;
const FLY_NOTICE_MS = 1000;
function _flyNoticeDom() {
  if (_flyNoticeEl) return _flyNoticeEl;
  _flyNoticeEl = document.createElement('div');
  _flyNoticeEl.id = 'fly-notice';
  Object.assign(_flyNoticeEl.style, {
    position:      'fixed',
    top:           '50%',
    left:          '50%',
    transform:     'translate(-50%, -50%)',
    padding:       '14px 36px',
    background:    'rgba(0,0,0,0.55)',
    border:        '1.5px solid rgba(220,242,255,0.92)',
    borderRadius:  '999px',
    color:         '#ffffff',
    fontFamily:    'monospace',
    fontSize:      '22px',
    letterSpacing: '2px',
    fontWeight:    'bold',
    textShadow:    '0 0 12px rgba(255,255,255,0.95), 0 1px 2px rgba(0,0,0,0.85)',
    boxShadow:     '0 0 34px rgba(139,92,246,0.75), 0 2px 8px rgba(0,0,0,0.5)',
    pointerEvents: 'none',
    opacity:       '0',
    transition:    'opacity 0.35s ease',
    zIndex:        '60',
  });
  document.body.appendChild(_flyNoticeEl);
  return _flyNoticeEl;
}
export function showFlyNotice(text) {
  const el = _flyNoticeDom();
  el.textContent = text;
  if (_flyNoticeTimer) clearTimeout(_flyNoticeTimer);
  el.style.opacity = '1';
  _flyNoticeTimer = setTimeout(() => {
    _flyNoticeTimer = 0;
    el.style.opacity = '0';
  }, FLY_NOTICE_MS);
}

// Zone-route notice (v0.2.182) — an inert top banner shown when the app loads on a
// same-origin `/zone/<slug>` deep-link/refresh. Display-only: textContent (never
// innerHTML), pointerEvents none, opacity crossfade (no setTimeout). It announces
// the resolved zone (or an invalid-link notice) and never navigates or loads.
let _zoneEl = null;
let _zoneOn = false;
function _zoneDom() {
  if (_zoneEl) return _zoneEl;
  _zoneEl = document.createElement('div');
  _zoneEl.id = 'zone-notice';
  Object.assign(_zoneEl.style, {
    position:      'fixed',
    top:           '140px',
    left:          '50%',
    transform:     'translateX(-50%)',
    maxWidth:      '90vw',
    padding:       '9px 22px',
    background:    'linear-gradient(90deg, rgba(76,201,240,0.55), rgba(139,92,246,0.55))',
    border:        '1.5px solid rgba(200,232,255,0.72)',
    borderRadius:  '12px',
    color:         '#f4f9ff',
    fontFamily:    'monospace',
    fontSize:      '14px',
    lineHeight:    '1.4',
    textAlign:     'center',
    textShadow:    '0 0 10px rgba(200,232,255,0.9), 0 1px 2px rgba(0,0,0,0.8)',
    boxShadow:     '0 0 26px rgba(76,201,240,0.55), 0 2px 8px rgba(0,0,0,0.45)',
    pointerEvents: 'none',
    opacity:       '0',
    transition:    'opacity 0.3s ease',
    zIndex:        '60',
  });
  document.body.appendChild(_zoneEl);
  return _zoneEl;
}
// Per-user-action banner auto-hide: zone notices + the portal prompt announce
// something on a transition (zone link resolved, gateway entered, gateway in
// range) and should NOT linger — they fade out after this many ms so the screen
// stays clean. Re-triggering the same notice resets the timer and shows it again.
const NOTICE_AUTOHIDE_MS = 2000;
let _zoneHideTimer = 0;
export function showZoneNotice(text) {
  const el = _zoneDom();
  el.textContent = typeof text === 'string' ? text : ''; // textContent only — never parsed as markup
  if (_zoneHideTimer) clearTimeout(_zoneHideTimer);
  _zoneOn = true;
  el.style.opacity = '1';
  _zoneHideTimer = setTimeout(() => {
    _zoneHideTimer = 0;
    if (_zoneOn) { _zoneOn = false; el.style.opacity = '0'; }
  }, NOTICE_AUTOHIDE_MS);
}
export function hideZoneNotice() {
  if (_zoneHideTimer) { clearTimeout(_zoneHideTimer); _zoneHideTimer = 0; }
  if (!_zoneOn) return;
  _zoneOn = false;
  _zoneDom().style.opacity = '0';
}
