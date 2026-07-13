// tests/multiplayer/bot-sim.test.js — locks down the PURE headless bot AI brain
// (engine/entities/botSim.js) extracted from src/bots.js in the v0.2.376-alpha bot
// milestone. The brain has zero render/audio/physics imports, so it runs in plain
// node with injected fakes: LOS, ground height, coastline clamp/containment,
// arena boxes + cover points, config, a spawn-reject disc, and a shotCallback.
import { describe, it, expect, beforeEach } from 'vitest';
import { createBotSim, BOT_R, EYE_Y, FLY_TARGET_CEILING, COVER_MARGIN }
  from '../../src/engine/entities/botSim.js';
import { buildCoverPoints } from '../../src/engine/entities/bot-tactics.js';

const BOT_COUNT = 5;
const BOT_HP = 5;
const BOT_SHOOT_CD = 2.6;
const NAP_X = 20;
const CRATES = [[8, 0, 0.75, 0.75, 1.5]];

// A wide-open flat arena: ground at y=0, everything inside the fence, clamp is a
// no-op. LOS defaults to clear (true) but is overridable per test. shotCallback
// records every shot so we can assert on suppression / cadence.
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
    config: { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X },
    playerSafeCorner: { x: -18, z: -18, radius: 6 },
    shotCallback: (origin, dir) => shots.push({ origin, dir }),
    getPlayerCollider: () => null,
    ...overrides,
  };
  return { deps, shots };
}

function playerAt(x, y, z, extra = {}) {
  return { x, y, z, outsideFence: false, flyEnabled: false, ...extra };
}

// Run the sim forward `steps` frames toward a fixed player.
function run(sim, player, steps, dt = 1 / 60) {
  for (let i = 0; i < steps; i++) sim.tick(dt, player);
}

describe('botSim spawn', () => {
  it('spawns exactly BOT_COUNT pure states with no THREE.Vector3', () => {
    const { deps } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    expect(bots).toHaveLength(BOT_COUNT);
    expect(sim.bots).toBe(bots);
    for (const b of bots) {
      expect(b.alive).toBe(true);
      expect(b.hp).toBe(BOT_HP);
      // pos is a plain {x,z} bag — not a THREE.Vector3 (no .setX / .isVector3).
      expect(typeof b.pos.x).toBe('number');
      expect(typeof b.pos.z).toBe('number');
      expect(b.pos.isVector3).toBeUndefined();
      expect(b.tier).toBeTruthy();
      expect(['walk', 'idle', 'shoot', 'hit', 'die']).toContain(b.animHint);
    }
  });

  it('re-spawning resets the roster (no accumulation)', () => {
    const { deps } = makeDeps();
    const sim = createBotSim(deps);
    sim.spawnAll(BOT_COUNT);
    sim.spawnAll(BOT_COUNT);
    expect(sim.bots).toHaveLength(BOT_COUNT);
  });

  it('keeps spawns inside the fence via the injected clamp', () => {
    let clampCalls = 0;
    const { deps } = makeDeps({
      // Pretend everything sampled is outside; clamp must pull it to a known point.
      pointInFence: () => false,
      clampFence: (x, z, m) => { clampCalls++; return [1, 2]; },
    });
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    expect(clampCalls).toBeGreaterThanOrEqual(BOT_COUNT);
    for (const b of bots) { expect(b.pos.x).toBe(1); expect(b.pos.z).toBe(2); }
  });
});

describe('botSim movement', () => {
  it('drives a bot toward the player over time', () => {
    const { deps } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    // Isolate one bot far from the player; kill the rest so separation is inert.
    const bot = bots[0];
    bot.pos.x = 0; bot.pos.z = 0;
    for (let i = 1; i < bots.length; i++) bots[i].alive = false;
    const player = playerAt(15, 1.6, 0);
    const before = Math.hypot(player.x - bot.pos.x, player.z - bot.pos.z);
    run(sim, player, 120);
    const after = Math.hypot(player.x - bot.pos.x, player.z - bot.pos.z);
    expect(after).toBeLessThan(before);
  });
});

