// engine/world/arrivalCamera.js — the "stepped out the other side" preview pose.
//
// The gateway directory preview shows a destination world as a traveller would
// SEE it the moment they step through the torii gate and look around: standing
// just inside the gate, back to the doorway, eye-height above the terrain, facing
// INTO the world — not a distant 3/4 bird's-eye, and not the window-parallax
// through-portal mapping (which reads as "looking through the gate", not "just
// arrived"). This pose is the SAME one travel lands the player on (resolveArrival),
// so the peek and the landed view agree.
//
// Pure + node-safe: reads only the validated manifest + the pure terrain sampler.
// No THREE / Rapier / DOM.

import { resolveArrival } from './worldArrival.js';
import { sampleTerrainHeight, PORTAL_EYE_HEIGHT } from './terrainSample.js';

/**
 * The destination-world preview camera pose: the traveller's arrival point, lifted
 * to eye height above the terrain, facing into the world (back to the gate).
 *
 * @param {object} world validated manifest (may be null/undefined)
 * @param {{ eyeHeight?: number }} [opts]
 * @returns {{ position: {x:number,y:number,z:number}, yaw:number, forward:{x:number,z:number} }}
 */
export function resolveArrivalCamera(world, { eyeHeight = PORTAL_EYE_HEIGHT } = {}) {
  const a = resolveArrival(world || null);
  const ground = sampleTerrainHeight(world || null, a.x, a.z);
  const y = (ground == null ? 0 : ground) + eyeHeight;
  // Arrival yaw faces into the world (resolveArrival's forward convention is
  // (sin yaw, cos yaw), i.e. away from the gate toward the interior).
  const forward = { x: Math.sin(a.yaw), z: Math.cos(a.yaw) };
  return {
    position: { x: a.x, y, z: a.z },
    yaw: a.yaw,
    forward,
  };
}