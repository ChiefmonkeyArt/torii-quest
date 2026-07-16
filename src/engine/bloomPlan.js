// bloomPlan.js — pure, node-safe bloom tuning plan for the arena path (v0.2.400).
//
// Centralises the UnrealBloom tuning so scene.js does not carry hand-tuned magic
// numbers inline. Pure data + clamps only: no THREE / DOM / window imports.
// The defaults aim for selective glow on emissive arena accents (fence, aurora,
// cyan paths, torii gate) without washing terrain or UI overlays.

const LIMITS = Object.freeze({
  strength: Object.freeze([0.45, 1.1]),
  radius: Object.freeze([0.18, 0.7]),
  threshold: Object.freeze([0.72, 0.95]),
});

export const DEFAULT_BLOOM_PLAN = Object.freeze({
  enabled: true,
  strength: 0.72,
  radius: 0.33,
  threshold: 0.86,
});

function clampNumber(value, [min, max], fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function createBloomPlan(input = {}) {
  const src = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  return Object.freeze({
    enabled: src.enabled !== false,
    strength: clampNumber(src.strength, LIMITS.strength, DEFAULT_BLOOM_PLAN.strength),
    radius: clampNumber(src.radius, LIMITS.radius, DEFAULT_BLOOM_PLAN.radius),
    threshold: clampNumber(src.threshold, LIMITS.threshold, DEFAULT_BLOOM_PLAN.threshold),
  });
}

export function bloomPlanForTier(tier = 'HIGH') {
  switch (String(tier || '').toUpperCase()) {
    case 'LOW':
      return createBloomPlan({ enabled: false });
    case 'NORMAL':
      return createBloomPlan({ strength: 0.68, radius: 0.3, threshold: 0.87 });
    case 'HIGH':
    default:
      return createBloomPlan(DEFAULT_BLOOM_PLAN);
  }
}
