// tests/multiplayer/arena-bot-sim.test.js — the SERVER-authoritative bot
// controller (server/bots/arenaBotSim.js). Wraps the pure brain with headless
// deps and owns: player→bot shot resolution, authoritative bot damage, the
// throttled BOT_STATE snapshot, and (via the injected onBotShot) bot→player fire.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { BOT_BODY_CENTRE_Y, BOT_HEAD_CENTRE_Y } from '../../server/bots/botColliders.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { BOT_COUNT, BOT_HP } from '../../src/config.js';

afterEach(() => vi.restoreAllMocks());

describe('spawn + snapshot', () => {
  it('spawns BOT_COUNT bots and snapshots compact, rounded, wire-shaped rows', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const snap = sim.snapshot();
    expect(snap).toHaveLength(BOT_COUNT);
    for (const b of snap) {
      expect(Number.isInteger(b.id)).toBe(true);
      expect(typeof b.x).toBe('number');
      expect(typeof b.z).toBe('number');
      expect(typeof b.rotY).toBe('number');
      expect(b.hp).toBe(BOT_HP);
      expect(b.alive).toBe(true);
      expect(['walk', 'idle', 'shoot', 'hit', 'die']).toContain(b.animHint);
      // rounded for bandwidth: x/z to 2dp, rotY to 3dp.
      expect(b.x).toBe(Math.round(b.x * 100) / 100);
      expect(b.rotY).toBe(Math.round(b.rotY * 1000) / 1000);
    }
  });

  it('snapshot is a full late-join roster (every bot, alive or dead)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b0 = sim.snapshot()[0];
    // Kill one bot; it must still appear in the snapshot (alive:false).
    sim.applyBotDamage(b0.id, BOT_HP, { x: 0, z: 0 });
    const snap = sim.snapshot();
    expect(snap).toHaveLength(BOT_COUNT);
    const dead = snap.find((b) => b.id === b0.id);
    expect(dead.alive).toBe(false);
  });
});

describe('player → bot shot resolution', () => {
  it('resolves a body-height ray as a nearest BODY hit on the aimed bot', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.snapshot()[0];
    const footY = sampleArenaHeight(b.x, b.z);
    const y = footY + BOT_BODY_CENTRE_Y;
    const origin = [b.x + 3, y, b.z];
    const dir = [-1, 0, 0]; // straight at the bot's chest
    const res = sim.resolvePlayerShot(origin, dir);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(b.id);
    expect(res.zone).toBe('body');
    expect(res.t).toBeGreaterThan(0);
  });

  it('resolves a head-height ray as a HEAD hit', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const b = sim.snapshot()[0];
    const footY = sampleArenaHeight(b.x, b.z);
    const origin = [b.x + 3, footY + BOT_HEAD_CENTRE_Y, b.z];
    const res = sim.resolvePlayerShot(origin, [-1, 0, 0]);
    expect(res).not.toBeNull();
    expect(res.zone).toBe('head');
  });

  it('misses when the ray points away from every bot', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    // Fire from far outside straight up — no bot in the ray.
    const res = sim.resolvePlayerShot([9000, 0, 9000], [0, 1, 0]);
    expect(res).toBeNull();
  });
});

describe('authoritative bot damage', () => {
  it('decrements hp, then kills on the lethal hit', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const id = sim.snapshot()[0].id;
    const r1 = sim.applyBotDamage(id, 1, { x: 0, z: 0 });
    expect(r1.hit).toBe(true);
    expect(r1.killed).toBe(false);
    expect(r1.hpAfter).toBe(BOT_HP - 1);

    const r2 = sim.applyBotDamage(id, BOT_HP, { x: 0, z: 0 });
    expect(r2.killed).toBe(true);
    expect(sim.getBot(id).alive).toBe(false);
  });

  it('a dead bot cannot be re-hit (guards double-kill)', () => {
    const sim = createArenaBotSim({});
    sim.spawn(BOT_COUNT);
    const id = sim.snapshot()[0].id;
    sim.applyBotDamage(id, BOT_HP, { x: 0, z: 0 });
    const again = sim.applyBotDamage(id, BOT_HP, { x: 0, z: 0 });
    expect(again.hit).toBe(false);
    expect(again.killed).toBe(false);
  });
});

describe('bot → player fire (onBotShot forwarding)', () => {
  it('fires onBotShot with (origin,dir) when a player is in the open nearby', () => {
    // Deterministic run: pin Math.random high so bots rarely break off to seek
    // cover (which resets their LOS timer). Put the player 2m off the nearest
    // bot with clear headless LOS so the brain reliably shoots over ~10s.
    vi.spyOn(Math, 'random').mockReturnValue(0.9);
    const calls = [];
    const sim = createArenaBotSim({ onBotShot: (origin, dir) => calls.push({ origin, dir }) });
    sim.spawn(BOT_COUNT);
    const b = sim.snapshot()[0];
    const player = { x: b.x, y: 1.6, z: b.z + 2, outsideFence: false, flyEnabled: false };
    for (let i = 0; i < 600; i++) sim.tick(1 / 60, [player]);
    expect(calls.length).toBeGreaterThan(0);
    const { origin, dir } = calls[0];
    expect(typeof origin.x).toBe('number');
    expect(typeof dir.x).toBe('number');
    // dir is normalised in the brain.
    const len = Math.hypot(dir.x, dir.y, dir.z);
    expect(len).toBeCloseTo(1, 3);
  });
});
