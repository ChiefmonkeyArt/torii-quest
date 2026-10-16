// src/gamezone/core/protocol.js — Game Zone v2 wire shapes (ADR-0130).
//
// Three messages, additive on PROTOCOL_VERSION=1 (older peers drop them via the
// UNKNOWN_TYPE guard):
//   GZ_FIRE  C→S  {seq, origin:[3], dir:[3], rt, claim?:{k,id,zone,dist}}
//   GZ_SNAP  S→C  {tick, b:[[id,kind,x,y,z,yaw,hp,st,anim,sp], ...]}
//   GZ_EVENT S→C  {tick, ev:[event, ...]}  ('result' events only reach the shooter)
// Validators are strict: everything is bounded so a hostile client cannot make
// the authority allocate or loop. Node-pure.

export const GZ_MSG = Object.freeze({ FIRE: 'GZ_FIRE', SNAP: 'GZ_SNAP', EVENT: 'GZ_EVENT' });

const POS = 5000;
const fin = (n) => typeof n === 'number' && Number.isFinite(n);
const vec3 = (v, cap) => Array.isArray(v) && v.length === 3 && v.every((n) => fin(n) && Math.abs(n) <= cap);
const ZONES = new Set(['head', 'body']);
const EV_TYPES = new Set(['shot', 'hit', 'kill', 'spawn', 'respawn', 'result']);

export function validateFire(m) {
  if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 0x7fffffff) return 'seq';
  if (!vec3(m.origin, POS)) return 'origin';
  if (!vec3(m.dir, 2)) return 'dir';
  if (!fin(m.rt) || m.rt < 0 || m.rt > 1e9) return 'rt';
  if (m.claim != null) {
    const c = m.claim;
    if (typeof c !== 'object') return 'claim';
    if (c.k !== 'bot' && c.k !== 'player') return 'claim.k';
    if (c.k === 'bot' && !(Number.isInteger(c.id) && c.id >= 0 && c.id < 1000)) return 'claim.id';
    if (c.k === 'player' && !(typeof c.id === 'string' && c.id.length > 0 && c.id.length <= 32)) return 'claim.id';
    if (!ZONES.has(c.zone)) return 'claim.zone';
    if (!fin(c.dist) || c.dist < 0 || c.dist > 500) return 'claim.dist';
  }
  return null;
}

export function validateSnap(m) {
  if (!Number.isInteger(m.tick) || m.tick < 0) return 'tick';
  if (!Array.isArray(m.b) || m.b.length > 64) return 'b';
  for (const r of m.b) {
    if (!Array.isArray(r) || r.length !== 10) return 'b[row]';
    if (!r.every(fin)) return 'b[num]';
    if (!Number.isInteger(r[0]) || r[0] < 0 || r[0] > 999) return 'b[id]';
    if (Math.abs(r[2]) > POS || Math.abs(r[3]) > POS || Math.abs(r[4]) > POS) return 'b[pos]';
  }
  return null;
}

export function validateEvent(m) {
  if (!Number.isInteger(m.tick) || m.tick < 0) return 'tick';
  if (!Array.isArray(m.ev) || m.ev.length > 256) return 'ev';
  for (const e of m.ev) {
    if (!e || typeof e !== 'object' || !EV_TYPES.has(e.type)) return 'ev[type]';
  }
  return null;
}

/** Copy an event to its wire form (drops nothing semantic; strips undefined). */
export function eventForWire(e) {
  const o = {};
  for (const k in e) if (e[k] !== undefined) o[k] = e[k];
  return o;
}

/** Legacy BOT_STATE rows for spectators on older nodes (portal mirrors). */
const LEGACY_ANIM = ['idle', 'walk', 'walk', 'shoot', 'walk', 'walk', 'die'];
export function legacyBotRows(snap) {
  return snap.b.map((r) => ({
    id: r[0], x: r[2], z: r[4], rotY: r[5], hp: r[6], alive: r[7] === 0,
    animHint: r[7] === 0 ? (LEGACY_ANIM[r[8]] || 'walk') : 'die',
  }));
}
