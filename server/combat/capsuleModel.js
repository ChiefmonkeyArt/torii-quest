// server/combat/capsuleModel.js — pure snapshot → collider geometry (MP-2).
//
// Mirrors the shipped client colliders from src/engine/physics/bodies.js so
// the server's ray tests match what players see:
//
//   Body capsule:  half-height 0.50, radius 0.26, centre 0.76 above foot.
//                  Spans y=[0.00, 1.52]. Endpoints are cap centres:
//                    p0 = (x, foot+0.26, z)   (bottom cap centre)
//                    p1 = (x, foot+1.26, z)   (top cap centre)
//                  Cylinder body between them; hemispherical caps at both ends.
//
//   Head sphere:   radius 0.20, centre 1.55 above foot.
//                  Spans y=[1.35, 1.75]. Overlaps top of body cap [0, 1.52] by
//                  0.17 m — no thread-through gap.
//
// snapshot.pos is EYE-LEVEL (matches the shipped MOVE emission — see
// engine/entities/player.js SPAWN_Y = EYE + ISLAND_BASE_Y + 0.8). We derive
// foot = pos.y - EYE_HEIGHT. EYE_HEIGHT matches the shipped PLAYER_EYE_Y in
// player.js (1.7). This is a small drift risk vs. the ground truth; a parity
// test in tests/multiplayer/capsule-model.test.js locks the constants.

// Shipped constants from src/engine/physics/bodies.js — copied, not imported,
// so this file stays pure server-side.
export const BODY_HALF_H = 0.50;
export const BODY_RADIUS = 0.26;
export const BODY_CENTRE_Y = 0.76; // BODY_HALF_H + BODY_RADIUS

export const HEAD_RADIUS  = 0.20;
export const HEAD_CENTRE_Y = 1.55;

// EYE height above the peer's foot. Shipped clients emit MOVE.pos at the
// camera position, not the foot, so we back out here. Matches PLAYER_EYE_Y
// in engine/entities/player.js.
export const EYE_HEIGHT = 1.7;

/**
 * Given a MOVE-style snapshot ({pos:[x,y,z], rot:[yaw,pitch]}) build the
 * two colliders. Returns a fresh object; caller may hold onto it.
 *
 * @param {{pos:[number,number,number]}} snap
 * @returns {{
 *   bodyCap: { p0:[number,number,number], p1:[number,number,number], r:number },
 *   headSphere: { c:[number,number,number], r:number },
 * }}
 */
export function buildColliders(snap) {
  const [x, y, z] = snap.pos;
  const footY = y - EYE_HEIGHT;
  // Body cap endpoints (cylinder axis centres — NOT cap tips).
  const p0y = footY + BODY_RADIUS;                    // bottom cap centre
  const p1y = footY + BODY_RADIUS + 2 * BODY_HALF_H;  // top cap centre
  return {
    bodyCap: {
      p0: [x, p0y, z],
      p1: [x, p1y, z],
      r:  BODY_RADIUS,
    },
    headSphere: {
      c: [x, footY + HEAD_CENTRE_Y, z],
      r: HEAD_RADIUS,
    },
  };
}
