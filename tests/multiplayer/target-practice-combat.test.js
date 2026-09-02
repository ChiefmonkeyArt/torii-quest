// tests/multiplayer/target-practice-combat.test.js — ADR-0044 target-practice
// combat contract (v0.2.665). The owner's "clean + snappy" bar for bot combat:
//   • 2 body shots  = kill a regular bot
//   • 1 head shot    = kill a regular bot
//   • the boss (Augustink, 60 HP) survives 19 body shots, dies on the 20th
//   • shooting a corpse is a no-op (no double-kill, no damage)
//   • every regular bot shows a dwarf name, never "regular"
//
// This drives the AUTHORITATIVE server path end-to-end: the damage a shot
// deals comes from damageTable.damageFor(zone) (BODY_DAMAGE=3 / HEADSHOT_DAMAGE=9),
// applied through arenaBotSim.applyBotDamage — the same function the live
// server's resolvePlayerBotHit calls. So if these numbers ever drift, this
// test fails before a deploy. Geometry (does the ray hit the bot?) is already
// pinned in player-bot-combat.test.js; here we fire at point-blank so the
// damage→kill contract is exercised directly, deterministically, no raycast
// flake.
import { describe, it, expect } from 'vitest';
import { createArenaBotSim } from '../../server/bots/arenaBotSim.js';
import { damageFor, BODY_DAMAGE, HEADSHOT_DAMAGE } from '../../server/combat/damageTable.js';
import { BOT_COUNT, BOT_HP, BOSS_HP } from '../../src/config.js';
import { labelForBotState, DWARF_NAMES } from '../../src/engine/entities/botIdentity.js';

const PLAYER_POS = { x: 10, y: 1.6, z: 0 };

function spawnSim() {
  // No TEST_MODE — keep the full roster (5 regulars + 1 boss) so both the
  // regular + boss contracts are exercised against the real spawn path.
  const sim = createArenaBotSim({});
  sim.spawn(BOT_COUNT);
  return sim;
}

// Park every other bot far away so a damage call never accidentally lands on
// the wrong bot via a stray collider (mirrors player-bot-combat.test.js's isolate).
function isolate(sim, keep) {
  for (const b of sim.bots) {
    if (b.id === keep.id) continue;
    b.pos.x += 1000;
    b.pos.z += 1000;
  }
  return keep;
}

function regularBot(sim) {
  const b = sim.bots.find((x) => x.alive && x.kind !== 'boss');
  return isolate(sim, b);
}
function bossBot(sim) {
  const b = sim.bots.find((x) => x.alive && x.kind === 'boss');
  return isolate(sim, b);
}

describe('target practice — damage→kill contract (ADR-0044)', () => {
  it('damageTable: body=3, head=9 (the 2-body / 1-head kill math)', () => {
    expect(BODY_DAMAGE).toBe(3);
    expect(HEADSHOT_DAMAGE).toBe(9);
    expect(damageFor('body')).toBe(BODY_DAMAGE);
    expect(damageFor('head')).toBe(HEADSHOT_DAMAGE);
    // 2 body shots (6) > BOT_HP (5); 1 head shot (9) > BOT_HP (5).
    expect(BODY_DAMAGE * 2).toBeGreaterThan(BOT_HP);
    expect(HEADSHOT_DAMAGE).toBeGreaterThan(BOT_HP);
  });

  it('2 body shots kill a regular bot — shot 1 wounds, shot 2 kills', () => {
    const sim = spawnSim();
    const bot = regularBot(sim);
    const body = damageFor('body');

    const s1 = sim.applyBotDamage(bot.id, body, PLAYER_POS);
    expect(s1.hit).toBe(true);
    expect(s1.killed).toBe(false);
    expect(sim.getBot(bot.id).alive).toBe(true);

    const s2 = sim.applyBotDamage(bot.id, body, PLAYER_POS);
    expect(s2.killed).toBe(true);
    expect(sim.getBot(bot.id).alive).toBe(false);
  });

  it('1 head shot kills a regular bot outright', () => {
    const sim = spawnSim();
    const bot = regularBot(sim);
    const head = damageFor('head');

    const r = sim.applyBotDamage(bot.id, head, PLAYER_POS);
    expect(r.killed).toBe(true);
    expect(sim.getBot(bot.id).alive).toBe(false);
  });

  it('shooting a corpse is a no-op (no damage, no double-kill)', () => {
    const sim = spawnSim();
    const bot = regularBot(sim);
    // Kill it with a headshot first.
    sim.applyBotDamage(bot.id, damageFor('head'), PLAYER_POS);
    expect(sim.getBot(bot.id).alive).toBe(false);
    // Now keep shooting the corpse — body + head must both be skipped.
    const body = sim.applyBotDamage(bot.id, damageFor('body'), PLAYER_POS);
    const head = sim.applyBotDamage(bot.id, damageFor('head'), PLAYER_POS);
    expect(body.hit).toBe(false);
    expect(body.killed).toBe(false);
    expect(head.hit).toBe(false);
    expect(head.killed).toBe(false);
  });

  it('the boss Augustink (60 HP) survives 19 body shots, dies on the 20th', () => {
    const sim = spawnSim();
    const boss = bossBot(sim);
    const body = damageFor('body');
    expect(sim.getBot(boss.id).hp).toBe(BOSS_HP);

    for (let i = 0; i < 19; i++) {
      const r = sim.applyBotDamage(boss.id, body, PLAYER_POS);
      expect(r.killed).toBe(false);
      expect(sim.getBot(boss.id).alive).toBe(true);
    }
    const r20 = sim.applyBotDamage(boss.id, body, PLAYER_POS);
    expect(r20.killed).toBe(true);
    expect(sim.getBot(boss.id).alive).toBe(false);
  });

  it('every regular bot id maps to a dwarf name, never "regular"', () => {
    // labelForBotState is what the HP-chip redraw reads; with no server `name`
    // (the regular-bot wire state) it must return a dwarf name, never the
    // `kind` string 'regular'.
    for (let id = 0; id < 20; id++) {
      const label = labelForBotState(id, {}); // no name → dwarf fallback
      expect(label).not.toBe('regular');
      expect(DWARF_NAMES).toContain(label);
    }
    // The boss keeps its server-stamped name.
    expect(labelForBotState(4, { name: 'Augustink' })).toBe('Augustink');
  });
});
