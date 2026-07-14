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
import { createServer } from 'http';
import { randomBytes } from 'crypto';

import {
  MSG, PROTOCOL_VERSION, LIMITS,
  decode, encode, sanitize,
} from '../src/engine/multiplayer/wireProtocol.js';
import { verifyNostrEventSig } from '../src/engine/crypto/nostrSig.js';
import { createSessionTokens } from './auth/sessionTokens.js';
import { createSnapshotRing, push as pushSnap } from './combat/snapshotRing.js';
import { resolveShot, DEFAULT_LAG_COMP_MS } from './combat/hitResolver.js';
import { damageFor } from './combat/damageTable.js';
import {
  createHpLedger, register as hpRegister, unregister as hpUnregister,
  applyDamage, respawn, HP_MAX,
} from './combat/hpLedger.js';
import { createScoreLedger, newSessionId as newScoreSessionId } from './combat/scoreLedger.js';
import { createArenaBotSim } from './bots/arenaBotSim.js';
import { buildColliders } from './combat/capsuleModel.js';
import { rayVsPeer } from './combat/rayVsCapsule.js';
import { pointInCoastline } from '../src/terrain/coastline.js';
import { BOT_COUNT, BOT_DAMAGE } from '../src/config.js';

// ---------- config ----------

const PORT       = Number(process.env.PORT || 5000);
const HOST       = process.env.HOST || '0.0.0.0';
const WS_PATH    = process.env.WS_PATH || '/mp';
const MAX_PEERS  = Number(process.env.MAX_PEERS || 32);
const LOG_LEVEL  = process.env.LOG_LEVEL || 'info';
const SERVER_VERSION = process.env.SERVER_VERSION || 'v0.2.385-alpha';

// MP-2 tunables.
//   MP_MODE is FORCED to 'authoritative'. advisory mode was retired in v0.2.374+
//   (the client no longer sends client-side HIT), so in advisory the server relays
//   SHOT visuals but never resolves hits — making player→peer AND player→bot damage
//   impossible. v0.2.378 hard-codes authoritative so a stale VPS .env cannot break
//   combat; a leftover MP_MODE=advisory is warned about below and ignored.
const MP_MODE_ENV = (process.env.MP_MODE || 'authoritative').toLowerCase();
const MP_MODE     = 'authoritative';
const LAG_COMP_MS = Number(process.env.LAG_COMP_MS || DEFAULT_LAG_COMP_MS);
const HP_MAX_ENV  = Number(process.env.HP_MAX || HP_MAX);
const RESPAWN_MS  = Number(process.env.RESPAWN_MS || 3000);

// Bot milestone chunk 2 (v0.2.379-alpha): server-authoritative bots.
//   BOT_SIM_ENABLED — master switch (default on).
//   BOT_TICK_MS     — fixed AI tick period (~20Hz).
//   BOT_STATE_MS    — throttled BOT_STATE broadcast period (~15Hz).
const BOT_SIM_ENABLED = String(process.env.BOT_SIM_ENABLED || 'true').toLowerCase() !== 'false';
const BOT_TICK_MS     = Number(process.env.BOT_TICK_MS || 50);
const BOT_STATE_MS    = Number(process.env.BOT_STATE_MS || 66);

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

// Per-session snapshot ring for MP-2 lag-compensated hit resolution.
// Kept OUT of the Session struct so the MP-1 shape stays untouched and
// snapshot writes remain a single point of concern.
/** @type {Map<string, ReturnType<typeof createSnapshotRing>>} */
const snapshotRings = new Map();

// Server-authoritative HP ledger.
const hpLedger = createHpLedger(HP_MAX_ENV);

