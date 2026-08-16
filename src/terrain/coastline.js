// terrain/coastline.js — TOMOE coastline rings (v0.2.511).
//
// Replaces the old circular coastline with the Mitsudomoe play-area rings.
// The fence/glass wall follows the ARENA play rings (two loops for the bottom
// islands). The 1m beach gap between coast and play is the safe zone.
//
// Consumers:
//   • arena.js — fenceRing() builds the glass wall (two neon loops)
//   • physics.js — fenceRing() builds knee-high colliders
//   • bots.js — clampToCoastline/pointInCoastline/coastlineBounds for containment
//   • player.js — isInsideFence for safe-zone detection
//
// Pure + node-safe: no THREE, no game state.

import {
  ARENA_BL_PLAY, ARENA_BR_PLAY,
  ARENA_BL_COAST, ARENA_BR_COAST,
  NAP_COAST,
} from './tomoeShapeData.js';
import {
  isArenaPlayArea, clampToArenaPlay,
} from './tomoeShape.js';

// Safe-zone width — the fence sits this far INSIDE the true terrain edge.
export const SAFE_ZONE_M = 1.0;

// The FENCE rings = arena play area rings (two loops for the two bottom islands).
// These are the rings the glass wall, colliders, and bot containment follow.
const _fenceRings = [ARENA_BL_PLAY, ARENA_BR_PLAY];

// The terrain edge rings = arena coast rings (for mesh cropping, if needed).
const _terrainEdgeRings = [ARENA_BL_COAST, ARENA_BR_COAST];

// Combined bounds of the fence rings — used for spawn sampling.
let _minX = Infinity, _maxX = -Infinity, _minZ = Infinity, _maxZ = -Infinity;
for (const ring of _fenceRings) {
  for (const [x, z] of ring) {
    if (x < _minX) _minX = x;
    if (x > _maxX) _maxX = x;
    if (z < _minZ) _minZ = z;
    if (z > _maxZ) _maxZ = z;
  }
}
const _bounds = Object.freeze({ minX: _minX, maxX: _maxX, minZ: _minZ, maxZ: _maxZ });

// Generic ray-casting point-in-polygon over an arbitrary [x,z] ring.
function _pointInRing(ring, x, z) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1];
    const xj = ring[j][0], zj = ring[j][1];
    const intersect =
      (zi > z) !== (zj > z) &&
      x < ((xj - xi) * (z - zi)) / (zj - zi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

// Point-in-rings: true if inside ANY of the rings.
function _pointInRings(rings, x, z) {
  for (const ring of rings) {
    if (_pointInRing(ring, x, z)) return true;
  }
  return false;
}

// True when (x, z) is inside any ARENA play ring (the fence).
export function pointInCoastline(x, z) { return isArenaPlayArea(x, z); }

// True when (x, z) is inside any ARENA coast ring (the terrain edge).
export function pointInTerrainEdge(x, z) { return _pointInRings(_terrainEdgeRings, x, z); }

// True when (x, z) is inside the fence (arena play area).
export function isInsideFence(x, z) { return isArenaPlayArea(x, z); }

// Clamp (x, z) so it stays inside the arena play area.
export function clampToCoastline(x, z, margin = 0) {
  const [cx, cz] = clampToArenaPlay(x, z, margin);
  return [cx, cz];
}

// The FENCE polygon vertices — array of rings (two loops for two arena islands).
export function fenceRing() { return _fenceRings; }
export function coastlineRing() { return _fenceRings; }

// The terrain-edge polygon vertices — array of rings.
export function terrainEdgeRing() { return _terrainEdgeRings; }

// Axis-aligned bounds of the fence rings for spawn sampling.
export function coastlineBounds() { return _bounds; }

// Legacy export — the first fence ring (for consumers expecting a single ring).
export const ARENA_COASTLINE = _fenceRings[0];
