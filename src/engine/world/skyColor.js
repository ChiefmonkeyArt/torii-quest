// engine/world/skyColor.js — resolve a world's sky colour to a numeric hex.
//
// The main scene's atmospheric sky lives in Sky.js (legacy boot path) and is
// never rebuilt by the in-place travel swap — so it correctly persists there.
// The portal LIVE MIRROR (portalMirror.js) is a *second, separate* offscreen scene
// with NO Sky.js, and its world manifests pin a CSS colour (e.g. the arena's
// `sky: { type:'clear', color:'#87ceeb' }`). Left unpainted, that scene renders a
// black void — the exact "black circle iris" the two-node playtest reported.
//
// Pure + node-testable: no THREE, no DOM.

/**
 * Parse `world.sky.color` (a CSS `#rgb` / `#rrggbb` hex, or bare hex) into a
 * numeric 0xRRGGBB. Falls back to `fallback` on anything malformed/absent.
 * @param {{ sky?: { color?: string } }} world
 * @param {number} [fallback] default 0x87ceeb (a light clear-day blue)
 * @returns {number} 0xRRGGBB
 */
export function resolveSkyColor(world, fallback = 0x87ceeb) {
  const fb = (typeof fallback === 'number' && Number.isFinite(fallback) ? fallback : 0x87ceeb) >>> 0;
  const c = world && world.sky && typeof world.sky.color === 'string' && world.sky.color.trim() !== ''
    ? world.sky.color.trim() : null;
  if (!c) return fb;
  const s = c[0] === '#' ? c.slice(1) : c;
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16) >>> 0;
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    // Expand #rgb → #rrggbb (matches worldRenderer._parseColor's convention).
    const r = s[0], g = s[1], b = s[2];
    return ((parseInt(r + r, 16) << 16) | (parseInt(g + g, 16) << 8) | parseInt(b + b, 16)) >>> 0;
  }
  return fb;
}