// MP-3: authoritative per-peer kill/death/damage ledger for the current
// arena instance. Client-signed leaderboard events derive from snapshots
// of this state at match-end / peer-disconnect.
const scoreLedger  = createScoreLedger();
const SCORE_ENABLED = String(process.env.SCORE_ENABLED || 'true').toLowerCase() !== 'false';
// Arena-instance session id. Peers within a single arena share this id;
// it is emitted in every SCORE frame so replay-attack guards / WoT
// aggregation can group tallies per match.
const SCORE_SESSION_ID = newScoreSessionId((n) => randomBytes(n));
// v0.2.380-alpha: live in-arena leaderboard. In addition to the on-close SCORE
// emit, broadcast the running tally on every kill and on this periodic tick so
// clients see real-time standings. Additive on PROTOCOL_VERSION=1.
const SCORE_TICK_MS = Number(process.env.SCORE_TICK_MS || 5000);

// Session-token authority (v0.2.375-alpha). Login signs a NIP-98 event ONCE
// over a one-time challenge (POST /mp/session), receives an opaque bearer
// token, and the arena WS reuses it via AUTH_TOKEN — no per-entry NIP-42 sign.
const sessionTokens = createSessionTokens();

// Pending RESPAWN timers keyed by sid. Only ever holds one timer per session;
// on reconnect / LEFT we clear pending timers to avoid warping ghosts.
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const respawnTimers = new Map();

// Bot milestone chunk 2: the server-authoritative bot brain. onBotShot fires
// synchronously from inside the sim's tick when a bot pulls the trigger — we
// broadcast the tracer to all clients AND resolve the shot against players.
const arenaBotSim = createArenaBotSim({
  onBotShot: (origin, dir, dmg) => onBotShot(origin, dir, dmg),
});
if (BOT_SIM_ENABLED) arenaBotSim.spawn(BOT_COUNT);
// Synthetic shooter id carried on bot→player HIT/KILL so the existing client
// peerCombat handler applies damage exactly as it does for a peer shot.
const BOT_SHOOTER_ID = 'bot';

// ---------- logging ----------

const log = {
  info:  (...a) => LOG_LEVEL !== 'error' && console.log('[arena-ws]', ...a),
  warn:  (...a) => console.warn('[arena-ws]', ...a),
  error: (...a) => console.error('[arena-ws]', ...a),
};

// v0.2.378 fix 1: warn (once, at boot) if a retired MP_MODE=advisory is still set
// in the environment — it is ignored; authoritative is the only supported mode.
if (MP_MODE_ENV === 'advisory') {
  log.warn('MP_MODE=advisory is retired (client dropped client-side HIT in v0.2.374); ignoring and forcing authoritative');
}

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

// MP-2: HIT / KILL are broadcast to EVERYONE including the shooter, because
// the shooter's client no longer decides outcomes — it needs the wire event
// to trigger its own kill-confirmed audio/HUD.
function broadcastToAll(msg) {
  const wire = encode(msg);
  for (const sess of sessions.values()) {
    if (!sess.authed) continue;
    try { sess.ws.send(wire); } catch { /* ignore */ }
  }
}

