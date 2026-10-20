// src/engine/input/touchControls.js — ADR-0137 on-screen thumb controls.
//
// Phones/tablets have no keyboard and no pointer lock, so Quest was
// look-locked and unwalkable on touch. This module overlays two thumb zones
// while the game is PLAYING:
//   • LEFT  — a floating joystick. Wherever the thumb lands becomes the stick
//             centre; sliding emulates W/A/S/D (8-way) via synthetic keyboard
//             events, so EVERY existing key consumer (player.js movement, any
//             onKeyDown/keyup listener) behaves exactly as on desktop.
//   • RIGHT — a look pad. Sliding turns/tilts the camera through
//             input.applyLookDelta (same yaw/pitch accumulator as mouse-look).
// Plus three buttons: JUMP (Space), FIRE (input.triggerShoot) and MENU
// (Escape → the normal pause overlay).
//
// Zero game logic lives here. The overlay sits at z-index 30: above the HUD
// (10/20) so it gets the touches, below in-world panels (40+), the pause
// overlay (60) and menus, so those stay tappable. Pointer Events with
// touch-action:none + preventDefault suppress the compatibility mousedown,
// so a look-pad tap can never also fire a click-shot.
//
// Enabled when the primary pointer is coarse (touch). `?touch=1` forces it on
// (desktop testing with devtools touch emulation), `?touch=0` forces it off.

export const JOY_RADIUS_PX = 56;   // knob travel; full deflection at this distance
export const JOY_DEAD_ZONE = 0.22; // fraction of radius ignored (thumb jitter)
export const LOOK_SENS     = 0.0058; // radians per CSS px of thumb travel
// sin(22.5°): a component above this fraction of the unit direction engages its
// key, giving clean 8-way sectors (pure forward stays pure forward).
const AXIS_ON = 0.3827;

const MOVE_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD'];

/** Pure: thumb offset (CSS px, +y = down) → the set of movement key codes held.
 *  Exported for tests. */
export function joystickKeys(dx, dy, radius = JOY_RADIUS_PX, dead = JOY_DEAD_ZONE) {
  const out = new Set();
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || radius <= 0) return out;
  const mag = Math.hypot(dx, dy);
  if (mag < radius * dead) return out;
  const nx = dx / mag, ny = dy / mag;
  if (ny < -AXIS_ON) out.add('KeyW');
  if (ny >  AXIS_ON) out.add('KeyS');
  if (nx < -AXIS_ON) out.add('KeyA');
  if (nx >  AXIS_ON) out.add('KeyD');
  return out;
}

/** Pure: clamp a thumb offset to the knob ring (for drawing the knob). */
export function clampKnob(dx, dy, radius = JOY_RADIUS_PX) {
  const mag = Math.hypot(dx, dy);
  if (!(mag > radius)) return { x: dx || 0, y: dy || 0 };
  return { x: (dx / mag) * radius, y: (dy / mag) * radius };
}

/** Pure: should the overlay install on this device? */
export function shouldEnableTouch(win = (typeof window !== 'undefined' ? window : undefined)) {
  if (!win) return false;
  try {
    const q = new URLSearchParams(win.location?.search || '').get('touch');
    if (q === '1') return true;
    if (q === '0') return false;
  } catch { /* ignore */ }
  try {
    if (win.matchMedia?.('(pointer: coarse)').matches) return true;
  } catch { /* ignore */ }
  return false;
}

const CSS = `
#torii-touch{position:fixed;inset:0;z-index:30;pointer-events:none;display:none;
  -webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
#torii-touch.on{display:block}
#torii-touch .tz{position:absolute;top:0;bottom:0;pointer-events:auto;touch-action:none}
#torii-touch .tz-move{left:0;width:45%}
#torii-touch .tz-look{right:0;width:55%}
#torii-touch .joy{position:absolute;width:${JOY_RADIUS_PX * 2}px;height:${JOY_RADIUS_PX * 2}px;
  margin:-${JOY_RADIUS_PX}px 0 0 -${JOY_RADIUS_PX}px;border-radius:50%;
  border:2px solid rgba(255,214,170,.45);background:rgba(20,13,9,.25);display:none}
#torii-touch .joy.on{display:block}
#torii-touch .knob{position:absolute;left:50%;top:50%;width:52px;height:52px;margin:-26px 0 0 -26px;
  border-radius:50%;background:rgba(255,170,90,.55);will-change:transform}
#torii-touch .hint{position:absolute;top:55%;transform:translateY(-50%);
  font:600 11px/1 system-ui,sans-serif;letter-spacing:3px;color:rgba(255,230,200,.4);
  pointer-events:none;transition:opacity .4s}
#torii-touch .hint.used{opacity:0}
#torii-touch .hint-move{left:calc(18% - 18px)}
#torii-touch .hint-look{left:calc(45% + 20%)}
#torii-touch .tb{position:absolute;pointer-events:auto;touch-action:none;border-radius:50%;
  border:2px solid rgba(255,214,170,.55);background:rgba(20,13,9,.45);color:#ffe6c8;
  font:700 11px/1 system-ui,sans-serif;letter-spacing:1px;display:flex;align-items:center;justify-content:center}
#torii-touch .tb.down{background:rgba(255,140,60,.6)}
#torii-touch .tb-fire{width:76px;height:76px;right:calc(22px + env(safe-area-inset-right));bottom:calc(96px + env(safe-area-inset-bottom))}
#torii-touch .tb-jump{width:64px;height:64px;right:calc(108px + env(safe-area-inset-right));bottom:calc(30px + env(safe-area-inset-bottom))}
#torii-touch .tb-menu{width:44px;height:44px;border-radius:12px;left:calc(14px + env(safe-area-inset-left));top:calc(58px + env(safe-area-inset-top))}
`;

