// tests/gamezone/core.test.js — Game Zone v2 core rules (ADR-0130).
//
// Locks the user's acceptance criteria at the rules level:
//   • head/body is consistent (decided by impact height, not shape overlap)
//   • a bot that takes lethal damage dies — immediately, exactly once
//   • a dying/dead bot can never be hit again (no ghost hits)
//   • the roster the clients render is exactly the authority's roster
//   • points unchanged: head 9 / body 3, bot 5 HP, boss 60 HP
import { describe, it, expect } from 'vitest';
import {
  wrapAngle, lerpAngle, raySphere, rayCapsule, createRng, normalize3,
} from '../../src/gamezone/core/geom.js';
import { createHistory } from '../../src/gamezone/core/history.js';
import { rayVsBody, validateClaim } from '../../src/gamezone/core/body.js';
import { createGameZoneSim, ST, damageFor, botName } from '../../src/gamezone/core/sim.js';
import {
  BOT_KINDS, HEAD_DAMAGE, BODY_DAMAGE, BOT_HP, BOSS_HP, PLAYER_HP, BOT_DYING_MS, BOT_RESPAWN_MS,
  TICK_MS, MAX_REWIND_TICKS, SPAWN_PROTECT_MS, PLAYER_RESPAWN_MS, PLAYER_EYE,
} from '../../src/gamezone/core/constants.js';
import * as CORE from '../../src/gamezone/core/index.js';
import { flatWorld } from './_flatWorld.js';

const REG = BOT_KINDS.regular;
const ticksFor = (ms) => Math.ceil(ms / TICK_MS);

// Aim from `o` at the point (x, y, z); returns {dir, dist} to the bot's surface.
function aim(o, x, y, z, radius = REG.radius) {
  const d = [x - o[0], y - o[1], z - o[2]];
  const L = Math.hypot(...d);
  return { dir: d.map((v) => v / L), dist: L - radius };
}

function makeSim(opts = {}) {
  const world = opts.world || flatWorld();
  const kills = [], dmg = [];
  const sim = createGameZoneSim({
    world, seed: 11, roster: opts.roster || { total: 2, bosses: 0 },
    onDamage: (sid, n, tk) => dmg.push({ sid, n, tk }),
    onKill: (sid, kind, tid) => kills.push({ sid, kind, tid }),
  });
  return { sim, world, kills, dmg };
}

function seat(sim, id = 'p1', pos = [0, PLAYER_EYE, 0]) {
  sim.addPlayer(id, { pos });
  return pos;
}

function shootBot(sim, sid, botId, y, { seq = 1, zone, rt, origin } = {}) {
  const b = sim.bots.get(botId);
  const o = origin || [sim.players.get(sid).x, sim.players.get(sid).y + PLAYER_EYE, sim.players.get(sid).z];
  const a = aim(o, b.x, b.y + y, b.z, b.spec.radius);
  return sim.fire(sid, { seq, origin: o, dir: a.dir, rt: rt ?? sim.tick, claim: { k: 'bot', id: botId, zone: zone || (y >= b.spec.neckY ? 'head' : 'body'), dist: a.dist } });
}

