// wireProtocol.js — pure encode/decode + validation for MP-1 WebSocket messages.
// Node-pure (no THREE, no WebSocket, no DOM). Both client and server import this.
//
// See MP_1_SPEC.md §5 for the full message table.
//
// Design rules for MP-1:
//   - Every message: { t: <TYPE>, ...payload }. Short type strings save bytes.
//   - Validators reject:
//       * malformed JSON (throws from JSON.parse — caller decides)
//       * unknown t values
//       * missing/wrong-type required fields
//       * numeric fields outside sane ranges (position ±5000, angles ±π)
//   - decode() returns { ok:true, msg } or { ok:false, error, code }.
//   - encode() always produces a JSON string, throws for programmer errors.
//   - PROTOCOL_VERSION bumps only when a message shape changes in a
//     non-backwards-compatible way. MP-2 (server-authoritative) does NOT bump
//     it — the wire is identical, only server-side interpretation of HIT
//     changes.

export const PROTOCOL_VERSION = 1;

export const MSG = Object.freeze({
  HELLO:     'HELLO',
  AUTH:      'AUTH',
  // v0.2.375-alpha: bearer-token auth. Additive on PROTOCOL_VERSION=1 — the
  // client sends this INSTEAD of AUTH when it holds a server-issued session
  // token (login signed once via NIP-98), so arena entry / reconnect needs no
  // NIP-07 signature. NIP-42 AUTH remains the fallback.
  AUTH_TOKEN: 'AUTH_TOKEN',
  AUTH_FAIL: 'AUTH_FAIL',
  WELCOME:   'WELCOME',
  JOIN:      'JOIN',
  LEFT:      'LEFT',
  MOVE:      'MOVE',
  SHOT:      'SHOT',
  HIT:       'HIT',
  KILL:      'KILL',
  CHAT:      'CHAT',
  PING:      'PING',
  PONG:      'PONG',
  // MP-2 (v0.2.366-alpha): server-only, purely additive, PROTOCOL_VERSION unchanged.
  // MP-1 clients drop this via decode()'s UNKNOWN_TYPE guard (harmless).
  RESPAWN:   'RESPAWN',
  // MP-3 (v0.2.366-alpha): server→all-peers, purely additive.
  // Delivered on match-end or peer disconnect; carries session-final tallies
  // so each peer can client-sign their own Nostr kind:30078 leaderboard event.
  SCORE:     'SCORE',
  // Bot milestone chunk 2 (v0.2.379-alpha): server-authoritative bots. All four
  // are server→all-peers, purely additive on PROTOCOL_VERSION=1 (older clients
  // drop them via decode()'s UNKNOWN_TYPE guard).
  //   BOT_STATE — throttled ~15Hz continuous roster {id,x,z,rotY,hp,alive,animHint}
  //   BOT_SHOT  — immediate tracer cue {origin,dir} for a bot's shot
  //   BOT_HIT   — immediate {botId,dmg,zone,hp} when a player's shot hits a bot
  //   BOT_KILL  — immediate {botId,shooterId} when a bot dies
  BOT_STATE: 'BOT_STATE',
  BOT_SHOT:  'BOT_SHOT',
  BOT_HIT:   'BOT_HIT',
  BOT_KILL:  'BOT_KILL',
});

// Animation hint labels a bot state may carry (mirrors botSim _animHint).
const BOT_ANIM_HINTS = new Set(['walk', 'idle', 'shoot', 'hit', 'die']);

const MSG_TYPES = new Set(Object.values(MSG));

// Sanity clamps — used to reject nonsense before broadcast.
export const LIMITS = Object.freeze({
  POS_ABS:      5000,        // metres from origin
  ROT_ABS:      Math.PI * 2, // radians, allows unwrapped yaw
  VEL_ABS:      200,         // m/s cap
  CHAT_LEN:     280,
  NPUB_LEN:     72,          // "npub1" + 63 chars max in practice
  ID_LEN:       32,
  CHALLENGE_LEN:88,          // base64 of 32 bytes = 44, allow room to spare
  TOKEN_LEN:    128,         // opaque session token, hex (32 bytes = 64), room to spare
  SIG_HEX_LEN:  128,         // schnorr sig, hex
  ZONES:        Object.freeze(['head', 'body', 'limb']),
});

// ---------- helpers ----------

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isStr = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max;

const isVec3 = (v, absCap) =>
  Array.isArray(v) && v.length === 3 &&
  v.every((n) => isFiniteNum(n) && Math.abs(n) <= absCap);

const isRot2 = (v) =>
  Array.isArray(v) && v.length === 2 &&
  v.every((n) => isFiniteNum(n) && Math.abs(n) <= LIMITS.ROT_ABS);

