// engine/world/portalCamera.js — the parallax-correct portal camera (ADR-0118).
//
// The heart of "look through the gate into another world": derive a camera for the
// DESTINATION scene from the viewer's own camera, mapped through the gate, so the
// view through the aperture shifts correctly as the viewer moves — like a real
// window / mirror, not a flat texture.
//
//   M_portalCamera = M_to · M_from⁻¹ · M_viewer
//
// where M_from is the gate's transform in the viewer's world and M_to is its
// counterpart in the destination world. This is the standard matrix portal; it is
// PURE 3D math (three Matrix4/Vector3/Quaternion are the only deps, no WebGL), so it
// is unit-testable in node. The oblique near-plane clipping (so destination geometry
// never pops in front of the gate) is a renderer-side follow-up, not this module.
//
// Positions/quaternions are accepted and returned as plain `{x,y,z}` / `{x,y,z,w}`
// objects so callers and tests avoid three-object identity.

import { Matrix4, Vector3, Quaternion } from 'three';

function _vec(p) {
  return new Vector3(p.x, p.y, p.z);
}
function _quat(q) {
  // Accept a three Quaternion or a plain {x,y,z,w}; normalise on the way in.
  return new Quaternion(q.x, q.y, q.z, q.w).normalize();
}
function _compose(pos, quat) {
  return new Matrix4().compose(_vec(pos), _quat(quat), new Vector3(1, 1, 1));
}
function _plainPosition(v) {
  return { x: v.x, y: v.y, z: v.z };
}
function _plainQuaternion(q) {
  const n = new Quaternion(q.x, q.y, q.z, q.w).normalize();
  return { x: n.x, y: n.y, z: n.z, w: n.w };
}

/** A neutral planar transform at the origin, identity rotation. */
export function identityTransform() {
  return { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
}

/**
 * Compute the portal camera transform for the destination scene.
 *
 * @param {{ viewer: {position:{x,y,z}, quaternion:{x,y,z,w}},
 *           portalFrom: {position:{x,y,z}, quaternion:{x,y,z,w}},
 *           portalTo: {position:{x,y,z}, quaternion:{x,y,z,w}} }} args
 * @returns {{ position:{x,y,z}, quaternion:{x,y,z,w} }}
 *   The camera placed in DESTINATION space that sees world B exactly as the viewer
 *   sees world A through `portalFrom`. Null-safe: a missing transform is the origin.
 */
export function computePortalCamera({ viewer, portalFrom, portalTo } = {}) {
  const v = viewer || identityTransform();
  const from = portalFrom || identityTransform();
  const to = portalTo || identityTransform();

  const mViewer = _compose(v.position, v.quaternion);
  const mFrom = _compose(from.position, from.quaternion);
  const mTo = _compose(to.position, to.quaternion);

  const mCamera = new Matrix4().multiplyMatrices(mTo, new Matrix4().copy(mFrom).invert()).multiply(mViewer);

  const pos = new Vector3();
  const quat = new Quaternion();
  const scale = new Vector3();
  mCamera.decompose(pos, quat, scale);

  return { position: _plainPosition(pos), quaternion: _plainQuaternion(quat) };
}

/**
 * The portal camera expressed in the DESTINATION gate's local frame, i.e.
 * M_to⁻¹ · M_camera — which equals M_from⁻¹ · M_viewer (the viewer in the SOURCE
 * gate's local frame). Exposed for the invariant test and any placement logic.
 */
export function relativeToPortal(transform, portal) {
  const mT = _compose(transform.position, transform.quaternion);
  const mP = _compose(portal.position, portal.quaternion);
  const mR = new Matrix4().copy(mP).invert().multiply(mT);
  const pos = new Vector3();
  const quat = new Quaternion();
  const scale = new Vector3();
  mR.decompose(pos, quat, scale);
  return { position: _plainPosition(pos), quaternion: _plainQuaternion(quat) };
}