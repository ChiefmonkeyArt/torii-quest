// engine/gateway/gatewayScreen.js — the in-world TORII GATEWAY, hosted as a napplet.
//
// ADR-0147 M2 (v0.2.934): the doorway UI (directory, peek, 入, ✕) moved into the
// gateway napplet (conformance/gateway-v1/napplet/, 0BSD), mounted here in an
// <iframe sandbox="allow-scripts"> — opaque origin, no network (its own CSP), no
// access to this page. This module is the TRUSTED HOST half and keeps the exported
// API the runtime already uses:
//
//   openGatewayScreen({ mutualFriends, otherWorlds, scanStatus, canTravel, onPeek, onCommit, onClose })
//   refreshGatewayScreen({ mutualFriends, otherWorlds, scanStatus, canTravel })
//   closeGatewayScreen()  commitGatewayScreen()  isGatewayScreenOpen()
//   getGatewayPreviewCanvas()   — a host-side canvas the runtime blits the mirror into
//   pushGatewayPreview()        — send that canvas to the napplet (transferable bitmap)
//   isGatewayCommitting()       — a peek is armed
//   markGatewayPeekReady()      — the host resolved the peek; 入 may travel now
//   peekGateWorld(world)        — pre-peek from outside (menu / world link hand-off)
//   setGatewayTheme(vars)       — restyle (validated colours only; no authority)
//   markGatewayPeekVisit({ host, note }) — v0.2.935 (M3.3): the peeked world is another
//                                 engine; 入 becomes "Visit site ↗" behind a HOST-tracked
//                                 confirm (first press asks, the confirm press travels)
//
// Trust rules (by construction):
//   - Only messages whose event.source is THIS iframe's contentWindow AND whose
//     channelId is this mount's nonce are read (parseGateRequest checks the rest).
//   - gate.peek names a row by key; only rows the host sent can be peeked, and only
//     when the player is travel-capable.
//   - gate.enter travels only when a peek is armed AND the host marked it ready.
//   - A visit (leaving Quest) needs two steps the HOST tracks: ask → confirm.
//   - Forwarded keys are a fixed movement/gaze set; Enter/Escape are intents.
//   - Display strings only cross the boundary (labels, short keys) — never relays,
//     endpoints or identities beyond what the directory already shows.

import { generateChannelId } from '../napplets/nappletSrcdoc.js';
import { GATE_NAPPLET_PATH, GATE_MODES, GATE_NOTES, gateStateFor, gateRowKey, gateRowView, parseGateRequest, sanitizeGateTheme } from './gateNapplet.js';
import { rowIsUnreachable } from './travelMode.js';

export const GATEWAY_SCREEN_VERSION = 5;

let _el = null;           // backdrop (click outside the card closes)
let _iframe = null;
let _cid = '';
let _ready = false;       // the napplet said gate.ready
let _open = false;
let _onClose = null;
let _onPeek = null;
let _onCommit = null;
let _canTravel = false;
let _rows = new Map();    // key → world record (what a gate.peek may name)
let _state = null;        // last gate.state payload
let _peeking = null;      // the world record currently peered at (or null)
let _peekReady = false;
let _mode = GATE_MODES.ENTER; // how 入 travels for the current peek (M3.3)
let _visitHost = '';
let _note = '';
let _confirming = false;      // a visit asked "leave for <host>?"; the next 入 goes
let _theme = {};
let _previewCanvas = null;
let _previewBusy = false;
// v0.2.937: owner key → expiry (ms) for worlds a lookup just found unreachable, and
// the last directory, so marking one re-renders without waiting for the host.
const UNREACHABLE_TTL_MS = 10 * 60 * 1000;
const _failed = new Map();
let _lastDir = null;
let _travelOpts = {};
let _now = () => Date.now();

function _baseUrl() {
  try { return (import.meta.env && import.meta.env.BASE_URL) || '/'; } catch { return '/'; }
}

function _post(type, data, transfer) {
  const w = _iframe && _iframe.contentWindow;
  if (!w || !_ready || typeof w.postMessage !== 'function') return false;
  try { w.postMessage({ type, channelId: _cid, data: data || {} }, '*', transfer || []); return true; } catch { return false; }
}

function _sendPeek() {
  const v = _peeking ? gateRowView(_peeking) : null;
  _post('gate.peek', v ? { key: v.key || 'pre', label: v.label, ready: _peekReady, mode: _mode, host: _visitHost, note: _note, confirm: _confirming } : { key: '' });
}

function _flush() {
  _post('gate.theme', { vars: _theme });
  if (_state) _post('gate.state', _state);
  _sendPeek();
}

