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
//
// Trust rules (by construction):
//   - Only messages whose event.source is THIS iframe's contentWindow AND whose
//     channelId is this mount's nonce are read (parseGateRequest checks the rest).
//   - gate.peek names a row by key; only rows the host sent can be peeked, and only
//     when the player is travel-capable.
//   - gate.enter travels only when a peek is armed AND the host marked it ready.
//   - Forwarded keys are a fixed movement/gaze set; Enter/Escape are intents.
//   - Display strings only cross the boundary (labels, short keys) — never relays,
//     endpoints or identities beyond what the directory already shows.

import { generateChannelId } from '../napplets/nappletSrcdoc.js';
import { GATE_NAPPLET_PATH, gateStateFor, gateRowKey, gateRowView, parseGateRequest, sanitizeGateTheme } from './gateNapplet.js';

export const GATEWAY_SCREEN_VERSION = 4;

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
let _theme = {};
let _previewCanvas = null;
let _previewBusy = false;

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
  _post('gate.peek', v ? { key: v.key || 'pre', label: v.label, ready: _peekReady } : { key: '' });
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
    case 'enter': _commit(); break;
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

function _commit() {
  if (!_open || !_peeking || !_peekReady) return; // 入 travels only on a READY peek
  const cb = _onCommit;
  if (typeof cb === 'function') { try { cb(); } catch { /* host commit is best-effort */ } }
}

function _clearPeek() {
  _peeking = null;
  _peekReady = false;
  _sendPeek();
}

// _armPeek(w) — highlight + "finding…" in the napplet, then the host's onPeek builds
// the mirror. 入 stays disabled until markGatewayPeekReady().
function _armPeek(w) {
  if (typeof _onPeek !== 'function') return;
  _peeking = w;
  _peekReady = false;
  _sendPeek();
  try { _onPeek(w); } catch { /* host peek is best-effort */ }
}

function _render(opts) {
  const { rows, state } = gateStateFor(opts);
  _rows = rows;
  _state = state;
  _post('gate.state', state);
}

export function openGatewayScreen({ mutualFriends = [], otherWorlds = [], scanStatus = 'idle', canTravel = false, onPeek = null, onCommit = null, onClose = null } = {}) {
  const el = _build();
  _onClose = onClose;
  _onPeek = onPeek;
  _onCommit = onCommit;
  _canTravel = !!canTravel;
  _peeking = null;
  _peekReady = false;
  _render({ mutualFriends, otherWorlds, scanStatus, canTravel: _canTravel });
  _sendPeek();
  _open = true;
  el.style.display = 'flex';
  // No auto-focus: the player stays PLAYING with a free cursor (v0.2.884).
}

// refreshGatewayScreen(...) — re-render the directory in place (owner names resolve
// after open). Keeps the current peek. No-op when closed.
export function refreshGatewayScreen({ mutualFriends = [], otherWorlds = [], scanStatus = 'idle', canTravel = null } = {}) {
  if (!_open) return;
  if (typeof canTravel === 'boolean') _canTravel = canTravel;
  _render({ mutualFriends, otherWorlds, scanStatus, canTravel: _canTravel });
  if (_peeking) _sendPeek();
}

export function closeGatewayScreen() { _close(); }
export function commitGatewayScreen() { _commit(); }
export function isGatewayScreenOpen() { return _open; }
export function getGatewayPreviewCanvas() { return _open && _peeking ? _previewCanvas : null; }
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
