// engine/world/grassColor.js — single source of truth for the arena's blade
// colours (world-as-data). The instanced grass shader colours each blade by a
// base→tip gradient; two zones use two gradients (NAP = green, arena =
// purple→orange). These values were previously hardcoded inside the GLSL
// vertex shader, so a traveller always saw their OWN node's colours and a
// world owner could never publish a distinct grass palette. They now live here
// so they can be (a) serialized into the manifest, (b) validated, and (c) fed
// to the shader as uniforms. PURE + node-safe: no DOM, no THREE, no GLSL.
//
// The default palette is EXACTLY the shipped values (no visual change by
// default) — extracted so a destination world can override them without
// touching shader code.

/** The shipped default blade gradient. Values match the pre-extraction GLSL. */
export const DEFAULT_GRASS_COLOR = {
  napBase:   [0.27, 0.60, 0.15],
  napTip:    [0.18, 0.43, 0.12],
  arenaBase: [0.45, 0.20, 0.65],
  arenaTip:  [0.95, 0.55, 0.15],
};

const RGB_KEY = ['napBase', 'napTip', 'arenaBase', 'arenaTip'];

function _rgb(v) {
  if (!Array.isArray(v) || v.length !== 3) return null;
  const out = v.map(Number);
  if (!out.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return null;
  return out;
}

/**
 * Normalize an arbitrary grass-colour payload into the canonical { napBase,
 * napTip, arenaBase, arenaTip } each [r,g,b] in 0..1, or null. Missing keys are
 * filled from the default; malformed keys fail closed (null). Pure + idempotent.
 */
export function normalizeGrassColor(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const out = {};
  for (const key of RGB_KEY) {
    let v = input[key];
    if (v === undefined) v = DEFAULT_GRASS_COLOR[key];
    const rgb = _rgb(v);
    if (!rgb) return null;
    out[key] = rgb;
  }
  return out;
}

/** Convenience: merge a (already-normalized) colour over the default for serialization. */
export function resolveGrassColor(input) {
  return normalizeGrassColor(input) || { ...DEFAULT_GRASS_COLOR };
}