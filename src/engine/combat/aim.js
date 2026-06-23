// aim.js — pure barrel-to-crosshair aiming math (no Three/Rapier; unit-testable).
//
// v0.2.126 firing rule: a player bullet ORIGINATES at the gun BARREL/muzzle and
// flies toward the point the CROSSHAIR is on — i.e. the camera ray's first hit,
// or a fallback convergence point when the crosshair ray hits open sky. Because
// the bullet line is aimed THROUGH the exact point the reticle previewed, a
// previewed headshot genuinely lands as a headshot, without pretending the
// projectile starts at the camera.
//
// This supersedes the v0.2.125 camera-origin experiment (bullet == camera ray):
// that fixed parallax but moved the muzzle off the gun. The barrel-origin +
// crosshair-convergence model keeps the muzzle on the gun AND keeps the shot
// honest, because convergence now happens at the ACTUAL aimed point (any range),
// not a fixed distance that only lined up at one range.

// Fallback aim distance (m) when the crosshair ray hits nothing (open sky / max
// range). Matched to the diagnostic ray reach so far shots still converge sanely.
export const CONVERGE_DIST = 80;

// World point the crosshair is on: camera origin + camera unit-dir * dist.
// Writes into `out` ({x,y,z}); returns out. Allocation-free (caller owns out).
export function crosshairPoint(ox, oy, oz, dx, dy, dz, dist, out) {
  out.x = ox + dx * dist;
  out.y = oy + dy * dist;
  out.z = oz + dz * dist;
  return out;
}

// Unit firing direction from the barrel (bx,by,bz) to the crosshair target
// point (tx,ty,tz). Writes normalized x/y/z into `out`; returns out. If the
// barrel sits essentially on the target (degenerate), falls back to the camera
// forward (fbx,fby,fbz) so we never emit a zero-length direction.
export function aimDirection(bx, by, bz, tx, ty, tz, fbx, fby, fbz, out) {
  const dx = tx - bx, dy = ty - by, dz = tz - bz;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-6) { out.x = fbx; out.y = fby; out.z = fbz; return out; }
  const inv = 1 / len;
  out.x = dx * inv; out.y = dy * inv; out.z = dz * inv;
  return out;
}
