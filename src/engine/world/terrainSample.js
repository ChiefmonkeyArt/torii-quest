// engine/world/terrainSample.js — terrain-height sampling for a validated world
// manifest (ADR-0119 inline zone heights). Used by the portal live-mirror so the
// peek camera is anchored ABOVE the destination island instead of underground.
//
// Pure + node-safe: only reads the validated world object. No THREE / Rapier /
// DOM / WebGL, so it is fully unit-testable in node and safe for any leaf.
//
// Heightfield convention (matches terrainVisual._zoneMesh + worldTerrain):
// column-major — index = col * rows + row, where col walks +X (cols count) and
// row walks +Z (rows count). World-Y = rawHeight * scale[1] + offset[1].

/** Default eye/through height for a portal camera, metres above ground. */
export const PORTAL_EYE_HEIGHT = 1.6;

function _clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

/**
 * Bilinear-interpolated terrain surface height (world-Y) at (x, z), or null when
 * the world has no terrain or the point falls outside every zone.
 *
 * @param {object} world validated manifest (may be null/undefined)
 * @param {number} x world-X
 * @param {number} z world-Z
 * @returns {number|null}
 */
export function sampleTerrainHeight(world, x, z) {
  if (!world || !world.terrain || !Array.isArray(world.terrain.zones)) return null;
  for (const zone of world.terrain.zones) {
    if (!zone || typeof zone !== 'object') continue;
    const rows = Number(zone.rows);
    const cols = Number(zone.cols);
    const heights = zone.heights;
    const scale = Array.isArray(zone.scale) ? zone.scale : null;
    const offset = Array.isArray(zone.offset) ? zone.offset : null;
    if (!Number.isFinite(rows) || !Number.isFinite(cols) || rows < 2 || cols < 2) continue;
    if (!heights || typeof heights.length !== 'number' || heights.length !== rows * cols) continue;
    if (!scale || scale.length < 3 || !offset || offset.length < 3) continue;

    const cellW = scale[0] / (cols - 1);
    const cellD = scale[2] / (rows - 1);
    const minX = offset[0] - scale[0] / 2;
    const maxX = offset[0] + scale[0] / 2;
    const minZ = offset[2] - scale[2] / 2;
    const maxZ = offset[2] + scale[2] / 2;
    if (x < minX || x > maxX || z < minZ || z > maxZ) continue;

    const colF = (x - minX) / cellW;
    const rowF = (z - minZ) / cellD;
    let c0 = Math.floor(colF);
    let r0 = Math.floor(rowF);
    if (c0 < 0) c0 = 0; else if (c0 > cols - 2) c0 = cols - 2;
    if (r0 < 0) r0 = 0; else if (r0 > rows - 2) r0 = rows - 2;
    const fc = _clamp01(colF - c0);
    const fr = _clamp01(rowF - r0);

    const h00 = heights[c0 * rows + r0];
    const h10 = heights[(c0 + 1) * rows + r0];
    const h01 = heights[c0 * rows + (r0 + 1)];
    const h11 = heights[(c0 + 1) * rows + (r0 + 1)];
    const h = (h00 * (1 - fc) + h10 * fc) * (1 - fr) + (h01 * (1 - fc) + h11 * fc) * fr;
    return h * scale[1] + offset[1];
  }
  return null;
}

/**
 * Lift a gate transform's Y so its through-point sits at EYE height above the
 * local terrain surface. A manifest gate that stores `y = 0` (world origin)
 * would otherwise map the parallax camera underground on a heightfield island
 * (the blank-turquoise peek). Returns a NEW transform; the input is untouched.
 *
 * @param {object} world validated manifest
 * @param {{ position:{x,y,z}, quaternion:object }|null} transform gate transform
 * @returns {typeof transform} terrain-anchored copy, or the original when no terrain
 */
export function liftTransformToTerrain(world, transform) {
  if (!transform || !transform.position) return transform;
  const h = sampleTerrainHeight(world, transform.position.x, transform.position.z);
  if (h == null) return transform;
  return {
    position: { x: transform.position.x, y: h + PORTAL_EYE_HEIGHT, z: transform.position.z },
    quaternion: transform.quaternion,
  };
}

/**
 * The lowest camera Y that keeps the mirror above the destination surface at
 * (x, z) — terrain height + a small headroom. Null when there is no terrain
 * (the caller's existing platform-based height stays authoritative).
 */
export function groundFloorFor(world, x, z, headroom = 1.2) {
  const h = sampleTerrainHeight(world, x, z);
  return h == null ? null : h + headroom;
}