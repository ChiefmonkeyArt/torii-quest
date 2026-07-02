// engine/physics/bodies.js — Rapier body/collider factories (SDK boundary).
// Extracted from physics.js (v0.2.110). Behaviour is identical: the same
// kinematic/dynamic/static/bot/crate factories, the same capsule geometry, and
// the same collider→bot lookup maps that the raycast layer reads.
//
// World + RAPIER are injected by physics.js via initBodies() once Rapier has
// loaded, so this module stays free of the async import and can be reasoned
// about as a pure factory surface.

let _world = null;
let _RAPIER = null;

export function initBodies(world, RAPIER) {
  _world = world;
  _RAPIER = RAPIER;
}

// Collider → bot map, populated by createBotBody/createBotHead. Used by the
// raycast layer to translate a Rapier hit into a game-side bot reference.
// Keyed by collider handle (integer), value is the bot object.
export const colliderToBot = new Map();
// Collider → body-part map ('body' or 'head'). Lets the bullet raycast apply
// headshot damage multipliers without inspecting collider geometry.
export const colliderToPart = new Map();
// Collider → dynamic-crate rigid body map (v0.2.113). Lets the bullet raycast
// translate a crate-collider hit into the Rapier body so weapons.js can apply a
// nudge impulse. Keyed by collider handle; value is the dynamic RigidBody.
export const colliderToCrate = new Map();

// Player capsule geometry — matches PLAYER_RADIUS (0.35). 1.8m total height.
export const PLAYER_CAPSULE_HALF_H = 0.55;
export const PLAYER_CAPSULE_RADIUS = 0.35;
// Body centre sits this far above the foot.
export const PLAYER_BODY_CENTRE_OFFSET = PLAYER_CAPSULE_HALF_H + PLAYER_CAPSULE_RADIUS; // 0.9

// Bot body — kinematic capsule that hugs the Banker GLB silhouette.
// v0.2.112: widened to cut body-shot misses and RAISED the cap so it meets the
// head sphere (the old 3cm dead-band between body top 1.44 and head bottom 1.47
// swallowed clear shots). halfHeight 0.5 + radius 0.26 → 1.52m total, 0.52m
// wide. Centre sits at footY + 0.76 (radius + halfHeight). Head sits in a
// SEPARATE sphere collider so headshots are detectable independently.
export const BOT_BODY_HALF_H = 0.5;
export const BOT_BODY_RADIUS = 0.26;
export const BOT_BODY_CENTRE_Y_OFFSET = BOT_BODY_HALF_H + BOT_BODY_RADIUS; // 0.76 → body spans [0,1.52]
// v0.2.112: head sphere enlarged 0.18 → 0.22 so clear headshots can't slip past
// the small ball.
// v0.2.128: head zone was sitting TOO HIGH. The Banker GLB tops out at y≈1.70
// (crown), but centre 1.65 + radius 0.22 spanned [1.43,1.87] — the sphere's top
// floated 0.17 m ABOVE the visible head, so players had to aim OVER the model to
// score a headshot while crosshairs on the actual face resolved the body cap.
// Lowered the centre to 1.55 (face/eye line, where players aim) and tightened
// the radius 0.22 → 0.20, so the sphere now spans [1.35,1.75]: its top hugs the
// model crown (only ~0.05 m over) and its bottom still OVERLAPS the body cap
// (1.52) so there is no gap a bullet can thread between head and torso.
export const BOT_HEAD_RADIUS = 0.20;
// Head centre sits this far above the foot — at the visible face/eye line,
// overlapping the body capsule cap below it.
export const BOT_HEAD_CENTRE_Y_OFFSET = 1.55;

// ── Player bodies ────────────────────────────────────────────────────────────
// Kinematic = position-based, driven by setNextKinematicTranslation each
// frame. The character controller computes the corrected delta; we apply it.
export function createKinematic(x, y, z) {
  if (!_world) return null;
  const body = _world.createRigidBody(
    _RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z)
  );
  const collider = _world.createCollider(
    _RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_H, PLAYER_CAPSULE_RADIUS),
    body
  );
  return { body, collider };
}

export function createDynamic(x, y, z) {
  if (!_world) return null;
  const body = _world.createRigidBody(
    _RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z).lockRotations()
  );
  const collider = _world.createCollider(
    _RAPIER.ColliderDesc.capsule(PLAYER_CAPSULE_HALF_H, PLAYER_CAPSULE_RADIUS),
    body
  );
  return { body, collider };
}

