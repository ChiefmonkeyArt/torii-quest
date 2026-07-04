// terrain/terrainMesh.js — undulating island ground meshes (Stage 3, v0.2.329).
//
// Builds the NAP and ARENA island surfaces as world-space BufferGeometry meshes.
// Vertices are authored directly in WORLD space (x, h(x,z), z) so there is no
// PlaneGeometry rotation/UV orientation to get wrong — each mesh is bit-identical
// to its sample function by construction. Grass blades bake the same sample() into
// their base Y, so grass sits exactly on the surface. Meshes span the EXTENDED
// grid extent (footprint + outward shore) so the island slopes into the sea.
//
// Browser-only (imports THREE). Pure geometry build, no game state.

import * as THREE from 'three';
import {
  NAP_TERRAIN, NAP_GRID, sampleNapHeight,
  ARENA_TERRAIN, ARENA_GRID, sampleArenaHeight, ISLAND_BASE_Y,
} from './heightmap.js';
import { SEA_LEVEL } from './seaConfig.js';
import { pointInTerrainEdge } from './coastline.js';

// Cheap deterministic value-noise in [0,1) from world XZ — no textures, no state.
function _hash(x, z) {
  const s = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

// Shared builder: world-space grid mesh over a zone's extended extent. When
// `vary(base, x, z, h)` is supplied, per-vertex colours are baked (vertexColors)
// for cheap procedural ground variation with no texture assets.
function buildZoneMesh(scene, TERRAIN, GRID, sample, { color, name, roughness = 1.0, vary = null, cellKeep = null }) {
  const { colsX, rowsZ, cellW, cellD } = GRID;
  const { gMinX, gMinZ } = TERRAIN;

  const vertCount = colsX * rowsZ;
  const positions = new Float32Array(vertCount * 3);
  const uvs = new Float32Array(vertCount * 2);
  const normals = new Float32Array(vertCount * 3); // recomputed below
  const colors = vary ? new Float32Array(vertCount * 3) : null;
  const _base = new THREE.Color(color);

  for (let col = 0; col < colsX; col++) {
    const x = gMinX + col * cellW;
    for (let row = 0; row < rowsZ; row++) {
      const z = gMinZ + row * cellD;
      const vi = (col * rowsZ + row) * 3;
      const h = sample(x, z);
      positions[vi + 0] = x;
      positions[vi + 1] = h;
      positions[vi + 2] = z;
      const ui = (col * rowsZ + row) * 2;
      uvs[ui + 0] = col / (colsX - 1);
      uvs[ui + 1] = row / (rowsZ - 1);
      if (colors) { const c = vary(_base, x, z, h); colors[vi] = c.r; colors[vi + 1] = c.g; colors[vi + 2] = c.b; }
    }
  }

  // Index build. When `cellKeep(cx,cz)` is supplied, a grid CELL is emitted only
  // if its XZ centroid passes the test — this CROPS the mesh to an arbitrary
  // polygon (the rounded terrain edge) so the visible/physical footprint follows
  // the coast, not the square grid. The full vertex buffer is retained; culled
  // cells simply leave their verts unreferenced (not drawn).
  const vidx = (col, row) => col * rowsZ + row;
  let indices;
  if (cellKeep) {
    const arr = [];
    for (let col = 0; col < colsX - 1; col++) {
      const cx = gMinX + (col + 0.5) * cellW;
      for (let row = 0; row < rowsZ - 1; row++) {
        const cz = gMinZ + (row + 0.5) * cellD;
        if (!cellKeep(cx, cz)) continue;
        const a = vidx(col,     row);
        const b = vidx(col + 1, row);
        const c = vidx(col + 1, row + 1);
        const d = vidx(col,     row + 1);
        arr.push(a, d, b, b, d, c);
      }
    }
    indices = new Uint32Array(arr);
  } else {
    indices = new Uint32Array((colsX - 1) * (rowsZ - 1) * 6);
    let p = 0;
    for (let col = 0; col < colsX - 1; col++) {
      for (let row = 0; row < rowsZ - 1; row++) {
        const a = vidx(col,     row);
        const b = vidx(col + 1, row);
        const c = vidx(col + 1, row + 1);
        const d = vidx(col,     row + 1);
        indices[p++] = a; indices[p++] = d; indices[p++] = b;
        indices[p++] = b; indices[p++] = d; indices[p++] = c;
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
  geo.setAttribute('normal',   new THREE.BufferAttribute(normals, 3));
  if (colors) geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setIndex(new THREE.BufferAttribute(indices, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    color: vary ? 0xffffff : color, roughness, metalness: 0, vertexColors: !!vary,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = name;
  if (scene) scene.add(mesh);
  return mesh;
}

// NAP island — green, matching the peaceful-garden tone.
export function buildNapTerrainMesh(scene) {
  return buildZoneMesh(scene, NAP_TERRAIN, NAP_GRID, sampleNapHeight, {
    color: 0x3d5a2f,        // NAP ground-cover green
    name: 'nap-zone-floor', // preserve scene.getObjectByName lookup
  });
}

// Arena island — sandy/earthy shore (v0.2.342). Warm sand base with procedural
// per-vertex variation: a hashed noise breaks up the flat colour and the height
// tints it (lighter dry sand on the rises, darker damp earth in the dips down to
// the waterline). High roughness, no metalness — reads as matte ground, not
// plastic. Purely procedural — no texture assets, so bundle size is unchanged.
const _SAND = 0xb9a06b;
function _arenaGroundColor(base, x, z, h) {
  const n = _hash(x, z);                                   // 0..1 speckle
  const span = (ISLAND_BASE_Y - SEA_LEVEL) || 1;
  const hf = Math.max(0, Math.min(1, (h - SEA_LEVEL) / span)); // 0 shore → 1 plateau
  const shade = 0.80 + 0.20 * n + 0.14 * hf;               // ~0.80..1.14
  return _scratchCol.setRGB(base.r * shade, base.g * shade, base.b * shade);
}
const _scratchCol = new THREE.Color();
export function buildArenaTerrainMesh(scene) {
  return buildZoneMesh(scene, ARENA_TERRAIN, ARENA_GRID, sampleArenaHeight, {
    color: _SAND,
    name: 'arena-floor',
    roughness: 0.95,
    vary: _arenaGroundColor,
    // Crop the visible/physical arena footprint to the ROUNDED terrain edge so the
    // land follows the coast instead of the square grid. The east/river vertex is
    // preserved (no outward push) and the bridge overlaps x∈[14,26] at z≈0, so the
    // arena→bridge→NAP connection stays intact even though the corners round in.
    cellKeep: (x, z) => pointInTerrainEdge(x, z),
  });
}
