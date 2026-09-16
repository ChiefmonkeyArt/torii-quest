// engine/world/irisReveal.js — the iris + sky-resolve TIMELINE (ADR-0118).
//
// The "moment": as you cross (or open a mirror), an iris ring opens from the gate and
// the DESTINATION sky resolves through it — the new world's sky colour fades in while
// the aperture opens, so the reveal feels like the far world resolving into view
// rather than a hard cut. This module is the PURE timeline + easing + sky-interpolation
// math behind that visual; it holds no WebGL, so it is unit-testable in node and the
// Three.js portal shader drives its uniforms from the values these functions return.
//
// Timeline model (all t ∈ [0,1], elapsed/total):
//   iris(t)    — radial aperture coverage, 0 = fully closed, 1 = fully open.
//   skyBlend(t) — 0 = origin sky, 1 = destination sky, delayed so the sky resolves
//                 into the opening hole rather than racing it.

export function clamp01(x) {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : (x > 1 ? 1 : x);
}

// ease-in-out cubic — a smooth, "camera iris blades" feel (slow-settle ends).
export function easeInOutCubic(x) {
  const t = clamp01(x);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Iris aperture coverage: 0 (closed) → 1 (open), eased. `t` outside [0,1] is clamped.
 */
export function irisCoverage(t, easing = easeInOutCubic) {
  return easing(clamp01(t));
}

/**
 * Sky-resolve blend: 0 → 1, DELAYED then eased, so the new sky resolves into the
 * opening iris. `delay` + `duration` are fractions of the full timeline.
 */
export function skyResolve(t, { delay = 0, duration = 1, easing = easeInOutCubic } = {}) {
  const span = Math.max(1e-6, duration || 1);
  const u = (clamp01(t) - clamp01(delay)) / span;
  return u <= 0 ? 0 : (u >= 1 ? 1 : easing(u));
}

// ── Sky interpolation ────────────────────────────────────────────────────────
// A world.json sky is { type: 'space'|'clear'|'dusk' | undefined, color?: hex,
// stars?: bool } (worldSchema). The destination TYPE is discrete; color + stars
// crossfade.

function _hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.test(String(hex || '')) ? String(hex).replace('#', '') : null;
  if (!m) return null;
  const v = m.toLowerCase();
  return {
    r: parseInt(v.slice(0, 2), 16) / 255,
    g: parseInt(v.slice(2, 4), 16) / 255,
    b: parseInt(v.slice(4, 6), 16) / 255,
  };
}
function _rgbToHex({ r, g, b }) {
  const c = (n) => Math.round(clamp01(n) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Lerp two hex colours (#rrggbb) → hex. Fallback: return `b` if either is unparseable. */
export function lerpHexColor(a, b, k) {
  const t = clamp01(k);
  const ra = _hexToRgb(a);
  const rb = _hexToRgb(b);
  if (!ra || !rb) return b || a || '#000000';
  return _rgbToHex({
    r: ra.r + (rb.r - ra.r) * t,
    g: ra.g + (rb.g - ra.g) * t,
    b: ra.b + (rb.b - ra.b) * t,
  });
}

/**
 * Interpolate a sky descriptor a→b at blend k. Colour lerps; `stars` switches at the
 * halfway point; `type` flips to the destination's once past halfway. Never throws.
 */
export function lerpSky(a, b, k) {
  const t = clamp01(k);
  const from = a && typeof a === 'object' ? a : {};
  const to = b && typeof b === 'object' ? b : {};
  const out = {};
  if (from.type || to.type) out.type = t < 0.5 ? (from.type || to.type) : (to.type || from.type);
  if (from.color || to.color) out.color = lerpHexColor(from.color, to.color, t);
  const stars = t < 0.5 ? !!from.stars : !!to.stars;
  if (from.stars !== undefined || to.stars !== undefined) out.stars = stars;
  return out;
}

/**
 * The full iris/sky-resolve timeline for one reveal of `totalMs`.
 *
 * @param {{ elapsedMs:number, totalMs:number, irisDelay?:number, irisDuration?:number,
 *           skyDelay?:number, skyDuration?:number }} args
 *   Delays/durations are fractions of the whole timeline (defaults give the sky a
 *   ~0.15 head-start so it resolves into the opening iris).
 * @returns {{ t:number, iris:number, skyBlend:number, done:boolean }}
 */
export function mirrorTimeline({
  elapsedMs, totalMs,
  irisDelay = 0, irisDuration = 1,
  skyDelay = 0.15, skyDuration = 0.85,
} = {}) {
  const total = Math.max(1, Number.isFinite(totalMs) ? totalMs : 1);
  const t = clamp01(Number.isFinite(elapsedMs) ? elapsedMs / total : 0);
  const iris = irisCoverage((t - clamp01(irisDelay)) / (irisDuration || 1));
  const skyBlend = skyResolve(t, { delay: skyDelay, duration: skyDuration });
  return { t, iris, skyBlend, done: t >= 1 };
}