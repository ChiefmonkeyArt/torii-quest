// server/gamezone/gameZoneServer.js — Game Zone v2 authority host (ADR-0130).
//
// Thin adapter between the WebSocket sessions in arena-ws.js and the shared
// simulation in src/gamezone/core/sim.js. It owns no rules of its own:
//   • session lifecycle → sim.addPlayer / updatePlayer / removePlayer
//   • GZ_FIRE           → sim.fire (resolved immediately, results flushed at once)
//   • 20 Hz interval    → sim.step, then GZ_SNAP + GZ_EVENT to every seated peer
//   • score hooks       → the existing MP-3 score ledger (points system unchanged)
// Spectators (portal mirrors on other nodes) keep receiving the legacy
// BOT_STATE shape at ~6.7 Hz so older nodes can still peek into this arena.

import { createGameZoneSim } from '../../src/gamezone/core/sim.js';
import { sharedArenaWorld } from '../../src/gamezone/core/arenaWorld.js';
import { TICK_MS, ROSTER, PLAYER_HP } from '../../src/gamezone/core/constants.js';
import { legacyBotRows, eventForWire } from '../../src/gamezone/core/protocol.js';
import { MSG } from '../../src/engine/multiplayer/wireProtocol.js';

function envInt(env, key, def) {
  const raw = env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : def;
}
function envBool(env, key) {
  const raw = String(env[key] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/** ADR-0018 knobs carried forward: BOT_COUNT_OVERRIDE / BOSS_COUNT_OVERRIDE / TEST_MODE. */
export function rosterFromEnv(env = process.env) {
  const test = envBool(env, 'TEST_MODE');
  const total = envInt(env, 'BOT_COUNT_OVERRIDE', test ? 1 : ROSTER.total);
  const bosses = Math.min(total, envInt(env, 'BOSS_COUNT_OVERRIDE', test ? 0 : ROSTER.bosses));
  return { total, bosses };
}

/**
 * @param {object} deps
 * @param {Map<string, object>} deps.sessions   live session map (id → sess)
 * @param {(sess:object)=>boolean} deps.isKamiActive
 * @param {(sess:object, msg:object)=>void} deps.sendTo
 * @param {(fromId:string, msg:object)=>void} deps.broadcastToOthers
 * @param {(wire:string)=>void} deps.sendToSpectators
 * @param {()=>number} deps.spectatorCount
 * @param {(msg:object)=>string} deps.encode
 * @param {object} [deps.score]  {enabled, ledger, broadcast}
 * @param {object} [deps.log]
 */
export function createGameZoneServer(deps) {
  const { sessions, isKamiActive, sendTo, broadcastToOthers, sendToSpectators, spectatorCount, encode } = deps;
  const score = deps.score || { enabled: false };
  const log = deps.log || { info() {}, warn() {} };
  const roster = deps.roster || rosterFromEnv();
  const world = deps.world || sharedArenaWorld();

  let scoreDirty = false;
  const sim = createGameZoneSim({
    world, roster, seed: deps.seed ?? ((Date.now() ^ 0x5eed) >>> 0),
    onDamage: (sid, dmg) => { if (score.enabled) score.ledger.addDamage(sid, dmg); },
    onKill: (sid, kind, tid) => {
      if (!score.enabled) return;
      if (kind === 'bot') score.ledger.addBotKill(sid);
      else if (kind === 'player') score.ledger.addKill(sid, tid);
      else if (kind === 'botKilledPlayer') score.ledger.addBotDeath(tid);
      scoreDirty = true;
    },
  });
  if (roster.total !== ROSTER.total || roster.bosses !== ROSTER.bosses) {
    log.info(`[GZ] roster override: ${roster.total} bots incl. ${roster.bosses} boss`);
  }

  function seated() {
    let n = 0;
    for (const s of sessions.values()) if (s.authed) n++;
    return n;
  }

  function _broadcastWire(wire) {
    for (const s of sessions.values()) {
      if (!s.authed) continue;
      try { s.ws.send(wire); } catch { /* ignore individual failures */ }
    }
  }

  // Route events: 'result' → shooter only; everything else → all seated peers.
  function flush(events) {
    if (!events.length) return;
    const shared = [];
    const perShooter = new Map();
    for (const e of events) {
      if (e.type === 'result') {
        if (!perShooter.has(e.sid)) perShooter.set(e.sid, []);
        perShooter.get(e.sid).push(eventForWire(e));
        continue;
      }
      if (e.type === 'respawn') _applyRespawn(e);
      shared.push(eventForWire(e));
    }
    const tick = sim.tick;
    for (const [sid, list] of perShooter) {
      const s = sessions.get(sid);
      if (s && s.authed) sendTo(s, { t: MSG.GZ_EVENT, tick, ev: list });
    }
    if (shared.length) _broadcastWire(encode({ t: MSG.GZ_EVENT, tick, ev: shared }));
    if (scoreDirty) { scoreDirty = false; if (score.broadcast) score.broadcast(); }
  }

  // The sim chose a spawn point: warp the victim (existing RESPAWN path heals +
  // teleports the client) and pop their avatar for everyone else.
  function _applyRespawn(e) {
    const s = sessions.get(e.pid);
    if (!s || !s.authed) return;
    s.pos = e.pos;
    const rot = [e.yaw, 0];
    sendTo(s, { t: MSG.RESPAWN, pos: e.pos, rot, hp: PLAYER_HP });
    broadcastToOthers(s.id, { t: MSG.MOVE, id: s.id, pos: e.pos, rot, vel: [0, 0, 0] });
  }

  function onAuth(sess) {
    sim.addPlayer(sess.id, { pos: Array.isArray(sess.pos) ? sess.pos : undefined, targetable: !isKamiActive(sess) });
    sendTo(sess, { t: MSG.GZ_SNAP, ...sim.snapshot() });
  }
  function onMove(sess) {
    const yaw = Array.isArray(sess.rot) ? sess.rot[0] : undefined;
    sim.updatePlayer(sess.id, sess.pos, yaw);
  }
  function onLeave(sess) { sim.removePlayer(sess.id); }
  function onKami(sess) { sim.setTargetable(sess.id, !isKamiActive(sess)); }
  function onFire(sess, msg) {
    sim.fire(sess.id, msg);
    flush(sim.drainEvents());
  }

  let _spectatorTick = 0;
  function tick() {
    const events = sim.step();
    flush(events);
    if (seated() > 0) _broadcastWire(encode({ t: MSG.GZ_SNAP, ...sim.snapshot() }));
    if (spectatorCount() > 0 && (++_spectatorTick % 3) === 0) {
      sendToSpectators(encode({ t: MSG.BOT_STATE, bots: legacyBotRows(sim.snapshot()) }));
    }
  }

  // Drift-free clock: the sim tick tracks wall time (catching up at most 4 ticks
  // after a stall) so clients' tick-rate estimate stays steady.
  let timer = null, t0 = 0, base = 0;
  function _pump() {
    const due = base + Math.floor((Date.now() - t0) / TICK_MS);
    let n = 0;
    while (sim.tick < due && n++ < 4) tick();
    if (sim.tick < due) { base -= due - sim.tick; } // drop the backlog rather than spiral
  }
  function start() {
    if (timer) return;
    t0 = Date.now(); base = sim.tick;
    timer = setInterval(_pump, Math.max(5, Math.floor(TICK_MS / 3)));
  }
  function stop() { if (timer) { clearInterval(timer); timer = null; } }

  return { sim, start, stop, tick, onAuth, onMove, onLeave, onKami, onFire, roster };
}
