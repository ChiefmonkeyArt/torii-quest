// tests/multiplayer/arena-bot-sim-env-override.test.js
// ADR-0018 env overrides, carried into Game Zone v2 (ADR-0130): the VPS roster
// is read from BOT_COUNT_OVERRIDE / BOSS_COUNT_OVERRIDE / TEST_MODE by
// rosterFromEnv(), and the shared sim spawns exactly that roster.
import { describe, it, expect } from 'vitest';
import { BOT_COUNT, BOSS_COUNT, BOT_HP, BOSS_HP } from '../../src/config.js';
import { rosterFromEnv } from '../../server/gamezone/gameZoneServer.js';
import { createGameZoneSim } from '../../src/gamezone/core/sim.js';
import { sharedArenaWorld } from '../../src/gamezone/core/arenaWorld.js';

describe('ADR-0018 env overrides → Game Zone roster', () => {
  it('defaults match config when no env vars are set', () => {
    expect(rosterFromEnv({})).toEqual({ total: BOT_COUNT, bosses: BOSS_COUNT });
  });
  it('BOT_COUNT_OVERRIDE=0 → empty roster', () => {
    expect(rosterFromEnv({ BOT_COUNT_OVERRIDE: '0' })).toEqual({ total: 0, bosses: 0 });
  });
  it('BOT_COUNT_OVERRIDE=1 + BOSS_COUNT_OVERRIDE=0 → one regular', () => {
    expect(rosterFromEnv({ BOT_COUNT_OVERRIDE: '1', BOSS_COUNT_OVERRIDE: '0' })).toEqual({ total: 1, bosses: 0 });
  });
  it('TEST_MODE=1 alone → 1 regular, 0 bosses; explicit override still wins', () => {
    expect(rosterFromEnv({ TEST_MODE: '1' })).toEqual({ total: 1, bosses: 0 });
    expect(rosterFromEnv({ TEST_MODE: '1', BOT_COUNT_OVERRIDE: '3' })).toEqual({ total: 3, bosses: 0 });
  });
  it('bosses are clamped to the total; invalid values fall back to config', () => {
    expect(rosterFromEnv({ BOT_COUNT_OVERRIDE: '2', BOSS_COUNT_OVERRIDE: '5' })).toEqual({ total: 2, bosses: 2 });
    expect(rosterFromEnv({ BOT_COUNT_OVERRIDE: 'abc', BOSS_COUNT_OVERRIDE: '-1' })).toEqual({ total: BOT_COUNT, bosses: Math.min(BOT_COUNT, BOSS_COUNT) });
  });
  it('the sim spawns exactly the roster (3 + 1 boss) with correct hp', () => {
    const sim = createGameZoneSim({ world: sharedArenaWorld(), roster: rosterFromEnv({ BOT_COUNT_OVERRIDE: '3', BOSS_COUNT_OVERRIDE: '1' }), seed: 7 });
    const rows = sim.snapshot().b;
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r[1] === 1)).toHaveLength(1);
    for (const r of rows) expect(r[6]).toBe(r[1] === 1 ? BOSS_HP : BOT_HP);
  });
});