function _onMessage(ev) {
  if (!_iframe || !ev || ev.source !== _iframe.contentWindow) return; // not our napplet
  const req = parseGateRequest(ev.data, _cid);
  if (!req) return;
  switch (req.action) {
    case 'ready': _ready = true; _flush(); break;
    case 'peek': {
      if (!_open || !_canTravel) return;
      const w = _rows.get(req.data.key);
      if (w) _armPeek(w);
      break;
    }
    case 'enter': _commit(req.data.confirm === true); break;
    case 'stay': if (_confirming) { _confirming = false; _sendPeek(); } break;
    case 'close': _close(); break;
    case 'key': {
      if (!_open || typeof document === 'undefined' || typeof KeyboardEvent !== 'function') return;
      try { document.dispatchEvent(new KeyboardEvent(req.data.type, { code: req.data.code, key: _keyFor(req.data.code), bubbles: true })); } catch { /* noop */ }
      break;
    }
    case 'size': {
      if (!_iframe) return;
      const max = typeof window !== 'undefined' && window.innerHeight ? Math.round(window.innerHeight * 0.46) : 400;
      _iframe.style.height = `${Math.max(60, Math.min(max, req.data.h))}px`;
      break;
    }
    default: break;
  }
}

function _keyFor(code) {
  if (code.startsWith('Key')) return code.slice(3).toLowerCase();
  if (code === 'Space') return ' ';
  if (code.startsWith('Shift')) return 'Shift';
  return code; // ArrowUp … — key === code
}

function _build() {
  if (_el) return _el;
  const backdrop = document.createElement('div');
  backdrop.id = 'gateway-screen';
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Torii gateway');
  Object.assign(backdrop.style, {
    position: 'fixed', inset: '0', zIndex: '70', display: 'none',
    // Bottom strip (v0.2.883): the gate and the world behind it stay unobstructed.
    alignItems: 'flex-end', justifyContent: 'center', padding: '0 0 22px', background: 'transparent',
  });
  _cid = generateChannelId();
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts'); // exactly: opaque origin, no popups/forms/navigation
  iframe.setAttribute('title', 'Torii gateway');
  iframe.setAttribute('referrerpolicy', 'no-referrer');
  iframe.setAttribute('allow', '');
  iframe.setAttribute('data-napplet', 'torii-gateway');
  Object.assign(iframe.style, {
    width: 'min(780px, 94vw)', height: '180px', border: '0', background: 'transparent', colorScheme: 'normal', display: 'block',
  });
  iframe.src = `${_baseUrl()}${GATE_NAPPLET_PATH}#c=${_cid}`;
  backdrop.appendChild(iframe);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) _close(); });
  document.body.appendChild(backdrop);
  if (typeof window !== 'undefined') window.addEventListener('message', _onMessage);
  _previewCanvas = document.createElement('canvas');
  _iframe = iframe;
  _el = backdrop;
  return backdrop;
}

function _close() {
  if (!_open) return;
  _open = false;
  if (_el) _el.style.display = 'none';
  const cb = _onClose;
  _onClose = null;
  _clearPeek();
  if (typeof cb === 'function') { try { cb(); } catch { /* host close is best-effort */ } }
}

function _commit(confirm) {
  if (!_open || !_peeking || !_peekReady) return; // 入 travels only on a READY peek
  if (_mode === GATE_MODES.VISIT) {
    // Leaving Quest: the first press only ASKS; the host remembers it asked, and only
    // a confirm while asking travels. A napplet cannot skip the question.
    if (!_confirming || !confirm) { _confirming = true; _sendPeek(); return; }
    _confirming = false;
  }
  const cb = _onCommit;
  if (typeof cb === 'function') { try { cb(); } catch { /* host commit is best-effort */ } }
}

function _resetMode() { _mode = GATE_MODES.ENTER; _visitHost = ''; _note = ''; _confirming = false; }

function _clearPeek() {
  _peeking = null;
  _peekReady = false;
  _resetMode();
  _sendPeek();
}

// _armPeek(w) — highlight + "finding…" in the napplet, then the host's onPeek builds
// the mirror. 入 stays disabled until markGatewayPeekReady().
function _armPeek(w) {
  if (typeof _onPeek !== 'function') return;
  _peeking = w;
  _peekReady = false;
  _resetMode();
  _sendPeek();
  try { _onPeek(w); } catch { /* host peek is best-effort */ }
}

function _failedNow() {
  const t = _now();
  for (const [k, exp] of _failed) if (exp <= t) _failed.delete(k);
  return new Set(_failed.keys());
}

function _render(opts) {
  _lastDir = opts;
  const failed = _failedNow();
  const { rows, state } = gateStateFor({ ...opts, isUnreachable: (w) => rowIsUnreachable(w, { ...(_travelOpts || {}), failed }) });
  _rows = rows;
  _state = state;
  _post('gate.state', state);
}

export function openGatewayScreen({ mutualFriends = [], otherWorlds = [], scanStatus = 'idle', canTravel = false, onPeek = null, onCommit = null, onClose = null, travelOpts = null } = {}) {
  const el = _build();
  if (travelOpts && typeof travelOpts === 'object') _travelOpts = travelOpts;
  _onClose = onClose;
  _onPeek = onPeek;
  _onCommit = onCommit;
  _canTravel = !!canTravel;
  _peeking = null;
  _peekReady = false;
  _resetMode();
  _render({ mutualFriends, otherWorlds, scanStatus, canTravel: _canTravel });
  _sendPeek();
  _open = true;
  el.style.display = 'flex';
  // No auto-focus: the player stays PLAYING with a free cursor (v0.2.884).
}

