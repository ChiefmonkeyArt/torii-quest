// tests/multiplayer/bot-test-mode-respawn.test.js
// ADR-0019 (v0.2.628-alpha): TEST_MODE skips the death arc + 8s respawn so a
// test rig can kill/respawn a bot instantly. This asserts REAL behaviour against
// the actual createBotSim module (no mirror/fake of the module under test).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createBotSim, COVER_MARGIN } from '../../src/engine/entities/botSim.js';
import { buildCoverPoints } from '../../src/engine/entities/bot-tactics.js';
import { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, BOT_SPEED, BOT_DAMAGE } from '../../src/config.js';

afterEach(() => vi.restoreAllMocks());

const CRATES = [[8, 0, 0.75, 0.75, 1.5]];

function makeDeps(configOverrides = {}) {
  return {
    losFn: () => true,
    footY: () => 0,
    clampFence: (x, z) => [x, z],
    pointInFence: () => true,
    fenceBounds: () => ({ minX: -19, maxX: 19, minZ: -19, maxZ: 1 }),
    arenaBoxes: CRATES,
    coverPoints: buildCoverPoints(CRATES, COVER_MARGIN),
    config: {
      BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, BOT_SPEED, BOT_DAMAGE,
      BOSS_COUNT: 0,
      ...configOverrides,
    },
    playerSafeCorner: { x: -18, z: -18, radius: 6 },
    shotCallback: () => {},
    getPlayerCollider: () => null,
  };
}

describe('ADR-0019 TEST_MODE instant respawn', () => {
  it('TEST_MODE=true: killBot sets respawnTimer=0 and skips the death arc', () => {
    const sim = createBotSim(makeDeps({ TEST_MODE: true }));
    const bots = sim.spawnAll(1);
    const bot = bots[0];
    sim.killBot(bot, { x: 0, z: 0 });
    expect(bot.alive).toBe(false);
    expect(bot._isDying).toBe(false);
    expect(bot.respawnTimer).toBe(0);
    expect(bot._blowVx).toBe(0);
    expect(bot._blowVy).toBe(0);
  });

  it('TEST_MODE=true: the bot revives on the very next tick (no 8s wait)', () => {
    const sim = createBotSim(makeDeps({ TEST_MODE: true }));
    const bots = sim.spawnAll(1);
    const bot = bots[0];
    sim.killBot(bot, { x: 0, z: 0 });
    expect(bot.alive).toBe(false);
    sim.tick(1 / 60, []); // one tick → respawnTimer 0 - dt <= 0 → revive
    expect(bot.alive).toBe(true);
    expect(bot.hp).toBe(BOT_HP);
  });

  it('TEST_MODE=false (default): killBot keeps the 8s respawn + death arc', () => {
    const sim = createBotSim(makeDeps()); // no TEST_MODE → false
    const bots = sim.spawnAll(1);
    const bot = bots[0];
    sim.killBot(bot, { x: 0, z: 0 });
    expect(bot.alive).toBe(false);
    expect(bot._isDying).toBe(true);
    expect(bot.respawnTimer).toBe(8.0);
    // A single tick must NOT revive it.
    sim.tick(1 / 60, []);
    expect(bot.alive).toBe(false);
  });

  it('TEST_MODE=true does not change regular bot stats (HP/damage)', () => {
    const sim = createBotSim(makeDeps({ TEST_MODE: true }));
    const bots = sim.spawnAll(1);
    expect(bots[0].hp).toBe(BOT_HP);
    expect(bots[0].damage).toBe(BOT_DAMAGE);
  });
});
