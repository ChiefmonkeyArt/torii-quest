// engine/world/portalReveal.js — the HYBRID dual-mode reveal (ADR-0118 Decision 6).
//
// The gate shows a LIVE APERTURE window on approach (world B visible only within the
// gate's opening, origin sky outside) and, on crossing, the aperture IRIS EXPANDS past
// its own frame to fullscreen while the destination sky resolves in — "look through,
// then step through." This module encodes that arc as pure, testable math; the renderer
// drives the shader's uIris/uSkyBlend from these values.
//
// Model (aperture units): a radius of 1 = exactly the gate opening; `fullFactor` = the
// radius that reaches the furthest screen corner, so the iris covers the whole viewport.
//   approach — radius pinned at 1 (aperture-only window), origin sky holds outside.
//   cross    — radius eases 1 → fullFactor while the sky resolves origin → destination.
//   settled  — radius = fullFactor, destination sky fully resolved.

import { clamp01, easeInOutCubic } from './irisReveal.js';

export const REVEAL_MODE = Object.freeze({
  APPROACH: 'approach',
  CROSS: 'cross',
  SETTLED: 'settled',
});

/**
 * How many aperture radii reach the furthest screen corner from the gate centre
 * (≥ 1; the aperture must fit inside the viewport, so the corner is never nearer).
 * Guards divide-by-zero and a corner measured closer than the aperture.
 */
export function apertureToFullscreenFactor(apertureRadius, cornerDistance) {
  const a = Math.max(1e-6, Number.isFinite(apertureRadius) ? apertureRadius : 0);
  const c = Math.max(a, Number.isFinite(cornerDistance) ? cornerDistance : 0);
  return c / a;
}

/**
 * The iris mask radius, in aperture units, for a reveal phase.
 * @param {{ mode?:'approach'|'cross'|'settled', t?:number, fullFactor?:number,
 *           easing?:(x:number)=>number }} args
 */
export function irisRadius({
  mode = REVEAL_MODE.APPROACH, t = 0, fullFactor = 1, easing = easeInOutCubic,
} = {}) {
  const x = clamp01(t);
  const full = Math.max(1, Number.isFinite(fullFactor) ? fullFactor : 1);
  switch (mode) {
    case REVEAL_MODE.CROSS:   return 1 + (full - 1) * easing(x);
    case REVEAL_MODE.SETTLED: return full;
    case REVEAL_MODE.APPROACH:
    default:                  return 1;
  }
}

/**
 * Sky-resolve blend (0 = origin, 1 = destination). The destination sky resolves only
 * during CROSS and stays resolved once SETTLED; APPROACH keeps the origin sky outside
 * the aperture (world B is seen through the hole, its sky resolving on entry).
 */
export function skyBlendFor(mode, t, easing = easeInOutCubic) {
  const x = clamp01(t);
  if (mode === REVEAL_MODE.SETTLED) return 1;
  if (mode === REVEAL_MODE.CROSS) return easing(x);
  return 0;
}

/**
 * The complete per-frame reveal state: the mask radius (aperture units) + sky blend.
 * @returns {{ radius:number, skyBlend:number }}
 */
export function revealState({ mode, t, fullFactor, easing } = {}) {
  return {
    radius: irisRadius({ mode, t, fullFactor, easing }),
    skyBlend: skyBlendFor(mode, t, easing),
  };
}