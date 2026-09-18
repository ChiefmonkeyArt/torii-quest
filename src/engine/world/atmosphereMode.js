// engine/world/atmosphereMode.js
//
// Resolves a world manifest's sky descriptor into a scene atmosphere mode. The
// arena's warm sunrise SKY layer (the Sky.js Preetham dome + sun sprite + god rays
// + both star shells, all added once at module load in scene.js) belongs to the
// HOME arena only. When a foreign `space` world is swapped in by the in-place
// travel path, that layer must be hidden — it paints its own flat scene.background
// + a fresh starfield, and the warm dome/sun/god-rays leaking over it is the two-
// node "sky V artifact". A non-space world (`clear`/`dusk`/none, including the
// home arena's own `clear` manifest) re-shows the layer and restores the arena fog.
//
// This module is the PURE decision only (no THREE, no DOM), so it is node-testable.
// The impure scene mutation (toggling `.visible` on the sky meshes + restoring
// scene.fog/background) lives in scene.js (setArenaAtmosphere).
//
// Note on `clear`/`dusk` foreign worlds: they resolve to 'arena' here (and thus
// keep the arena sunrise layer). That is intentionally conservative — the home
// arena's own manifest is `clear`, and buildMinimalWorld has never painted a flat
// background for non-space skies, so reclassifying them would regress homecoming.

/** Constant: show the arena's atmospheric sky layer. */
export const ATMOSPHERE_ARENA = 'arena';

/** Constant: a `space` world hides the arena's atmospheric sky layer. */
export const ATMOSPHERE_SPACE = 'space';

/**
 * Decide whether the arena's atmospheric sky layer should be shown for `world`.
 *
 * @param {{ sky?: { type?: string } } | null | undefined} world
 * @returns {'arena' | 'space'} `'space'` only when the world declares a `space`
 *   sky (which paints its own background + starfield); everything else —
 *   including a missing, malformed, or unknown sky type — is `'arena'`.
 */
export function resolveAtmosphereMode(world) {
  const type = world && world.sky && typeof world.sky.type === 'string'
    ? world.sky.type
    : '';
  return type === ATMOSPHERE_SPACE ? ATMOSPHERE_SPACE : ATMOSPHERE_ARENA;
}