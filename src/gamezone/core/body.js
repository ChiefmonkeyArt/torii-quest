// src/gamezone/core/body.js — coarse bodies + shot validation (ADR-0130).
//
// Two jobs, one geometry:
//   1. RESOLVE a shot that arrives without a client claim (peers, tests, any
//      client that cannot see skeletons): an upright capsule from the feet to the
//      top of the head. The ZONE is decided by the impact HEIGHT relative to the
//      neck line — not by which of two overlapping shapes the ray touched first.
//      That rule is symmetric and angle-independent, which is the property the
//      legacy head-sphere/body-capsule overlap lacked (shots at the same spot on
//      the face resolved head or body depending on the shooter's height).
//   2. VALIDATE a client claim made against the rendered skeleton: the ray must
//      pass within a generous envelope of where the authority had that target at
//      the claimed render tick, the claimed distance must agree, and a head claim
//      must cross the target above `headMinY`.
// Node-pure.

import { rayCapsule, raySegmentClosest } from './geom.js';

const _c = { dist: 0, t: 0, s: 0, px: 0, py: 0, pz: 0 };

/**
 * Ray vs an upright coarse body standing with feet at (x, footY, z).
 * @returns {{t:number, zone:'head'|'body', y:number}|null}
 */
export function rayVsBody(ox, oy, oz, dx, dy, dz, maxT, x, footY, z, spec) {
  const r = spec.radius;
  const t = rayCapsule(ox, oy, oz, dx, dy, dz, x, footY + r, z, x, footY + spec.height - r, z, r);
  if (t < 0 || t > maxT) return null;
  const y = oy + dy * t;
  return { t, zone: (y - footY) >= spec.neckY ? 'head' : 'body', y };
}

/**
 * Validate a client claim. Returns the accepted zone or null when rejected.
 * @param {object} claim  {zone, dist}
 */
export function validateClaim(ox, oy, oz, dx, dy, dz, maxT, x, footY, z, spec, claim) {
  const reach = Math.min(maxT + 0.35, (Number.isFinite(claim.dist) ? claim.dist : maxT) + spec.envR + 0.5);
  raySegmentClosest(ox, oy, oz, dx, dy, dz, reach, x, footY, z, x, footY + spec.height, z, _c);
  if (Number.isFinite(claim.dist) && claim.dist > maxT + 0.6) return { ok: false, reason: 'occluded' };
  if (_c.dist > spec.envR) return { ok: false, reason: 'geom' };
  if (_c.t > maxT + 0.35) return { ok: false, reason: 'occluded' };
  if (Number.isFinite(claim.dist) && Math.abs(claim.dist - _c.t) > spec.envR + 0.75) return { ok: false, reason: 'dist' };
  // Head claims must strike above the lowest plausible head height (impact point).
  const impactY = Number.isFinite(claim.dist) ? oy + dy * claim.dist : _c.py;
  const zone = (claim.zone === 'head' && (impactY - footY) >= spec.headMinY) ? 'head' : 'body';
  return { ok: true, zone, t: Number.isFinite(claim.dist) ? Math.min(claim.dist, maxT) : _c.t };
}
