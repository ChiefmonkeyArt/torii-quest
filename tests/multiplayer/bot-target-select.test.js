// tests/multiplayer/bot-target-select.test.js — chunk-2 made the pure bot brain
// multi-target: tick(dt, players[]) picks a per-bot NEAREST-ELIGIBLE (in-fence,
// non-NAP) target, falling back to nearest-overall. Single-player passes a
// 1-element array and must stay byte-identical to passing the bare object.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBotSim, COVER_MARGIN } from '../../src/engine/entities/botSim.js';
import { buildCoverPoints } from '../../src/engine/entities/bot-tactics.js';

const BOT_HP = 5;
const BOT_SHOOT_CD = 2.6;
const NAP_X = 20;
const CRATES = [[8, 0, 0.75, 0.75, 1.5]];

function makeDeps(overrides = {}) {
  const shots = [];
  return {
    deps: {
      losFn: () => true,
      footY: () => 0,
      clampFence: (x, z) => [x, z],
      pointInFence: () => true,
      fenceBounds: () => ({ minX: -19, maxX: 19, minZ: -19, maxZ: 19 }),
      arenaBoxes: CRATES,
      coverPoints: buildCoverPoints(CRATES, COVER_MARGIN),
      config: { BOT_COUNT: 1, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X },
      playerSafeCorner: { x: 9999, z: 9999, radius: 0 },
      shotCallback: (origin, dir) => shots.push({ origin, dir }),
      getPlayerCollider: () => null,
      ...overrides,
    },
    shots,
  };
}

const player = (x, y, z, extra = {}) => ({ x, y, z, outsideFence: false, flyEnabled: false, ...extra });

// Facing a target ⇒ rotY = atan2(target.x - bot.x, target.z - bot.z). After one
// small tick the bot has barely moved, so rotY reveals which target was chosen.
function spawnOneAtOrigin(deps) {
  const sim = createBotSim(deps);
  sim.spawnAll(1);
  sim.bots[0].pos.x = 0;
  sim.bots[0].pos.z = 0;
  sim.bots[0]._coverPoint = null;
  sim.bots[0]._coverTimer = 999; // suppress cover eval so movement stays minimal
  return sim;
}

afterEach(() => vi.restoreAllMocks());

describe('nearest-eligible target selection', () => {
  it('faces the NEARER of two eligible players', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { deps } = makeDeps();
    const sim = spawnOneAtOrigin(deps);
    // A is near on +x; B is far on +z. Nearest eligible = A ⇒ rotY ≈ +π/2.
    sim.tick(1 / 60, [player(4, 0, 0), player(0, 0, 15)]);
    expect(Math.abs(sim.bots[0].rotY - Math.PI / 2)).toBeLessThan(0.4);
  });

  it('skips a NEARER ineligible (NAP) player for a farther eligible one', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const { deps } = makeDeps();
    const sim = spawnOneAtOrigin(deps);
    // A is in the NAP zone (x > NAP_X) ⇒ ineligible. B is eligible on +z ⇒
    // target = B ⇒ rotY ≈ 0.
    sim.tick(1 / 60, [player(25, 0, 3), player(0, 0, 12)]);
    expect(Math.abs(sim.bots[0].rotY)).toBeLessThan(0.4);
  });

  it('does not shoot when the only players are ineligible (all outside fence)', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.0); // maximise shoot readiness
    const { deps, shots } = makeDeps();
    const sim = spawnOneAtOrigin(deps);
    for (let i = 0; i < 120; i++) {
      sim.tick(1 / 60, [player(4, 0, 0, { outsideFence: true })]);
    }
    expect(sim.bots[0].isShooting).toBe(false);
    expect(shots).toHaveLength(0);
  });

  it('sits idle (no shooting, idle hint) when there are zero players', () => {
    const { deps } = makeDeps();
    const sim = spawnOneAtOrigin(deps);
    sim.tick(1 / 60, []);
    expect(sim.bots[0].isShooting).toBe(false);
    expect(sim.bots[0].animHint).toBe('idle');
  });
});

describe('single-player array/object identity', () => {
  it('tick(dt, p) and tick(dt, [p]) produce identical bot state', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.37);
    const a = createBotSim(makeDeps().deps);
    const b = createBotSim(makeDeps().deps);
    a.spawnAll(5);
    b.spawnAll(5);
    const p = player(6, 0, 6);
    for (let i = 0; i < 200; i++) {
      a.tick(1 / 60, p);      // bare object (legacy single-player call)
      b.tick(1 / 60, [p]);    // 1-element array (new MP-shaped call)
    }
    for (let i = 0; i < 5; i++) {
      expect(b.bots[i].pos.x).toBeCloseTo(a.bots[i].pos.x, 10);
      expect(b.bots[i].pos.z).toBeCloseTo(a.bots[i].pos.z, 10);
      expect(b.bots[i].rotY).toBeCloseTo(a.bots[i].rotY, 10);
      expect(b.bots[i].isShooting).toBe(a.bots[i].isShooting);
      expect(b.bots[i].animHint).toBe(a.bots[i].animHint);
    }
  });
});
