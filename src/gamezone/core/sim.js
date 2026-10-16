// src/gamezone/core/sim.js — the Game Zone v2 authority (ADR-0130).
//
// ONE simulation decides every combat outcome. The VPS runs it for multiplayer;
// the browser runs the very same module for single-player. There is no second
// copy of the rules anywhere, so single-player and multiplayer cannot disagree.
//
//   step()           advance one fixed tick (20 Hz): bot AI, bot fire, timers,
//                    pose history. Returns the events produced.
//   fire(id, shot)   resolve a player's shot at the render tick they saw it. Bot
//                    hits REQUIRE a claim (the client tests the rendered mesh);
//                    the authority validates it. Claimless shots only test peers.
//   snapshot()       the complete bot roster — clients render EXACTLY this set.
//
// Outcomes are events (never callbacks into rendering):
//   shot    {sk:'bot'|'player', sid, from:[3], to:[3]}          tracer cue
//   hit     {tk:'bot'|'player', tid, sid, sk, zone, dmg, hp}
//   kill    {tk, tid, sid, sk, zone}
//   spawn   {bid}                                                bot respawned
//   respawn {pid, pos:[x,eyeY,z], yaw}                           player respawned
//   result  {sid, seq, ok, reason?, hit?:{tk,tid,zone,dmg,hp,killed,absorbed}}
//
// Node-pure; deterministic for a given seed + input sequence.

import {
  TICK_MS, TICK_DT, MAX_REWIND_TICKS, ROSTER, BOT_KINDS, PLAYER_BODY, PLAYER_EYE, PLAYER_HP,
  HEAD_DAMAGE, BODY_DAMAGE, BOSS_NAME, ENGAGE_MIN, ENGAGE_MAX, TURN_RATE, AIM_CONE, SHOT_RANGE,
  FIRE_RANGE, SHOOT_ANIM_MS, BOT_DYING_MS, BOT_RESPAWN_MS, PLAYER_RESPAWN_MS, SPAWN_PROTECT_MS,
  MAX_SHOTS_PER_TICK, MAX_ORIGIN_DRIFT,
} from './constants.js';
import { createRng, wrapAngle, normalize3 } from './geom.js';
import { createHistory, q2, q3 } from './history.js';
import { rayVsBody, validateClaim } from './body.js';
import { BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN } from '../../config.js';

export const BOT_NAMES = Object.freeze(['Doc', 'Grumpy', 'Happy', 'Sleepy', 'Bashful', 'Sneezy', 'Dopey']);
export const ST = Object.freeze({ alive: 0, dying: 1, dead: 2 });
export const ANIM_CODES = Object.freeze(['idle', 'walk', 'run', 'shoot', 'strafeL', 'strafeR', 'die']);
const A = Object.fromEntries(ANIM_CODES.map((n, i) => [n, i]));

export function botName(id, kind) { return kind === 'boss' ? BOSS_NAME : BOT_NAMES[id % BOT_NAMES.length]; }
export const damageFor = (zone) => (zone === 'head' ? HEAD_DAMAGE : BODY_DAMAGE);

const BRIDGE_ENDS = [BRIDGE2_X - BRIDGE2_LEN / 2 - 0.6, BRIDGE2_X + BRIDGE2_LEN / 2 + 0.6];

/**
 * @param {object} opts
 * @param {object} opts.world          arena world (createArenaWorld) — must be built
 * @param {number} [opts.seed]
 * @param {{total:number,bosses:number}} [opts.roster]
 * @param {(sid:string, dmg:number, tk:string)=>void} [opts.onDamage]  score hook
 * @param {(sid:string, tk:string, tid:any)=>void} [opts.onKill]        score hook
 */
