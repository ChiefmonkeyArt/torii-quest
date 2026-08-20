// engine/entities/bridge2Walk.js — PURE Bridge 2 walkability + entry waypoints.
//
// Single source of truth for "can a bot walk here on Bridge 2" and the two
// bridge entry waypoints used for inter-island routing. Shared by:
//   • src/bots.js               — single-player client bot wrapper
//   • server/bots/arenaBotSim.js — server-authoritative MP bot sim
//
// v0.2.610 fix: the server sim previously ran with isBridgeWalkable=()=>false
// and NO bridgeWaypoints, so MP bots steering at a player on the other island
// were coastline-clamped at the water's edge and beached there forever
// ("bots not honing/aware" in MP while SP worked — SP routes over Bridge 2).
//
// PURE: imports config constants only — no THREE, no Rapier, no scene.

import { BRIDGE2_X, BRIDGE2_Z, BRIDGE2_LEN, BRIDGE2_WIDTH } from '../../config.js';

// Bridge 2 walkable zone — lets bots walk between Arena BL and BR islands over
// the bridge. Includes a margin so the bot centre stays on deck.
const _HALF_L = BRIDGE2_LEN / 2 + 0.3;   // 0.3m margin for bot radius
const _HALF_W = BRIDGE2_WIDTH / 2 + 0.3;

// Bridge 2 is axis-aligned (no rotation), so this is a simple AABB check.
export function isOnBridge2(x, z) {
  return Math.abs(x - BRIDGE2_X) <= _HALF_L &&
         Math.abs(z - BRIDGE2_Z) <= _HALF_W;
}

// Bridge 2 entry waypoints (one per island side) for inter-island pathing.
// Index 0 = BL-side entry, index 1 = BR-side entry (botSim reads [i][0]/[i][1]).
export const BRIDGE2_WAYPOINTS = Object.freeze([
  Object.freeze([BRIDGE2_X - _HALF_L, BRIDGE2_Z]),  // BL-side entry
  Object.freeze([BRIDGE2_X + _HALF_L, BRIDGE2_Z]),  // BR-side entry
]);
