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
  MAX_SHOTS_PER_TICK, MAX_ORIGIN_DRIFT, REACT_S, ALERT_MS, ALERT_RADIUS, ALERT_SIGHT,
  MEMORY_MS, SETTLE_SPEED, SETTLE_MS, FLANK_R,
  AIM_MIN_M, AIM_WANDER_HZ, AIM_TWITCH, AIM_SETTLED, AIM_MOVING, AIM_DODGING, AIM_HURT, AIM_FIRST,
  HURT_MS, LEAD_RATE, LEAD_MAX, AIM_K_MAX, AIM_FAR_M, DODGE_MS, DODGE_CD_MS, DODGE_CHANCE, DODGE_ADAPT, NEAR_MISS_M,
  JUKE_MIN_MS, JUKE_MAX_MS, RETREAT_HP,
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
      // ADR-0136 awareness: who hurt me, last place I saw my target, burst state.
      alertBy: null, alertMs: 0, lastSeen: null, lostMs: 0, burstLeft: 0, settleMs: 0,
      flank: (id * 2.39996323) % (Math.PI * 2), // golden angle: bots fan out around you
      // ADR-0138 human aim + agility.
      ax: 0, ay: 0, lead: 0, firstShot: true, hurtMs: 0,
      dodgeMs: 0, dodgeCd: 0, dodgeDir: 1, threat: 0, jukeSpd: spec.speed, _lvx: 0, _lvz: 0,
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
      px: pos[0], pz: pos[2], speed: 0, // per-tick ground speed (bots read it to settle aim)
      vx: 0, vz: 0, // smoothed ground velocity (bots learn to lead it)
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
    for (const b of bots.values()) if (b.target === id || b.alertBy === id) _forget(b);
  }
  function setTargetable(id, on) {
    const p = players.get(id);
    if (!p) return;
    p.targetable = !!on;
    if (!on) for (const b of bots.values()) if (b.target === id || b.alertBy === id) _forget(b);
  }
  function _forget(b) { b.target = null; b.alertBy = null; b.alertMs = 0; b.lastSeen = null; b.lostMs = 0; b.settleMs = 0; }
  function canBeHurt(p) { return p && p.alive && p.targetable && p.protectMs <= 0 && world.inPlay(p.x, p.z); }

  // ── damage application ──────────────────────────────────────────────────────
  function damageBot(b, zone, dmg, sid, sk) {
    if (b.st !== ST.alive) return { tk: 'bot', tid: b.id, zone, dmg: 0, hp: 0, killed: false, absorbed: true };
    b.hp = Math.max(0, b.hp - dmg);
    events.push({ type: 'hit', tk: 'bot', tid: b.id, sid, sk, zone, dmg, hp: b.hp });
    if (sk === 'player') { _alert(b, sid); b.hurtMs = HURT_MS; _startle(b, sid, null); }
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
      for (const b of bots.values()) if (b.target === p.id || b.alertBy === p.id) _forget(b);
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
    // ADR-0138: rounds that pass close to a bot startle it (it may dodge).
    for (const b of bots.values()) {
      if (b.st !== ST.alive || (best && best.ref === b)) continue;
      const cx = b.x - ox, cy = b.y + b.spec.height * 0.6 - oy, cz = b.z - oz;
      const k = Math.max(0, Math.min(t, cx * dx + cy * dy + cz * dz));
      const mx = cx - dx * k, my = cy - dy * k, mz = cz - dz * k;
      if (mx * mx + my * my + mz * mz < NEAR_MISS_M * NEAR_MISS_M) {
        // side of the bullet line the bot is on: dodge further away from it
        _startle(b, sid, (dx * mz - dz * mx) >= 0 ? -1 : 1);
      }
    }
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
      // An alerted bot looks much further for the player who shot it.
      const sight = b.alertMs > 0 && b.alertBy === p.id ? ALERT_SIGHT : b.spec.sight;
      if (d > sight || d >= bestD) continue;
      if (!world.lineOfSight(b.x, _eye(b), b.z, p.x, p.y + 1.3, p.z)) continue;
      best = p; bestD = d;
    }
    return best;
  }

  // ADR-0136: being shot makes a bot (and its neighbours) hunt the shooter.
  function _alert(b, sid) {
    const p = players.get(sid);
    if (!p || !canBeHurt(p)) return;
    for (const o of bots.values()) {
      if (o.st !== ST.alive) continue;
      if (o !== b && Math.hypot(o.x - b.x, o.z - b.z) > ALERT_RADIUS) continue;
      if (o !== b && o.target != null) continue; // already busy
      o.alertBy = sid; o.alertMs = ALERT_MS;
      o.lastSeen = { x: p.x, z: p.z }; o.lostMs = MEMORY_MS;
      o.retargetIn = 0; // look now
    }
  }

  function _gauss() {
    const u = Math.max(1e-9, rng()), v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  // ADR-0138: a hit or a near miss can trigger a quick side-step. Bots get
  // jumpier the more often you land close (threat), within limits.
  function _startle(b, sid, side) {
    if (b.st !== ST.alive) return;
    b.threat = Math.min(4, b.threat + 1);
    if (b.dodgeCd > 0 || b.dodgeMs > 0) return;
    const chance = Math.min(0.85, (DODGE_CHANCE + DODGE_ADAPT * (b.threat - 1)) * b.spec.agile);
    if (rng() >= chance) return;
    b.dodgeMs = DODGE_MS * (0.6 + 0.8 * rng());
    b.dodgeCd = DODGE_CD_MS + b.dodgeMs;
    b.dodgeDir = side || (rng() < 0.5 ? -1 : 1);
    if (sid != null && b.target == null && players.has(sid)) b.retargetIn = 0;
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
    // Perceived target: where it was `lagTicks` ago, plus however much of your
    // run the bot has learned to lead (ADR-0138). A change of direction (or a
    // stop) makes the learned lead wrong — that's how you beat its aim.
    const past = playerHist.sample(target.id, tick - spec.lagTicks, _pose) || target;
    const lagS = spec.lagTicks * TICK_DT;
    const lx = past.x + target.vx * lagS * b.lead, lz = past.z + target.vz * lagS * b.lead;
    let dx = lx - ox, dy = (past.y + 1.2) - oy, dz = lz - oz;
    const L = Math.hypot(dx, dy, dz) || 1;
    dx /= L; dy /= L; dz /= L;
    // Human error: wandering offset + per-shot twitch, in metres at the target,
    // scaled by what the bot is doing. Sigma grows with range (angular error)
    // but never below AIM_MIN_M, so close misses are the common miss.
    let k = 1;
    if (b.settleMs >= SETTLE_MS) k *= AIM_SETTLED;
    if (b.dodgeMs > 0) k *= AIM_DODGING; else if (b.moving) k *= AIM_MOVING;
    if (b.hurtMs > 0) k *= AIM_HURT;
    if (b.firstShot) k *= AIM_FIRST;
    const Le = L <= AIM_FAR_M ? L : AIM_FAR_M + (L - AIM_FAR_M) * 0.4;
    const sig = Math.max(AIM_MIN_M, spec.aimErr * Le) * Math.min(k, AIM_K_MAX);
    const ex = (b.ax + AIM_TWITCH * _gauss()) * sig;
    const ey = (b.ay * 0.6 + AIM_TWITCH * 0.6 * _gauss()) * sig;
    // Offset the aim point sideways (horizontal right vector) and vertically
    // (world up — bot shots are near-level, so it's close enough).
    let hx = dz, hz = -dx; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    let rx = dx * L + hx * ex, ry = dy * L + ey, rz = dz * L + hz * ex;
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
    b.firstShot = false;
    // Bursts: short gaps inside a burst, the normal cooldown between bursts.
    if (b.burstLeft <= 0) b.burstLeft = spec.burst;
    b.burstLeft--;
    b.cd = b.burstLeft > 0 ? spec.burstGap : spec.shootCd * (0.8 + 0.4 * rng());
    b.shootMs = SHOOT_ANIM_MS;
  }

  // Wandering aim offset (Ornstein–Uhlenbeck, unit variance) + lead reset on
  // a change of direction. Runs every tick for every live bot: a few flops.
  function _tickAim(b, target) {
    const a = AIM_WANDER_HZ * TICK_DT, n = Math.sqrt(2 * a);
    b.ax += -a * b.ax + n * _gauss();
    b.ay += -a * b.ay + n * _gauss();
    if (b.hurtMs > 0) b.hurtMs -= TICK_MS;
    if (b.dodgeCd > 0) b.dodgeCd -= TICK_MS;
    b.threat = Math.max(0, b.threat - TICK_DT * 0.35);
    if (target) {
      const v = Math.hypot(target.vx, target.vz);
      const dot = b._lvx * target.vx + b._lvz * target.vz;
      // Learn your lead while you keep running one way; stopping or reversing
      // makes it wrong, and it starts over (that's how you beat its aim).
      if (v < SETTLE_SPEED * 0.5 || dot < 0) b.lead = 0;
      else b.lead = Math.min(LEAD_MAX, b.lead + LEAD_RATE * TICK_DT);
      b._lvx = target.vx; b._lvz = target.vz;
    }
  }

  function _think(b) {
    const spec = b.spec;
    if (b.shootMs > 0) b.shootMs -= TICK_MS;
    if (b.cd > 0) b.cd -= TICK_DT;
    // Re-evaluate the target 5×/s (LOS is the expensive bit).
    if (b.alertMs > 0) b.alertMs -= TICK_MS;
    if (--b.retargetIn <= 0) {
      const t = _pickTarget(b);
      const was = b.target;
      b.target = t ? t.id : null;
      // Fair reaction beat on first sight; aim settles from scratch.
      if (t && was !== t.id) { b.cd = Math.max(b.cd, REACT_S); b.settleMs = 0; b.burstLeft = 0; b.firstShot = true; b.lead = 0; }
      b.retargetIn = 4;
    }
    const target = b.target != null ? players.get(b.target) : null;
    _tickAim(b, target);
    let moved = false, anim = A.walk;
    if (target && canBeHurt(target)) {
      if (b.lastSeen) { b.lastSeen.x = target.x; b.lastSeen.z = target.z; } else b.lastSeen = { x: target.x, z: target.z };
      b.lostMs = MEMORY_MS;
      b.settleMs = target.speed <= SETTLE_SPEED ? b.settleMs + TICK_MS : 0;
      const dx = target.x - b.x, dz = target.z - b.z;
      const dist = Math.hypot(dx, dz) || 1e-6;
      const want = Math.atan2(dx, dz);
      const diff = wrapAngle(want - b.yaw);
      const turn = TURN_RATE * TICK_DT;
      b.yaw = wrapAngle(b.yaw + Math.max(-turn, Math.min(turn, diff)));
      const fx = dx / dist, fz = dz / dist;
      const hurt = b.hp <= spec.hp * RETREAT_HP;
      if (b.dodgeMs > 0) {
        // ADR-0138 dodge: a quick side-step at run speed, flipping off walls.
        b.dodgeMs -= TICK_MS;
        moved = _tryMove(b, fz * b.dodgeDir * spec.runSpeed, -fx * b.dodgeDir * spec.runSpeed);
        if (!moved) { b.dodgeDir = -b.dodgeDir; moved = _tryMove(b, fz * b.dodgeDir * spec.runSpeed, -fx * b.dodgeDir * spec.runSpeed); }
        anim = b.dodgeDir > 0 ? A.strafeR : A.strafeL;
      }
      else if (dist > ENGAGE_MAX && !hurt) { moved = _tryMove(b, fx * spec.runSpeed, fz * spec.runSpeed); anim = A.run; }
      else if (hurt && dist < ENGAGE_MAX + 3) {
        // Wounded: back off on a diagonal while still fighting.
        const k = spec.speed * 0.7071;
        moved = _tryMove(b, (-fx + fz * b.strafe) * k, (-fz - fx * b.strafe) * k);
        if (!moved) b.strafe = -b.strafe;
        anim = A.walk;
      }
      else if (dist < ENGAGE_MIN) { moved = _tryMove(b, -fx * spec.speed, -fz * spec.speed); anim = A.walk; }
      else {
        // Fan out: drift toward this bot's own spot on a ring around the
        // target (golden-angle slots), strafing once it's there (ADR-0136).
        const gx = target.x + Math.sin(b.flank) * FLANK_R, gz = target.z + Math.cos(b.flank) * FLANK_R;
        const ox = gx - b.x, oz = gz - b.z, od = Math.hypot(ox, oz);
        if (od > 2.5) {
          // side-step toward the slot (perpendicular component only: keeps range)
          const side = (ox * fz - oz * fx) >= 0 ? 1 : -1;
          b.strafe = side;
        }
        b.strafeMs -= TICK_MS;
        if (b.strafeMs <= 0) {
          // Jukes (ADR-0138): irregular reversals at a varied pace.
          b.strafe = -b.strafe;
          b.strafeMs = JUKE_MIN_MS + rng() * (JUKE_MAX_MS - JUKE_MIN_MS);
          b.jukeSpd = Math.min(spec.runSpeed * 0.9, spec.speed * (0.75 + 0.7 * rng() * spec.agile + 0.25 * (1 - spec.agile)));
        }
        const sx = fz * b.strafe, sz = -fx * b.strafe;
        moved = _tryMove(b, sx * b.jukeSpd, sz * b.jukeSpd);
        if (!moved) { b.strafe = -b.strafe; b.strafeMs = 900; }
        anim = b.strafe > 0 ? A.strafeR : A.strafeL;
      }
      if (b.cd <= 0 && Math.abs(diff) < AIM_CONE &&
          world.lineOfSight(b.x, _eye(b), b.z, target.x, target.y + 1.3, target.z)) {
        _botFire(b, target);
      }
    } else if (b.lastSeen && b.lostMs > 0) {
      // Lost sight: run to where it last saw you, then look around.
      b.target = null; b.settleMs = 0;
      b.lostMs -= TICK_MS;
      const dx = b.lastSeen.x - b.x, dz = b.lastSeen.z - b.z, dist = Math.hypot(dx, dz);
      if (dist < 1.2) { b.lostMs = 0; b.lastSeen = null; anim = A.idle; }
      else {
        const want = Math.atan2(dx, dz), diff = wrapAngle(want - b.yaw), turn = TURN_RATE * TICK_DT;
        b.yaw = wrapAngle(b.yaw + Math.max(-turn, Math.min(turn, diff)));
        if (Math.abs(diff) < 1.2) moved = _tryMove(b, (dx / dist) * spec.runSpeed, (dz / dist) * spec.runSpeed);
        if (!moved) { b.lostMs = 0; b.lastSeen = null; }
        anim = moved ? A.run : A.idle;
      }
    } else {
      b.target = null; b.lastSeen = null; b.settleMs = 0;
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
    b.alertBy = null; b.alertMs = 0; b.lastSeen = null; b.lostMs = 0; b.burstLeft = 0; b.settleMs = 0;
    b.ax = b.ay = 0; b.lead = 0; b.firstShot = true; b.hurtMs = 0; b.dodgeMs = 0; b.dodgeCd = 0; b.threat = 0;
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
      const ivx = (p.x - p.px) / TICK_DT, ivz = (p.z - p.pz) / TICK_DT;
      p.speed = Math.hypot(ivx, ivz); p.px = p.x; p.pz = p.z;
      if (p.speed > 12) { p.vx = p.vz = 0; } // teleport / respawn, not running
      else { p.vx += (ivx - p.vx) * 0.5; p.vz += (ivz - p.vz) * 0.5; }
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