export function createGameZoneSim(opts = {}) {
  const world = opts.world;
  if (!world || !world.ready) throw new Error('gamezone: world must be built before the sim starts');
  const rng = opts.rng || createRng(opts.seed ?? 0x7071);
  const roster = opts.roster || ROSTER;
  const onDamage = typeof opts.onDamage === 'function' ? opts.onDamage : null;
  const onKill = typeof opts.onKill === 'function' ? opts.onKill : null;

  let tick = 0;
  const bots = new Map();
  const players = new Map();
  const botHist = createHistory();
  const playerHist = createHistory();
  let events = [];
  const _pose = {};

  // ── roster ──────────────────────────────────────────────────────────────────
  const total = Math.max(0, roster.total | 0);
  const bosses = Math.max(0, Math.min(total, roster.bosses | 0));
  for (let id = 0; id < total; id++) {
    const kind = id >= total - bosses ? 'boss' : 'regular';
    const spec = BOT_KINDS[kind];
    const p = world.randomWalkable(rng);
    bots.set(id, {
      id, kind, spec, name: botName(id, kind),
      x: p.x, z: p.z, y: world.footY(p.x, p.z), yaw: rng() * Math.PI * 2 - Math.PI,
      hp: spec.hp, st: ST.alive, stMs: 0, sp: 0,
      cd: spec.shootCd * (0.5 + rng()), shootMs: 0, anim: A.walk,
      target: null, retargetIn: 0, route: [], wpMs: 0,
      strafe: rng() < 0.5 ? -1 : 1, strafeMs: 1500, moving: false,
    });
  }

  // ── players ─────────────────────────────────────────────────────────────────
  function addPlayer(id, init = {}) {
    if (players.has(id)) return players.get(id);
    const pos = Array.isArray(init.pos) ? init.pos : [0, PLAYER_EYE, 0];
    const p = {
      id, x: pos[0], y: pos[1] - PLAYER_EYE, z: pos[2], yaw: Number(init.yaw) || 0,
      hp: PLAYER_HP, alive: true, deadMs: 0, protectMs: SPAWN_PROTECT_MS,
      targetable: init.targetable !== false, shotTick: -1, shots: 0, kills: 0, deaths: 0,
    };
    players.set(id, p);
    return p;
  }
  function updatePlayer(id, pos, yaw) {
    const p = players.get(id);
    if (!p || !Array.isArray(pos)) return;
    if (!pos.every(Number.isFinite)) return;
    p.x = pos[0]; p.y = pos[1] - PLAYER_EYE; p.z = pos[2];
    if (Number.isFinite(yaw)) p.yaw = yaw;
  }
  function removePlayer(id) {
    players.delete(id);
    for (const b of bots.values()) if (b.target === id) b.target = null;
  }
  function setTargetable(id, on) {
    const p = players.get(id);
    if (!p) return;
    p.targetable = !!on;
    if (!on) for (const b of bots.values()) if (b.target === id) b.target = null;
  }
  function canBeHurt(p) { return p && p.alive && p.targetable && p.protectMs <= 0 && world.inPlay(p.x, p.z); }

  // ── damage application ──────────────────────────────────────────────────────
  function damageBot(b, zone, dmg, sid, sk) {
    if (b.st !== ST.alive) return { tk: 'bot', tid: b.id, zone, dmg: 0, hp: 0, killed: false, absorbed: true };
    b.hp = Math.max(0, b.hp - dmg);
    events.push({ type: 'hit', tk: 'bot', tid: b.id, sid, sk, zone, dmg, hp: b.hp });
    if (onDamage && sk === 'player') onDamage(sid, dmg, 'bot');
    let killed = false;
    if (b.hp <= 0) {
      killed = true;
      b.st = ST.dying; b.stMs = BOT_DYING_MS; b.anim = A.die; b.target = null; b.moving = false;
      events.push({ type: 'kill', tk: 'bot', tid: b.id, sid, sk, zone });
      if (onKill && sk === 'player') onKill(sid, 'bot', b.id);
    }
    return { tk: 'bot', tid: b.id, zone, dmg, hp: b.hp, killed, absorbed: false };
  }
  function damagePlayer(p, zone, dmg, sid, sk) {
    if (!canBeHurt(p)) return { tk: 'player', tid: p.id, zone, dmg: 0, hp: p.hp, killed: false, absorbed: true };
    p.hp = Math.max(0, p.hp - dmg);
    events.push({ type: 'hit', tk: 'player', tid: p.id, sid, sk, zone, dmg, hp: p.hp });
    if (onDamage && sk === 'player') onDamage(sid, dmg, 'player');
    let killed = false;
    if (p.hp <= 0) {
      killed = true;
      p.alive = false; p.deadMs = PLAYER_RESPAWN_MS; p.deaths++;
      for (const b of bots.values()) if (b.target === p.id) b.target = null;
      events.push({ type: 'kill', tk: 'player', tid: p.id, sid, sk, zone });
      if (onKill) onKill(sid, sk === 'bot' ? 'botKilledPlayer' : 'player', p.id);
    }
    return { tk: 'player', tid: p.id, zone, dmg, hp: p.hp, killed, absorbed: false };
  }

  // ── player fire ─────────────────────────────────────────────────────────────
  function reject(sid, seq, reason) {
    const r = { type: 'result', sid, seq, ok: false, reason };
    events.push(r);
    return r;
  }

  /**
   * @param {string} sid
   * @param {{seq:number, origin:number[], dir:number[], rt:number,
   *          claim?:{k:'bot'|'player', id:any, zone:'head'|'body', dist:number}|null}} shot
   */
  function fire(sid, shot) {
    const seq = Number.isInteger(shot && shot.seq) ? shot.seq : 0;
    const p = players.get(sid);
    if (!p) return reject(sid, seq, 'unknown');
    if (!p.alive) return reject(sid, seq, 'dead');
    if (!world.inPlay(p.x, p.z)) return reject(sid, seq, 'zone');
    if (p.shotTick !== tick) { p.shotTick = tick; p.shots = 0; }
    if (++p.shots > MAX_SHOTS_PER_TICK) return reject(sid, seq, 'rate');
    const o = shot.origin;
    if (!Array.isArray(o) || o.length !== 3 || !o.every(Number.isFinite)) return reject(sid, seq, 'origin');
    if (Math.hypot(o[0] - p.x, o[1] - (p.y + PLAYER_EYE), o[2] - p.z) > MAX_ORIGIN_DRIFT) return reject(sid, seq, 'origin');
    const d = Array.isArray(shot.dir) && shot.dir.length === 3 ? normalize3(shot.dir) : null;
    if (!d) return reject(sid, seq, 'dir');
    const rt = Math.max(tick - MAX_REWIND_TICKS, Math.min(tick, Number.isFinite(shot.rt) ? shot.rt : tick));
    const [ox, oy, oz] = o, [dx, dy, dz] = d;
    const maxT = world.occlusionT(ox, oy, oz, dx, dy, dz, FIRE_RANGE);

    let best = null; // {kind:'bot'|'player', ref, zone, t}
    const claim = shot.claim;
    if (claim && (claim.k === 'bot' || claim.k === 'player')) {
      if (claim.k === 'bot') {
        const b = bots.get(Number(claim.id));
        const pose = b ? botHist.sample(b.id, rt, _pose) : null;
        if (!b || !pose) return reject(sid, seq, 'target');
        if (pose.st !== ST.alive && b.st !== ST.alive) {
          // Dead at the moment they saw it AND now — nothing to hit.
          return _finish(sid, seq, ox, oy, oz, dx, dy, dz, maxT, null, 'absorbed');
        }
        const v = validateClaim(ox, oy, oz, dx, dy, dz, maxT, pose.x, pose.y, pose.z, b.spec, claim);
        if (!v.ok) return reject(sid, seq, v.reason);
        best = { kind: 'bot', ref: b, zone: v.zone, t: v.t };
      } else {
        const t = players.get(String(claim.id));
        if (!t || t.id === sid) return reject(sid, seq, 'target');
        const pose = playerHist.sample(t.id, rt, _pose) || { x: t.x, y: t.y, z: t.z };
        const v = validateClaim(ox, oy, oz, dx, dy, dz, maxT, pose.x, pose.y, pose.z, PLAYER_BODY, claim);
        if (!v.ok) return reject(sid, seq, v.reason);
        best = { kind: 'player', ref: t, zone: v.zone, t: v.t };
      }
    } else {
      // No claim: the shooter saw no bot under the crosshair, so bots are NOT
      // tested (a coarse body would invent hits on empty air next to the mesh).
      // Peers are resolved against the rewound coarse body.
      for (const t of players.values()) {
        if (t.id === sid || !t.alive) continue;
        const pose = playerHist.sample(t.id, rt, _pose) || { x: t.x, y: t.y, z: t.z };
        const h = rayVsBody(ox, oy, oz, dx, dy, dz, maxT, pose.x, pose.y, pose.z, PLAYER_BODY);
        if (h && (!best || h.t < best.t)) best = { kind: 'player', ref: t, zone: h.zone, t: h.t };
      }
    }
    return _finish(sid, seq, ox, oy, oz, dx, dy, dz, maxT, best, null);
  }

  function _finish(sid, seq, ox, oy, oz, dx, dy, dz, maxT, best, note) {
    const t = best ? best.t : maxT;
    events.push({ type: 'shot', sk: 'player', sid, from: [q2(ox), q2(oy), q2(oz)], to: [q2(ox + dx * t), q2(oy + dy * t), q2(oz + dz * t)] });
    let hit = null;
    if (best) {
      const dmg = damageFor(best.zone);
      hit = best.kind === 'bot' ? damageBot(best.ref, best.zone, dmg, sid, 'player') : damagePlayer(best.ref, best.zone, dmg, sid, 'player');
      if (hit.killed && best.kind === 'player') { const s = players.get(sid); if (s) s.kills++; }
    }
    const r = { type: 'result', sid, seq, ok: true, hit, reason: note || undefined };
    events.push(r);
    return r;
  }

  // ── bot brain ───────────────────────────────────────────────────────────────
  function _eye(b) { return b.y + b.spec.muzzleY; }

  function _pickTarget(b) {
    let best = null, bestD = Infinity;
    for (const p of players.values()) {
      if (!canBeHurt(p)) continue;
      const d = Math.hypot(p.x - b.x, p.z - b.z);
      if (d > b.spec.sight || d >= bestD) continue;
      if (!world.lineOfSight(b.x, _eye(b), b.z, p.x, p.y + 1.3, p.z)) continue;
      best = p; bestD = d;
    }
    return best;
  }

  function _tryMove(b, vx, vz) {
    const nx = b.x + vx * TICK_DT, nz = b.z + vz * TICK_DT;
    if (world.walkable(nx, nz)) { b.x = nx; b.z = nz; return true; }
    if (world.walkable(nx, b.z)) { b.x = nx; return true; }
    if (world.walkable(b.x, nz)) { b.z = nz; return true; }
    return false;
  }

  function _newRoute(b) {
    let wp = null;
    for (let k = 0; k < 24; k++) {
      const c = world.randomWalkable(rng);
      if (Math.hypot(c.x - b.x, c.z - b.z) < 16) { wp = c; break; }
      wp = c;
    }
    b.route = [];
    // Islands meet only at bridge 2: route across it when the goal is on the other side.
    if ((b.x < BRIDGE2_X) !== (wp.x < BRIDGE2_X)) {
      const near = b.x < BRIDGE2_X ? BRIDGE_ENDS[0] : BRIDGE_ENDS[1];
      const far = b.x < BRIDGE2_X ? BRIDGE_ENDS[1] : BRIDGE_ENDS[0];
      b.route.push({ x: near, z: BRIDGE2_Z }, { x: far, z: BRIDGE2_Z });
    }
    b.route.push(wp);
    b.wpMs = 9000;
  }

  function _botFire(b, target) {
    const spec = b.spec;
    const ox = b.x + Math.sin(b.yaw) * 0.3, oy = _eye(b), oz = b.z + Math.cos(b.yaw) * 0.3;
    let dx = target.x - ox, dy = (target.y + 1.25) - oy, dz = target.z - oz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    // Spread: jitter yaw and pitch independently.
    const jy = (rng() * 2 - 1) * spec.spread, jp = (rng() * 2 - 1) * spec.spread * 0.6;
    const cy = Math.cos(jy), sy = Math.sin(jy);
    let rx = dx * cy - dz * sy, rz = dx * sy + dz * cy;
    let ry = dy + jp;
    const M = Math.hypot(rx, ry, rz) || 1;
    rx /= M; ry /= M; rz /= M;
    const maxT = world.occlusionT(ox, oy, oz, rx, ry, rz, SHOT_RANGE);
    let best = null;
    for (const p of players.values()) {
      if (!canBeHurt(p)) continue;
      const h = rayVsBody(ox, oy, oz, rx, ry, rz, maxT, p.x, p.y, p.z, PLAYER_BODY);
      if (h && (!best || h.t < best.t)) best = { p, t: h.t };
    }
    const t = best ? best.t : maxT;
    events.push({ type: 'shot', sk: 'bot', sid: b.id, from: [q2(ox), q2(oy), q2(oz)], to: [q2(ox + rx * t), q2(oy + ry * t), q2(oz + rz * t)] });
    if (best) damagePlayer(best.p, 'body', spec.damage, b.id, 'bot');
    b.cd = spec.shootCd * (0.8 + 0.4 * rng());
    b.shootMs = SHOOT_ANIM_MS;
  }

  function _think(b) {
    const spec = b.spec;
    if (b.shootMs > 0) b.shootMs -= TICK_MS;
    if (b.cd > 0) b.cd -= TICK_DT;
    // Re-evaluate the target 5×/s (LOS is the expensive bit).
    if (--b.retargetIn <= 0) {
      const t = _pickTarget(b);
      b.target = t ? t.id : null;
      b.retargetIn = 4;
    }
    const target = b.target != null ? players.get(b.target) : null;
    let moved = false, anim = A.walk;
    if (target && canBeHurt(target)) {
      const dx = target.x - b.x, dz = target.z - b.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const want = Math.atan2(dx, dz);
      const diff = wrapAngle(want - b.yaw);
      const turn = TURN_RATE * TICK_DT;
      b.yaw = wrapAngle(b.yaw + Math.max(-turn, Math.min(turn, diff)));
      const fx = dx / dist, fz = dz / dist;
      if (dist > ENGAGE_MAX) { moved = _tryMove(b, fx * spec.runSpeed, fz * spec.runSpeed); anim = A.run; }
      else if (dist < ENGAGE_MIN) { moved = _tryMove(b, -fx * spec.speed, -fz * spec.speed); anim = A.walk; }
      else {
        b.strafeMs -= TICK_MS;
        if (b.strafeMs <= 0) { b.strafe = -b.strafe; b.strafeMs = 1200 + rng() * 1600; }
        const sx = fz * b.strafe, sz = -fx * b.strafe;
        moved = _tryMove(b, sx * spec.speed, sz * spec.speed);
        if (!moved) { b.strafe = -b.strafe; b.strafeMs = 900; }
        anim = b.strafe > 0 ? A.strafeR : A.strafeL;
      }
      if (b.cd <= 0 && Math.abs(diff) < AIM_CONE &&
          world.lineOfSight(b.x, _eye(b), b.z, target.x, target.y + 1.3, target.z)) {
        _botFire(b, target);
      }
    } else {
      b.target = null;
      b.wpMs -= TICK_MS;
      if (!b.route.length || b.wpMs <= 0) _newRoute(b);
      const wp = b.route[0];
      const dx = wp.x - b.x, dz = wp.z - b.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.8) { b.route.shift(); }
      else {
        const want = Math.atan2(dx, dz);
        const diff = wrapAngle(want - b.yaw);
        const turn = TURN_RATE * 0.6 * TICK_DT;
        b.yaw = wrapAngle(b.yaw + Math.max(-turn, Math.min(turn, diff)));
        if (Math.abs(diff) < 1.2) moved = _tryMove(b, (dx / dist) * spec.speed, (dz / dist) * spec.speed);
        if (!moved && Math.abs(diff) < 1.2) _newRoute(b);
      }
      anim = moved ? A.walk : A.idle;
    }
    // Keep bots from stacking on one another.
    for (const o of bots.values()) {
      if (o === b || o.st !== ST.alive) continue;
      const ddx = b.x - o.x, ddz = b.z - o.z, d2 = ddx * ddx + ddz * ddz;
      const min = spec.radius + o.spec.radius + 0.2;
      if (d2 > 1e-6 && d2 < min * min) {
        const d = Math.sqrt(d2), push = (min - d) * 0.5;
        const nx = b.x + (ddx / d) * push, nz = b.z + (ddz / d) * push;
        if (world.walkable(nx, nz)) { b.x = nx; b.z = nz; }
      }
    }
    b.y = world.footY(b.x, b.z);
    b.moving = moved;
    b.anim = b.shootMs > 0 ? A.shoot : anim;
  }

  function _respawnBot(b) {
    let best = null, bestScore = -1;
    for (let k = 0; k < 12; k++) {
      const c = world.randomWalkable(rng);
      let nearest = Infinity;
      for (const p of players.values()) if (p.alive) nearest = Math.min(nearest, Math.hypot(p.x - c.x, p.z - c.z));
      const score = Math.min(nearest, 40);
      if (score > bestScore) { bestScore = score; best = c; }
      if (score >= 18) break;
    }
    b.x = best.x; b.z = best.z; b.y = world.footY(b.x, b.z);
    b.yaw = rng() * Math.PI * 2 - Math.PI;
    b.hp = b.spec.hp; b.st = ST.alive; b.stMs = 0; b.sp++;
    b.cd = b.spec.shootCd; b.shootMs = 0; b.anim = A.walk; b.route = []; b.target = null; b.retargetIn = 0;
    events.push({ type: 'spawn', bid: b.id });
  }

  function _respawnPlayer(p) {
    let best = null, bestScore = -1;
    for (let k = 0; k < 16; k++) {
      const c = world.randomWalkable(rng);
      let nearest = Infinity;
      for (const b of bots.values()) if (b.st === ST.alive) nearest = Math.min(nearest, Math.hypot(b.x - c.x, b.z - c.z));
      if (nearest > bestScore) { bestScore = nearest; best = c; }
    }
    const fy = world.footY(best.x, best.z);
    p.x = best.x; p.z = best.z; p.y = fy;
    p.hp = PLAYER_HP; p.alive = true; p.deadMs = 0; p.protectMs = SPAWN_PROTECT_MS;
    events.push({ type: 'respawn', pid: p.id, pos: [q2(best.x), q2(fy + PLAYER_EYE), q2(best.z)], yaw: q3(rng() * Math.PI * 2 - Math.PI) });
  }

  // ── tick ────────────────────────────────────────────────────────────────────
  function step() {
    tick++;
    for (const p of players.values()) {
      if (p.protectMs > 0) p.protectMs -= TICK_MS;
      if (!p.alive) { p.deadMs -= TICK_MS; if (p.deadMs <= 0) _respawnPlayer(p); }
    }
    for (const b of bots.values()) {
      if (b.st === ST.dying) { b.stMs -= TICK_MS; if (b.stMs <= 0) { b.st = ST.dead; b.stMs = BOT_RESPAWN_MS; } }
      else if (b.st === ST.dead) { b.stMs -= TICK_MS; if (b.stMs <= 0) _respawnBot(b); }
      else _think(b);
    }
    _record();
    return drainEvents();
  }

  function _record() {
    const br = new Map();
    for (const b of bots.values()) br.set(b.id, { x: q2(b.x), y: q2(b.y), z: q2(b.z), yaw: q3(b.yaw), st: b.st, sp: b.sp });
    botHist.record(tick, br);
    const pr = new Map();
    for (const p of players.values()) pr.set(p.id, { x: q2(p.x), y: q2(p.y), z: q2(p.z), yaw: q3(p.yaw), st: p.alive ? 0 : 2, sp: 0 });
    playerHist.record(tick, pr);
  }

  function drainEvents() { const e = events; events = []; return e; }

  /** Compact roster: rows [id, kindCode, x, y, z, yaw, hp, st, anim, sp]. */
  function snapshot() {
    const rows = [];
    for (const b of bots.values()) {
      rows.push([b.id, b.kind === 'boss' ? 1 : 0, q2(b.x), q2(b.y), q2(b.z), q3(b.yaw), b.hp, b.st, b.anim, b.sp]);
    }
    return { tick, b: rows };
  }

  _record(); // tick 0 is rewindable from the start

  /** Debug/test seam: deal `n` body damage to bot `id` as player `sid`. */
  function debugDamage(id, n, sid) {
    const b = bots.get(id);
    if (!b || b.st !== ST.alive) return false;
    damageBot(b, 'body', Math.max(0, n | 0), sid, 'player');
    return true;
  }

  return {
    step, fire, snapshot, drainEvents, debugDamage,
    addPlayer, updatePlayer, removePlayer, setTargetable,
    get tick() { return tick; },
    bots, players, botHist, playerHist, world,
  };
}
