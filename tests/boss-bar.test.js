import { describe, it, expect } from 'vitest';
import { decideBossBarUpdate } from '../src/bossBarState.js';

describe('decideBossBarUpdate', () => {
  it('does not flash on the first visible sample', () => {
    const next = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 60, maxHp: 60, alive: true });
    expect(next.visible).toBe(true);
    expect(next.changed).toBe(true);
    expect(next.shouldFlash).toBe(false);
    expect(next.pct).toBe(1);
  });

  it('flashes when the same boss loses HP', () => {
    const prev = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 60, maxHp: 60, alive: true });
    const next = decideBossBarUpdate(prev, { id: 9, name: 'Augustink', hp: 48, maxHp: 60, alive: true });
    expect(next.shouldFlash).toBe(true);
    expect(next.changed).toBe(true);
    expect(next.pct).toBe(0.8);
  });

  it('does not flash when HP increases', () => {
    const prev = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 40, maxHp: 60, alive: true });
    const next = decideBossBarUpdate(prev, { id: 9, name: 'Augustink', hp: 52, maxHp: 60, alive: true });
    expect(next.shouldFlash).toBe(false);
    expect(next.changed).toBe(true);
  });

  it('does not flash when the boss identity changes', () => {
    const prev = decideBossBarUpdate(null, { id: 9, name: 'Augustink', hp: 40, maxHp: 60, alive: true });
    const next = decideBossBarUpdate(prev, { id: 10, name: 'A Different Boss', hp: 35, maxHp: 60, alive: true });
    expect(next.shouldFlash).toBe(false);
    expect(next.changed).toBe(true);
  });
});
