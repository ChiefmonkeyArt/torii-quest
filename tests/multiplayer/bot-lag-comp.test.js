// tests/multiplayer/bot-lag-comp.test.js — lag-compensated player→bot shots
// (v0.2.385-alpha). The server records each bot's position at the sim tick and
// rewinds to the shot ts before ray-testing, mirroring the peer lag-comp path,
// so a shot that lands on the ~100ms-old rendered (moving) bot registers.
import { describe, it, expect } from 'vitest';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { BOT_BODY_CENTRE_Y } from '../../server/bots/botColliders.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { BOT_COUNT, BOT_HP, BOSS_HP } from '../../src/config.js';

// Isolate one bot at (x,z): all others dead so only the target is ray-testable.
function soloBot(sim, target) {
  for (const b of sim.bots) b.alive = b === target;
}

// A body-height ray fired from +x straight along -x at fixed z, aimed at (x,z).
function bodyShotAt(x, z) {
  const footY = sampleArenaHeight(x, z);
  return { origin: [x + 3, footY + BOT_BODY_CENTRE_Y, z], dir: [-1, 0, 0] };
}

describe('player→bot lag-compensation', () => {
  it('HITS a moving bot at its ~100ms-old position (would MISS without rewind)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);

    // t=1000: bot at z=0. t=1100: bot slid to z=0.6 (> body radius 0.26).
    b.pos.x = 10; b.pos.z = 0;   sim.recordSnapshot(1000);
    b.pos.x = 10; b.pos.z = 0.6; sim.recordSnapshot(1100);

    const { origin, dir } = bodyShotAt(10, 0); // aim where the bot WAS (rendered)

    // Without lag-comp (2-arg, current position z=0.6) → clean miss.
    expect(sim.resolvePlayerShot(origin, dir)).toBeNull();

    // With lag-comp: rewind to the shot ts (1000) → bot back at z=0 → HIT.
    const res = sim.resolvePlayerShot(origin, dir, 1000, 1100, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
    expect(res.zone).toBe('body');
    expect(Number.isFinite(res.t)).toBe(true);
  });

  it('a true miss (ray nowhere near any bot, old or current) still misses', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    b.pos.x = 10; b.pos.z = 0;   sim.recordSnapshot(1000);
    b.pos.x = 10; b.pos.z = 0.6; sim.recordSnapshot(1100);
    // Fire straight up from far away — no bot on the ray at any time.
    const res = sim.resolvePlayerShot([9000, 0, 9000], [0, 1, 0], 1000, 1100, 300);
    expect(res).toBeNull();
  });

  it('a stationary bot is still hit through the rewind path (no regression)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    b.pos.x = 12; b.pos.z = -3; sim.recordSnapshot(1000);
    b.pos.x = 12; b.pos.z = -3; sim.recordSnapshot(1100); // didn't move
    const { origin, dir } = bodyShotAt(12, -3);
    const res = sim.resolvePlayerShot(origin, dir, 1050, 1100, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
    expect(res.zone).toBe('body');
  });

  it('the boss (scaled collider, HP 60) takes damage + dies the same way with lag-comp', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const boss = sim.bots.find((x) => x.kind === 'boss');
    expect(boss).toBeTruthy();
    expect(boss.hp).toBe(BOSS_HP);
    soloBot(sim, boss);

    boss.pos.x = 20; boss.pos.z = 0;   sim.recordSnapshot(1000);
    boss.pos.x = 20; boss.pos.z = 0.6; sim.recordSnapshot(1100);

    const { origin, dir } = bodyShotAt(20, 0);
    const hit = sim.resolvePlayerShot(origin, dir, 1000, 1100, 300);
    expect(hit).not.toBeNull();
    expect(hit.botId).toBe(boss.id);

    // Damage application is unchanged by lag-comp: HP drains, then a lethal hit kills.
    const r1 = sim.applyBotDamage(boss.id, BOSS_HP - 1, { x: 23, z: 0 });
    expect(r1.killed).toBe(false);
    const r2 = sim.applyBotDamage(boss.id, 1, { x: 23, z: 0 });
    expect(r2.killed).toBe(true);
    expect(sim.getBot(boss.id).alive).toBe(false);
  });

  it('an out-of-range shot ts clamps to the ring window (no crash, no NaN)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    b.pos.x = 10; b.pos.z = 0; sim.recordSnapshot(1000);
    b.pos.x = 10; b.pos.z = 0; sim.recordSnapshot(1100);
    const { origin, dir } = bodyShotAt(10, 0);

    // Ancient ts (older than the window) and far-future ts both clamp cleanly.
    const ancient = sim.resolvePlayerShot(origin, dir, 1, 1_000_000, 300);
    const future = sim.resolvePlayerShot(origin, dir, 9_999_999, 1100, 300);
    for (const res of [ancient, future]) {
      expect(res).not.toBeNull();
      expect(Number.isFinite(res.t)).toBe(true);
      expect(Number.isNaN(res.t)).toBe(false);
    }
  });

  it('falls back to current positions when no ts / no history (2-arg call unchanged)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    b.pos.x = 8; b.pos.z = 1;
    // No recordSnapshot at all → ring empty → resolver uses current positions.
    const { origin, dir } = bodyShotAt(8, 1);
    const res = sim.resolvePlayerShot(origin, dir, 1000, 1100, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
  });
});
