// tests/multiplayer/boss-bot.test.js — the Augustink BOSS archetype (v0.2.381).
//
// The boss is a per-bot stat profile layered on the EXISTING bot AI: big, slow,
// tanky, hard-hitting, named. These tests pin the per-bot stats + spawn split in
// the pure brain (botSim.js), the additive kind/name/scale snapshot + per-bot
// damage/hp/capsule in the server controller (arenaBotSim.js), and the identity
// pass-through in the pure client interpolator (botNetState.js).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBotSim, BOT_R, COVER_MARGIN } from '../../src/engine/entities/botSim.js';
import { buildCoverPoints } from '../../src/engine/entities/bot-tactics.js';
import { createBotNetState } from '../../src/engine/entities/botNetState.js';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { buildBotColliders, rayVsBot, BOT_HEAD_CENTRE_Y } from '../../server/bots/botColliders.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import {
  BOT_COUNT, BOT_HP, BOT_SPEED, BOT_DAMAGE,
  BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_RADIUS, BOSS_NAME,
} from '../../src/config.js';

afterEach(() => vi.restoreAllMocks());

const BOT_SHOOT_CD = 2.6;
const NAP_X = 20;
const CRATES = [[8, 0, 0.75, 0.75, 1.5]];

// Flat open arena with injected fakes. `bossN`/`count` let a test dial the roster.
function makeDeps(overrides = {}) {
  const shots = [];
  const deps = {
    losFn: () => true,
    footY: () => 0,
    clampFence: (x, z) => [x, z],
    pointInFence: () => true,
    fenceBounds: () => ({ minX: -19, maxX: 19, minZ: -19, maxZ: 19 }),
    arenaBoxes: CRATES,
    coverPoints: buildCoverPoints(CRATES, COVER_MARGIN),
    config: {
      BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X, BOT_SPEED, BOT_DAMAGE,
      BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD: 3.5, BOSS_RADIUS, BOSS_NAME,
    },
    playerSafeCorner: { x: -18, z: -18, radius: 6 },
    shotCallback: (origin, dir, target, shooter) => shots.push({ origin, dir, shooter }),
    getPlayerCollider: () => null,
    ...overrides,
  };
  return { deps, shots };
}

describe('pure brain — boss profile + spawn split', () => {
  it('spawnAll spawns (count - BOSS_COUNT) regulars + BOSS_COUNT boss', () => {
    const { deps } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    expect(bots).toHaveLength(BOT_COUNT);
    const bosses = bots.filter((b) => b.kind === 'boss');
    const regulars = bots.filter((b) => b.kind === 'regular');
    expect(bosses).toHaveLength(BOSS_COUNT);
    expect(regulars).toHaveLength(BOT_COUNT - BOSS_COUNT);
  });

  it('stamps boss stats on the boss and leaves regulars byte-identical', () => {
    const { deps } = makeDeps();
    const sim = createBotSim(deps);
    sim.spawnAll(BOT_COUNT);
    const boss = sim.bots.find((b) => b.kind === 'boss');
    const reg = sim.bots.find((b) => b.kind === 'regular');

    expect(boss.name).toBe(BOSS_NAME);
    expect(boss.hp).toBe(BOSS_HP);
    expect(boss.maxHp).toBe(BOSS_HP);
    expect(boss.speed).toBe(BOSS_SPEED);
    expect(boss.damage).toBe(BOSS_DAMAGE);
    expect(boss.radius).toBe(BOSS_RADIUS);

    expect(reg.hp).toBe(BOT_HP);
    expect(reg.speed).toBe(BOT_SPEED);
    expect(reg.damage).toBe(BOT_DAMAGE);
    expect(reg.radius).toBe(BOT_R);
  });

  it('with BOSS_COUNT=0 the roster is byte-identical (all regulars)', () => {
    const { deps } = makeDeps({ config: { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X } });
    const sim = createBotSim(deps);
    sim.spawnAll(BOT_COUNT);
    expect(sim.bots.every((b) => b.kind === 'regular')).toBe(true);
    expect(sim.bots.every((b) => b.hp === BOT_HP)).toBe(true);
  });

  it('the boss moves slower than a same-tier regular over the same chase', () => {
    // Identical spawn (random pinned) + identical tier (index 0) → the only
    // difference is the per-bot speed, so the boss must cover less ground.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const single = { BOT_COUNT: 1, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X, BOT_SPEED, BOT_DAMAGE };

    const reg = createBotSim(makeDeps({ config: { ...single, BOSS_COUNT: 0 } }).deps);
    reg.spawnAll(1);
    const boss = createBotSim(makeDeps({
      config: { ...single, BOSS_COUNT: 1, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_RADIUS, BOSS_NAME },
    }).deps);
    boss.spawnAll(1);

    expect(reg.bots[0].kind).toBe('regular');
    expect(boss.bots[0].kind).toBe('boss');
    const start = { x: reg.bots[0].pos.x, z: reg.bots[0].pos.z };
    const player = [{ x: start.x + 14, y: 1.6, z: start.z, outsideFence: false, flyEnabled: false }];

    for (let i = 0; i < 60; i++) { reg.tick(1 / 60, player); boss.tick(1 / 60, player); }
    const dReg = Math.hypot(reg.bots[0].pos.x - start.x, reg.bots[0].pos.z - start.z);
    const dBoss = Math.hypot(boss.bots[0].pos.x - start.x, boss.bots[0].pos.z - start.z);
    expect(dBoss).toBeLessThan(dReg);
  });

  it('the shotCallback carries the shooting bot per-bot damage', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const { deps, shots } = makeDeps({
      config: { BOT_COUNT: 1, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X, BOT_SPEED, BOT_DAMAGE,
                BOSS_COUNT: 1, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_RADIUS, BOSS_NAME },
    });
    const sim = createBotSim(deps);
    sim.spawnAll(1); // single boss
    const b = sim.bots[0];
    const player = [{ x: b.pos.x, y: 1.6, z: b.pos.z + 2, outsideFence: false, flyEnabled: false }];
    for (let i = 0; i < 600; i++) sim.tick(1 / 60, player);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0].shooter).toBeTruthy();
    expect(shots[0].shooter.damage).toBe(BOSS_DAMAGE);
    expect(shots[0].shooter.kind).toBe('boss');
  });

  it('reviving the boss restores its full boss HP (not BOT_HP)', () => {
    const { deps } = makeDeps();
    const sim = createBotSim(deps);
    sim.spawnAll(BOT_COUNT);
    const boss = sim.bots.find((b) => b.kind === 'boss');
    sim.killBot(boss, { x: 0, z: 0 });
    expect(boss.alive).toBe(false);
    sim.revive(boss);
    expect(boss.alive).toBe(true);
    expect(boss.hp).toBe(BOSS_HP);
  });
});

