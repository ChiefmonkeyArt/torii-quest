// engine/gateway/gateNapplet.js — host-side protocol for the gateway napplet
// (ADR-0147 M2, v0.2.934). PURE + node-safe: no DOM, no network.
//
// The doorway UI lives in conformance/gateway-v1/napplet/ (0BSD) and runs in a
// sandboxed iframe with no network. This module is the trusted half: it turns the
// host's directory into display-only rows, validates every napplet request, and
// sanitises the theme. Authority never crosses the boundary: a napplet can only
// name a row the host sent (`key`), and 入 only travels when the HOST says the
// peek is ready.

import { validateEnvelope } from '../napplets/nappletEnvelope.js';
import { worldDirectoryLabel } from './gatewayRead.js';

export const GATE_NS = 'gate';
export const GATE_NAPPLET_PATH = 'napplets/gateway/index.html';
export const GATE_ROW_CAP = 24;
const ACTIONS = new Set(['ready', 'peek', 'enter', 'close', 'key', 'size']);
// Keys a focused napplet may hand back to the game (movement + gaze). Enter and
// Escape are NOT forwarded: the napplet maps them to the `enter`/`close` intents.
export const GATE_FORWARD_KEYS = Object.freeze(new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
]));
export const GATE_THEME_KEYS = Object.freeze([
  '--gw-accent', '--gw-accent-2', '--gw-ink', '--gw-text', '--gw-soft', '--gw-muted', '--gw-dim', '--gw-live', '--gw-glass', '--gw-edge', '--gw-warn',
]);
const COLOUR = /^(#[0-9a-fA-F]{3,8}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\))$/;
const HEX64 = /^[0-9a-f]{64}$/;

/** world row → its stable napplet key (the owner pubkey), or ''. */
export function gateRowKey(w) {
  const k = w && (typeof w.pubkey === 'string' ? w.pubkey : '');
  return HEX64.test(k) ? k : '';
}

/** world row → { key, label, sub } — display strings only (no relays, no endpoints). */
export function gateRowView(w) {
  const key = gateRowKey(w);
  const sub = (w && typeof w.shortPubkey === 'string' && w.shortPubkey) || (key ? key.slice(0, 12) + '…' : '—');
  return { key, label: String(worldDirectoryLabel(w) || '—').slice(0, 80), sub: String(sub).slice(0, 80) };
}

/**
 * The host directory → { state, rows } where `state` is the gate.state payload and
 * `rows` maps key → the ORIGINAL world record (what a later gate.peek may name).
 */
export function gateStateFor({ mutualFriends = [], otherWorlds = [], scanStatus = 'idle', canTravel = false } = {}) {
  const rows = new Map();
  const take = (list) => {
    const out = [];
    for (const w of (Array.isArray(list) ? list : [])) {
      if (!w || typeof w !== 'object') continue;
      const v = gateRowView(w);
      if (v.key) rows.set(v.key, w);
      out.push(v);
      if (out.length >= GATE_ROW_CAP) break;
    }
    return out;
  };
  const friends = take(mutualFriends);
  const others = take(otherWorlds);
  const searching = scanStatus === 'scanning' && !friends.length && !others.length;
  return {
    rows,
    state: {
      searching,
      canTravel: !!canTravel,
      sections: [
        { title: 'mutual friends', count: Array.isArray(mutualFriends) ? mutualFriends.length : 0, empty: 'no mutual friends online', rows: friends },
        { title: 'all other worlds', count: Array.isArray(otherWorlds) ? otherWorlds.length : 0, empty: scanStatus === 'offline' ? 'login to see worlds' : 'no other worlds online', rows: others },
      ],
    },
  };
}

/**
 * A napplet message → { action, data } or null. Checks the envelope, the namespace,
 * the per-mount nonce and each action's payload. (Source identity — event.source ===
 * the iframe's contentWindow — is checked by the caller, before this.)
 */
export function parseGateRequest(msg, channelId) {
  if (!channelId || !msg || typeof msg !== 'object' || msg.channelId !== channelId) return null;
  const v = validateEnvelope(msg);
  if (!v.ok || !v.type.startsWith(GATE_NS + '.')) return null;
  const action = v.type.slice(GATE_NS.length + 1);
  if (!ACTIONS.has(action)) return null;
  const d = v.data;
  if (action === 'peek') return HEX64.test(d.key || '') ? { action, data: { key: d.key } } : null;
  if (action === 'key') {
    if ((d.type !== 'keydown' && d.type !== 'keyup') || !GATE_FORWARD_KEYS.has(d.code)) return null;
    return { action, data: { type: d.type, code: d.code } };
  }
  if (action === 'size') return Number.isFinite(d.h) && d.h > 0 ? { action, data: { h: Math.min(4000, Math.round(d.h)) } } : null;
  return { action, data: {} };
}

/** Theme vars → only known keys with colour values (a world restyles, never commands). */
export function sanitizeGateTheme(vars) {
  const out = {};
  if (!vars || typeof vars !== 'object') return out;
  for (const k of GATE_THEME_KEYS) {
    const v = vars[k];
    if (typeof v === 'string' && v.length <= 40 && COLOUR.test(v.trim())) out[k] = v.trim();
  }
  return out;
}