function closeSession(sess, reason) {
  const wasAuthed = sess.authed && sessions.has(sess.id);
  // MP-3: emit final SCORE to the departing peer BEFORE we close the socket,
  // then to remaining peers AFTER we drop from the ledger. Best-effort;
  // failures do not block session teardown.
  if (wasAuthed && SCORE_ENABLED) {
    try {
      const tallies = scoreLedger.snapshot(32);
      if (tallies.length > 0) {
        try { sess.ws.send(encode({ t: MSG.SCORE, sessionId: SCORE_SESSION_ID, endedAt: Date.now(), tallies })); }
        catch { /* client already gone — ignore */ }
      }
    } catch (e) { log.warn('SCORE pre-close send failed', sess.id, e.message); }
  }

  try { sess.ws.close(1000, reason); } catch { /* noop */ }
  if (sessions.has(sess.id)) {
    sessions.delete(sess.id);
    snapshotRings.delete(sess.id);
    hpUnregister(hpLedger, sess.id);
    // v0.2.384-alpha: RETIRE (not drop) so a disconnected player stays on the
    // LOCAL leaderboard for this arena instance until the server restarts.
    if (SCORE_ENABLED) scoreLedger.retire(sess.id);
    const timer = respawnTimers.get(sess.id);
    if (timer) { clearTimeout(timer); respawnTimers.delete(sess.id); }
    if (sess.authed) {
      broadcastToOthers(sess.id, { t: MSG.LEFT, id: sess.id, reason });
      // MP-3: broadcast the post-drop snapshot to remaining peers so their
      // leaderboard views converge on the same match-final state.
      broadcastScoreFrame();
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

// Mark a session authed and run the shared post-auth setup: HP ledger + snapshot
// ring bootstrap, score-ledger registration, WELCOME (with roster of other
// authed peers), and JOIN broadcast. Reused by BOTH the NIP-42 AUTH path and the
// v0.2.375 AUTH_TOKEN path so they converge on identical presence behaviour.
function finishAuth(sess, { npub, pubkey }) {
  sess.authed = true;
  sess.npub = npub;
  sess.pubkey = pubkey;
  // MP-2: bootstrap ledger + ring at auth time.
  hpRegister(hpLedger, sess.id);
  snapshotRings.set(sess.id, createSnapshotRing());
  // MP-3: register in score ledger keyed by pubkey (hex).
  if (SCORE_ENABLED && typeof sess.pubkey === 'string' && /^[0-9a-f]{64}$/.test(sess.pubkey)) {
    try { scoreLedger.register(sess.id, sess.pubkey); }
    catch (e) { log.warn('scoreLedger register failed', sess.id, e.message); }
  }
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
  // Bot milestone chunk 2: send the FULL bot roster snapshot immediately on
  // (re)auth so a late-joining / reconnecting client never briefly renders
  // stale/default bots before the first throttled BOT_STATE arrives.
  if (BOT_SIM_ENABLED) {
    sendTo(sess, { t: MSG.BOT_STATE, bots: arenaBotSim.snapshot() });
  }
  log.info('AUTH OK', sess.id, String(sess.npub).slice(0, 12) + '…');
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
    // v0.2.375-alpha: bearer-token auth (login signed once via NIP-98). No
    // NIP-07 signature needed on arena entry / reconnect.
    if (msg.t === MSG.AUTH_TOKEN) {
      const pubkey = sessionTokens.verifyToken(msg.token);
      if (!pubkey) {
        sendTo(sess, { t: MSG.AUTH_FAIL, reason: 'bad or expired token' });
        closeSession(sess, 'auth_fail');
        return;
      }
      // No bech32 npub on the token path — the hex pubkey (64 chars) fits the
      // wire npub field (NPUB_LEN=72) and is what the client's state uses too.
      finishAuth(sess, { npub: pubkey, pubkey });
      return;
    }
    // NIP-42 fallback: kind:22242 challenge/response (per-session, re-signed).
    if (msg.t !== MSG.AUTH) { closeSession(sess, 'unexpected_pre_auth'); return; }
    const v = verifyAuthEvent(sess, msg.event);
    if (!v.ok) {
      sendTo(sess, { t: MSG.AUTH_FAIL, reason: v.reason });
      closeSession(sess, 'auth_fail');
      return;
    }
    finishAuth(sess, { npub: msg.npub, pubkey: msg.event.pubkey });
    return;
  }

  // --- Authed phase ---
  switch (msg.t) {
    case MSG.MOVE: {
      if (!checkRate(sess, 'MOVE', RATE.MOVE)) return;
      sess.pos = msg.pos; sess.rot = msg.rot;
      // MP-2: record every accepted MOVE for lag-compensated hit resolution.
      const ring = snapshotRings.get(sess.id);
      if (ring) {
        pushSnap(ring, {
          ts: sess.lastActivity,
          pos: msg.pos, rot: msg.rot,
          vel: Array.isArray(msg.vel) ? msg.vel : [0, 0, 0],
        });
      }
      broadcastToOthers(sess.id, { ...msg, id: sess.id });
      return;
    }
    case MSG.SHOT: {
      if (!checkRate(sess, 'SHOT', RATE.SHOT)) return;
      broadcastToOthers(sess.id, { ...msg, id: sess.id });
      // MP-2: after relaying the muzzle/tracer cue, resolve the hit ourselves.
      // v0.2.378 fix 1: unconditional — advisory is retired, so every SHOT is
      // resolved authoritatively (player→peer AND player→bot).
      resolveAndBroadcast(sess, msg);
      return;
    }
    case MSG.HIT: {
      if (!checkRate(sess, 'HIT', RATE.HIT)) return;
      if (MP_MODE === 'advisory') {
        // MP-1 LEGACY: relay untouched. Only reachable with MP_MODE=advisory.
        broadcastToOthers(sess.id, { ...msg, id: sess.id });
        return;
      }
      // MP-2 AUTHORITATIVE: client HIT is IGNORED. The server-issued HIT is
      // the only one clients ever apply damage from. Drop silently to avoid
      // wasting a warning per bugged/legacy client.
      return;
    }
    case MSG.KILL: {
      if (MP_MODE === 'advisory') {
        broadcastToOthers(sess.id, msg);
      }
      // MP-2: server emits KILL; client-sent KILL is dropped.
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

// ---------- MP-2 authoritative hit resolution ----------

// Rate-limited (≤1/sec per shooter) SHOT-pipeline diagnostic. Tagged
// [SHOT-RESOLVE] so a stuck combat loop is greppable in the server log.
const _shotLogAt = new Map();
function _logShotResolve(shooterId, shotMsg, peerCount, result, botResult, decision) {
  const now = Date.now();
  if (now - (_shotLogAt.get(shooterId) || 0) < 1000) return;
  _shotLogAt.set(shooterId, now);
  const peer = result ? `${result.targetId}@t=${result.t.toFixed(2)}` : 'miss';
  const bot  = botResult ? `${botResult.botId}@t=${botResult.t.toFixed(2)}` : 'null';
  // v0.2.382 combat hotfix diagnostic: the reported miss (player→bot shots not
  // registering) could not be reproduced headlessly — server geometry HITS. This
  // compact Y-frame line lets us confirm the vertical alignment on a LIVE server:
  // origin.y is the shooter's camera/eye Y; botFootY is the nearest bot's collider
  // base (sampleArenaHeight); dy is the delta. A large |dy| that isn't ~EYE(1.7)
  // above the bot foot would explain rays passing over/under the bot capsule.
  const oy = (BOT_SIM_ENABLED && shotMsg.origin) ? shotMsg.origin[1] : null;
  const diag = BOT_SIM_ENABLED ? arenaBotSim.nearestBotDiag(shotMsg.origin) : null;
  let yinfo = '';
  if (diag && oy != null) {
    const dy = oy - diag.footY;
    yinfo = ` originY=${oy.toFixed(2)} nearBot=${diag.botId} botFootY=${diag.footY.toFixed(2)} dy=${dy.toFixed(2)}`;
  }
  // v0.2.385-alpha: surface the lag-comp inputs — the shot ts and whether it fell
  // outside the [now-LAG_COMP_MS, now] rewind window (so it was clamped).
  let rw = '';
  if (typeof shotMsg.ts === 'number') {
    const clamped = shotMsg.ts < now - LAG_COMP_MS || shotMsg.ts > now;
    rw = ` shotTs=${shotMsg.ts} rwClamp=${clamped}`;
  }
  log.info(`[SHOT-RESOLVE] shooter=${shooterId} origin=${!!shotMsg.origin} dir=${!!shotMsg.dir}` +
    ` peers=${peerCount} peerHit=${peer} botHit=${bot} decision=${decision}${yinfo}${rw}`);
}

function resolveAndBroadcast(shooter, shotMsg) {
  const peerRings = [];
  for (const [id, ring] of snapshotRings) {
    if (id === shooter.id) continue;
    const other = sessions.get(id);
    if (!other || !other.authed) continue;
    peerRings.push({ id, ring });
  }
  const now = Date.now();
  const result = resolveShot({
    shooterId: shooter.id,
    shot: { origin: shotMsg.origin, dir: shotMsg.dir, ts: shotMsg.ts },
    peerRings,
    now,
    lagCompMs: LAG_COMP_MS,
  });

  // Bot milestone chunk 2: also resolve against server-authoritative bots and
  // pick the NEAREST hit across peers AND bots — one bullet = one hit (no
  // piercing). A bot hit that is nearer than any peer hit wins, and vice versa.
  // v0.2.385-alpha: bots are lag-compensated too — rewind to the SAME shot ts +
  // LAG_COMP_MS window the peer resolver uses, so moving bots stop eating shots.
  const botResult = BOT_SIM_ENABLED
    ? arenaBotSim.resolvePlayerShot(shotMsg.origin, shotMsg.dir, shotMsg.ts, now, LAG_COMP_MS)
    : null;
  const botNearer = botResult && (!result || botResult.t < result.t);

  // v0.2.378 fix 4: low-noise diagnostic (≤1/sec per shooter). If player→player
  // damage still fails after fix 1, the next play session leaves a signal here.
  _logShotResolve(shooter.id, shotMsg, peerRings.length, result, botResult,
    botNearer ? 'bot-hit' : (result ? 'peer-hit' : 'miss'));

  if (botNearer) {
    resolvePlayerBotHit(shooter, botResult);
    return;
  }
  if (!result) return;

  const dmg = damageFor(result.zone);
  if (dmg <= 0) return;

  const outcome = applyDamage(hpLedger, result.targetId, dmg);
  // Server-issued HIT — broadcast to ALL so shooter also sees definitive result.
  broadcastToAll({
    t: MSG.HIT,
    id: shooter.id,           // shooter session id
    targetId: result.targetId,
    dmg: outcome.applied,
    zone: result.zone,
    shotTs: shotMsg.ts,
  });

  // MP-3: attribute damage to shooter in score ledger (any zone counts).
  if (SCORE_ENABLED) scoreLedger.addDamage(shooter.id, outcome.applied);

  if (outcome.killed) {
    broadcastToAll({
      t: MSG.KILL,
      shooterId: shooter.id,
      victimId: result.targetId,
      weapon: 'primary',
    });
    // MP-3: attribute kill → shooter, death → victim.
    if (SCORE_ENABLED) scoreLedger.addKill(shooter.id, result.targetId);
    // v0.2.380-alpha: push the updated standings immediately on a kill so the
    // live in-arena leaderboard reflects frags without waiting for the tick.
    broadcastScoreFrame();
    scheduleRespawn(result.targetId, shooter.pos);
  }
}

// MP-3: broadcast a SCORE frame to all authed peers. Called on peer
// disconnect (so departing peer + remaining peers both have a final tally
// for client-signing / leaderboard publishing).
function broadcastScoreFrame() {
  if (!SCORE_ENABLED) return;
  const tallies = scoreLedger.snapshot(32);
  if (tallies.length === 0) return;
  broadcastToAll({
    t: MSG.SCORE,
    sessionId: SCORE_SESSION_ID,
    endedAt: Date.now(),
    tallies,
  });
}

function scheduleRespawn(victimId, killerPos) {
  // Clear any pending timer (e.g. victim was already scheduled).
  const existing = respawnTimers.get(victimId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    respawnTimers.delete(victimId);
    const victim = sessions.get(victimId);
    if (!victim || !victim.authed) return; // peer left before respawn

    const r = respawn(hpLedger, victimId, killerPos);
    victim.pos = r.pos;
    // Reset the peer's ring so lag-comp doesn't rewind through a corpse.
    snapshotRings.set(victimId, createSnapshotRing());

    // RESPAWN → victim only (they warp + heal).
    sendTo(victim, {
      t: MSG.RESPAWN,
      pos: r.pos,
      rot: victim.rot,
      hp: r.hp,
    });
    // Synthetic MOVE → everyone else so remote avatars pop to the new corner.
    broadcastToOthers(victimId, {
      t: MSG.MOVE,
      id: victimId,
      pos: r.pos, rot: victim.rot, vel: [0, 0, 0],
    });
  }, RESPAWN_MS);
  respawnTimers.set(victimId, timer);
}

// ---------- bot milestone chunk 2: server-authoritative bots ----------

// A player's shot hit a bot (nearest across peers+bots). Apply authoritative
// damage to the bot, broadcast BOT_HIT, and on kill broadcast BOT_KILL. Damage
// (any zone) is attributed to the shooter's MP-3 score tally.
function resolvePlayerBotHit(shooter, botResult) {
  const dmg = damageFor(botResult.zone);
  if (dmg <= 0) return;
  const playerPos = { x: shooter.pos[0], z: shooter.pos[2] };
  const res = arenaBotSim.applyBotDamage(botResult.botId, dmg, playerPos);
  if (!res.hit) return;
  broadcastToAll({
    t: MSG.BOT_HIT,
    botId: botResult.botId,
    dmg,
    zone: botResult.zone,
    hp: res.hpAfter,
    shooterId: shooter.id,
  });
  if (SCORE_ENABLED) scoreLedger.addDamage(shooter.id, dmg);
  if (res.killed) {
    broadcastToAll({ t: MSG.BOT_KILL, botId: botResult.botId, shooterId: shooter.id });
  }
}

// A bot pulled the trigger (fired synchronously from arenaBotSim.tick). Emit the
// tracer cue to every client immediately, then resolve the shot against players
// authoritatively (bot → player damage reuses the peer HIT/KILL wire path with a
// synthetic shooter id so the client's existing peerCombat handler applies it).
function onBotShot(origin, dir, dmg) {
  const originArr = [origin.x, origin.y, origin.z];
  const dirArr = [dir.x, dir.y, dir.z];
  broadcastToAll({ t: MSG.BOT_SHOT, origin: originArr, dir: dirArr });
  // Per-bot damage (v0.2.381): the boss hits harder. Falls back to the global
  // BOT_DAMAGE for regular bots / callers that don't pass a per-bot value.
  const shotDamage = Number.isFinite(dmg) ? dmg : BOT_DAMAGE;

  // Nearest player hit — bots use the CURRENT authoritative player positions
  // (no lag-comp rewind needed; the bot itself is server-side).
  let best = null;
  for (const sess of sessions.values()) {
    if (!sess.authed) continue;
    const colliders = buildColliders({ pos: sess.pos });
    const r = rayVsPeer(originArr, dirArr, colliders);
    if (!r.hit) continue;
    if (!best || r.t < best.t) best = { id: sess.id, zone: r.zone, t: r.t };
  }
  if (!best) return;

  const outcome = applyDamage(hpLedger, best.id, shotDamage);
  if (outcome.applied <= 0) return; // target already dead — no wire event
  broadcastToAll({
    t: MSG.HIT,
    id: BOT_SHOOTER_ID,
    targetId: best.id,
    dmg: outcome.applied,
    zone: best.zone,
    shotTs: Date.now(),
  });
  if (outcome.killed) {
    broadcastToAll({
      t: MSG.KILL,
      shooterId: BOT_SHOOTER_ID,
      victimId: best.id,
      weapon: 'bot',
    });
    scheduleRespawn(best.id, [origin.x, origin.y, origin.z]);
  }
}

// Fixed-rate bot AI loop (~20Hz). Builds the live player roster from authed
// sessions, ticks the brain (which may fire onBotShot), and broadcasts the
// throttled (~15Hz) BOT_STATE roster only when there is someone to receive it.
let _lastBotStateAt = 0;
if (BOT_SIM_ENABLED) {
  setInterval(() => {
    const dt = BOT_TICK_MS / 1000;
    const players = [];
    for (const sess of sessions.values()) {
      if (!sess.authed) continue;
      const [x, y, z] = sess.pos;
      // `id` gives the bot brain a stable per-player key for target-switch
      // hysteresis (v0.2.378 fix 3) across ticks.
      players.push({ id: sess.id, x, y, z, outsideFence: !pointInCoastline(x, z), flyEnabled: false });
    }
    arenaBotSim.tick(dt, players);
    const now = Date.now();
    // v0.2.385-alpha: record post-tick bot positions for lag-compensated
    // player→bot shot resolution (mirrors the peer MOVE snapshot ring).
    arenaBotSim.recordSnapshot(now);
    if (players.length > 0 && now - _lastBotStateAt >= BOT_STATE_MS) {
      _lastBotStateAt = now;
      broadcastToAll({ t: MSG.BOT_STATE, bots: arenaBotSim.snapshot() });
    }
  }, BOT_TICK_MS);
}

// v0.2.380-alpha: periodic live SCORE broadcast. broadcastScoreFrame() is a
// no-op when SCORE is disabled or no tallies exist, so this only emits once
// combat has produced standings. The on-kill + on-close emits stay in place;
// this fills the quiet gaps (e.g. damage-only progress) at ~5s cadence.
if (SCORE_ENABLED) {
  setInterval(() => { broadcastScoreFrame(); }, SCORE_TICK_MS);
}

// ---------- server bring-up ----------

// HTTP server: 200 OK on /healthz, 404 for everything else non-WS.
// WebSocket upgrades are handled explicitly for WS_PATH only.
const MAX_LOGIN_BODY = 8 * 1024; // NIP-98 event is small; cap to avoid abuse.

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

const httpServer = createServer((req, res) => {
  // Path without query. The reverse proxy may prefix a mount (/quest, or the
  // sandbox /port/5000), so match by suffix — same tolerance as the WS upgrade.
  const path = (req.url || '').split('?')[0];

  if (path === '/healthz' || path === '/health') {
    return sendJson(res, 200, {
      ok: true,
      peers: sessions.size,
      maxPeers: MAX_PEERS,
      version: SERVER_VERSION,
      protocol: PROTOCOL_VERSION,
      mode: MP_MODE,
    });
  }

  // v0.2.375-alpha session-token endpoints (plain HTTP, same origin as /mp).
  //   GET  /mp/auth-challenge → { challenge, ttl }         (no auth)
  //   POST /mp/session {event, challenge} → { token, npub } (verifies NIP-98)
  if (req.method === 'GET' && path.endsWith('/mp/auth-challenge')) {
    return sendJson(res, 200, sessionTokens.issueChallenge());
  }

  if (req.method === 'POST' && path.endsWith('/mp/session')) {
    let body = '';
    let tooBig = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_LOGIN_BODY) { tooBig = true; req.destroy(); }
    });
    req.on('end', () => {
      if (tooBig) return sendJson(res, 413, { error: 'body too large' });
      let parsed;
      try { parsed = JSON.parse(body); }
      catch { return sendJson(res, 400, { error: 'bad json' }); }
      const pubkey = sessionTokens.verifyLoginEvent({
        event: parsed && parsed.event,
        challenge: parsed && parsed.challenge,
      });
      if (!pubkey) return sendJson(res, 401, { error: 'login verification failed' });
      const token = sessionTokens.issueToken(pubkey);
      if (!token) return sendJson(res, 401, { error: 'token issuance failed' });
      return sendJson(res, 200, { token, npub: pubkey });
    });
    req.on('error', () => { try { sendJson(res, 400, { error: 'request error' }); } catch { /* noop */ } });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('arena-ws: not found');
});

const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (req, socket, head) => {
  // Only upgrade the /mp path; the sandbox proxy may forward /port/5000/mp
  // (rewritten from client-side __PORT_5000__ sentinel). Accept both shapes.
  const url = req.url || '';
  const isMpPath = url === WS_PATH || url.endsWith(WS_PATH) || url.startsWith(`${WS_PATH}?`);
  if (!isMpPath) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

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
  // Purge expired login challenges + session tokens.
  sessionTokens.cleanup();
  log.info(`peers=${sessions.size}/${MAX_PEERS}`);
}, 60_000);

httpServer.listen(PORT, HOST, () => {
  log.info(`listening on ${HOST}:${PORT}${WS_PATH} (max_peers=${MAX_PEERS}, protocol=${PROTOCOL_VERSION}, mp_mode=${MP_MODE}, lag_comp_ms=${LAG_COMP_MS})`);
});