// refreshGatewayScreen(...) — re-render the directory in place (owner names resolve
// after open). Keeps the current peek. No-op when closed.
export function refreshGatewayScreen({ mutualFriends = [], otherWorlds = [], scanStatus = 'idle', canTravel = null, travelOpts = null } = {}) {
  if (!_open) return;
  if (travelOpts && typeof travelOpts === 'object') _travelOpts = travelOpts;
  if (typeof canTravel === 'boolean') _canTravel = canTravel;
  _render({ mutualFriends, otherWorlds, scanStatus, canTravel: _canTravel });
  if (_peeking) _sendPeek();
}

export function closeGatewayScreen() { _close(); }

/**
 * v0.2.937: a lookup found this world has no way in (no world description, no site).
 * Moves it into the collapsed `unreachable` group for 10 minutes (then it is tried
 * again) and drops the peek if it was the one being looked at. Returns true if shown.
 */
export function markGatewayRowUnreachable(key, { ttlMs = UNREACHABLE_TTL_MS } = {}) {
  if (!/^[0-9a-f]{64}$/.test(key || '')) return false;
  _failed.set(key, _now() + Math.max(1000, Math.min(UNREACHABLE_TTL_MS * 6, ttlMs | 0)));
  if (!_open) return false;
  if (_peeking && gateRowKey(_peeking) === key) _clearPeek();
  if (_lastDir) _render({ ..._lastDir, canTravel: _canTravel });
  return true;
}
/** Test seam: a fixed clock for the unreachable expiry. */
export function _setGatewayClockForTest(fn) { _now = typeof fn === 'function' ? fn : () => Date.now(); _failed.clear(); }
// Keyboard Enter: in visit mode the first press asks, a second press (while asking) goes.
export function commitGatewayScreen() { _commit(_confirming); }
export function isGatewayScreenOpen() { return _open; }
export function getGatewayPreviewCanvas() { return _open && _peeking && _mode === GATE_MODES.ENTER ? _previewCanvas : null; }
export function isGatewayCommitting() { return !!_peeking; }
/** The key of the row being peeked ('' when none) — a late resolve for another row is stale. */
export function gatewayPeekKey() { return _peeking ? gateRowKey(_peeking) : ''; }

/** The host resolved the current peek (the world is real and built): arm 入. */
export function markGatewayPeekReady() {
  if (!_open || !_peeking) return false;
  _peekReady = true;
  _sendPeek();
  return true;
}

/**
 * v0.2.935 (M3.3): the current peek is another engine (or could not be built here):
 * arm 入 as a VISIT to `host`. `note` ∈ GATE_NOTES says why. Returns false when closed,
 * not peeking or the host label is empty.
 */
export function markGatewayPeekVisit({ host = '', note = 'other-engine' } = {}) {
  if (!_open || !_peeking || typeof host !== 'string' || !host) return false;
  _mode = GATE_MODES.VISIT;
  _visitHost = host.slice(0, 253);
  _note = GATE_NOTES.includes(note) ? note : 'other-engine';
  _confirming = false;
  _peekReady = true;
  _sendPeek();
  return true;
}
/** 'enter' | 'visit' for the current peek ('' when none). */
export function gatewayPeekMode() { return _peeking ? _mode : ''; }
/** The validated theme (the arrival card wears the same colours). */
export function getGatewayTheme() { return { ..._theme }; }

/** Send the preview canvas to the napplet as a transferable bitmap (one in flight). */
export function pushGatewayPreview() {
  if (!_open || !_peeking || !_ready || _previewBusy || !_previewCanvas || !_previewCanvas.width) return;
  if (typeof createImageBitmap !== 'function') return;
  _previewBusy = true;
  createImageBitmap(_previewCanvas)
    .then((bitmap) => { if (!_post('gate.preview', { bitmap }, [bitmap]) && bitmap.close) bitmap.close(); })
    .catch(() => { /* preview is best-effort */ })
    .finally(() => { _previewBusy = false; });
}

/** Restyle the doorway (validated colour variables only). */
export function setGatewayTheme(vars) {
  _theme = sanitizeGateTheme(vars);
  _post('gate.theme', { vars: _theme });
  return { ..._theme };
}

// peekGateWorld(world) — pre-peek from OUTSIDE (menu / world-link hand-off). No-op
// when closed. The world needs an identity the host can resolve.
export function peekGateWorld(world) {
  if (!_open || !world) return;
  if (gateRowKey(world)) _rows.set(gateRowKey(world), world);
  _armPeek(world);
}

// Test seam: the message handler (tests drive it with fake events).
export const _gatewayNappletMessageForTest = (ev) => _onMessage(ev);
export const _gatewayChannelForTest = () => _cid;
