// hp-ledger.test.js — MP-2 HP + respawn bookkeeping.
import { describe, it, expect } from 'vitest';
import {
  createHpLedger,
  register,
  unregister,
  getHp,
  applyDamage,
  respawn,
  pickSpawnFarthest,
  HP_MAX,
  SPAWN_MAG,
  RESPAWN_CORNERS,
} from '../../server/combat/hpLedger.js';

describe('hpLedger (MP-2)', () => {
  it('constants: HP_MAX=100, SPAWN_MAG=14, 4 respawn corners', () => {
    expect(HP_MAX).toBe(100);
    expect(SPAWN_MAG).toBe(14);
    expect(RESPAWN_CORNERS.length).toBe(4);
    // All corners lie at (±14, y, ±14).
    for (const c of RESPAWN_CORNERS) {
      expect(Math.abs(c[0])).toBe(SPAWN_MAG);
      expect(Math.abs(c[2])).toBe(SPAWN_MAG);
    }
  });

  it('applyDamage clamps at 0 and reports killed', () => {
    const led = createHpLedger();
    register(led, 'a');
    const r1 = applyDamage(led, 'a', 30);
    expect(r1.hpAfter).toBe(70);
    expect(r1.killed).toBe(false);
    const r2 = applyDamage(led, 'a', 200);
    expect(r2.hpAfter).toBe(0);
    expect(r2.killed).toBe(true);
    expect(r2.applied).toBe(70); // only what remained
  });

  it('negative / zero / non-finite damage is a no-op', () => {
    const led = createHpLedger();
    register(led, 'a');
    expect(applyDamage(led, 'a', 0).applied).toBe(0);
    expect(applyDamage(led, 'a', -5).applied).toBe(0);
    expect(applyDamage(led, 'a', NaN).applied).toBe(0);
    expect(getHp(led, 'a')).toBe(HP_MAX);
  });

  it('extra damage on a dead peer is dropped (no re-kill)', () => {
    const led = createHpLedger();
    register(led, 'a');
    applyDamage(led, 'a', 500);
    const again = applyDamage(led, 'a', 50);
    expect(again.killed).toBe(false);
    expect(again.applied).toBe(0);
    expect(getHp(led, 'a')).toBe(0);
  });

  it('respawn restores HP_MAX and picks the corner farthest from killer', () => {
    const led = createHpLedger();
    register(led, 'a');
    applyDamage(led, 'a', 500);
    // Killer stood near (-14, 3.1, -14) → farthest corner is (+14, 3.1, +14).
    const r = respawn(led, 'a', [-14, 3.1, -14]);
    expect(r.hp).toBe(HP_MAX);
    expect(r.pos[0]).toBe(SPAWN_MAG);
    expect(r.pos[2]).toBe(SPAWN_MAG);
    expect(getHp(led, 'a')).toBe(HP_MAX);
  });

  it('pickSpawnFarthest is deterministic and safe on bad input', () => {
    const p = pickSpawnFarthest([SPAWN_MAG, 3.1, SPAWN_MAG]);
    expect(p[0]).toBe(-SPAWN_MAG);
    expect(p[2]).toBe(-SPAWN_MAG);
    expect(pickSpawnFarthest(null)).toBe(RESPAWN_CORNERS[0]);
    expect(pickSpawnFarthest([])).toBe(RESPAWN_CORNERS[0]);
  });

  it('unregister removes tracked HP', () => {
    const led = createHpLedger();
    register(led, 'a');
    applyDamage(led, 'a', 40);
    unregister(led, 'a');
    // getHp on unknown sid returns hpMax (safe default).
    expect(getHp(led, 'a')).toBe(HP_MAX);
  });
});