const fail = (code, error) => ({ ok: false, code, error });
const ok   = (msg) => ({ ok: true, msg });

// ---------- validators (per message type) ----------

const validators = {
  [MSG.HELLO](m) {
    if (!isStr(m.challenge, LIMITS.CHALLENGE_LEN)) return fail('BAD_FIELD', 'challenge');
    if (!isStr(m.serverVersion, 32))               return fail('BAD_FIELD', 'serverVersion');
    if (m.protocolVersion !== PROTOCOL_VERSION)    return fail('BAD_VERSION', 'protocolVersion');
    return ok(m);
  },
  [MSG.AUTH](m) {
    if (!isStr(m.npub, LIMITS.NPUB_LEN))           return fail('BAD_FIELD', 'npub');
    if (!isStr(m.sig, LIMITS.SIG_HEX_LEN))         return fail('BAD_FIELD', 'sig');
    if (typeof m.event !== 'object' || m.event === null) return fail('BAD_FIELD', 'event');
    // Full nostr-event verification happens on the server via nostr-tools;
    // wire-level only asserts shape.
    return ok(m);
  },
  [MSG.AUTH_TOKEN](m) {
    if (!isStr(m.token, LIMITS.TOKEN_LEN)) return fail('BAD_FIELD', 'token');
    return ok(m);
  },
  [MSG.AUTH_FAIL](m) {
    if (!isStr(m.reason, 120)) return fail('BAD_FIELD', 'reason');
    return ok(m);
  },
  [MSG.WELCOME](m) {
    if (!isStr(m.selfId, LIMITS.ID_LEN))    return fail('BAD_FIELD', 'selfId');
    if (!Array.isArray(m.roster))           return fail('BAD_FIELD', 'roster');
    for (const p of m.roster) {
      if (!isStr(p.id, LIMITS.ID_LEN))      return fail('BAD_ROSTER', 'id');
      if (!isStr(p.npub, LIMITS.NPUB_LEN))  return fail('BAD_ROSTER', 'npub');
      if (!isVec3(p.pos, LIMITS.POS_ABS))   return fail('BAD_ROSTER', 'pos');
      if (!isRot2(p.rot))                   return fail('BAD_ROSTER', 'rot');
      if (!isStr(p.character, 64))          return fail('BAD_ROSTER', 'character');
    }
    return ok(m);
  },
  [MSG.JOIN](m) {
    if (!isStr(m.id, LIMITS.ID_LEN))       return fail('BAD_FIELD', 'id');
    if (!isStr(m.npub, LIMITS.NPUB_LEN))   return fail('BAD_FIELD', 'npub');
    if (!isVec3(m.pos, LIMITS.POS_ABS))    return fail('BAD_FIELD', 'pos');
    if (!isRot2(m.rot))                    return fail('BAD_FIELD', 'rot');
    if (!isStr(m.character, 64))           return fail('BAD_FIELD', 'character');
    return ok(m);
  },
  [MSG.LEFT](m) {
    if (!isStr(m.id, LIMITS.ID_LEN))    return fail('BAD_FIELD', 'id');
    if (!isStr(m.reason, 64))           return fail('BAD_FIELD', 'reason');
    return ok(m);
  },
  [MSG.MOVE](m) {
    if (!isVec3(m.pos, LIMITS.POS_ABS)) return fail('BAD_FIELD', 'pos');
    if (!isRot2(m.rot))                 return fail('BAD_FIELD', 'rot');
    if (!isVec3(m.vel, LIMITS.VEL_ABS)) return fail('BAD_FIELD', 'vel');
    // Server stamps `id` on rebroadcast; client-outbound MOVE omits id.
    if (m.id !== undefined && !isStr(m.id, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'id');
    return ok(m);
  },
  [MSG.SHOT](m) {
    if (!isVec3(m.origin, LIMITS.POS_ABS)) return fail('BAD_FIELD', 'origin');
    if (!isVec3(m.dir,    2))              return fail('BAD_FIELD', 'dir');
    if (!isFiniteNum(m.ts))                return fail('BAD_FIELD', 'ts');
    // v0.2.392 hit-reg: optional, additive (no PROTOCOL_VERSION bump). When
    // present it is the client's view-lag (ms); the server rewinds by it in its
    // own clock frame. Legacy clients omit it. Rejected only if malformed.
    if (m.viewLag !== undefined && (!isFiniteNum(m.viewLag) || m.viewLag < 0)) {
      return fail('BAD_FIELD', 'viewLag');
    }
    if (m.id !== undefined && !isStr(m.id, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'id');
    return ok(m);
  },
  [MSG.HIT](m) {
    if (!isStr(m.targetId, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'targetId');
    if (!isFiniteNum(m.dmg) || m.dmg <= 0 || m.dmg > 999) return fail('BAD_FIELD', 'dmg');
    if (!LIMITS.ZONES.includes(m.zone))    return fail('BAD_FIELD', 'zone');
    if (!isFiniteNum(m.shotTs))            return fail('BAD_FIELD', 'shotTs');
    if (m.id !== undefined && !isStr(m.id, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'id');
    return ok(m);
  },
  [MSG.KILL](m) {
    if (!isStr(m.shooterId, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'shooterId');
    if (!isStr(m.victimId,  LIMITS.ID_LEN)) return fail('BAD_FIELD', 'victimId');
    if (!isStr(m.weapon, 32))               return fail('BAD_FIELD', 'weapon');
    return ok(m);
  },
  [MSG.CHAT](m) {
    if (!isStr(m.msg, LIMITS.CHAT_LEN))     return fail('BAD_FIELD', 'msg');
    if (m.id !== undefined && !isStr(m.id, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'id');
    return ok(m);
  },
  [MSG.PING](m) {
    if (!isFiniteNum(m.ts)) return fail('BAD_FIELD', 'ts');
    return ok(m);
  },
  [MSG.PONG](m) {
    if (!isFiniteNum(m.ts)) return fail('BAD_FIELD', 'ts');
    return ok(m);
  },
  [MSG.RESPAWN](m) {
    if (!isVec3(m.pos, LIMITS.POS_ABS)) return fail('BAD_FIELD', 'pos');
    if (!isRot2(m.rot))                 return fail('BAD_FIELD', 'rot');
    if (!isFiniteNum(m.hp) || m.hp < 0 || m.hp > 9999) return fail('BAD_FIELD', 'hp');
    return ok(m);
  },
  [MSG.SCORE](m) {
    if (typeof m.sessionId !== 'string' || !/^[0-9a-f]{16}$/.test(m.sessionId)) {
      return fail('BAD_FIELD', 'sessionId');
    }
    if (!isFiniteNum(m.endedAt) || m.endedAt < 0) return fail('BAD_FIELD', 'endedAt');
    if (!Array.isArray(m.tallies) || m.tallies.length < 1 || m.tallies.length > 32) {
      return fail('BAD_FIELD', 'tallies');
    }
    for (const row of m.tallies) {
      if (!row || typeof row !== 'object')                      return fail('BAD_FIELD', 'tallies[row]');
      if (typeof row.id !== 'string' || row.id.length < 1 || row.id.length > 32) return fail('BAD_FIELD', 'tallies[id]');
      if (typeof row.npub !== 'string' || !/^[0-9a-f]{64}$/.test(row.npub))     return fail('BAD_FIELD', 'tallies[npub]');
      if (!Number.isInteger(row.kills)  || row.kills  < 0 || row.kills  > 1e6)   return fail('BAD_FIELD', 'tallies[kills]');
      if (!Number.isInteger(row.deaths) || row.deaths < 0 || row.deaths > 1e6)   return fail('BAD_FIELD', 'tallies[deaths]');
      if (!Number.isInteger(row.damage) || row.damage < 0 || row.damage > 1e6)   return fail('BAD_FIELD', 'tallies[damage]');
    }
    return ok(m);
  },
  [MSG.BOT_STATE](m) {
    if (!Array.isArray(m.bots) || m.bots.length > 64) return fail('BAD_FIELD', 'bots');
    for (const b of m.bots) {
      if (!b || typeof b !== 'object')                         return fail('BAD_FIELD', 'bots[row]');
      if (!Number.isInteger(b.id) || b.id < 0 || b.id > 999)   return fail('BAD_FIELD', 'bots[id]');
      if (!isFiniteNum(b.x) || Math.abs(b.x) > LIMITS.POS_ABS)  return fail('BAD_FIELD', 'bots[x]');
      if (!isFiniteNum(b.z) || Math.abs(b.z) > LIMITS.POS_ABS)  return fail('BAD_FIELD', 'bots[z]');
      if (!isFiniteNum(b.rotY) || Math.abs(b.rotY) > LIMITS.ROT_ABS) return fail('BAD_FIELD', 'bots[rotY]');
      if (!isFiniteNum(b.hp) || b.hp < 0 || b.hp > 9999)        return fail('BAD_FIELD', 'bots[hp]');
      if (typeof b.alive !== 'boolean')                        return fail('BAD_FIELD', 'bots[alive]');
      if (!BOT_ANIM_HINTS.has(b.animHint))                     return fail('BAD_FIELD', 'bots[animHint]');
    }
    return ok(m);
  },
  [MSG.BOT_SHOT](m) {
    if (!isVec3(m.origin, LIMITS.POS_ABS)) return fail('BAD_FIELD', 'origin');
    if (!isVec3(m.dir, 2))                 return fail('BAD_FIELD', 'dir');
    if (m.botId !== undefined && (!Number.isInteger(m.botId) || m.botId < 0 || m.botId > 999)) {
      return fail('BAD_FIELD', 'botId');
    }
    return ok(m);
  },
  [MSG.BOT_HIT](m) {
    if (!Number.isInteger(m.botId) || m.botId < 0 || m.botId > 999) return fail('BAD_FIELD', 'botId');
    if (!isFiniteNum(m.dmg) || m.dmg <= 0 || m.dmg > 999)          return fail('BAD_FIELD', 'dmg');
    if (!LIMITS.ZONES.includes(m.zone))                            return fail('BAD_FIELD', 'zone');
    if (!isFiniteNum(m.hp) || m.hp < 0 || m.hp > 9999)             return fail('BAD_FIELD', 'hp');
    if (m.shooterId !== undefined && !isStr(m.shooterId, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'shooterId');
    return ok(m);
  },
  [MSG.BOT_KILL](m) {
    if (!Number.isInteger(m.botId) || m.botId < 0 || m.botId > 999) return fail('BAD_FIELD', 'botId');
    if (m.shooterId !== undefined && !isStr(m.shooterId, LIMITS.ID_LEN)) return fail('BAD_FIELD', 'shooterId');
    return ok(m);
  },
};

// ---------- public API ----------

/** Encode a message object to a JSON string. Throws on programmer error. */
export function encode(msg) {
  if (!msg || typeof msg !== 'object') {
    throw new TypeError('wireProtocol.encode: msg must be an object');
  }
  if (!MSG_TYPES.has(msg.t)) {
    throw new TypeError(`wireProtocol.encode: unknown t=${msg.t}`);
  }
  return JSON.stringify(msg);
}

/** Decode a raw string (or already-parsed object) into { ok, msg | error, code }.
 *  Never throws. Untrusted-input safe. */
export function decode(raw) {
  let m;
  if (typeof raw === 'string') {
    try { m = JSON.parse(raw); }
    catch { return fail('BAD_JSON', 'invalid JSON'); }
  } else if (raw && typeof raw === 'object') {
    m = raw;
  } else {
    return fail('BAD_INPUT', 'expected string or object');
  }
  if (!m || typeof m !== 'object') return fail('BAD_INPUT', 'not an object');
  if (typeof m.t !== 'string')     return fail('BAD_TYPE', 'missing t');
  if (!MSG_TYPES.has(m.t))         return fail('UNKNOWN_TYPE', `unknown t=${m.t}`);
  return validators[m.t](m);
}

/** Sanitise a validated message before rebroadcast — strips any keys not on
 *  the known field set for that type. Prevents client-injected fields from
 *  reaching other peers. */
export function sanitize(msg) {
  const allow = ALLOWED_FIELDS[msg.t];
  if (!allow) return msg;
  const out = { t: msg.t };
  for (const k of allow) if (msg[k] !== undefined) out[k] = msg[k];
  return out;
}

const ALLOWED_FIELDS = Object.freeze({
  [MSG.HELLO]:     ['challenge', 'serverVersion', 'protocolVersion'],
  [MSG.AUTH]:      ['npub', 'sig', 'event'],
  [MSG.AUTH_TOKEN]:['token'],
  [MSG.AUTH_FAIL]: ['reason'],
  [MSG.WELCOME]:   ['selfId', 'roster'],
  [MSG.JOIN]:      ['id', 'npub', 'pos', 'rot', 'character'],
  [MSG.LEFT]:      ['id', 'reason'],
  [MSG.MOVE]:      ['id', 'pos', 'rot', 'vel'],
  [MSG.SHOT]:      ['id', 'origin', 'dir', 'ts', 'viewLag'],
  [MSG.HIT]:       ['id', 'targetId', 'dmg', 'zone', 'shotTs'],
  [MSG.KILL]:      ['shooterId', 'victimId', 'weapon'],
  [MSG.CHAT]:      ['id', 'msg'],
  [MSG.PING]:      ['ts'],
  [MSG.PONG]:      ['ts'],
  [MSG.RESPAWN]:   ['pos', 'rot', 'hp'],
  [MSG.SCORE]:     ['sessionId', 'endedAt', 'tallies'],
  [MSG.BOT_STATE]: ['bots'],
  [MSG.BOT_SHOT]:  ['origin', 'dir', 'botId'],
  [MSG.BOT_HIT]:   ['botId', 'dmg', 'zone', 'hp', 'shooterId'],
  [MSG.BOT_KILL]:  ['botId', 'shooterId'],
});

/** Is this a known message type? */
export function isKnownType(t) { return MSG_TYPES.has(t); }
