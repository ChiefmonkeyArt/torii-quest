// server/arena-ws.js — MP-1 arena WebSocket server (advisory hit detection).
//
// Runs on the operator's VPS behind Caddy reverse-proxy on the same domain
// (wss://<their-domain>/mp → 127.0.0.1:8787). See VPS_INSTALL.md.
//
// Responsibilities:
//   * NIP-01 challenge/response auth (kind:22242 event over server-issued nonce)
//   * Presence: JOIN / LEFT / MOVE fan-out
//   * Advisory combat relay: SHOT / HIT / KILL untouched
//   * Chat relay (rate-limited)
//   * PING/PONG keepalive; 60s idle disconnect
//   * Per-message wire validation via wireProtocol.js (shared with the client)
//
// Explicitly NOT in this file (see MP_1_SPEC.md §2/§3):
//   * Server-side hit computation (that's MP-2)
//   * Rooms / matchmaking (that's MP-1.5+)
//   * Persistence, metrics, admin console
//
// Design constraints from the strategy doc:
//   * No new setTimeout in the browser code path (this file is server-only, so allowed)
//   * No new global mutable state; per-connection state lives on the ws instance
//   * Config only via env vars — never a JSON/YAML file
//   * Sanitize-on-broadcast: only whitelisted fields ever leave this box
//
// Run: node server/arena-ws.js
// Env: PORT (default 8787), MAX_PEERS (default 32), LOG_LEVEL (default 'info')

import { WebSocketServer } from 'ws';
import { randomBytes } from 'crypto';

import {
  MSG, PROTOCOL_VERSION, LIMITS,
  decode, encode, sanitize,
} from '../src/engine/multiplayer/wireProtocol.js';
import { verifyNostrEventSig } from '../src/engine/crypto/nostrSig.js';

// ---------- config ----------

const PORT       = Number(process.env.PORT || 8787);
const MAX_PEERS  = Number(process.env.MAX_PEERS || 32);
const LOG_LEVEL  = process.env.LOG_LEVEL || 'info';
const SERVER_VERSION = process.env.SERVER_VERSION || 'v0.2.363-alpha';

// Per-session rate limits (msg / sec).
const RATE = Object.freeze({
  MOVE: 25,
  SHOT: 20,
  HIT:  20,
  CHAT: 1,
});

const IDLE_DISCONNECT_MS = 60_000;
const AUTH_TIMEOUT_MS    = 10_000;
const CHALLENGE_TTL_MS   = 60_000; // an AUTH event's created_at must be within this window

// ---------- server state ----------

/**
 * Session state per connected socket. Never leaves the process.
 * @typedef {{
 *   id: string, ws: import('ws').WebSocket,
 *   npub: string | null, pubkey: string | null,
 *   challenge: string, authed: boolean,
 *   pos: [number,number,number], rot: [number,number], character: string,
 *   lastActivity: number,
 *   rate: Record<string, {count:number, resetAt:number}>,
 * }} Session
 */
/** @type {Map<string, Session>} */
const sessions = new Map();

// ---------- logging ----------

const log = {
  info:  (...a) => LOG_LEVEL !== 'error' && console.log('[arena-ws]', ...a),
  warn:  (...a) => console.warn('[arena-ws]', ...a),
  error: (...a) => console.error('[arena-ws]', ...a),
};

// ---------- helpers ----------

function newSessionId() { return randomBytes(12).toString('hex'); }
function newChallenge() { return randomBytes(32).toString('base64'); }

function checkRate(sess, key, limitPerSec) {
  const now = Date.now();
  const slot = sess.rate[key] || { count: 0, resetAt: now + 1000 };
  if (now >= slot.resetAt) { slot.count = 0; slot.resetAt = now + 1000; }
  slot.count++;
  sess.rate[key] = slot;
  return slot.count <= limitPerSec;
}

function sendTo(sess, msg) {
  try { sess.ws.send(encode(msg)); }
  catch (err) { log.warn('send failed', sess.id, err.message); }
}

function broadcastToOthers(fromId, msg) {
  const wire = encode(msg);
  for (const [id, sess] of sessions) {
    if (id === fromId) continue;
    if (!sess.authed) continue;
    try { sess.ws.send(wire); } catch { /* ignore individual failures */ }
  }
}

function closeSession(sess, reason) {
  try { sess.ws.close(1000, reason); } catch { /* noop */ }
  if (sessions.has(sess.id)) {
    sessions.delete(sess.id);
    if (sess.authed) {
      broadcastToOthers(sess.id, { t: MSG.LEFT, id: sess.id, reason });
    }
  }
}

// ---------- auth ----------

// Verify a client's AUTH event:
//   * event.kind === 22242 (NIP-42 "auth" kind — reused semantically for MP)
//   * event.tags contains ['challenge', <our issued challenge>]
//   * created_at within CHALLENGE_TTL_MS of now
//   * schnorr sig valid over the id (checked by verifyNostrEventSig)
function verifyAuthEvent(sess, evt) {
  if (!evt || typeof evt !== 'object')       return { ok: false, reason: 'no event' };
  if (evt.kind !== 22242)                    return { ok: false, reason: 'bad kind' };
  if (!Array.isArray(evt.tags))              return { ok: false, reason: 'bad tags' };
  const challengeTag = evt.tags.find((t) => Array.isArray(t) && t[0] === 'challenge');
  if (!challengeTag || challengeTag[1] !== sess.challenge) return { ok: false, reason: 'wrong challenge' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - evt.created_at) > CHALLENGE_TTL_MS / 1000) {
    return { ok: false, reason: 'stale' };
  }
  if (!verifyNostrEventSig(evt)) return { ok: false, reason: 'bad sig' };
  return { ok: true };
}

