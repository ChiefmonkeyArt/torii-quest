// engine/world/worldTerrain.js — the data-driven terrain heightfield (Phase 0k.5,
// foundation slice). Given a validated `world.terrain` object (from
// worldSchema.validateWorld) + injected deps, it builds the Rapier heightfield
// collider that mirrors the legacy buildArena() terrain (physics.js
// createHeightfield → bodies.js createHeightfield). The heights + grid come from
// the world manifest instead of hardcoded buildArenaHeightfieldArray().
//
// INJECTED DEPS — NO static @dimforge/rapier3d-compat import (mirrors
// worldObjectColliders.js, which reaches the Rapier world + namespace via
// getWorld()/getRapier()). The source module is loaded via an injected
// `loadTerrainSource` so this module stays pure + testable with a mock loader
// (the schema in worldSchema.js must never do I/O).
//
// THREE-FREE for now (the collider is physics-only). The visual mesh (a
// heightmap-displaced PlaneGeometry mirroring terrain/terrainMesh.js) is a LATER
// sub-step — read terrainMesh.js before writing it (PlaneGeometry is XY, the
// collider is XZ; column-major heights are easy to transpose).
//
// CRITICAL CONTRACT — the ground must never vanish. A terrain present but
// unbuildable (source load failure, heights length mismatch, non-finite values,
// missing physics deps) is NOT silently skipped: buildWorldTerrain returns a
// structured { ok:false, error } so arenaRuntime falls back to legacy
// buildArena(). Only an ABSENT world.terrain (gateway-blank minimal world) is a
// no-op ({ ok:true, terrain:null }). This is the opposite fail-mode from
// worldObjectColliders (where a bad collider is silently omitted because
// colliders are optional) — the ground is not optional.
//
// Rapier gotcha (from physics.js): nrows/ncols are CELL counts (one fewer than
// the vertex counts). heights.length must equal (nrows+1)*(ncols+1) = rows*cols.
// Passing vertex counts panics the WASM ("unreachable"). Heights are column-major
// (heights[col*rows + row]). scale = total extents {x,y,z} (scaleY typically 1 →
// heights are absolute world-Y metres). offset = the CENTRE translation.

// loadWorldTerrainData(terrain, { loadTerrainSource }) → async { ok, error?, data }
// Resolves the heights Float32Array from the source module + re-validates against
// rows*cols + finiteness. The source module may export `heights` (Float32Array or
// plain array — the latter from .json modules) OR `buildHeightfieldArray()` (a
// function, preferred — avoids eager allocation of a large array at import time).
// Pure validation — no Rapier/THREE. Returns {ok:true, data:null} when terrain is
// null/absent. Returns {ok:false, error} on any failure.
export async function loadWorldTerrainData(terrain, { loadTerrainSource } = {}) {
  if (!terrain) return { ok: true, data: null };
  if (typeof loadTerrainSource !== 'function') {
    return { ok: false, error: 'loadWorldTerrainData: loadTerrainSource dep missing' };
  }
  const { source, rows, cols } = terrain;

  let mod;
  try {
    mod = await loadTerrainSource(source);
  } catch (err) {
    return { ok: false, error: `terrain source "${source}" load failed: ${_errMsg(err)}` };
  }
  if (mod == null || typeof mod !== 'object') {
    return { ok: false, error: `terrain source "${source}" did not export a module object` };
  }

  // heights: prefer buildHeightfieldArray() (lazy), fall back to `heights` (eager).
  let heights;
  if (typeof mod.buildHeightfieldArray === 'function') {
    try {
      heights = mod.buildHeightfieldArray();
    } catch (err) {
      return { ok: false, error: `buildHeightfieldArray() threw: ${_errMsg(err)}` };
    }
  } else {
    heights = mod.heights;
  }
  // Normalise a plain array (from .json modules) to a Float32Array.
  if (Array.isArray(heights)) heights = new Float32Array(heights);
  if (!(heights instanceof Float32Array)) {
    return {
      ok: false,
      error: `terrain source "${source}" must export heights (Float32Array) or buildHeightfieldArray()`,
    };
  }
  if (heights.length !== rows * cols) {
    return {
      ok: false,
      error: `terrain heights length ${heights.length} != rows*cols ${rows}*${cols} = ${rows * cols}`,
    };
  }
  for (let i = 0; i < heights.length; i++) {
    if (!Number.isFinite(heights[i])) {
      return { ok: false, error: `terrain heights has a non-finite value at index ${i}` };
    }
  }
  return {
    ok: true,
    data: {
      source,
      rows,
      cols,
      heights,
      scale: terrain.scale,
      offset: terrain.offset || [0, 0, 0],
    },
  };
}

