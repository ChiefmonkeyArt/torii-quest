// tests/multiplayer/arena-bot-sim-env-override.test.js
// ADR-0018 (v0.2.628-alpha): env-var override for controlled test environments.
//
// This test asserts REAL behaviour end-to-end from process.env → arenaBotSim
// spawn → sim.bots roster. It does NOT mock the module under test or mirror
// its logic in a fake (the previous ghost-nameplate tests failed that way).
//
// Env is read at module import time, so each case uses vi.resetModules() and
// a fresh dynamic import. process.env is restored after each case.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { BOT_COUNT, BOSS_COUNT, BOT_HP, BOSS_HP } from '../../src/config.js';

// Snapshot ONLY the vars we touch so we don't stomp anything else vitest
// or CI has set. Delete after each case; restore explicit prior values.
const ORIG_BOT_COUNT_OVERRIDE = process.env.BOT_COUNT_OVERRIDE;
const ORIG_BOSS_COUNT_OVERRIDE = process.env.BOSS_COUNT_OVERRIDE;
const ORIG_TEST_MODE = process.env.TEST_MODE;

beforeEach(() => {
  delete process.env.BOT_COUNT_OVERRIDE;
  delete process.env.BOSS_COUNT_OVERRIDE;
  delete process.env.TEST_MODE;
  vi.resetModules();
});

afterEach(() => {
  delete process.env.BOT_COUNT_OVERRIDE;
  delete process.env.BOSS_COUNT_OVERRIDE;
  delete process.env.TEST_MODE;
  if (ORIG_BOT_COUNT_OVERRIDE !== undefined) process.env.BOT_COUNT_OVERRIDE = ORIG_BOT_COUNT_OVERRIDE;
  if (ORIG_BOSS_COUNT_OVERRIDE !== undefined) process.env.BOSS_COUNT_OVERRIDE = ORIG_BOSS_COUNT_OVERRIDE;
  if (ORIG_TEST_MODE !== undefined) process.env.TEST_MODE = ORIG_TEST_MODE;
  // Reset the module registry so any OTHER test file that imports arenaBotSim
  // AFTER this file gets a clean re-import with the restored (or absent) env.
  vi.resetModules();
  vi.restoreAllMocks();
});

async function importFresh() {
  vi.resetModules();
  const mod = await import('../../server/bots/arenaBotSim.js');
  return mod;
}

describe('ADR-0018 env overrides (BOT_COUNT_OVERRIDE / BOSS_COUNT_OVERRIDE)', () => {
  it('defaults match config when no env vars are set', async () => {
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn(); // no arg → module default
    const snap = sim.snapshot();
    expect(snap).toHaveLength(BOT_COUNT);
    const bosses = snap.filter((b) => b.kind === 1);
    expect(bosses).toHaveLength(BOSS_COUNT);
  });

  it('BOT_COUNT_OVERRIDE=1 + BOSS_COUNT_OVERRIDE=0 → 1 regular bot (Doc, id=0), no boss', async () => {
    process.env.BOT_COUNT_OVERRIDE = '1';
    process.env.BOSS_COUNT_OVERRIDE = '0';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn();
    const snap = sim.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(0);
    expect(snap[0].kind).not.toBe(1); // not a boss
    expect(snap[0].hp).toBe(BOT_HP);
    // Name is added server-side by arenaBotSim.snapshot for boss only;
    // regulars carry st.name from spawn. Doc = id 0 per botIdentity.
    expect(snap[0].name === undefined || snap[0].name === 'Doc' || snap[0].name === null).toBe(true);
  });

  it('BOT_COUNT_OVERRIDE=0 → empty roster', async () => {
    process.env.BOT_COUNT_OVERRIDE = '0';
    process.env.BOSS_COUNT_OVERRIDE = '0';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn();
    expect(sim.snapshot()).toHaveLength(0);
  });

  it('BOT_COUNT_OVERRIDE=3 + BOSS_COUNT_OVERRIDE=1 → 2 regulars + 1 boss', async () => {
    process.env.BOT_COUNT_OVERRIDE = '3';
    process.env.BOSS_COUNT_OVERRIDE = '1';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn();
    const snap = sim.snapshot();
    expect(snap).toHaveLength(3);
    const bosses = snap.filter((b) => b.kind === 1);
    expect(bosses).toHaveLength(1);
    expect(bosses[0].hp).toBe(BOSS_HP);
  });

  it('invalid env values fall back to config default', async () => {
    process.env.BOT_COUNT_OVERRIDE = 'not-a-number';
    process.env.BOSS_COUNT_OVERRIDE = '-2';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn();
    expect(sim.snapshot()).toHaveLength(BOT_COUNT);
  });

  it('explicit spawn(count) arg still overrides the env default', async () => {
    process.env.BOT_COUNT_OVERRIDE = '1';
    process.env.BOSS_COUNT_OVERRIDE = '0';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn(4); // explicit arg wins
    expect(sim.snapshot()).toHaveLength(4);
  });

  it('TEST_MODE=1 alone → 1 regular bot, 0 bosses (one-stop flag)', async () => {
    process.env.TEST_MODE = '1';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn();
    const snap = sim.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].id).toBe(0);
    expect(snap[0].kind).not.toBe(1);
  });

  it('TEST_MODE=1 does not override an explicit BOT_COUNT_OVERRIDE', async () => {
    process.env.TEST_MODE = '1';
    process.env.BOT_COUNT_OVERRIDE = '3';
    process.env.BOSS_COUNT_OVERRIDE = '0';
    const { createArenaBotSim } = await importFresh();
    const sim = createArenaBotSim({});
    sim.spawn();
    expect(sim.snapshot()).toHaveLength(3);
  });
});
