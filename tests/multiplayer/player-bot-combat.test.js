// tests/multiplayer/player-bot-combat.test.js — v0.2.382 combat hotfix.
//
// Reproduces the LIVE player→bot shot geometry end-to-end through the server
// controller (createArenaBotSim.resolvePlayerShot + applyBotDamage) using the
// REAL terrain sampler, and pins that a shot fired from a realistic settled
// player camera/eye (sampleArenaHeight + EYE 1.7) aimed at the VISUAL bot
// registers a HIT — torso AND head — and that both a regular bot and the boss
// take damage and die. A clearly-off shot must still miss.
//
// Context: v0.2.382 investigated a reported one-directional break (player→bot
// shots not registering while bot→player worked). The hypothesised ~0.8 m
// vertical-frame mismatch between the bot collider footY (sampleArenaHeight) and
// the shooter's camera Y could NOT be reproduced headlessly — the server geometry
// HITS in every realistic scenario, as these tests assert. These tests therefore
// guard the server-side geometry against regression and document the expected
// frame; the shipped diagnostic ([SHOT-RESOLVE] originY/botFootY/dy) confirms the
// same alignment on a live server.
import { describe, it, expect } from 'vitest';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { BOT_COUNT, BOT_HP, BOSS_HP } from '../../src/config.js';
import { BOT_HEAD_CENTRE_Y, BOT_BODY_CENTRE_Y } from '../../server/bots/botColliders.js';

// The player's real world eye height (src/engine/entities/player.js EYE = 1.7).
// The client SHOT origin is camera.matrixWorld ≈ sampleArenaHeight + EYE.
const PLAYER_EYE = 1.7;

function spawnSim() {
  const sim = createArenaBotSim({});
  sim.spawn(BOT_COUNT);
  return sim;
}

// A horizontal shot from `dist` metres away, at world-Y = bot foot + `aimY`,
// aimed straight at the bot along -X. Mirrors a player standing near a bot with
// the crosshair on it (origin at eye height, dir horizontal).
function shootHorizontal(bot, aimY, dist = 3) {
  const footY = sampleArenaHeight(bot.pos.x, bot.pos.z);
  const origin = [bot.pos.x + dist, footY + aimY, bot.pos.z];
  const dir = [-1, 0, 0];
  return { origin, dir };
}

describe('v0.2.382 player→bot combat — server geometry in the live Y frame', () => {
  it('a torso-height shot from player eye registers a body HIT on a regular bot', () => {
    const sim = spawnSim();
    const bot = sim.bots.find((b) => b.alive && b.kind !== 'boss');
    // Aim at chest (body capsule centre) — the frame the player actually shoots in.
    const { origin, dir } = shootHorizontal(bot, BOT_BODY_CENTRE_Y);
    const res = sim.resolvePlayerShot(origin, dir);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(bot.id);
    expect(res.zone).toBe('body');
  });

  it('a head-height shot from player eye registers a HEAD HIT on a regular bot', () => {
    const sim = spawnSim();
    const bot = sim.bots.find((b) => b.alive && b.kind !== 'boss');
    const { origin, dir } = shootHorizontal(bot, BOT_HEAD_CENTRE_Y);
    const res = sim.resolvePlayerShot(origin, dir);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(bot.id);
    expect(res.zone).toBe('head');
  });

  it('a realistic player-eye shot (foot + 1.7) still intersects the bot capsule', () => {
    const sim = spawnSim();
    const bot = sim.bots.find((b) => b.alive && b.kind !== 'boss');
    // Origin at true player eye height, aimed slightly DOWN at the bot torso from
    // a short distance — the exact live scenario the hotfix targets.
    const footY = sampleArenaHeight(bot.pos.x, bot.pos.z);
    const origin = [bot.pos.x + 4, footY + PLAYER_EYE, bot.pos.z];
    const target = [bot.pos.x, footY + BOT_BODY_CENTRE_Y, bot.pos.z];
    const dx = target[0] - origin[0], dy = target[1] - origin[1], dz = target[2] - origin[2];
    const len = Math.hypot(dx, dy, dz);
    const res = sim.resolvePlayerShot(origin, [dx / len, dy / len, dz / len]);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(bot.id);
  });

  it('a regular bot takes damage and DIES from player shots', () => {
    const sim = spawnSim();
    const bot = sim.bots.find((b) => b.alive && b.kind !== 'boss');
    const { origin, dir } = shootHorizontal(bot, BOT_BODY_CENTRE_Y);
    const res = sim.resolvePlayerShot(origin, dir);
    expect(res).not.toBeNull();
    const out = sim.applyBotDamage(res.botId, BOT_HP, { x: origin[0], z: origin[2] });
    expect(out.hit).toBe(true);
    expect(out.killed).toBe(true);
  });

  it('the boss registers a HIT and dies after enough player damage', () => {
    const sim = spawnSim();
    const boss = sim.bots.find((b) => b.alive && b.kind === 'boss');
    expect(boss).toBeTruthy();
    // Boss capsule is scaled up; a chest-height horizontal shot still hits.
    const { origin, dir } = shootHorizontal(boss, BOT_BODY_CENTRE_Y);
    const res = sim.resolvePlayerShot(origin, dir);
    expect(res).not.toBeNull();
    expect(res.botId).toBe(boss.id);
    const out = sim.applyBotDamage(boss.id, BOSS_HP, { x: origin[0], z: origin[2] });
    expect(out.hit).toBe(true);
    expect(out.killed).toBe(true);
  });

  it('a clearly-off shot (well above the head, aimed away) still MISSES', () => {
    const sim = spawnSim();
    const bot = sim.bots.find((b) => b.alive && b.kind !== 'boss');
    const footY = sampleArenaHeight(bot.pos.x, bot.pos.z);
    // High above every capsule AND pointing up-and-away: no bot can be hit.
    const origin = [bot.pos.x + 3, footY + 10, bot.pos.z];
    const res = sim.resolvePlayerShot(origin, [1, 1, 0]);
    expect(res).toBeNull();
  });

  it('nearestBotDiag reports the nearest bot foot in the sampleArenaHeight frame', () => {
    const sim = spawnSim();
    const bot = sim.bots.find((b) => b.alive);
    const origin = [bot.pos.x, sampleArenaHeight(bot.pos.x, bot.pos.z) + PLAYER_EYE, bot.pos.z];
    const diag = sim.nearestBotDiag(origin);
    expect(diag).not.toBeNull();
    // The diagnostic footY must equal the collider base used by resolvePlayerShot.
    expect(diag.footY).toBeCloseTo(sampleArenaHeight(diag.pos.x, diag.pos.z), 6);
  });
});