// buildWorldTerrainCollider(data, { physicsWorld, Rapier }) → { ok, error?, collider, dispose }
// Creates the Rapier heightfield collider. nrows=rows-1, ncols=cols-1 (CELL counts —
// one fewer than the vertex counts; passing vertex counts panics the WASM). Heights
// are column-major (heights[col*rows + row]). scale = total extents {x,y,z};
// offset = centre translation. Mirrors physics.js createHeightfield — a standalone
// collider with NO rigid body (the heightfield is static + immovable).
export function buildWorldTerrainCollider(data, { physicsWorld, Rapier } = {}) {
  if (!data) return { ok: true, collider: null, dispose: () => {} };
  if (!physicsWorld || !Rapier) {
    return { ok: false, error: 'buildWorldTerrainCollider: physicsWorld + Rapier deps required' };
  }
  const { rows, cols, heights, scale, offset } = data;
  let collider;
  try {
    const desc = Rapier.ColliderDesc.heightfield(
      rows - 1,
      cols - 1,
      heights,
      { x: scale[0], y: scale[1], z: scale[2] },
    );
    desc.setTranslation(offset[0], offset[1], offset[2]);
    collider = physicsWorld.createCollider(desc);
  } catch (err) {
    return { ok: false, error: `buildWorldTerrainCollider: Rapier build failed: ${_errMsg(err)}` };
  }
  if (!collider) {
    return { ok: false, error: 'buildWorldTerrainCollider: physicsWorld.createCollider returned no collider' };
  }
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { physicsWorld.removeCollider(collider, true); } catch { /* best-effort */ }
  };
  return { ok: true, collider, dispose };
}

// buildWorldTerrainMesh(data, { THREE }) → { ok, error?, mesh, dispose }
// Builds the visual ground mesh — a heightmap-displaced BufferGeometry authored
// DIRECTLY in world space (mirrors terrain/terrainMesh.js buildZoneMesh: positions
// [x, h, z], column-major vertex index col*rows+row — NOT PlaneGeometry, which is XY
// + would need a rotation that's easy to get wrong). Vertex Y = heights[col*rows+row]
// * scale[1] + offset[1] (heights scaled by heightScale + offset by centre Y —
// matches the Rapier heightfield's local→world: heights * scale.y + translation.y).
// XZ span is centred at the offset: gMinX = offset[0]-scale[0]/2, cellW = scale[0]/(cols-1).
// Index winding a,d,b,b,d,c per cell matches the legacy (no back-face culling gap).
// Simple MeshStandardMaterial (no vertex-colour vary / sea-discard shader — those are
// zone-specific + need a sample() function; the world template can layer water itself).
export function buildWorldTerrainMesh(data, { THREE } = {}) {
  if (!data) return { ok: true, mesh: null, dispose: () => {} };
  if (!THREE) return { ok: false, error: 'buildWorldTerrainMesh: THREE dep required' };
  const { rows, cols, heights, scale, offset } = data;
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
  // Index build (two triangles per cell, column-major, winding a,d,b,b,d,c —
  // matches terrainMesh.js so there's no back-face culling gap at cell seams).
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
  mesh.name = 'world-terrain';
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { geo.dispose(); } catch { /* best-effort */ }
    try { mat.dispose(); } catch { /* best-effort */ }
  };
  return { ok: true, mesh, dispose };
}

// buildWorldTerrain(world, deps) → async { ok, error?, terrain }
//   world  — a validated world object (worldSchema.validateWorld result .world).
//             Only `world.terrain` is read.
//   deps   — { physicsWorld, Rapier, loadTerrainSource }. physicsWorld + Rapier
//             come from physics.js getWorld()/getRapier() (lazy). loadTerrainSource
//             is injected by the renderer (arenaRuntime) — it resolves the source
//             module path to { heights } or { buildHeightfieldArray } (a dynamic
//             import for .js, a fetch+parse for .json). Keeping the loader injected
//             lets this module stay pure + testable with a mock.
//
// Returns:
//   { ok: true, terrain: null }  — the world has no terrain (gateway-blank). No-op.
//   { ok: true, terrain: { colliders, bodies, meshes, dispose } }  — built.
//   { ok: false, error }  — a terrain was present but unbuildable. arenaRuntime
//                            treats this as "fall back to legacy buildArena()" so
//                            the ground never vanishes (the legacy arena has its
//                            own terrain).
export async function buildWorldTerrain(world, deps = {}) {
  if (!world || !world.terrain) return { ok: true, terrain: null };
  const loaded = await loadWorldTerrainData(world.terrain, deps);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  if (!loaded.data) return { ok: true, terrain: null };
  const colliderResult = buildWorldTerrainCollider(loaded.data, deps);
  if (!colliderResult.ok) return { ok: false, error: colliderResult.error };
  // Optional visual mesh (mirror terrain/terrainMesh.js). Built only when THREE is
  // provided; absent THREE = physics-only (the renderer can layer a legacy mesh
  // above the collider until the data-driven mesh is wired). A mesh build failure
  // fails the WHOLE terrain (→ fall back to legacy) — a collider with no visible
  // mesh means players walk on invisible ground, which is worse than legacy.
  let meshes = [];
  let meshDispose = () => {};
  if (deps.THREE) {
    const meshResult = buildWorldTerrainMesh(loaded.data, deps);
    if (!meshResult.ok) return { ok: false, error: meshResult.error };
    if (meshResult.mesh) { meshes = [meshResult.mesh]; meshDispose = meshResult.dispose; }
  }
  const dispose = () => {
    try { colliderResult.dispose && colliderResult.dispose(); } catch { /* best-effort */ }
    try { meshDispose(); } catch { /* best-effort */ }
  };
  return {
    ok: true,
    terrain: {
      colliders: colliderResult.collider ? [colliderResult.collider] : [],
      bodies: [],
      meshes,
      dispose,
    },
  };
}

function _errMsg(err) {
  return err && err.message ? String(err.message) : String(err);
}