describe('geom', () => {
  it('wrapAngle is O(1), non-finite-safe and stays in [-π, π)', () => {
    expect(wrapAngle(NaN)).toBe(0);
    expect(wrapAngle(Infinity)).toBe(0);
    for (let k = -40; k <= 40; k++) {
      const r = wrapAngle(k * 1.37);
      expect(r).toBeGreaterThanOrEqual(-Math.PI);
      expect(r).toBeLessThan(Math.PI);
    }
  });
  it('lerpAngle takes the short way across the ±π seam', () => {
    const m = lerpAngle(Math.PI - 0.1, -Math.PI + 0.1, 0.5);
    expect(Math.abs(Math.abs(m) - Math.PI)).toBeLessThan(1e-9);
  });
  it('raySphere / rayCapsule hit and miss', () => {
    expect(raySphere(0, 0, 0, 1, 0, 0, 5, 0, 0, 1)).toBeCloseTo(4, 9);
    expect(raySphere(0, 0, 0, 1, 0, 0, 5, 3, 0, 1)).toBeLessThan(0);
    expect(rayCapsule(0, 1, 0, 1, 0, 0, 5, 0.5, 0, 5, 1.5, 0, 0.4)).toBeCloseTo(4.6, 6);
    expect(rayCapsule(0, 3, 0, 1, 0, 0, 5, 0.5, 0, 5, 1.5, 0, 0.4)).toBeLessThan(0);
  });
  it('createRng is deterministic per seed', () => {
    const a = createRng(5), b = createRng(5), c = createRng(6);
    const sa = [a(), a(), a()], sb = [b(), b(), b()];
    expect(sa).toEqual(sb);
    expect(c()).not.toBe(sa[0]);
  });
  it('normalize3 rejects zero / non-finite vectors', () => {
    expect(normalize3([0, 0, 0])).toBeNull();
    expect(normalize3([NaN, 0, 1])).toBeNull();
    expect(normalize3([3, 0, 4])).toEqual([0.6, 0, 0.8]);
  });
});

describe('history', () => {
  it('interpolates between ticks and clamps at the newest frame (never extrapolates)', () => {
    const h = createHistory(8);
    h.record(1, new Map([[0, { x: 0, y: 0, z: 0, yaw: 0, st: 0, sp: 0 }]]));
    h.record(2, new Map([[0, { x: 2, y: 0, z: 4, yaw: 0, st: 0, sp: 0 }]]));
    expect(h.sample(0, 1.5)).toMatchObject({ x: 1, z: 2 });
    expect(h.sample(0, 9)).toMatchObject({ x: 2, z: 4 });
    expect(h.sample(7, 1.5)).toBeNull();
    expect(h.sample(0, NaN)).toBeNull();
  });
  it('never lerps across a respawn (sp) or lifecycle (st) edge', () => {
    const h = createHistory(8);
    h.record(1, new Map([[0, { x: 0, y: 0, z: 0, yaw: 0, st: 0, sp: 0 }]]));
    h.record(2, new Map([[0, { x: 50, y: 0, z: 0, yaw: 0, st: 0, sp: 1 }]]));
    expect(h.sample(0, 1.4).x).toBe(0);
    expect(h.sample(0, 1.6).x).toBe(50);
  });
  it('the ring forgets frames older than its size', () => {
    const h = createHistory(4);
    for (let t = 0; t < 10; t++) h.record(t, new Map([[0, { x: t, y: 0, z: 0, yaw: 0, st: 0, sp: 0 }]]));
    expect(h.frameAt(2)).toBeNull();
    expect(h.frameAt(9).get(0).x).toBe(9);
  });
});

describe('body — consistent zones', () => {
  it('the zone depends only on impact height, not on the shooter height', () => {
    // Same impact point (y = 1.50 on a bot at x = 10) from a low and a high shooter.
    for (const oy of [0.6, 1.7, 3.5]) {
      const a = aim([0, oy, 0], 10, 1.5, 0);
      const h = rayVsBody(0, oy, 0, ...a.dir, 100, 10, 0, 0, REG);
      expect(h.zone).toBe('head');
    }
    for (const oy of [0.6, 1.7, 3.5]) {
      const a = aim([0, oy, 0], 10, 1.2, 0);
      expect(rayVsBody(0, oy, 0, ...a.dir, 100, 10, 0, 0, REG).zone).toBe('body');
    }
  });
  it('validateClaim: honest claims pass; off-target/occluded/far claims are rejected', () => {
    const a = aim([0, 1.7, 0], 10, 1.0, 0);
    expect(validateClaim(0, 1.7, 0, ...a.dir, 100, 10, 0, 0, REG, { zone: 'body', dist: a.dist })).toMatchObject({ ok: true, zone: 'body' });
    const off = aim([0, 1.7, 0], 10, 1.0, 5);
    expect(validateClaim(0, 1.7, 0, ...off.dir, 100, 10, 0, 0, REG, { zone: 'body', dist: 10 }).reason).toBe('geom');
    expect(validateClaim(0, 1.7, 0, ...a.dir, 5, 10, 0, 0, REG, { zone: 'body', dist: a.dist }).reason).toBe('occluded');
    expect(validateClaim(0, 1.7, 0, ...a.dir, 100, 10, 0, 0, REG, { zone: 'body', dist: a.dist + 8 }).reason).toBe('dist');
    // A claim far SHORT of the target never even reaches it along the ray.
    expect(validateClaim(0, 1.7, 0, ...a.dir, 100, 10, 0, 0, REG, { zone: 'body', dist: 3 }).ok).toBe(false);
  });
  it('a head claim that strikes below headMinY is downgraded to body', () => {
    const a = aim([0, 1.7, 0], 10, 0.4, 0);
    expect(validateClaim(0, 1.7, 0, ...a.dir, 100, 10, 0, 0, REG, { zone: 'head', dist: a.dist }).zone).toBe('body');
  });
});

