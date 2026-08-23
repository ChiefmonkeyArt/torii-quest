// input.js — keyboard + mouse. Pure input, zero game logic.
import { state, isPlaying } from './state.js';

export const keys = {};
const _downCbs = [], _upCbs = [];

// ADR-0027 Kami Mode: while the ema note input is open, ALL game input is
// suppressed — not just keystrokes that happen to land on the textarea. Focus
// can slip to the overlay/body (a click on the modal, a tab, a pointer-lock
// edge) and a bare Space / E would still fire the jump onKeyDown callback, or a
// mousedown would fire a shot. This flag is the single source of truth the
// arena toggles; `keys` is never latched + downCbs never fire while it is set.
let _inputSuppressed = false;
export function setGameInputSuppressed(suppressed) {
  _inputSuppressed = suppressed;
  if (suppressed) clearKeys(); // drop any held movement keys carried into the modal
}

// v0.2.612: stuck-key guard ("sticky movement"). The browser SWALLOWS keyup
// events when the window loses focus, the tab hides, or a pointer-lock exit /
// extension prompt (NIP-07 signer) steals the gesture — a held W/A/S/D then
// stays latched true and the player keeps running after the key is released.
// Clear every held key on those transitions; the next real keydown re-latches.
export function clearKeys() { for (const k in keys) keys[k] = false; }
if (typeof window !== 'undefined') {
  window.addEventListener('blur', clearKeys);
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) clearKeys();
});

document.addEventListener('keydown', e => {
  // ADR-0025: Ctrl/Cmd-modified keys are APPLICATION shortcuts, not movement.
  // Two reasons to drop them here rather than at each call site:
  //   1. Collision. `KeyE` is a jump alias (player.js), so Kami Mode's Ctrl+E
  //      would both hang an ema AND make the player jump. Call sites receive
  //      only `e.code`, so they cannot tell a modified press from a bare one —
  //      this is the only layer that can.
  //   2. Stuck keys. Browser-level combos (Ctrl+R, Cmd+Tab) often swallow the
  //      matching keyup, which would latch the key true forever — the exact
  //      "sticky movement" class of bug the v0.2.612 guard above exists for.
  if (e.ctrlKey || e.metaKey) return;
  // ADR-0027: game input is suppressed while the Kami ema note is open — a
  // bare Space / E must not jump the player, no matter where focus landed.
  if (_inputSuppressed) return;
  // ADR-0027: a keystroke destined for any other focused text field (chat
  // input, login, etc.) belongs to the field, not the game — same Space/E leak.
  const _t = e.target;
  if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.tagName === 'SELECT' || _t.isContentEditable)) return;
  keys[e.code] = true;
  _downCbs.forEach(fn => fn(e.code));
});
document.addEventListener('keyup', e => {
  keys[e.code] = false;
  _upCbs.forEach(fn => fn(e.code));
});

export function onKeyDown(fn) { _downCbs.push(fn); }
export function onKeyUp(fn)   { _upCbs.push(fn);   }

// Mouse look
let _yaw = 0, _pitch = 0;
const SENS = 0.0018;
const _mouseCbs = [];

export function onMouseMove(fn) { _mouseCbs.push(fn); }

document.addEventListener('mousemove', e => {
  if (!state.pointerLocked) return;
  _yaw   -= e.movementX * SENS;
  _pitch -= e.movementY * SENS;
  _pitch  = Math.max(-Math.PI/2.1, Math.min(Math.PI/2.1, _pitch));
  _mouseCbs.forEach(fn => fn(_yaw, _pitch));
});

export function getYaw()   { return _yaw;   }
export function getPitch() { return _pitch; }
export function setYaw(y)  { _yaw = y;      }
export function setPitch(p) { _pitch = p;   } // DIAG v0.2.294: debug look-down for grass inspection

// Mouse click
const _clickCbs = [];
export function onShoot(fn) { _clickCbs.push(fn); }
document.addEventListener('mousedown', e => {
  if (_inputSuppressed) return; // ADR-0027: clicking the ema modal must not fire a shot
  if (e.button === 0 && isPlaying()) {
    _clickCbs.forEach(fn => fn());
  }
});

// Pointer lock — browser blocks re-acquire for ~1s after release
let _lockReleasedAt = 0;
const _LOCK_COOLDOWN = 1100; // ms — browser enforces ~1s, we add 100ms margin

export function requestLock(el) {
  const now = performance.now();
  if (now - _lockReleasedAt < _LOCK_COOLDOWN) return; // still in cooldown, skip silently
  el.requestPointerLock();
}

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement !== null;
  if (!locked) {
    _lockReleasedAt = performance.now();
    clearKeys(); // lock exit can eat keyups for held movement keys
  }
  state.pointerLocked = locked;
});