// ---------- message handling ----------

function handleMessage(sess, raw) {
  sess.lastActivity = Date.now();

  const parsed = decode(raw);
  if (!parsed.ok) {
    log.warn('bad message from', sess.id, parsed.code);
    // Malformed input from an unauthed client → hang up. From an authed
    // client → tolerate (bugged client) but don't rebroadcast.
    if (!sess.authed) closeSession(sess, 'bad_message');
    return;
  }
  const msg = sanitize(parsed.msg);

  // --- Handshake phase ---
  if (!sess.authed) {
    if (msg.t !== MSG.AUTH) { closeSession(sess, 'unexpected_pre_auth'); return; }
    const v = verifyAuthEvent(sess, msg.event);
    if (!v.ok) {
      sendTo(sess, { t: MSG.AUTH_FAIL, reason: v.reason });
      closeSession(sess, 'auth_fail');
      return;
    }
    sess.authed = true;
    sess.npub = msg.npub;
    sess.pubkey = msg.event.pubkey;
    // Build roster of OTHER authed sessions.
    const roster = [];
    for (const other of sessions.values()) {
      if (other.id === sess.id || !other.authed) continue;
      roster.push({
        id: other.id, npub: other.npub || 'npub1' + 'x'.repeat(58),
        pos: other.pos, rot: other.rot, character: other.character,
      });
    }
    sendTo(sess, { t: MSG.WELCOME, selfId: sess.id, roster });
    // Announce this new peer to everyone else.
    broadcastToOthers(sess.id, {
      t: MSG.JOIN, id: sess.id, npub: sess.npub,
      pos: sess.pos, rot: sess.rot, character: sess.character,
    });
    log.info('AUTH OK', sess.id, sess.npub.slice(0, 12) + '…');
    return;
  }

  // --- Authed phase ---
  switch (msg.t) {
    case MSG.MOVE: {
      if (!checkRate(sess, 'MOVE', RATE.MOVE)) return;
      sess.pos = msg.pos; sess.rot = msg.rot;
      broadcastToOthers(sess.id, { ...msg, id: sess.id });
      return;
    }
    case MSG.SHOT: {
      if (!checkRate(sess, 'SHOT', RATE.SHOT)) return;
      broadcastToOthers(sess.id, { ...msg, id: sess.id });
      return;
    }
    case MSG.HIT: {
      if (!checkRate(sess, 'HIT', RATE.HIT)) return;
      // ADVISORY MODEL (MP-1): trust the shooter's claim, relay untouched.
      // MP-2 will replace this with a server-side raycast; the wire is unchanged.
      broadcastToOthers(sess.id, { ...msg, id: sess.id });
      return;
    }
    case MSG.KILL: {
      broadcastToOthers(sess.id, msg);
      return;
    }
    case MSG.CHAT: {
      if (!checkRate(sess, 'CHAT', RATE.CHAT)) return;
      const trimmed = String(msg.msg || '').slice(0, LIMITS.CHAT_LEN);
      if (!trimmed) return;
      broadcastToOthers(sess.id, { t: MSG.CHAT, id: sess.id, msg: trimmed });
      return;
    }
    case MSG.PING: {
      sendTo(sess, { t: MSG.PONG, ts: msg.ts });
      return;
    }
    case MSG.PONG: return;
    // Ignore anything a client shouldn't be sending.
    default: return;
  }
}

// ---------- server bring-up ----------

const wss = new WebSocketServer({ port: PORT, host: '127.0.0.1' });

wss.on('connection', (ws, req) => {
  if (sessions.size >= MAX_PEERS) {
    try { ws.close(1013, 'server_full'); } catch { /* noop */ }
    return;
  }
  const sess = {
    id: newSessionId(),
    ws,
    npub: null, pubkey: null,
    challenge: newChallenge(),
    authed: false,
    pos: [0, 0, 0], rot: [0, 0], character: 'chiefmonkey',
    lastActivity: Date.now(),
    rate: {},
  };
  sessions.set(sess.id, sess);
  log.info('connect', sess.id, 'from', req.socket.remoteAddress);

  // Send HELLO immediately.
  sendTo(sess, {
    t: MSG.HELLO,
    challenge: sess.challenge,
    serverVersion: SERVER_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  });

  // Auth-timeout guard.
  const authTimer = setTimeout(() => {
    if (!sess.authed) closeSession(sess, 'auth_timeout');
  }, AUTH_TIMEOUT_MS);

  ws.on('message', (data) => handleMessage(sess, data.toString('utf8')));
  ws.on('close', () => { clearTimeout(authTimer); closeSession(sess, 'ws_closed'); });
  ws.on('error', (err) => { log.warn('ws error', sess.id, err.message); });
});

// Idle sweep + heartbeat log.
setInterval(() => {
  const now = Date.now();
  for (const sess of sessions.values()) {
    if (now - sess.lastActivity > IDLE_DISCONNECT_MS) {
      log.info('idle disconnect', sess.id);
      closeSession(sess, 'idle');
    }
  }
  log.info(`peers=${sessions.size}/${MAX_PEERS}`);
}, 60_000);

log.info(`listening on 127.0.0.1:${PORT} (max_peers=${MAX_PEERS}, protocol=${PROTOCOL_VERSION})`);
