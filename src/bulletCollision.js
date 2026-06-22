// bulletCollision.js — swept bullet-vs-world tests.
// At BULLET_SPEED ~60 m/s a bullet covers ~1 m per tick, so point-in-AABB
// tunnels straight through thin walls and crate edges. These routines sweep
// the prev→curr segment instead. East-wall plane is suppressed inside the
// torii gate gap (|z| < EAST_GAP_HALF) so the opening is a real hole.
//
// Used by weapons.js for both player AND bot bullets — same physics.

import * as THREE from 'three';
import { ARENA_HALF, EAST_GAP_HALF, CRATES } from './config.js';

// Module-level scratch — never allocate in hot path. Callers read these
// after a successful test, before invoking the next test.
export const impactPos = new THREE.Vector3();
export const impactNrm = new THREE.Vector3();

// Sweep prev→curr against the four arena wall planes.
// Returns true and fills impactPos/impactNrm on hit.
export function sweepWalls(b) {
  const p0 = b.prev, p1 = b.mesh.position;
  let tHit = 2, hx = 0, hy = 0, hz = 0, nx = 0, nz = 0;
  if (p1.x >= ARENA_HALF && p0.x < ARENA_HALF) {
    const t = (ARENA_HALF - p0.x) / (p1.x - p0.x);
    const zAt = p0.z + (p1.z - p0.z) * t;
    if (Math.abs(zAt) > EAST_GAP_HALF && t < tHit) {
      tHit = t; hx = ARENA_HALF; hy = p0.y + (p1.y - p0.y) * t; hz = zAt; nx = -1; nz = 0;
    }
  }
  if (p1.x <= -ARENA_HALF && p0.x > -ARENA_HALF) {
    const t = (-ARENA_HALF - p0.x) / (p1.x - p0.x);
    if (t < tHit) { tHit = t; hx = -ARENA_HALF; hy = p0.y + (p1.y - p0.y) * t; hz = p0.z + (p1.z - p0.z) * t; nx = 1; nz = 0; }
  }
  if (p1.z >= ARENA_HALF && p0.z < ARENA_HALF) {
    const t = (ARENA_HALF - p0.z) / (p1.z - p0.z);
    if (t < tHit) { tHit = t; hx = p0.x + (p1.x - p0.x) * t; hy = p0.y + (p1.y - p0.y) * t; hz = ARENA_HALF; nx = 0; nz = -1; }
  }
  if (p1.z <= -ARENA_HALF && p0.z > -ARENA_HALF) {
    const t = (-ARENA_HALF - p0.z) / (p1.z - p0.z);
    if (t < tHit) { tHit = t; hx = p0.x + (p1.x - p0.x) * t; hy = p0.y + (p1.y - p0.y) * t; hz = -ARENA_HALF; nx = 0; nz = 1; }
  }
  if (tHit > 1) return false;
  impactPos.set(hx, hy, hz);
  impactNrm.set(nx, 0, nz);
  return true;
}

// Slab method swept-AABB test against one crate. Returns t ∈ [0,1] or -1.
function _sweepCrate(b, cx, cz, hw, hd, fullH) {
  const p0 = b.prev, p1 = b.mesh.position;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  let tEnter = 0, tExit = 1;
  let nx = 0, ny = 0, nz = 0;
  if (Math.abs(dx) < 1e-8) { if (p0.x < cx - hw || p0.x > cx + hw) return -1; }
  else {
    let t1 = (cx - hw - p0.x) / dx, t2 = (cx + hw - p0.x) / dx, eN = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; eN = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = eN; ny = 0; nz = 0; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return -1;
  }
  if (Math.abs(dy) < 1e-8) { if (p0.y < 0 || p0.y > fullH) return -1; }
  else {
    let t1 = (0 - p0.y) / dy, t2 = (fullH - p0.y) / dy, eN = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; eN = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = 0; ny = eN; nz = 0; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return -1;
  }
  if (Math.abs(dz) < 1e-8) { if (p0.z < cz - hd || p0.z > cz + hd) return -1; }
  else {
    let t1 = (cz - hd - p0.z) / dz, t2 = (cz + hd - p0.z) / dz, eN = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; eN = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = 0; ny = 0; nz = eN; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return -1;
  }
  if (tEnter < 0 || tEnter > 1) return -1;
  impactPos.set(p0.x + dx * tEnter, p0.y + dy * tEnter, p0.z + dz * tEnter);
  impactNrm.set(nx, ny, nz);
  return tEnter;
}

// Sweep all crates and report the earliest entry.
export function sweepCrates(b) {
  let bestT = 2, hpx = 0, hpy = 0, hpz = 0, hnx = 0, hny = 0, hnz = 0;
  for (let i = 0; i < CRATES.length; i++) {
    const c = CRATES[i];
    const t = _sweepCrate(b, c[0], c[1], c[2], c[3], c[4]);
    if (t >= 0 && t < bestT) {
      bestT = t;
      hpx = impactPos.x; hpy = impactPos.y; hpz = impactPos.z;
      hnx = impactNrm.x; hny = impactNrm.y; hnz = impactNrm.z;
    }
  }
  if (bestT > 1) return false;
  impactPos.set(hpx, hpy, hpz);
  impactNrm.set(hnx, hny, hnz);
  return true;
}