describe('sim — points unchanged', () => {
  it('head 9 / body 3, bot 5 HP, boss 60 HP', () => {
    expect([HEAD_DAMAGE, BODY_DAMAGE, BOT_HP, BOSS_HP]).toEqual([9, 3, 5, 60]);
    expect(damageFor('head')).toBe(9);
    expect(damageFor('body')).toBe(3);
  });
  it('the core barrel re-exports the sim + protocol', () => {
    expect(typeof CORE.createGameZoneSim).toBe('function');
    expect(typeof CORE.validateFire).toBe('function');
  });
});

describe('sim — roster', () => {
  it('spawns exactly the roster; bosses are the last ids', () => {
    const { sim } = makeSim({ roster: { total: 4, bosses: 1 } });
    const rows = sim.snapshot().b;
    expect(rows.map((r) => r[0])).toEqual([0, 1, 2, 3]);
    expect(rows.map((r) => r[1])).toEqual([0, 0, 0, 1]);
    expect(rows.map((r) => r[6])).toEqual([BOT_HP, BOT_HP, BOT_HP, BOSS_HP]);
    expect(botName(3, 'boss')).toBe(sim.bots.get(3).name);
  });
  it('refuses to start on an unbuilt world', () => {
    expect(() => createGameZoneSim({ world: { ready: false } })).toThrow(/world/);
  });
});

describe('sim — bots die when hit', () => {
  it('one headshot kills a regular bot; events, result and score hooks agree', () => {
    const { sim, kills, dmg } = makeSim();
    seat(sim);
    const r = shootBot(sim, 'p1', 0, 1.6);
    expect(r).toMatchObject({ ok: true, hit: { tk: 'bot', tid: 0, zone: 'head', dmg: 9, hp: 0, killed: true } });
    const ev = sim.drainEvents();
    expect(ev.map((e) => e.type)).toEqual(['shot', 'hit', 'kill', 'result']);
    expect(sim.bots.get(0).st).toBe(ST.dying);
    expect(kills).toEqual([{ sid: 'p1', kind: 'bot', tid: 0 }]);
    expect(dmg).toEqual([{ sid: 'p1', n: 9, tk: 'bot' }]);
  });
  it('two body shots kill a regular bot (3 + 3 ≥ 5)', () => {
    const { sim } = makeSim();
    seat(sim);
    expect(shootBot(sim, 'p1', 0, 1.0, { seq: 1 }).hit).toMatchObject({ zone: 'body', hp: 2, killed: false });
    expect(shootBot(sim, 'p1', 0, 1.0, { seq: 2 }).hit).toMatchObject({ zone: 'body', hp: 0, killed: true });
  });
  it('a dying bot absorbs nothing more — no double kill, no ghost hits', () => {
    const { sim, kills } = makeSim();
    seat(sim);
    shootBot(sim, 'p1', 0, 1.6, { seq: 1 });
    sim.step();
    const r2 = shootBot(sim, 'p1', 0, 1.6, { seq: 2 });
    expect(r2.ok).toBe(true);
    expect(r2.hit == null || r2.hit.absorbed === true).toBe(true);
    expect(kills).toHaveLength(1);
  });
  it('dying → dead → respawn bumps sp, restores hp and emits spawn', () => {
    const { sim } = makeSim();
    seat(sim);
    shootBot(sim, 'p1', 0, 1.6);
    sim.drainEvents();
    for (let i = 0; i < ticksFor(BOT_DYING_MS); i++) sim.step();
    expect(sim.bots.get(0).st).toBe(ST.dead);
    let spawned = false;
    for (let i = 0; i < ticksFor(BOT_RESPAWN_MS) + 1 && !spawned; i++) {
      spawned = sim.step().some((e) => e.type === 'spawn' && e.bid === 0);
    }
    expect(spawned).toBe(true);
    const b = sim.bots.get(0);
    expect(b).toMatchObject({ st: ST.alive, hp: BOT_HP, sp: 1 });
  });
  it('the boss takes 9 per headshot and dies at 60', () => {
    const { sim } = makeSim({ roster: { total: 1, bosses: 1 } });
    seat(sim);
    let last;
    for (let i = 0; i < 7; i++) { last = shootBot(sim, 'p1', 0, 2.8, { seq: i }); sim.step(); }
    expect(last.hit).toMatchObject({ zone: 'head', killed: true, hp: 0 });
  });
});