// ── Bot bodies ───────────────────────────────────────────────────────────────
export function createBotBody(bot, x, y, z) {
  if (!_world) return null;
  const body = _world.createRigidBody(
    _RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z)
  );
  const collider = _world.createCollider(
    _RAPIER.ColliderDesc.capsule(BOT_BODY_HALF_H, BOT_BODY_RADIUS),
    body
  );
  colliderToBot.set(collider.handle, bot);
  colliderToPart.set(collider.handle, 'body');
  return { body, collider };
}

// Bot head — separate kinematic sphere collider on its own rigid body.
export function createBotHead(bot, x, y, z) {
  if (!_world) return null;
  const body = _world.createRigidBody(
    _RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y, z)
  );
  const collider = _world.createCollider(
    _RAPIER.ColliderDesc.ball(BOT_HEAD_RADIUS),
    body
  );
  colliderToBot.set(collider.handle, bot);
  colliderToPart.set(collider.handle, 'head');
  return { body, collider };
}

export function getBotForColliderHandle(h) {
  return colliderToBot.get(h) || null;
}
export function getBodyPartForColliderHandle(h) {
  return colliderToPart.get(h) || null;
}

// Move a bot's kinematic body/head to a new position. Y is the collider
// CENTRE (caller passes footY + BOT_BODY_CENTRE_Y_OFFSET for body, footY +
// BOT_HEAD_CENTRE_Y_OFFSET for head).
export function setBotBodyPos(body, x, y, z) {
  if (body) body.setNextKinematicTranslation({ x, y, z });
}

// ── Static + dynamic world bodies ──────────────────────────────────────────────
export function createStatic(hw, hh, hd, x, y, z) {
  if (!_world) return;
  _world.createCollider(
    _RAPIER.ColliderDesc.cuboid(hw, hh, hd).setTranslation(x, y, z)
  );
}

// Static cuboid rotated about the world Y axis by `yaw` radians. Used for the
// coastline wall segments, whose local +X (half-extent hw) is aligned to an
// arbitrary segment direction. Rotation about Y maps local +X → (cos yaw, 0,
// -sin yaw), so callers pass yaw = atan2(-dz, dx) to point +X along (dx, dz).
export function createStaticYaw(hw, hh, hd, x, y, z, yaw) {
  if (!_world) return;
  const s = Math.sin(yaw / 2), c = Math.cos(yaw / 2);
  _world.createCollider(
    _RAPIER.ColliderDesc.cuboid(hw, hh, hd)
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: s, z: 0, w: c })
  );
}

// Heightfield collider for undulating terrain (Stage 1, v0.2.326).
// Rapier's heightfield: nrows/ncols are CELL counts (subdivisions). Rapier builds
// a (nrows+1)×(ncols+1) column-major height matrix internally, so `heights` MUST
// have length (nrows+1)*(ncols+1) — passing the wrong length panics the WASM with
// "unreachable" (v0.2.327). Heights lie in the local XZ plane with heights on +Y
// and are CENTRED at the collider's translation. `scale` is the FULL extent
// {x: totalWidth, y: verticalScale, z: totalDepth} — heightfield spans
// [-scale.x/2, scale.x/2] × [-scale.z/2, scale.z/2]; heights are multiplied by
// scale.y. We pass scale.y=1 so the heights array already holds world metres.
// (cx,cy,cz) is the world centre the heightfield is translated to.
export function createHeightfield(nrows, ncols, heights, scaleX, scaleY, scaleZ, cx, cy, cz) {
  if (!_world) return;
  const desc = _RAPIER.ColliderDesc.heightfield(
    nrows, ncols, heights,
    { x: scaleX, y: scaleY, z: scaleZ },
  );
  desc.setTranslation(cx, cy, cz);
  _world.createCollider(desc);
}

// Dynamic crate — physics-driven cuboid that bullets and players can shove.
export function createDynamicCrate(x, y, z, half) {
  if (!_world) return null;
  const body = _world.createRigidBody(
    _RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y, z)
  );
  const collider = _world.createCollider(
    _RAPIER.ColliderDesc.cuboid(half, half, half), body
  );
  colliderToCrate.set(collider.handle, body);
  return { body, collider };
}
