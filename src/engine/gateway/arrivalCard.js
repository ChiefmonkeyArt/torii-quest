// engine/gateway/arrivalCard.js — the arrival card, drawn by the gateway napplet.
//
// ADR-0147 M2 (v0.2.935): after 入 lands you in another world (or Back brings you
// home) a short card says where you are. It is the SAME gateway napplet
// (conformance/gateway-v1/napplet/, 0BSD) mounted in `m=arrival` mode: sandboxed
// (`allow-scripts` only, no network), non-interactive (pointer-events none, never
// focused), wearing the doorway's theme. The napplet fades itself and says
// gate.close; the host then removes the frame. No timers here.
//
//   showArrivalCard({ kind: 'arrive'|'home', owner, world, npub }) → boolean
//   hideArrivalCard()

import { generateChannelId } from '../napplets/nappletSrcdoc.js';
import { GATE_NAPPLET_PATH, gateArrivalFor, parseGateRequest } from './gateNapplet.js';
import { getGatewayTheme } from './gatewayScreen.js';

let _frame = null;
let _cid = '';
let _payload = null;
let _listening = false;

function _baseUrl() {
  try { return (import.meta.env && import.meta.env.BASE_URL) || '/'; } catch { return '/'; }
}

function _post(type, data) {
  const w = _frame && _frame.contentWindow;
  if (!w || typeof w.postMessage !== 'function') return;
  try { w.postMessage({ type, channelId: _cid, data }, '*'); } catch { /* best-effort */ }
}

function _onMessage(ev) {
  if (!_frame || !ev || ev.source !== _frame.contentWindow) return;
  const req = parseGateRequest(ev.data, _cid);
  if (!req) return;
  if (req.action === 'ready') {
    _post('gate.theme', { vars: getGatewayTheme() });
    if (_payload) _post('gate.arrival', _payload);
  } else if (req.action === 'size') {
    _frame.style.height = `${Math.max(40, Math.min(200, req.data.h))}px`;
  } else if (req.action === 'close') {
    hideArrivalCard();
  }
  // Every other intent (peek / enter / key …) is ignored: the card has no authority.
}

export function hideArrivalCard() {
  if (_frame && _frame.parentNode && typeof _frame.parentNode.removeChild === 'function') _frame.parentNode.removeChild(_frame);
  _frame = null;
  _cid = '';
  _payload = null;
}

export function showArrivalCard(info) {
  const payload = gateArrivalFor(info);
  if (!payload || typeof document === 'undefined' || !document.body) return false;
  hideArrivalCard(); // one card at a time
  _payload = payload;
  _cid = generateChannelId();
  const f = document.createElement('iframe');
  f.setAttribute('sandbox', 'allow-scripts');
  f.setAttribute('title', 'Arrived');
  f.setAttribute('referrerpolicy', 'no-referrer');
  f.setAttribute('allow', '');
  f.setAttribute('tabindex', '-1');
  f.setAttribute('aria-hidden', 'true');
  f.setAttribute('data-napplet', 'torii-arrival');
  Object.assign(f.style, {
    position: 'fixed', top: '64px', left: '50%', transform: 'translateX(-50%)', zIndex: '60',
    width: 'min(520px, 92vw)', height: '96px', border: '0', background: 'transparent',
    colorScheme: 'normal', pointerEvents: 'none',
  });
  f.src = `${_baseUrl()}${GATE_NAPPLET_PATH}#c=${_cid}&m=arrival`;
  document.body.appendChild(f);
  _frame = f;
  if (!_listening && typeof window !== 'undefined') { window.addEventListener('message', _onMessage); _listening = true; }
  return true;
}

// Test seams.
export const _arrivalMessageForTest = (ev) => _onMessage(ev);
export const _arrivalStateForTest = () => ({ frame: _frame, cid: _cid, payload: _payload });