describe('sim — claims are required for bot hits', () => {
  it('a claimless shot straight through a bot does NOT hit it', () => {
    const { sim } = makeSim();
    seat(sim);
    const b = sim.bots.get(0);
    const a = aim([0, PLAYER_EYE, 0], b.x, 1.0, b.z);
    const r = sim.fire('p1', { seq: 1, origin: [0, PLAYER_EYE, 0], dir: a.dir, rt: sim.tick });
    expect(r).toMatchObject({ ok: true, hit: null });
    expect(sim.bots.get(0).hp).toBe(BOT_HP);
  });
  it('a claimless shot still resolves against peers (after spawn protection)', () => {
    const { sim } = makeSim({ roster: { total: 0, bosses: 0 } });
    seat(sim, 'p1', [0, PLAYER_EYE, 0]);
    seat(sim, 'p2', [10, PLAYER_EYE, 0]);
    for (let i = 0; i < ticksFor(SPAWN_PROTECT_MS) + 1; i++) sim.step();
    const r = sim.fire('p1', { seq: 1, origin: [0, PLAYER_EYE, 0], dir: [1, 0, 0], rt: sim.tick });
    expect(r.hit).toMatchObject({ tk: 'player', tid: 'p2', zone: 'head', dmg: 9 });
    expect(sim.players.get('p2').hp).toBe(PLAYER_HP - 9);
  });
  it('spawn protection absorbs peer damage', () => {
    const { sim } = makeSim({ roster: { total: 0, bosses: 0 } });
    seat(sim, 'p1');
    seat(sim, 'p2', [10, PLAYER_EYE, 0]);
    const r = sim.fire('p1', { seq: 1, origin: [0, PLAYER_EYE, 0], dir: [1, 0, 0], rt: sim.tick });
    expect(r.hit).toMatchObject({ absorbed: true, dmg: 0 });
  });
});

