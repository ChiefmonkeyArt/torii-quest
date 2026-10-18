// dynamicCrates.js — physics-driven push-around crates (v0.2.106).
// Small dynamic Rapier cuboids the player and bullets can shove around. Visual
// mesh follows the Rapier body each frame (allocation-free sync).
import * as THREE from 'three';
import { scene } from './scene.js';
import { createDynamicCrate } from './engine/physics/bodies.js';
import { sampleArenaHeight } from './terrain/heightmap.js';
import { crateMaterial } from './engine/render/crateLook.js';

const _crates = []; // { body, mesh }

const HALF = 0.5;
const SPOTS = [[3, 3], [-4, 2], [2, -4], [-3, -3]];

const _geo = new THREE.BoxGeometry(HALF * 2, HALF * 2, HALF * 2);

export function buildDynamicCrates() {
  // Clear any prior crates (re-entering the arena rebuilds the world).
  for (const c of _crates) scene.remove(c.mesh);
  _crates.length = 0;

  for (const [x, z] of SPOTS) {
    // Spawn a hair above the undulating arena surface so gravity drops the crate
    // cleanly onto the heightfield collider instead of into a hill (v0.2.330).
    // These are DYNAMIC bodies — physics settles them onto the terrain; we only
    // need a non-buried start height.
    const y = sampleArenaHeight(x, z) + HALF + 0.05;
    const handle = createDynamicCrate(x, y, z, HALF);
    if (!handle) continue;
    const mesh = new THREE.Mesh(_geo, crateMaterial());
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x, y, z);
    scene.add(mesh);
    _crates.push({ body: handle.body, mesh });
  }
}

export function tickDynamicCrates() {
  for (const c of _crates) {
    const t = c.body.translation();
    const r = c.body.rotation();
    c.mesh.position.set(t.x, t.y, t.z);
    c.mesh.quaternion.set(r.x, r.y, r.z, r.w);
  }
}

// Debug/handoff summary (v0.2.130) — current crate count + live positions.
// Allocates a small array; called only from the debug snapshot surface, never in
// the per-frame path, so it stays clear of the no-alloc hot-path rule.
export function getCrateSummary() {
  return {
    count: _crates.length,
    positions: _crates.map(c => {
      const t = c.body.translation();
      return { x: t.x, y: t.y, z: t.z };
    }),
  };
}
