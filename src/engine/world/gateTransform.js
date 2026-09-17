// engine/world/gateTransform.js — the torii-gate transform for a world manifest
// (ADR-0118). Reads the destination world's gate as a plain { position, quaternion }
// (yaw-only rotation about Y) so portalCamera.computePortalCamera can map the viewer
// through the doorway — the parallax-correct "look through the gate" peek.
//
// Gate detection mirrors worldArrival.resolveArrival: an explicit `gateway.position`
// wins (its through-axis yaw is read from `gateway.target` only when arriving, not
// here — the gate transform itself is positional + yaw), else the first `torii-gate`
// object. A torii-gate object carries `rotation[1]` as its through-axis yaw.
//
// Pure + node-safe: no THREE/Rapier/DOM. Returns plain objects so callers and tests
// never touch three-object identity.

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** yaw (about +Y) → a normalised plain quaternion { x, y, z, w }. */
export function quatFromYaw(yaw) {
  const half = _num(yaw) / 2;
  return { x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) };
}

/**
 * The gate transform for a validated world manifest, or null when the manifest has
 * no gate (there is still a world — just nothing to map the portal through; the
 * mirror falls back to its fixed 3/4 peek view).
 *
 * @param {object} [world] validated manifest
 * @returns {{ position: {x,y,z}, quaternion: {x,y,z,w} } | null}
 */
export function gateTransform(world) {
  let pos = null;
  let yaw = 0;
  if (world && world.gateway && Array.isArray(world.gateway.position) && world.gateway.position.length >= 3) {
    pos = {
      x: _num(world.gateway.position[0]),
      y: _num(world.gateway.position[1]),
      z: _num(world.gateway.position[2]),
    };
  } else if (world && Array.isArray(world.objects)) {
    const g = world.objects.find(
      (o) => o && o.type === 'torii-gate' && Array.isArray(o.position) && o.position.length >= 3,
    );
    if (g) {
      pos = { x: _num(g.position[0]), y: _num(g.position[1]), z: _num(g.position[2]) };
      if (Array.isArray(g.rotation)) yaw = _num(g.rotation[1]);
    }
  }
  if (!pos) return null;
  return { position: pos, quaternion: quatFromYaw(yaw) };
}