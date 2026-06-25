// hud.js — ALL DOM updates live here. Nothing else touches the DOM.
import { state } from './state.js';
import { on, EV } from './events.js';

// DOM refs — cached once
const $ = id => document.getElementById(id);
const elSats    = $('sb-sats'), elKills = $('sb-kills'), elHp = $('sb-hp');
const elAmmo    = $('ammo-cur'), elHpFill = $('healthbar-fill');
const elHitFlash= $('hit-flash'), elDeathMsg = $('death-msg'), elCross = $('crosshair');
const elKillFeed= $('killfeed');

// Prev-value guards — skip DOM write if unchanged
let _ph=-1,_pk=-1,_pp=-1,_pa='',_ps=-1;
let _hitTimer=0, _crossTimer=0;

export function initHUD() {
  on(EV.HUD_UPDATE,    updateHUD);
  on(EV.BOT_KILLED,    d => { addKill('☠ NOSTRICH DOWN +5⚡', '#f7931a'); updateHUD(); });
  on(EV.PLAYER_HIT,    d => flashHit(d?.dmg || 25));
  on(EV.PLAYER_KILLED, () => { elDeathMsg.classList.add('show'); });
  on(EV.PLAYER_RESPAWN,() => { elDeathMsg.classList.remove('show'); });
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
}

// ── NAP Zone indicator ──────────────────────────────────────────
// Created lazily on first call so we don't need to edit index.html. Soft
// purple/teal pill at the top of the screen reading "☮ NAP ZONE — PEACE".
// Crossfades in/out via CSS opacity transition.
let _napEl = null;
let _napOn = false;
function _napDom() {
  if (_napEl) return _napEl;
  _napEl = document.createElement('div');
  _napEl.id = 'nap-indicator';
  _napEl.textContent = '☮  NAP ZONE — PEACE  ☮';
  Object.assign(_napEl.style, {
    position:      'fixed',
    top:           '14px',
    left:          '50%',
    transform:     'translateX(-50%)',
    padding:       '8px 22px',
    background:    'linear-gradient(90deg, rgba(139,92,246,0.35), rgba(76,201,240,0.35))',
    border:        '1px solid rgba(200,232,255,0.5)',
    borderRadius:  '999px',
    color:         '#e8f4ff',
    fontFamily:    'monospace',
    fontSize:      '13px',
    letterSpacing: '2px',
    fontWeight:    'bold',
    textShadow:    '0 0 8px rgba(200,232,255,0.7)',
    boxShadow:     '0 0 22px rgba(139,92,246,0.4)',
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
  _napDom().style.opacity = on ? '1' : '0';
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
    bottom:        '90px',
    left:          '50%',
    transform:     'translateX(-50%)',
    padding:       '9px 24px',
    background:    'linear-gradient(90deg, rgba(76,201,240,0.32), rgba(139,92,246,0.32))',
    border:        '1px solid rgba(200,232,255,0.55)',
    borderRadius:  '999px',
    color:         '#e8f4ff',
    fontFamily:    'monospace',
    fontSize:      '14px',
    letterSpacing: '1px',
    fontWeight:    'bold',
    textShadow:    '0 0 8px rgba(200,232,255,0.7)',
    boxShadow:     '0 0 22px rgba(76,201,240,0.4)',
    pointerEvents: 'none',
    opacity:       '0',
    transition:    'opacity 0.3s ease',
    zIndex:        '50',
  });
  document.body.appendChild(_portalEl);
  return _portalEl;
}
export function showPortalPrompt(text = 'Press F to travel') {
  const el = _portalDom();
  el.textContent = text;
  if (!_portalOn) { _portalOn = true; el.style.opacity = '1'; }
}
export function hidePortalPrompt() {
  if (!_portalOn) return;
  _portalOn = false;
  _portalDom().style.opacity = '0';
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
