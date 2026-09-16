// engine/world/terrainVisual.js — VISUAL-ONLY terrain for offscreen/peek scenes.
//
// `buildWorldTerrain` (worldTerrain.js) builds physics colliders AND meshes, and
// REQUIRES a Rapier physicsWorld — which the portal live-mirror scene does not
// own (it's a read-only render-to-target with no simulation). The result was a
// peek that shows only the flat cloud platform: the black/grey iris the two-node
// playtest reported.
//
// This module mirrors the *mesh* half of buildWorldTerrainMesh — same column-major
// heightfield layout, same winding — with NO physics or THREE-adjacent coupling
// beyond the injected THREE namespace, so the mirror renders the destination's
// real island silhouette through the gate. Pure data path; THREE is injected.

/**
 * Build the visual-only terrain meshes for a world's inline terrain zones.
 * Reads world.terrain.zones[i] { rows, cols, heights, scale, offset }; heights
 * are inline (content-addressed manifests), column-major (col*rows+row).
 * Returns { ok, meshes, grounds } — each mesh is { mesh, dispose }. A zone with a
 * missing/malformed heights pair degrades (skipped) rather than failing the whole
 * peek: the platform fallback stays underneath.
 * @param {{ terrain?: { zones?: Array }} } world
 * @param {{ THREE: object }} deps
 */
export function buildTerrainVisual(world, { THREE } = {}) {
  if (!world || !world.terrain || !Array.isArray(world.terrain.zones) || !world.terrain.zones.length) {
    return { ok: true, meshes: [] };
  }
  if (!THREE) return { ok: false, error: 'buildTerrainVisual: THREE dep required' };

  const meshes = [];
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

    let mesh;
    try {
      mesh = _zoneMesh({ rows: rows | 0, cols: cols | 0, heights, scale, offset }, THREE);
    } catch { mesh = null; }
    if (mesh) meshes.push(mesh);
  }
  return { ok: true, meshes };
}

// _zoneMesh — one displaced heightfield mesh. Column-major, same winding as
// worldTerrain.buildWorldTerrainMesh (see that module for the convention notes).
function _zoneMesh(z, THREE) {
  const { rows, cols, heights, scale, offset } = z;
  const cellW = scale[0] / (cols - 1);
  const cellD = scale[2] / (rows - 1);
  const gMinX = offset[0] - scale[0] / 2;
  const gMinZ = offset[2] - scale[2] / 2;

  const vertCount = rows * cols;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  for (let col = 0; col < cols; col++) {
    const x = gMinX + col * cellW;
    for (let row = 0; row < rows; row++) {
      const z = gMinZ + row * cellD;
      const vi3 = (col * rows + row) * 3;
      positions[vi3 + 0] = x;
      positions[vi3 + 1] = heights[col * rows + row] * scale[1] + offset[1];
      positions[vi3 + 2] = z;
      const ui = (col * rows + row) * 2;
      uvs[ui + 0] = col / (cols - 1);
      uvs[ui + 1] = row / (rows - 1);
    }
  }
  const indices = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let p = 0;
  for (let col = 0; col < cols - 1; col++) {
    for (let row = 0; row < rows - 1; row++) {
      const a = col * rows + row;
      const b = (col + 1) * rows + row;
      const c = (col + 1) * rows + (row + 1);
      const d = col * rows + (row + 1);
      indices[p++] = a; indices[p++] = d; indices[p++] = b;
      indices[p++] = b; indices[p++] = d; indices[p++] = c;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xb9a06b, roughness: 0.95, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'world-terrain-visual';
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { geo.dispose(); } catch { /* best-effort */ }
    try { mat.dispose(); } catch { /* best-effort */ }
  };
  return { mesh, dispose };
}