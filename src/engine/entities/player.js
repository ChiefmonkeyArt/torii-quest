// engine/entities/player.js — Player entity boundary (SDK seam, v0.2.114).
//
// First slice of the A1-next "extract player boundary" task. This module owns
// the player's PURE, allocation-free GEOMETRY, SPAWN shape, and look-down
// CAMERA math — the parts that can leave player.js with zero behaviour risk
// because they hold no per-frame mutable state and allocate nothing.
//
// Still living in src/player.js (stateful — to migrate in a later slice):
//   • movement/kinematic tick (tickPlayer)        — owns _vy / _onGround + Rapier
//   • combat (shoot / startReload / getRecoilT)    — owns ammo / recoil timers
//   • lifecycle (takeDamage / killPlayer / tickDeath) — owns hp / respawn
//   • body-state (setPlayerBody / getPlayerCollider / spawnPlayerBody) — owns _body
// Those depend on live module state and Three/Rapier handles; this slice leaves
// them in place and documents the seam so the next agent can lift them cleanly.
//
// No Three import on purpose: everything here is scalar math + plain data, so
// the module is trivially testable and stays allocation-free in the hot path.

// Import the capsule-centre offset from the pure bodies.js leaf (where it is
// defined) rather than the physics.js facade, so this boundary — and its unit
// tests — stay free of the Three/Rapier import chain.
import { PLAYER_BODY_CENTRE_OFFSET } from '../physics/bodies.js';

// --- Geometry ---------------------------------------------------------------
// Eye sits 1.7 m above the foot. The capsule CENTRE sits PLAYER_BODY_CENTRE_OFFSET
// (0.9 m) above the foot, so body.y = playerObj.y - EYE + PLAYER_BODY_CENTRE_OFFSET.
export const EYE = 1.7;
export const BODY_FROM_EYE = PLAYER_BODY_CENTRE_OFFSET - EYE; // -0.8

// --- Spawn ------------------------------------------------------------------
// Safe respawn corner — southwest (-X,-Z), opposite the torii gate (east) and
// furthest from the bots.
export const SPAWN_X = -14;
export const SPAWN_Z = -14;
export const SPAWN_Y = 1.7;
// Face NE into the arena from the SW corner toward centre (0,0).
// Three.js fwd = (-sin(yaw),0,-cos(yaw)); need fwd=(+0.707,0,+0.707)
// => sin(yaw)=-0.707, cos(yaw)=-0.707 => yaw = -3π/4.
export const SPAWN_YAW = -3 * Math.PI / 4;
// Bots stay out of this radius around the LIVE spawn. Mutable: resetPlayerPos()
// updates .x/.z on respawn, so consumers must read the shared object reference.
export const PLAYER_SAFE_CORNER = { x: SPAWN_X, z: SPAWN_Z, radius: 6 };

// Respawn-corner picker (v0.2.291) — the local player's "where do I respawn"
// decision, lifted out of the THREE-coupled arenaRuntime PLAYER_KILLED handler so
// it is one pure, owned, unit-testable function living with the spawn geometry it
// uses. The four arena corners sit at ±SPAWN_MAG (matching |SPAWN_X|=|SPAWN_Z|);
// the chosen corner MAXIMISES the minimum squared distance to the live bots (spawn
// as far from danger as possible). A missing bot position counts as the origin
// (0,0). Ties resolve to the lowest-index corner (SW first), so with no live bots
// it returns the canonical SW spawn — behaviour-identical to the pre-extraction
// inline logic. Each corner faces the arena centre: yaw = atan2(x, z) (Three.js
// forward = (-sin yaw, -cos yaw), so facing (0,0) from (x,z) needs that yaw). Pure;
// allocates one tiny result object (called once per death, never per frame).
export const SPAWN_MAG = 14;
const RESPAWN_CORNERS = Object.freeze([
  { x: -SPAWN_MAG, z: -SPAWN_MAG },
  { x:  SPAWN_MAG, z: -SPAWN_MAG },
  { x:  SPAWN_MAG, z:  SPAWN_MAG },
  { x: -SPAWN_MAG, z:  SPAWN_MAG },
]);
export function pickRespawnCorner(liveBotPositions = []) {
  let best = RESPAWN_CORNERS[0], bestDist = -1;
  for (const c of RESPAWN_CORNERS) {
    let minD = Infinity;
    for (const p of liveBotPositions) {
      const dx = (p?.x ?? 0) - c.x, dz = (p?.z ?? 0) - c.z;
      minD = Math.min(minD, dx * dx + dz * dz);
    }
    if (minD > bestDist) { bestDist = minD; best = c; }
  }
  return { x: best.x, z: best.z, yaw: Math.atan2(best.x, best.z) };
}

// --- Look-down POV (v0.2.112 neck-pivot arc) --------------------------------
// The camera is a child of playerObj at the eye, so these offsets move the eye
// WITHIN the head without touching gameplay height (playerObj.y stays at EYE —
// bots still aim at the true eye).
//   CAM_BASE_Y    — lower the resting eye a touch so the chin/neck stops
//                   intruding when looking down.
//   CAM_FWD_ARC   — peak forward lean mid-look-down: a sin BUMP that arcs the
//                   eye OUT over the chest then back INWARD toward the feet,
//                   like a head rotating on the neck pivot.
//   CAM_DOWN_DROP — extra eye drop eased in as the pitch tips fully down,
//                   pulling the view onto the chest → feet.
const CAM_BASE_Y    = -0.06;
const CAM_FWD_ARC   = 0.10;
const CAM_DOWN_DROP = 0.12;

// down: 0 level → 1 straight down. pitch is 0 level → -PI/2 straight down.
function lookDown(pitch) {
  return Math.max(0, Math.min(1, -pitch / (Math.PI / 2)));
}

// Camera local Y for a given pitch. Allocation-free scalar; identical formula to
// the pre-extraction inline math so the look-down POV is preserved exactly.
export function lookDownEyeY(pitch) {
  return CAM_BASE_Y - CAM_DOWN_DROP * Math.sin(lookDown(pitch) * (Math.PI / 2));
}

// Camera local Z for a given pitch. Camera local -Z is forward, so the forward
// lean is a negative z (the sin bump described above).
export function lookDownEyeZ(pitch) {
  return -CAM_FWD_ARC * Math.sin(lookDown(pitch) * Math.PI);
}

// --- Movement heading basis (yaw -> world XZ) --------------------------------
// Per-frame WASD movement builds its world-space direction from the camera yaw.
// These are the exact scalar components the movement tick used inline, lifted
// here so they're testable and the basis convention lives in one place.
// Three.js convention: forward = (-sin(yaw), -cos(yaw)); right is forward
// rotated +90° about Y = (cos(yaw), -sin(yaw)). Allocation-free scalars — the
// caller writes them into its reusable scratch vectors, so the hot path still
// allocates nothing.
export function forwardX(yaw) { return -Math.sin(yaw); }
export function forwardZ(yaw) { return -Math.cos(yaw); }
export function rightX(yaw)   { return  Math.cos(yaw); }
export function rightZ(yaw)   { return -Math.sin(yaw); }
