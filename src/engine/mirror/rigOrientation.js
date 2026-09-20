// engine/mirror/rigOrientation.js — the character rig's Z-up→Y-up "stand up"
// orientation as pure, node-safe math (no THREE import, no DOM).
//
// playerModel.loadPlayerModel orients a loaded GLB scene so the character stands
// upright in world space. Two cases:
//   - Z-up GLB (e.g. chiefmonkey's animation-library.glb): apply q = turnAround ⊗ standUp
//     where standUp = +90° about X and turnAround = 180° about Y.
//   - Y-up GLB: only rotation.y = π (a 180° yaw; the up axis is untouched).
//
// The "crab" bug (self-view mirror shows the character lying on its back) was
// initially suspected to be this rotation being wrong. This module is the single
// source of truth for the quaternion AND the invariants that lock it, so the
// orientation can be unit-tested and can never silently regress.

// World "up" is +Y. A rig is "upright" when its authored head-axis maps to +Y.
export const WORLD_UP = Object.freeze([0, 1, 0]);

/** A rig's authored "up" axis in its bind pose. Z-up model heads point −Z (the
 *  stand-up quaternion maps −Z → +Y — verified against THREE.Quaternion); a Y-up
 *  model's head points +Y. */
export function rigLocalUp(isZUp) {
  return isZUp ? [0, 0, -1] : [0, 1, 0];
}

/** Quaternion from axis + angle (right-hand rule) → [x, y, z, w]. */
function axisAngle(ax, ay, az, angle) {
  const s = Math.sin(angle / 2);
  const n = Math.hypot(ax, ay, az) || 1;
  return [(ax / n) * s, (ay / n) * s, (az / n) * s, Math.cos(angle / 2)];
}

/** Hamilton product a ⊗ b (apply b first, then a) → [x, y, z, w]. */
function multiply(a, b) {
  const ax = a[0], ay = a[1], az = a[2], aw = a[3];
  const bx = b[0], by = b[1], bz = b[2], bw = b[3];
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** Rotate vector v by unit quaternion q (matches THREE.Vector3.applyQuaternion). */
export function applyQuat(q, v) {
  const qx = q[0], qy = q[1], qz = q[2], qw = q[3];
  const vx = v[0], vy = v[1], vz = v[2];
  // t = 2 * cross(q.xyz, v)
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  // v' = v + qw * t + cross(q.xyz, t)
  return [
    vx + qw * tx + (qy * tz - qz * ty),
    vy + qw * ty + (qz * tx - qx * tz),
    vz + qw * tz + (qx * ty - qy * tx),
  ];
}

/** standUp = +90° about X. */
export function standUpQuaternion() {
  return axisAngle(1, 0, 0, Math.PI / 2);
}

/** turnAround = 180° about Y. */
export function turnAroundQuaternion() {
  return axisAngle(0, 1, 0, Math.PI);
}

/** The orientation quaternion applied to a rig's root, as [x, y, z, w]. For a
 *  Z-up rig this is turnAround ⊗ standUp; for a Y-up rig it is the 180° yaw (which
 *  leaves the up axis untouched). */
export function orientQuaternion(isZUp) {
  if (!isZUp) return turnAroundQuaternion(); // rotation.y = π
  return multiply(turnAroundQuaternion(), standUpQuaternion());
}

/** The rig's authored up axis after the orientation is applied, in world space. */
export function computeRigWorldUp(isZUp) {
  return applyQuat(orientQuaternion(isZUp), rigLocalUp(isZUp));
}

/** true when the oriented rig's head axis lands on world +Y (within eps). */
export function isRigUpright(isZUp, eps = 1e-6) {
  const u = computeRigWorldUp(isZUp);
  return Math.abs(u[0]) <= eps && Math.abs(u[1] - 1) <= eps && Math.abs(u[2]) <= eps;
}