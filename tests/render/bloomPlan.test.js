// tests/render/bloomPlan.test.js — locks the v0.2.400 arena bloom tuning plan.
// Pure node-safe coverage only: clamps + tier presets, no THREE/WebGL required.
import { describe, it, expect } from 'vitest';
import { DEFAULT_BLOOM_PLAN, createBloomPlan, bloomPlanForTier } from '../../src/engine/bloomPlan.js';

describe('bloomPlan', () => {
  it('exports a frozen default plan tuned for selective glow', () => {
    expect(Object.isFrozen(DEFAULT_BLOOM_PLAN)).toBe(true);
    expect(DEFAULT_BLOOM_PLAN.enabled).toBe(true);
    expect(DEFAULT_BLOOM_PLAN.strength).toBeCloseTo(0.72, 5);
    expect(DEFAULT_BLOOM_PLAN.radius).toBeCloseTo(0.33, 5);
    expect(DEFAULT_BLOOM_PLAN.threshold).toBeCloseTo(0.86, 5);
  });

  it('sanitises non-numeric or out-of-range overrides back into safe bounds', () => {
    const plan = createBloomPlan({ strength: 9, radius: -2, threshold: 'wat', enabled: true });
    expect(plan).toEqual({ enabled: true, strength: 1.1, radius: 0.18, threshold: 0.86 });
    expect(Object.isFrozen(plan)).toBe(true);
  });

  it('maps HIGH/NORMAL/LOW tiers to predictable bloom plans', () => {
    expect(bloomPlanForTier('HIGH')).toEqual({ enabled: true, strength: 0.72, radius: 0.33, threshold: 0.86 });
    expect(bloomPlanForTier('NORMAL')).toEqual({ enabled: true, strength: 0.68, radius: 0.3, threshold: 0.87 });
    expect(bloomPlanForTier('LOW')).toEqual({ enabled: false, strength: 0.72, radius: 0.33, threshold: 0.86 });
  });

  it('falls back to the HIGH/default profile for unknown tiers', () => {
    expect(bloomPlanForTier('mystery')).toEqual(bloomPlanForTier('HIGH'));
  });
});