describe('sim — every reject reason', () => {
  const base = (sim, extra = {}) => ({ seq: 1, origin: [0, PLAYER_EYE, 0], dir: [1, 0, 0], rt: sim.tick, ...extra });
  it('unknown / dead / zone', () => {
    const { sim } = makeSim({ world: flatWorld({ outOfPlay: (x) => x < -50 }) });
    expect(sim.fire('ghost', base(sim)).reason).toBe('unknown');
    seat(sim);
    sim.players.get('p1').alive = false;
    expect(sim.fire('p1', base(sim)).reason).toBe('dead');
    seat(sim, 'p3', [-60, PLAYER_EYE, 0]);
    expect(sim.fire('p3', base(sim, { origin: [-60, PLAYER_EYE, 0] })).reason).toBe('zone');
  });
  it('rate: more than 3 shots in one tick', () => {
    const { sim } = makeSim();
    seat(sim);
    const rs = [1, 2, 3, 4].map((seq) => sim.fire('p1', base(sim, { seq, dir: [0, 0, 1] })));
    expect(rs.map((r) => r.reason || 'ok')).toEqual(['ok', 'ok', 'ok', 'rate']);
    sim.step();
    expect(sim.fire('p1', base(sim, { seq: 5, dir: [0, 0, 1] })).ok).toBe(true);
  });
  it('origin far from the eye / bad dir / unknown target', () => {
    const { sim } = makeSim();
    seat(sim);
    expect(sim.fire('p1', base(sim, { origin: [5, PLAYER_EYE, 0] })).reason).toBe('origin');
    expect(sim.fire('p1', base(sim, { origin: [NaN, 0, 0] })).reason).toBe('origin');
    sim.step();
    expect(sim.fire('p1', base(sim, { dir: [0, 0, 0] })).reason).toBe('dir');
    expect(sim.fire('p1', base(sim, { claim: { k: 'bot', id: 99, zone: 'head', dist: 5 } })).reason).toBe('target');
    sim.step();
    expect(sim.fire('p1', base(sim, { claim: { k: 'player', id: 'p1', zone: 'head', dist: 5 } })).reason).toBe('target');
  });
  it('geom / occluded / dist on a bot claim', () => {
    const { sim } = makeSim({ world: flatWorld({ wallX: 24 }) });
    seat(sim);
    const b = sim.bots.get(0);
    // Ray well off to the side of the bot.
    expect(sim.fire('p1', base(sim, { dir: normalize3([b.x, 0, b.x * 0.5]), claim: { k: 'bot', id: 0, zone: 'body', dist: b.x } })).reason).toBe('geom');
    // Wall at x=24 sits in front of the bot at x=26.
    const a = aim([0, PLAYER_EYE, 0], b.x, 1.0, b.z);
    expect(sim.fire('p1', base(sim, { dir: a.dir, claim: { k: 'bot', id: 0, zone: 'body', dist: a.dist } })).reason).toBe('occluded');
  });
  it('dist: claimed distance disagrees with where the bot was', () => {
    const { sim } = makeSim();
    seat(sim);
    const b = sim.bots.get(0);
    const a = aim([0, PLAYER_EYE, 0], b.x, 1.0, b.z);
    expect(sim.fire('p1', { seq: 1, origin: [0, PLAYER_EYE, 0], dir: a.dir, rt: sim.tick, claim: { k: 'bot', id: 0, zone: 'body', dist: a.dist + 9 } }).reason).toBe('dist');
  });
});

describe('sim — lag compensation by render tick', () => {
  it('a shot is validated against where the bot was at the claimed render tick', () => {
    const { sim } = makeSim({ roster: { total: 1, bosses: 0 } });
    seat(sim);
    for (let i = 0; i < ticksFor(SPAWN_PROTECT_MS) + 2; i++) sim.step();
    const rt = sim.tick;
    const then = { ...sim.botHist.sample(0, rt) };
    for (let i = 0; i < MAX_REWIND_TICKS - 2; i++) sim.step();
    const now = sim.bots.get(0);
    expect(Math.hypot(now.x - then.x, now.z - then.z)).toBeGreaterThan(0.2); // it moved
    const p = sim.players.get('p1');
    if (!p.alive) return; // the bot shot us dead in the meantime — covered elsewhere
    const o = [p.x, p.y + PLAYER_EYE, p.z];
    const a = aim(o, then.x, then.y + 1.0, then.z);
    const r = sim.fire('p1', { seq: 1, origin: o, dir: a.dir, rt, claim: { k: 'bot', id: 0, zone: 'body', dist: a.dist } });
    expect(r.ok).toBe(true);
    expect(r.hit).toMatchObject({ tk: 'bot', tid: 0 });
  });
  it('rewind is clamped to MAX_REWIND_TICKS (a 2 s old pose cannot be claimed)', () => {
    const { sim } = makeSim({ roster: { total: 1, bosses: 0 }, world: flatWorld({ spawn: (k) => (k === 0 ? { x: 30, z: 0 } : { x: 30, z: 14 }) }) });
    seat(sim, 'p1', [0, PLAYER_EYE, -40]); // far away + behind spawn protection: the bot wanders
    for (let i = 0; i < 40; i++) sim.step();
    const old = { ...sim.botHist.sample(0, 0) };
    const clamped = sim.botHist.sample(0, sim.tick - MAX_REWIND_TICKS);
    const moved = Math.hypot(old.x - clamped.x, old.z - clamped.z);
    expect(moved).toBeGreaterThan(REG.envR + 1); // precondition: it really wandered off
    const o = [0, PLAYER_EYE, -40];
    const a = aim(o, old.x, old.y + 1.0, old.z);
    const r = sim.fire('p1', { seq: 1, origin: o, dir: a.dir, rt: 0, claim: { k: 'bot', id: 0, zone: 'body', dist: a.dist } });
    expect(r.ok).toBe(false);
  });
});

