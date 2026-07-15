// hud.js — ALL DOM updates live here. Nothing else touches the DOM.
import { state } from './state.js';
import { on, EV } from './events.js';
import { decideBossBarUpdate } from './bossBarState.js';

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
  on(EV.BOT_KILLED,    d => { addKill('☠ NOSTRICH DOWN +5⚡', '#f7931a'); updateHUD(); });
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

export function flashCross() { elCross.classList.add('hit'); _crossTimer = 0.12; }

function _bossBarDom() {
  if (_bossBarEl) return _bossBarEl;
  _bossBarEl = document.createElement('div');
  _bossBarEl.id = 'boss-hp-bar';
  Object.assign(_bossBarEl.style, {
    position: 'fixed',
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '520px',
    maxWidth: '90vw',
    padding: '10px 14px 12px',
    background: 'linear-gradient(180deg, rgba(30,7,8,0.92), rgba(12,4,5,0.84))',
    border: '1px solid rgba(255,120,88,0.52)',
    borderRadius: '14px',
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
    gap: '12px',
    marginBottom: '8px',
  });
  _bossBarNameEl = document.createElement('div');
  Object.assign(_bossBarNameEl.style, {
    color: '#ffd8c8',
    fontFamily: 'monospace',
    fontSize: '16px',
    fontWeight: 'bold',
    letterSpacing: '2.8px',
    textTransform: 'uppercase',
    textShadow: '0 0 12px rgba(255,124,96,0.72), 0 1px 2px rgba(0,0,0,0.82)',
    whiteSpace: 'nowrap',
  });
  _bossBarHpEl = document.createElement('div');
  Object.assign(_bossBarHpEl.style, {
    color: '#ffe7de',
    fontFamily: 'monospace',
    fontSize: '14px',
    fontWeight: 'bold',
    letterSpacing: '1.2px',
    textShadow: '0 0 10px rgba(255,140,112,0.42), 0 1px 2px rgba(0,0,0,0.82)',
    whiteSpace: 'nowrap',
  });
  head.appendChild(_bossBarNameEl);
  head.appendChild(_bossBarHpEl);
  _bossBarTrackEl = document.createElement('div');
  Object.assign(_bossBarTrackEl.style, {
    position: 'relative',
    height: '18px',
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
export function setBossBar({ id = null, name, hp, maxHp, alive } = {}) {
  const prevHp = _prevBossHp;
  const prevBossId = _bossId;
  const next = decideBossBarUpdate(_bossBarState, { id, name, hp, maxHp, alive });
  if (!next.visible) { hideBossBar(); return; }
  _bossBarState = next;
  if (!next.changed) {
    _prevBossHp = next.hp;
    _bossId = next.identity;
    return;
  }
  const el = _bossBarDom();
  _bossBarNameEl.textContent = next.name.toUpperCase();
  _bossBarHpEl.textContent = `${next.hp} / ${next.maxHp}`;
  _bossBarFillEl.style.transform = `scaleX(${next.pct})`;
  el.style.opacity = '1';
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

export function tickHUD(dt) {
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

// Minimap
const _mm = $('minimap')?.getContext('2d');
const MM  = 110;
export function drawMinimap(playerPos, bots) {
  if (!_mm) return;
  const wx = x => ((x+20)/40)*MM, wz = z => ((20-z)/40)*MM;
  _mm.fillStyle='rgba(10,10,20,0.85)'; _mm.fillRect(0,0,MM,MM);
  _mm.strokeStyle='rgba(139,92,246,0.5)'; _mm.lineWidth=1; _mm.strokeRect(3,3,MM-6,MM-6);
  _mm.fillStyle='#ff9933';
  bots.forEach(b => {
    if (!b.alive) return;
    _mm.beginPath(); _mm.arc(wx(b.mesh.position.x), wz(b.mesh.position.z), 2.5, 0, Math.PI*2); _mm.fill();
  });
  const px=wx(playerPos.x), pz=wz(playerPos.z);
  const g=_mm.createRadialGradient(px,pz,0,px,pz,8);
  g.addColorStop(0,'rgba(139,92,246,0.8)'); g.addColorStop(1,'rgba(139,92,246,0)');
  _mm.fillStyle=g; _mm.beginPath(); _mm.arc(px,pz,8,0,Math.PI*2); _mm.fill();
  _mm.fillStyle='#8b5cf6'; _mm.beginPath(); _mm.arc(px,pz,4,0,Math.PI*2); _mm.fill();
}