describe('botSim LOS gate', () => {
  it('suppresses shots when LOS is blocked (through cover)', () => {
    const { deps, shots } = makeDeps({ losFn: () => false });
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    bots.forEach((b, i) => { b.pos.x = 5; b.pos.z = 0; if (i) b.alive = false; });
    run(sim, playerAt(6, 1.6, 0), 300);
    expect(shots).toHaveLength(0);
  });

  it('fires when LOS is clear and within sight, after the reaction dwell', () => {
    const { deps, shots } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    // one hard-tier bot at index 1 (reaction 0.12, cooldown fast); park others.
    const bot = bots[1];
    bots.forEach((b, i) => { if (i !== 1) b.alive = false; });
    bot.pos.x = 5; bot.pos.z = 0;
    bot.shootCd = 0; bot._losTimer = 0;
    // First frame acquires LOS but reaction dwell not yet met → no shot.
    sim.tick(1 / 60, playerAt(6, 1.6, 0));
    expect(shots).toHaveLength(0);
    // Dwell past tier.reaction then it fires.
    run(sim, playerAt(6, 1.6, 0), 60);
    expect(shots.length).toBeGreaterThan(0);
    const s = shots[0];
    expect(s.origin.y).toBeCloseTo(EYE_Y, 6);
    // dir is unit length
    expect(Math.hypot(s.dir.x, s.dir.y, s.dir.z)).toBeCloseTo(1, 3);
  });

  it('enforces a shoot cooldown between shots', () => {
    const { deps, shots } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    const bot = bots[1]; // hard tier
    bots.forEach((b, i) => { if (i !== 1) b.alive = false; });
    bot.pos.x = 5; bot.pos.z = 0; bot.shootCd = 0; bot._losTimer = 10;
    run(sim, playerAt(6, 1.6, 0), 6); // ~0.1s — far shorter than any cooldown
    expect(shots.length).toBeLessThanOrEqual(1);
  });
});

describe('botSim NAP + fly suppression', () => {
  it('does not shoot when the player is in the NAP zone (x > NAP_X)', () => {
    const { deps, shots } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    bots.forEach((b, i) => { b.pos.x = 18; b.pos.z = 0; b._losTimer = 10; b.shootCd = 0; if (i) b.alive = false; });
    run(sim, playerAt(NAP_X + 2, 1.6, 0), 120);
    expect(shots).toHaveLength(0);
  });

  it('does not shoot a flying player above the targeting ceiling', () => {
    const { deps, shots } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    bots.forEach((b, i) => { b.pos.x = 5; b.pos.z = 0; b._losTimer = 10; b.shootCd = 0; if (i) b.alive = false; });
    run(sim, playerAt(6, FLY_TARGET_CEILING + 1, 0, { flyEnabled: true }), 120);
    expect(shots).toHaveLength(0);
  });

  it('does not shoot a player outside the fence (safe zone)', () => {
    const { deps, shots } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    bots.forEach((b, i) => { b.pos.x = 5; b.pos.z = 0; b._losTimer = 10; b.shootCd = 0; if (i) b.alive = false; });
    run(sim, playerAt(6, 1.6, 0, { outsideFence: true }), 120);
    expect(shots).toHaveLength(0);
  });
});