describe('sim — bots fight back; kami is untargetable', () => {
  it('bots kill an exposed player, the hook reports botKilledPlayer, and the player respawns', () => {
    const { sim, kills } = makeSim({ roster: { total: 2, bosses: 0 }, world: flatWorld({ spawn: (k) => ({ x: 7 + k, z: 0 }) }) });
    seat(sim);
    sim.players.get('p1').hp = 1; // one bot hit is lethal — keeps the test short
    let died = false, respawned = false;
    for (let i = 0; i < 3000 && !respawned; i++) {
      const ev = sim.step();
      if (ev.some((e) => e.type === 'kill' && e.tk === 'player')) died = true;
      if (died && ev.some((e) => e.type === 'respawn' && e.pid === 'p1')) respawned = true;
    }
    expect(died).toBe(true);
    expect(respawned).toBe(true);
    expect(kills.some((k) => k.kind === 'botKilledPlayer' && k.tid === 'p1')).toBe(true);
    expect(sim.players.get('p1').hp).toBe(PLAYER_HP);
    expect(PLAYER_RESPAWN_MS).toBeGreaterThan(0);
  });
  it('a non-targetable (Kami) player is never shot', () => {
    const { sim } = makeSim({ roster: { total: 2, bosses: 0 }, world: flatWorld({ spawn: (k) => ({ x: 7 + k, z: 0 }) }) });
    seat(sim);
    sim.setTargetable('p1', false);
    for (let i = 0; i < 600; i++) {
      const ev = sim.step();
      expect(ev.some((e) => e.type === 'hit' && e.tk === 'player')).toBe(false);
    }
    expect(sim.players.get('p1').hp).toBe(PLAYER_HP);
  });
});

describe('sim — determinism + debug seam', () => {
  it('same seed + same inputs ⇒ identical snapshots', () => {
    const run = () => {
      const { sim } = makeSim({ roster: { total: 3, bosses: 1 } });
      seat(sim);
      const out = [];
      for (let i = 0; i < 200; i++) { sim.step(); if (i % 20 === 0) out.push(JSON.stringify(sim.snapshot())); }
      return out;
    };
    expect(run()).toEqual(run());
  });
  it('debugDamage applies body damage through the normal path', () => {
    const { sim, dmg } = makeSim();
    expect(sim.debugDamage(0, 5, 'dbg')).toBe(true);
    expect(sim.bots.get(0).st).toBe(ST.dying);
    expect(sim.debugDamage(0, 5, 'dbg')).toBe(false);
    expect(sim.debugDamage(42, 5, 'dbg')).toBe(false);
    expect(dmg[0]).toEqual({ sid: 'dbg', n: 5, tk: 'bot' });
  });
  it('removing a player clears bot targets', () => {
    const { sim } = makeSim({ world: flatWorld({ spawn: (k) => ({ x: 7 + k, z: 0 }) }) });
    seat(sim);
    for (let i = 0; i < 10; i++) sim.step();
    sim.removePlayer('p1');
    for (const b of sim.bots.values()) expect(b.target).toBeNull();
  });
});
