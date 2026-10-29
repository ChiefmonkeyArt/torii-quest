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
const ACTIONS = new Set(['ready', 'peek', 'enter', 'stay', 'close', 'key', 'size']);
// v0.2.935 (ADR-0147 M3.3): how 入 travels for the peeked world.
//   enter — a Torii world Quest can build: walk through in place (no page load).
//   visit — another engine: hand off to its website (Gate v1), behind a host-tracked
//           confirm ("Leave Torii Quest for <host>?").
export const GATE_MODES = Object.freeze({ ENTER: 'enter', VISIT: 'visit' });
// Why a world is offered as a visit (napplet shows a fixed sentence per code).
export const GATE_NOTES = Object.freeze(['other-engine', 'enter-failed', 'visit-only']);
const HOSTNAME = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
/** A display hostname (lower-case, no port/path), or ''. */
export function gateHostLabel(url) {
  try { const h = new URL(url).hostname.toLowerCase(); return HOSTNAME.test(h) ? h : ''; } catch { return ''; }
}
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
export function gateStateFor({ mutualFriends = [], otherWorlds = [], scanStatus = 'idle', canTravel = false, isUnreachable = null } = {}) {
  const rows = new Map();
  // v0.2.937: rows with no way in go to one collapsed `unreachable` group — shown,
  // never clickable, never peekable (not in `rows`).
  const unreach = [];
  let unreachCount = 0;
  const cut = typeof isUnreachable === 'function' ? isUnreachable : () => false;
  const split = (list) => (Array.isArray(list) ? list : []).filter((w) => {
    if (!w || typeof w !== 'object') return true; // junk: `take` drops it, as before
    let u = false;
    try { u = !!cut(w); } catch { u = false; }
    if (!u) return true;
    unreachCount += 1;
    if (unreach.length < GATE_ROW_CAP) unreach.push({ ...gateRowView(w), key: '' });
    return false;
  });
  mutualFriends = split(mutualFriends);
  otherWorlds = split(otherWorlds);
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
      unreachable: { count: unreachCount, rows: unreach },
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
  if (action === 'enter') return { action, data: { confirm: d.confirm === true } };
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

// ── v0.2.935 (ADR-0147 M2): the arrival card ─────────────────────────────────────
// The same napplet, mounted non-interactive in `#m=arrival` mode, shows who you just
// arrived with and fades itself. Display strings only, capped.
export const GATE_ARRIVAL_KINDS = Object.freeze(['arrive', 'home']);
const clip = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, n) : '');
/** → the gate.arrival payload, or null for an unknown kind. */
export function gateArrivalFor({ kind = 'arrive', owner = '', world = '', npub = '' } = {}) {
  if (!GATE_ARRIVAL_KINDS.includes(kind)) return null;
  const n = clip(npub, 80);
  return { kind, owner: clip(owner, 80), world: clip(world, 80), npub: /^npub1[02-9ac-hj-np-z]{6,}$/.test(n) ? `${n.slice(0, 12)}…${n.slice(-6)}` : '' };
}
