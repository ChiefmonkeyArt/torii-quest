// tests/combat-damage.test.js (v0.2.125) — locks the combat damage contract
// that the manual feedback ("headshots take two shots") exposed. The damage
// path itself was correct; these tests pin it so a future tweak to BOT_HP or
// the damage numbers can't silently break the one-shot-headshot guarantee.
import { describe, it, expect } from 'vitest';
import {
  HEADSHOT_DAMAGE, BODY_DAMAGE, shotDamage, applyDamage, isLethal,
} from '../src/engine/combat/damage.js';
import { BOT_HP } from '../src/config.js';

describe('shotDamage', () => {
  it('headshot deals the headshot amount', () => {
    expect(shotDamage(true)).toBe(HEADSHOT_DAMAGE);
    expect(shotDamage(true)).toBe(9);
  });
  it('body shot deals the body amount', () => {
    expect(shotDamage(false)).toBe(BODY_DAMAGE);
    expect(shotDamage(false)).toBe(3);
  });
  it('headshot deals strictly more than a body shot', () => {
    expect(shotDamage(true)).toBeGreaterThan(shotDamage(false));
  });
});

describe('applyDamage', () => {
  it('subtracts damage from hp', () => {
    expect(applyDamage(BOT_HP, BODY_DAMAGE)).toBe(BOT_HP - BODY_DAMAGE);
  });
  it('can drive hp negative (caller treats <=0 as dead)', () => {
    expect(applyDamage(BOT_HP, HEADSHOT_DAMAGE)).toBeLessThan(0);
  });
});

describe('kill threshold vs BOT_HP', () => {
  it('a clean headshot one-shots a full-HP bot', () => {
    expect(isLethal(BOT_HP, shotDamage(true))).toBe(true);
    expect(HEADSHOT_DAMAGE).toBeGreaterThanOrEqual(BOT_HP);
  });
  it('a single body shot does NOT kill a full-HP bot', () => {
    expect(isLethal(BOT_HP, shotDamage(false))).toBe(false);
    expect(BODY_DAMAGE).toBeLessThan(BOT_HP);
  });
  it('two body shots DO kill', () => {
    const afterFirst = applyDamage(BOT_HP, BODY_DAMAGE);
    expect(isLethal(afterFirst, BODY_DAMAGE)).toBe(true);
    expect(2 * BODY_DAMAGE).toBeGreaterThanOrEqual(BOT_HP);
  });
  it('headshot is worth more than two body shots (one-shot dominance)', () => {
    expect(HEADSHOT_DAMAGE).toBeGreaterThanOrEqual(2 * BODY_DAMAGE);
  });
});
