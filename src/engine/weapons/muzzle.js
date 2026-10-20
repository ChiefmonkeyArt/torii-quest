// engine/weapons/muzzle.js — pure first-person muzzle/barrel origin math.
// Extracted from weapons.js (v0.2.129) so the barrel offset SIDE CONVENTION is
// unit-testable without the WebGL renderer (scene.js). Imports only three's
// DOM-free math classes (Object3D / Camera / Quaternion / Vector3 — never the
// WebGLRenderer), so it loads cleanly in the node test environment.
//
// v0.2.129 bug + fix: getGunBarrelWorld used to apply the barrel offset along
// the camera's LOCAL quaternion. But the FP camera is a CHILD of playerObj,
// which carries the YAW (the camera itself holds only pitch). The local frame
// therefore ignored yaw, so the lateral (+right) offset pointed in a fixed
// WORLD direction regardless of facing — and as the player turned, the bullet
// origin/tracer swung to the wrong side (notably the LEFT) instead of staying on
// the visible right-hand gun. We now build the offset basis from the camera's
// WORLD quaternion so the muzzle tracks facing and stays on the right.
import * as THREE from 'three';

// Barrel offset in CAMERA-LOCAL space (metres). The sign convention is
// deliberate: +X is the camera's RIGHT, i.e. the side the visible right-hand gun
// viewmodel sits on (FP_REST_X is also > 0). +Y is up; -Z is forward, down the
// barrel toward the crosshair.
export const MUZZLE_FORWARD = 0.30;
export const MUZZLE_RIGHT   = 0.12;  // > 0 ⇒ visible RIGHT-hand gun side
export const MUZZLE_UP      = -0.10;

// Apply the local barrel offset along the supplied WORLD basis vectors. Pure
// scalars in, writes into `out` ({x,y,z}); no allocation. `out` may alias the
// camera-position source — the position components are read as numbers before
// any write.
export function muzzlePoint(
  ox, oy, oz,          // camera world position
  fx, fy, fz,          // world forward (unit)
  rx, ry, rz,          // world right (unit)
  ux, uy, uz,          // world up (unit)
  out,
) {
  out.x = ox + fx * MUZZLE_FORWARD + rx * MUZZLE_RIGHT + ux * MUZZLE_UP;
  out.y = oy + fy * MUZZLE_FORWARD + ry * MUZZLE_RIGHT + uy * MUZZLE_UP;
  out.z = oz + fz * MUZZLE_FORWARD + rz * MUZZLE_RIGHT + uz * MUZZLE_UP;
  return out;
}

// Scratch — allocated once at module load, never per call (keeps the per-shot
// path allocation-free).
const _q   = new THREE.Quaternion();
const _pos = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _rgt = new THREE.Vector3();
const _up  = new THREE.Vector3();

// Barrel tip in WORLD space for a first-person camera. Uses the camera's WORLD
// quaternion (NOT the local one) so the offset tracks player yaw. Writes the
// result into `out` and returns it.
export function barrelWorldFromCamera(camera, out) {
  camera.getWorldPosition(_pos);
  camera.getWorldQuaternion(_q);
  _fwd.set(0, 0, -1).applyQuaternion(_q);
  _rgt.set(1, 0,  0).applyQuaternion(_q);
  _up .set(0, 1,  0).applyQuaternion(_q);
  return muzzlePoint(
    _pos.x, _pos.y, _pos.z,
    _fwd.x, _fwd.y, _fwd.z,
    _rgt.x, _rgt.y, _rgt.z,
    _up.x,  _up.y,  _up.z,
    out,
  );
}

// ADR-0139: the FP gun is drawn by a SEPARATE camera (gunCamera, 55° FOV) on top
// of the world camera (75° FOV), so a fixed camera-local offset never lines up
// with the gun you see. Instead we take the gun tip's screen position (NDC, from
// gunCamera) and find the world point on the MAIN camera's ray through that same
// pixel, `depth` metres in front of it. A tracer started there visibly leaves
// the barrel. Pure: scalars + a column-major Matrix4 `elements` array in.
export const MUZZLE_VIS_DEPTH = 0.5; // m in front of the main camera (> near 0.1)
export function screenMatchedPoint(ndcX, ndcY, depth, fovDeg, aspect, m, out) {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const lx = ndcX * t * aspect * depth, ly = ndcY * t * depth, lz = -depth;
  out.x = m[0] * lx + m[4] * ly + m[8] * lz + m[12];
  out.y = m[1] * lx + m[5] * ly + m[9] * lz + m[13];
  out.z = m[2] * lx + m[6] * ly + m[10] * lz + m[14];
  return out;
}

/**
 * ADR-0139: the barrel tip of the FP gun model, in the model's LOCAL space.
 * gunScene's world frame is gunCamera's view frame (the camera sits at the
 * origin looking down -Z), so the tip is the front-most geometry: the mean of
 * the vertices within 1.2 cm of the minimum Z. Runs once when the GLB loads.
 * Returns false if the model has no geometry.
 */
export function findGunTip(root, out) {
  root.updateMatrixWorld(true);
  let minZ = Infinity;
  const v = _pos;
  root.traverse((o) => {
    const p = o.isMesh && o.geometry && o.geometry.attributes.position;
    if (!p) return;
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); if (v.z < minZ) minZ = v.z; }
  });
  if (!Number.isFinite(minZ)) return false;
  let sx = 0, sy = 0, n = 0;
  root.traverse((o) => {
    const p = o.isMesh && o.geometry && o.geometry.attributes.position;
    if (!p) return;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
      if (v.z < minZ + 0.012) { sx += v.x; sy += v.y; n++; }
    }
  });
  out.set(sx / n, sy / n, minZ);
  root.worldToLocal(out);
  return true;
}
