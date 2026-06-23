import { describe, it, expect } from 'vitest';
import {
  reloadDip,
  RELOAD_DROP_END,
  RELOAD_HOLD_END,
  RELOAD_SETTLE_END,
  RELOAD_OVERSHOOT,
} from '../src/engine/weapons/reloadPose.js';

describe('reloadDip — "click down, clack snap back" curve', () => {
  it('is at rest (0) at and beyond the endpoints', () => {
    expect(reloadDip(0)).toBe(0);
    expect(reloadDip(1)).toBe(0);
    expect(reloadDip(-0.5)).toBe(0);
    expect(reloadDip(1.5)).toBe(0);
  });

  it('drops quickly to fully lowered during the DROP phase', () => {
    // Monotonic rise from ~0 toward 1 across the drop window.
    const a = reloadDip(RELOAD_DROP_END * 0.25);
    const b = reloadDip(RELOAD_DROP_END * 0.5);
    const c = reloadDip(RELOAD_DROP_END * 0.95);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(1);
    // Ease-out: more than half the drop is done by the midpoint.
    expect(b).toBeGreaterThan(0.5);
  });

  it('holds fully lowered (1) through the HOLD window', () => {
    expect(reloadDip(RELOAD_DROP_END)).toBeCloseTo(1, 10);
    expect(reloadDip((RELOAD_DROP_END + RELOAD_HOLD_END) / 2)).toBe(1);
    expect(reloadDip(RELOAD_HOLD_END - 1e-6)).toBe(1);
  });

  it('snaps back fast: passes through rest and overshoots above it', () => {
    // Just after HOLD it is still near lowered.
    const start = reloadDip(RELOAD_HOLD_END + 1e-6);
    expect(start).toBeCloseTo(1, 4);
    // By the end of the snap-back it has overshot to -OVERSHOOT.
    const end = reloadDip(RELOAD_SETTLE_END - 1e-6);
    expect(end).toBeCloseTo(-RELOAD_OVERSHOOT, 4);
    // Somewhere in the snap-back it crosses rest (dip == 0).
    const mid = reloadDip((RELOAD_HOLD_END + RELOAD_SETTLE_END) / 2);
    expect(mid).toBeLessThan(start);
  });

  it('settles the overshoot back to rest by p=1', () => {
    const overshoot = reloadDip(RELOAD_SETTLE_END);
    expect(overshoot).toBeCloseTo(-RELOAD_OVERSHOOT, 6);
    // Monotonically eases from -OVERSHOOT back up toward 0.
    const a = reloadDip(RELOAD_SETTLE_END + (1 - RELOAD_SETTLE_END) * 0.5);
    const b = reloadDip(0.99);
    expect(a).toBeGreaterThan(overshoot);
    expect(b).toBeGreaterThan(a);
    expect(b).toBeLessThanOrEqual(0);
  });

  it('stays within the bounds [-OVERSHOOT, 1] across the whole range', () => {
    for (let i = 0; i <= 100; i++) {
      const v = reloadDip(i / 100);
      expect(v).toBeGreaterThanOrEqual(-RELOAD_OVERSHOOT - 1e-9);
      expect(v).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it('reaches full lowered faster than the old symmetric sin hump', () => {
    // Old curve peaked (1) only at p=0.5; the new curve is fully lowered by
    // RELOAD_DROP_END and the snap-back begins well before p=0.5 finishes.
    const oldAtDropEnd = Math.sin(RELOAD_DROP_END * Math.PI);
    expect(reloadDip(RELOAD_DROP_END)).toBeGreaterThan(oldAtDropEnd);
  });

  it('phase boundaries are ordered and within (0,1)', () => {
    expect(RELOAD_DROP_END).toBeGreaterThan(0);
    expect(RELOAD_DROP_END).toBeLessThan(RELOAD_HOLD_END);
    expect(RELOAD_HOLD_END).toBeLessThan(RELOAD_SETTLE_END);
    expect(RELOAD_SETTLE_END).toBeLessThan(1);
  });
});