describe('botSim hit → kill → blowback → respawn', () => {
  let sim, bot;
  beforeEach(() => {
    const { deps } = makeDeps();
    sim = createBotSim(deps);
    sim.spawnAll(BOT_COUNT);
    bot = sim.bots[0];
    bot.pos.x = 0; bot.pos.z = 0;
  });

  it('hit reduces hp and flags the hit without killing', () => {
    const res = sim.hitBot(bot, 1, { x: 10, y: 1.6, z: 0 });
    expect(res).toEqual({ hit: true, killed: false });
    expect(bot.hp).toBe(BOT_HP - 1);
    expect(bot._isHit).toBe(true);
    expect(bot.alive).toBe(true);
  });

  it('lethal damage kills, sets blowback away from the player, and reports killed', () => {
    const res = sim.hitBot(bot, BOT_HP, { x: 10, y: 1.6, z: 0 });
    expect(res.killed).toBe(true);
    expect(bot.alive).toBe(false);
    expect(bot._isDying).toBe(true);
    expect(bot.respawnTimer).toBeGreaterThan(0);
    // player is +x of the bot → blowback pushes the corpse in −x, up in +y.
    expect(bot._blowVx).toBeLessThan(0);
    expect(bot._blowVy).toBeGreaterThan(0);
    expect(bot.animHint).toBe('die');
  });

  it('ticks blowback then hides then revives after the respawn timer', () => {
    sim.killBot(bot, { x: 10, y: 1.6, z: 0 });
    const startX = bot.pos.x;
    // Blowback carries the corpse away from the player while dying.
    run(sim, playerAt(10, 1.6, 0), 30);
    expect(bot.pos.x).toBeLessThan(startX);
    expect(bot._isDying).toBe(true);
    // Death anim ends (~2.67s) → stops dying but still dead awaiting respawn.
    run(sim, playerAt(10, 1.6, 0), 60 * 3);
    expect(bot._isDying).toBe(false);
    expect(bot.alive).toBe(false);
    // Respawn timer (8s from kill) elapses → revived, full hp, fresh flags.
    run(sim, playerAt(10, 1.6, 0), 60 * 6);
    expect(bot.alive).toBe(true);
    expect(bot.hp).toBe(BOT_HP);
    expect(bot._isDying).toBe(false);
    expect(bot._coverPoint).toBeNull();
  });
});

describe('botSim coastline containment', () => {
  it('keeps a moving bot inside the fence via the injected clamp', () => {
    const clamped = [];
    // A clamp that hard-caps |x|,|z| ≤ 10 so we can prove movement respects it.
    const { deps } = makeDeps({
      clampFence: (x, z, m) => {
        const cx = Math.max(-10, Math.min(10, x));
        const cz = Math.max(-10, Math.min(10, z));
        clamped.push([cx, cz]);
        return [cx, cz];
      },
    });
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    bots.forEach((b, i) => { b.pos.x = 9.5; b.pos.z = 0; if (i) b.alive = false; });
    // Player far outside the clamp region pulls the bot toward the boundary.
    run(sim, playerAt(100, 1.6, 0), 240);
    expect(bots[0].pos.x).toBeLessThanOrEqual(10);
    expect(bots[0].pos.x).toBeGreaterThanOrEqual(-10);
  });
});

describe('botSim purity', () => {
  it('exports the shared tuning constants used by the wrapper', () => {
    expect(BOT_R).toBeCloseTo(0.4, 6);
    expect(EYE_Y).toBeCloseTo(0.9, 6);
    expect(FLY_TARGET_CEILING).toBe(21);
    expect(COVER_MARGIN).toBeCloseTo(0.4 + 0.35, 6);
  });

  it('routes shots through the injected shotCallback (no direct side-effects)', () => {
    const { deps, shots } = makeDeps();
    const sim = createBotSim(deps);
    const bots = sim.spawnAll(BOT_COUNT);
    const bot = bots[1];
    bots.forEach((b, i) => { if (i !== 1) b.alive = false; });
    bot.pos.x = 5; bot.pos.z = 0; bot.shootCd = 0; bot._losTimer = 10;
    run(sim, playerAt(6, 1.6, 0), 2);
    expect(shots.length).toBeGreaterThan(0);
    expect(shots[0].origin).toHaveProperty('x');
    expect(shots[0].dir).toHaveProperty('x');
  });
});
