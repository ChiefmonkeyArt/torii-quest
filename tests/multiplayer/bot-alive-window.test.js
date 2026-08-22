// tests/multiplayer/bot-alive-window.test.js — ADR-0015 (v0.2.625-alpha).
// Guards the death-side lag-comp window: a client-confirmed hit against a bot
// that was ALIVE at the rewound shot instant must resolve even if the bot has
// since died server-side (BOT_KILL hasn't reached the client yet). Also guards
// the v0.2.383 respawn-side fix (dead-at-ts + alive-now still resolves) so this
// change doesn't reopen it.
import { describe, it, expect } from 'vitest';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { BOT_BODY_CENTRE_Y } from '../../server/bots/botColliders.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { BOT_COUNT, BOT_HP } from '../../src/config.js';

function soloBot(sim, target) {
  for (const b of sim.bots) b.alive = b === target;
}

function bodyShotAt(x, z) {
  const footY = sampleArenaHeight(x, z);
  return { origin: [x + 3, footY + BOT_BODY_CENTRE_Y, z], dir: [-1, 0, 0] };
}

describe('ADR-0015 bot alive-window', () => {
  it('THE FIX: alive-at-ts + dead-now still resolves (death-side window)', () => {
    // Bot was alive when the client fired; server killed it before the SHOT
    // arrived (in the last ~viewLag ms). Pre-0.2.625 dropped this silently;
    // now it must resolve because the shooter saw a live target.
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);

    // Snapshot at t=1000 with bot ALIVE at (10, 0).
    b.pos.x = 10; b.pos.z = 0; b.alive = true;
    sim.recordSnapshot(1000);
    // Snapshot at t=1100 also alive (stationary — this test isolates the alive
    // gate, not the position rewind).
    sim.recordSnapshot(1100);

    // Bot dies NOW (t=1200); the in-flight client shot was fired at ts=1000.
    b.alive = false;

    const { origin, dir } = bodyShotAt(10, 0);
    const res = sim.resolvePlayerShot(origin, dir, 1000, 1200, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
    expect(res.zone).toBe('body');
  });

  it('alive-throughout still resolves (baseline, unchanged)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    b.pos.x = 10; b.pos.z = 0; b.alive = true;
    sim.recordSnapshot(1000);
    sim.recordSnapshot(1100);
    const { origin, dir } = bodyShotAt(10, 0);
    const res = sim.resolvePlayerShot(origin, dir, 1050, 1100, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
  });

  it('dead-throughout still skips (no free hits on corpses)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    // Kill the bot BEFORE the first snapshot so both wasAlive and isAlive are false.
    b.alive = false;
    b.pos.x = 10; b.pos.z = 0;
    sim.recordSnapshot(1000);
    sim.recordSnapshot(1100);
    const { origin, dir } = bodyShotAt(10, 0);
    const res = sim.resolvePlayerShot(origin, dir, 1050, 1100, 300);
    expect(res).toBeNull();
  });

  it('dead-at-ts + alive-now still resolves (v0.2.383 respawn guard)', () => {
    // The respawn-side window: bot was dead at rewind ts but has since
    // respawned and is alive now. The client is already rendering it alive
    // (BOT_STATE/BOT_KILL arrived), so a hit must land. This case is covered
    // in bot-lag-comp.test.js but we repeat it here as a co-located regression
    // guard for the OR gate.
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    b.pos.x = 10; b.pos.z = 0; b.alive = false;
    sim.recordSnapshot(1000);
    b.alive = true;
    b.hp = BOT_HP;
    const { origin, dir } = bodyShotAt(10, 0);
    const res = sim.resolvePlayerShot(origin, dir, 1000, 1100, 300);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
  });

  it('posthumous hit against an already-dead bot applies zero damage (no double-kill)', () => {
    // Once wasAlive || isAlive lets the ray-test through, applyBotDamage is the
    // second gate: a bot that's already dead now must not take more damage or
    // fire a second KILL. Guards the "safe-by-construction" claim in ADR-0015.
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.bots[0];
    soloBot(sim, b);
    // Alive at ts → resolves; dead now → applyBotDamage should no-op.
    b.pos.x = 10; b.pos.z = 0; b.alive = true;
    sim.recordSnapshot(1000);
    sim.recordSnapshot(1100);
    b.alive = false;
    b.hp = 0;

    const { origin, dir } = bodyShotAt(10, 0);
    const res = sim.resolvePlayerShot(origin, dir, 1000, 1200, 300);
    expect(res).not.toBeNull(); // rewound-alive gate passes

    const outcome = sim.applyBotDamage(res.botId, 25, { x: 13, z: 0 });
    expect(outcome.hit).toBe(false);
    expect(outcome.killed).toBe(false);
    expect(outcome.hpAfter).toBe(0);
  });
});