function _key(type, code) {
  const key = code === 'Space' ? ' ' : code === 'Escape' ? 'Escape' : code.replace(/^Key/, '').toLowerCase();
  document.dispatchEvent(new KeyboardEvent(type, { code, key, bubbles: true, cancelable: true }));
}

/**
 * Install the overlay. Idempotent.
 * @param {object} o
 * @param {() => boolean} o.isActive  true while the overlay should show (PLAYING)
 * @param {(dYaw:number, dPitch:number) => void} o.look
 * @param {() => void} o.shoot
 * @returns {{ root: HTMLElement, destroy: () => void } | null}
 */
let _installed = null;
export function installTouchControls({ isActive, look, shoot }) {
  if (_installed) return _installed;
  if (typeof document === 'undefined') return null;

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'torii-touch';
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML =
    '<div class="tz tz-move"></div><div class="tz tz-look"></div>' +
    '<div class="joy"><div class="knob"></div></div>' +
    '<div class="hint hint-move">MOVE</div><div class="hint hint-look">LOOK</div>' +
    '<div class="tb tb-fire">FIRE</div><div class="tb tb-jump">JUMP</div><div class="tb tb-menu">II</div>';
  document.body.appendChild(root);

  const $ = s => root.querySelector(s);
  const zMove = $('.tz-move'), zLook = $('.tz-look'), joy = $('.joy'), knob = $('.knob');
  // Zone hints fade out after the first touch on that zone.
  zMove.addEventListener('pointerdown', () => $('.hint-move').classList.add('used'), { once: true });
  zLook.addEventListener('pointerdown', () => $('.hint-look').classList.add('used'), { once: true });

  // ── Movement joystick ─────────────────────────────────────────────────────
  let moveId = null, ox = 0, oy = 0;
  const held = new Set();
  function setHeld(next) {
    for (const c of MOVE_CODES) {
      if (next.has(c) && !held.has(c)) { held.add(c); _key('keydown', c); }
      else if (!next.has(c) && held.has(c)) { held.delete(c); _key('keyup', c); }
    }
  }
  function endMove() {
    moveId = null;
    joy.classList.remove('on');
    knob.style.transform = '';
    setHeld(new Set());
  }
  zMove.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (moveId !== null) return;
    moveId = e.pointerId; ox = e.clientX; oy = e.clientY;
    try { zMove.setPointerCapture(e.pointerId); } catch { /* noop */ }
    joy.style.left = ox + 'px'; joy.style.top = oy + 'px';
    joy.classList.add('on');
  });
  zMove.addEventListener('pointermove', e => {
    if (e.pointerId !== moveId) return;
    e.preventDefault();
    const dx = e.clientX - ox, dy = e.clientY - oy;
    const k = clampKnob(dx, dy);
    knob.style.transform = `translate(${k.x}px,${k.y}px)`;
    setHeld(joystickKeys(dx, dy));
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zMove.addEventListener(t, e => { if (e.pointerId === moveId) endMove(); });
  }

  // ── Look pad ──────────────────────────────────────────────────────────────
  let lookId = null, lx = 0, ly = 0;
  zLook.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (lookId !== null) return;
    lookId = e.pointerId; lx = e.clientX; ly = e.clientY;
    try { zLook.setPointerCapture(e.pointerId); } catch { /* noop */ }
  });
  zLook.addEventListener('pointermove', e => {
    if (e.pointerId !== lookId) return;
    e.preventDefault();
    const dx = e.clientX - lx, dy = e.clientY - ly;
    lx = e.clientX; ly = e.clientY;
    look(dx * LOOK_SENS, dy * LOOK_SENS);
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    zLook.addEventListener(t, e => { if (e.pointerId === lookId) lookId = null; });
  }

  // ── Buttons ───────────────────────────────────────────────────────────────
  function button(sel, onDown, onUp) {
    const el = $(sel);
    el.addEventListener('pointerdown', e => { e.preventDefault(); el.classList.add('down'); onDown(); });
    const up = e => { e.preventDefault(); if (!el.classList.contains('down')) return; el.classList.remove('down'); onUp?.(); };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
  }
  button('.tb-fire', () => shoot());
  button('.tb-jump', () => _key('keydown', 'Space'), () => _key('keyup', 'Space'));
  button('.tb-menu', () => _key('keydown', 'Escape'), () => _key('keyup', 'Escape'));

  // Block the long-press context menu / text selection on the overlay.
  root.addEventListener('contextmenu', e => e.preventDefault());

  // ── Visibility (cheap poll; no per-frame work) ────────────────────────────
  const crosshair = document.getElementById('crosshair');
  let shown = false;
  function sync() {
    const on = !!isActive();
    if (on === shown) return;
    shown = on;
    root.classList.toggle('on', on);
    if (on) crosshair?.classList.add('active');
    else {
      endMove(); lookId = null;
      if (!document.pointerLockElement) crosshair?.classList.remove('active');
    }
  }
  const timer = setInterval(sync, 150);
  sync();

  _installed = {
    root,
    destroy() {
      clearInterval(timer); endMove(); root.remove(); style.remove(); _installed = null;
    },
  };
  return _installed;
}