describe('server controller — additive snapshot + per-bot combat', () => {
  it('snapshot stamps kind/name/scale on the boss and omits them on regulars', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const snap = sim.snapshot();
    const boss = snap.find((b) => b.kind === 1);
    const reg = snap.find((b) => b.kind !== 1);
    expect(boss).toBeTruthy();
    expect(boss.name).toBe(BOSS_NAME);
    expect(boss.scale).toBeGreaterThan(1);
    expect(boss.hp).toBe(BOSS_HP);
    // regular rows stay byte-identical on the wire (no boss-only fields).
    expect(reg.kind).toBeUndefined();
    expect(reg.name).toBeUndefined();
    expect(reg.scale).toBeUndefined();
  });

  it('the boss soaks many hits — BOSS_HP is authoritative', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const bossId = sim.snapshot().find((b) => b.kind === 1).id;
    // A single BOT_HP-sized hit must NOT kill the boss.
    const r1 = sim.applyBotDamage(bossId, BOT_HP, { x: 0, z: 0 });
    expect(r1.killed).toBe(false);
    expect(r1.hpAfter).toBe(BOSS_HP - BOT_HP);
    // The lethal blow needs the full remaining boss HP.
    const r2 = sim.applyBotDamage(bossId, BOSS_HP, { x: 0, z: 0 });
    expect(r2.killed).toBe(true);
  });

  it('the boss capsule is bigger — a ray above a normal head still hits the boss', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const boss = sim.snapshot().find((b) => b.kind === 1);
    const footY = sampleArenaHeight(boss.x, boss.z);
    // Aim ABOVE a normal bot's head centre — only the enlarged boss capsule reaches.
    const y = footY + BOT_HEAD_CENTRE_Y + 0.6;
    const res = sim.resolvePlayerShot([boss.x + 3, y, boss.z], [-1, 0, 0]);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(boss.id);
  });

  it('buildBotColliders grows uniformly with scale', () => {
    const base = buildBotColliders(0, 0, 0, 1);
    const big = buildBotColliders(0, 0, 0, 2);
    expect(big.bodyCap.r).toBeCloseTo(base.bodyCap.r * 2, 6);
    expect(big.headSphere.c[1]).toBeCloseTo(base.headSphere.c[1] * 2, 6);
  });

  it('onBotShot receives the boss per-bot damage when the boss fires', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const hits = [];
    const sim = createArenaBotSim({ onBotShot: (origin, dir, dmg) => hits.push(dmg) });
    sim.spawn(BOT_COUNT);
    const boss = sim.snapshot().find((b) => b.kind === 1);
    // Stand right on the boss so it is by far the nearest shooter.
    const player = { x: boss.x, y: 1.6, z: boss.z + 2, outsideFence: false, flyEnabled: false };
    for (let i = 0; i < 900; i++) sim.tick(1 / 60, [player]);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain(BOSS_DAMAGE);
  });
});

describe('client interpolator — identity pass-through', () => {
  it('threads kind/name/scale from the boss frame through sample()', () => {
    const net = createBotNetState();
    net.ingest([
      { id: 0, x: 0, z: 0, rotY: 0, hp: 5, alive: true, animHint: 'walk' },
      { id: 4, x: 1, z: 1, rotY: 0, hp: 60, alive: true, animHint: 'walk', kind: 1, name: 'Augustink', scale: 2 },
    ], 1000);
    const out = net.sample(1000);
    const reg = out.find((b) => b.id === 0);
    const boss = out.find((b) => b.id === 4);
    expect(reg.kind).toBe('regular');
    expect(reg.scale).toBe(1);
    expect(boss.kind).toBe('boss');
    expect(boss.name).toBe('Augustink');
    expect(boss.scale).toBe(2);
  });

  it('a regular frame with no identity fields defaults to regular/1x', () => {
    const net = createBotNetState();
    net.ingest([{ id: 2, x: 0, z: 0, rotY: 0, hp: 5, alive: true, animHint: 'idle' }], 1000);
    const [b] = net.sample(1000);
    expect(b.kind).toBe('regular');
    expect(b.name).toBe('');
    expect(b.scale).toBe(1);
  });
});
