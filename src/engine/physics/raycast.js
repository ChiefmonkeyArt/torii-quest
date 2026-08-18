// engine/physics/raycast.js — Rapier raycast SDK boundary.
// Extracted from physics.js (v0.2.110). Behaviour is identical for player
// bullets, bot bullets, and line-of-sight: same closest-hit resolution, same
// bot/static filtering, same scratch-vector reuse (no hot-path allocations).
//
// World + RAPIER are injected by physics.js via initRaycast(). The collider→bot
// lookup maps live in bodies.js (the factories that populate them); we read
// them here to translate a Rapier hit into a game-side bot reference.
import { colliderToBot, colliderToPart, colliderToCrate, colliderToNpc, colliderToBone } from './bodies.js';

let _world = null;
let _RAPIER = null;

export function initRaycast(world, RAPIER) {
  _world = world;
  _RAPIER = RAPIER;
}

// Cast a ray and return the closest hit. `excludeCollider` is optional; pass
// the player's own collider for player bullets, or the firing bot's collider
// for bot bullets, so the projectile never self-hits. Returns:
//   null                                            — no hit within maxDist
//   { toi, point:{x,y,z}, collider, bot:Bot|null }  — closest hit
// `toi` is time-of-impact in the same units as the ray dir's length, i.e. if
// dir is a unit vector then toi is metres along the ray.
const _rayHitPoint = { x: 0, y: 0, z: 0 };
let _rayCache = null;
export function castRay(ox, oy, oz, dx, dy, dz, maxDist, excludeCollider = null, filterPredicate = null) {
  if (!_world || !_RAPIER) return null;
  // Reuse the Ray object — Rapier copies the values, safe to mutate.
  if (!_rayCache) _rayCache = new _RAPIER.Ray({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
  _rayCache.origin.x = ox; _rayCache.origin.y = oy; _rayCache.origin.z = oz;
  _rayCache.dir.x    = dx; _rayCache.dir.y    = dy; _rayCache.dir.z    = dz;

  // Signature: (ray, maxToi, solid, filterFlags?, filterGroups?,
  //             filterExcludeCollider?, filterExcludeRigidBody?, filterPredicate?)
  // Default filter: exclude bone colliders so combat raycasts (which pass no
  // filter) never hit per-bone sensors — only body capsule, head sphere, static
  // geometry. Sticker raycasts pass their own explicit filter to override.
  const effectiveFilter = filterPredicate || (c => !colliderToBone.has(c.handle));
  const hit = _world.castRayAndGetNormal(
    _rayCache, maxDist, true,
    undefined, undefined,
    excludeCollider || undefined,   // exclude the firing entity's own collider
    undefined, effectiveFilter || undefined,
  );
  if (!hit) return null;
  _rayHitPoint.x = ox + dx * hit.timeOfImpact;
  _rayHitPoint.y = oy + dy * hit.timeOfImpact;
  _rayHitPoint.z = oz + dz * hit.timeOfImpact;
  return {
    toi:      hit.timeOfImpact,
    point:    _rayHitPoint,
    normal:   hit.normal,
    collider: hit.collider,
    bot:      colliderToBot.get(hit.collider.handle) || null,
    bodyPart: colliderToPart.get(hit.collider.handle) || null,
    crate:    colliderToCrate.get(hit.collider.handle) || null,
    npc:      colliderToNpc.get(hit.collider.handle) || null,
    bone:     colliderToBone.get(hit.collider.handle) || null,
  };
}

// Cast a ray that IGNORES bots — only static geometry (walls, crates, floor,
// obstacles) and dynamic crates can block it. Used by bot bullets (so a bot
// bullet sparks on the wall behind the player, never on another bot) and by
// line-of-sight checks. `excludePlayerCollider` keeps the player's own capsule
// out of the result when needed.
export function castRayStatic(ox, oy, oz, dx, dy, dz, maxDist, excludePlayerCollider = null) {
  return castRay(ox, oy, oz, dx, dy, dz, maxDist, excludePlayerCollider,
    c => !colliderToBot.has(c.handle) && !colliderToNpc.has(c.handle) && !colliderToBone.has(c.handle));
}

// True if nothing static blocks the segment from (ox,oy,oz) to (tx,ty,tz).
// Bots are ignored (a bot never blocks its own line of fire to the player).
// Returns true when physics isn't ready so behaviour falls back to "can see".
export function hasLineOfSight(ox, oy, oz, tx, ty, tz, excludePlayerCollider = null) {
  if (!_world || !_RAPIER) return true;
  let dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
  if (len < 1e-5) return true;
  dx /= len; dy /= len; dz /= len;
  return !castRayStatic(ox, oy, oz, dx, dy, dz, len, excludePlayerCollider);
}
