// physics.js — Rapier world + kinematic character controller.
// v0.2.61-alpha (Rapier Phase 1): player movement is now driven by Rapier's
// KinematicCharacterController. Static colliders for the arena + NAP heightfields,
// CRATES and OBSTACLES are built from config so the physics world matches the
// visual + gameplay arena 1:1. (Perimeter walls were removed in v0.2.333 — the
// island is open to the sea, bounded by the shore slope + a void-fall respawn.)
//
// v0.2.110: body/collider factories were extracted to engine/physics/bodies.js
// and the raycast layer to engine/physics/raycast.js. This module owns the
// world + character controller and wires those modules at init. All previously
// exported symbols are RE-EXPORTED here unchanged, so every existing
// `from './physics.js'` import keeps working with identical behaviour.
//
// Capsule convention: Rapier capsule(halfHeight, radius). Total height =
// 2*(halfHeight + radius). Player body is positioned at the *capsule centre*
// (foot + halfHeight + radius), NOT the eye. player.js maps body↔eye.
import {
  CRATES, OBSTACLES, EAST_GAP_HALF,
  BRIDGE_X, BRIDGE_Z, BRIDGE_DECK_Y, BRIDGE_LEN, BRIDGE_WIDTH, BRIDGE_THICK,
} from './config.js';
import { initBodies, createStatic, createStaticYaw, createHeightfield } from './engine/physics/bodies.js';
import { initRaycast } from './engine/physics/raycast.js';
// Pure (node-safe) terrain heightmap — static import is fine: no THREE/RAPIER.
import {
  NAP_GRID, NAP_TERRAIN, buildNapHeightfieldArray, napTerrainPeak,
  ARENA_GRID, ARENA_TERRAIN, buildArenaHeightfieldArray, arenaTerrainPeak,
  sampleArenaHeight, ISLAND_BASE_Y,
} from './terrain/heightmap.js';
import { fenceRing } from './terrain/coastline.js';

// Re-export the SDK boundary surface so existing import sites are unchanged.
export {
  createKinematic, createDynamic, createBotBody, createBotHead, setBotBodyPos,
  createStatic, createDynamicCrate, getBotForColliderHandle, getBodyPartForColliderHandle,
  PLAYER_CAPSULE_HALF_H, PLAYER_CAPSULE_RADIUS, PLAYER_BODY_CENTRE_OFFSET,
  BOT_BODY_HALF_H, BOT_BODY_RADIUS, BOT_BODY_CENTRE_Y_OFFSET,
  BOT_HEAD_RADIUS, BOT_HEAD_CENTRE_Y_OFFSET,
} from './engine/physics/bodies.js';
export { castRay, castRayStatic, hasLineOfSight } from './engine/physics/raycast.js';

let world, RAPIER;
let _controller = null;
export let physicsReady = false;

export function getWorld() { return world || null; }

export async function initPhysics() {
  RAPIER = await import('@dimforge/rapier3d-compat');
  await RAPIER.init();
  world = new RAPIER.World({ x:0, y:-25, z:0 });

  // Wire the extracted SDK modules with the live world + RAPIER handles.
  initBodies(world, RAPIER);
  initRaycast(world, RAPIER);

  // Character controller — 0.05 offset is the recommended "skin" gap.
  _controller = world.createCharacterController(0.05);
  _controller.setUp({ x: 0, y: 1, z: 0 });
  _controller.setSlideEnabled(true);
  _controller.setApplyImpulsesToDynamicBodies(true);
  // Snap-to-ground keeps the player glued to slopes/steps when walking down.
  _controller.enableSnapToGround(0.2);
  // Allow stepping over small bumps (future-proofing for crate edges, stairs).
  _controller.enableAutostep(0.3, 0.2, true);
  // Climb up to 45° slopes; slide off anything steeper.
  _controller.setMaxSlopeClimbAngle(Math.PI / 4);

  physicsReady = true;
  return world;
}

export function stepPhysics() { if (world) world.step(); }

// ── Character controller movement ───────────────────────────────────────────
// player.js calls this each frame with the desired XYZ delta. Rapier slides
// the capsule against obstacles and returns the actual delta + grounded flag.
const _zero = { x: 0, y: 0, z: 0 };
export function movePlayer(playerCollider, desiredDX, desiredDY, desiredDZ) {
  if (!_controller || !playerCollider) {
    return { dx: desiredDX, dy: desiredDY, dz: desiredDZ, grounded: false };
  }
  _zero.x = desiredDX; _zero.y = desiredDY; _zero.z = desiredDZ;
  _controller.computeColliderMovement(playerCollider, _zero);
  const m = _controller.computedMovement();
  return { dx: m.x, dy: m.y, dz: m.z, grounded: _controller.computedGrounded() };
}

// ── Arena collider build ────────────────────────────────────────────────────
// Drives off the SAME config the renderer + manual physics used, so Rapier
// sees the exact arena the player sees. Includes the NAP-zone floor and the
// split east-wall segments (gate gap is a real hole in the collider, not just
// in the manual code path).
export function buildArenaColliders() {
  // Floors — BOTH zones are now undulating Rapier HEIGHTFIELDS (Stage 3, v0.2.329).
  // The old flat arena cuboid floor (createStatic at y=-0.1) is GONE; the arena is
  // an island like the NAP zone. Heights are column-major (col*rowsZ + row) over
  // each zone's EXTENDED extent (footprint + outward shore), scale.y=1 → the values
  // are absolute world-Y metres (they already include ISLAND_BASE_Y and the shore
  // slope), so the collider translation Y is 0.
  //
  // Rapier's nrows/ncols are CELL counts (subdivisions), not vertex counts: it
  // builds a (nrows+1)×(ncols+1) height matrix internally, so heights.length must
  // equal (nrows+1)*(ncols+1). We have rowsZ×colsX VERTICES, so pass one fewer of
  // each (rowsZ-1 rows along Z, colsX-1 cols along X). Passing the vertex counts
  // panics the WASM ("unreachable") on a matrix size mismatch. (v0.2.327 guard.)
  const arenaHeights = buildArenaHeightfieldArray();
  createHeightfield(
    ARENA_GRID.rowsZ - 1, ARENA_GRID.colsX - 1, arenaHeights,
    ARENA_TERRAIN.gWidth, 1, ARENA_TERRAIN.gDepth,
    ARENA_TERRAIN.gCenterX, 0, ARENA_TERRAIN.gCenterZ,
  );
  const napHeights = buildNapHeightfieldArray();
  createHeightfield(
    NAP_GRID.rowsZ - 1, NAP_GRID.colsX - 1, napHeights,
    NAP_TERRAIN.gWidth, 1, NAP_TERRAIN.gDepth,
    NAP_TERRAIN.gCenterX, 0, NAP_TERRAIN.gCenterZ,
  );
  const _ap = arenaTerrainPeak(), _np = napTerrainPeak();
  console.info(`[island-terrain] arena ${ARENA_GRID.colsX}x${ARENA_GRID.rowsZ} ` +
    `peak=${_ap.height.toFixed(3)} · nap ${NAP_GRID.colsX}x${NAP_GRID.rowsZ} ` +
    `peak=${_np.height.toFixed(3)} · baseY=${ISLAND_BASE_Y}`);

  // Crates and obstacles sit ON the raised plateau, so their base rises by
  // ISLAND_BASE_Y (their footprints are on full-height plateau ground, not shore).
  const B = ISLAND_BASE_Y;
  // Arena perimeter walls were REMOVED in v0.2.333 — no north/south/west/east wall
  // colliders. The island is open to the sea on all sides; the terrain shore slope
  // (heightfield) is the boundary, and the player.js void-fall net respawns anyone
  // who walks off the edge into the sea. The east-wall segment colliders are also
  // gone from OBSTACLES (config.js), leaving the bridge entrance at z=0 clear.

  // CRATES — visual + collidable cover. Each crate rests ON the undulating arena
  // surface: its collider base is the terrain height sampled at the crate centre
  // (v0.2.330), matching the visual mesh in arena.js so the collision box lines
  // up with what the player sees on the hills.
  for (const [cx, cz, hw, hd, ch] of CRATES) {
    createStatic(hw, ch / 2, hd, cx, ch / 2 + sampleArenaHeight(cx, cz), cz);
  }
  // OBSTACLES — collision-only (tree trunk, torii pillars, east wall segments).
  for (const [cx, cz, hw, hd, ch] of OBSTACLES) {
    createStatic(hw, ch / 2, hd, cx, ch / 2 + B, cz);
  }

  // COASTLINE wall — knee-high (0.5m) PLAYER colliders following the organic
  // coast ring (v0.2.342). Height sits above the 0.3m autostep but far below the
  // ~2m jump apex, so the player can jump the boundary but not walk over it. One
  // thin yaw-rotated cuboid per ring segment (~32, well under the ≤40 budget),
  // skipping the east torii-gate gap so the bridge → NAP walkway stays clear.
  // These do NOT contain bots — bots are held in by the polygon clamp in bots.js
  // (kinematic bots ignore static colliders). See coastline.js.
  const ring = fenceRing();
  const rn = ring.length;
  const WALL_HH = 0.25;   // half-height → 0.5m tall
  const WALL_HD = 0.1;    // half-thickness (radial)
  for (let i = 0; i < rn; i++) {
    const [ax, az] = ring[i];
    const [bx, bz] = ring[(i + 1) % rn];
    const mx = (ax + bx) * 0.5, mz = (az + bz) * 0.5;
    if (mx > 6 && Math.abs(mz) < EAST_GAP_HALF) continue; // gate gap (matches arena.js)
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz) || 1e-6;
    const yaw = Math.atan2(-dz, dx);
    const cy = sampleArenaHeight(mx, mz) + WALL_HH;
    createStaticYaw(len / 2, WALL_HH, WALL_HD, mx, cy, mz, yaw);
  }

  // BRIDGE deck (Stage 4, v0.2.331) — a static cuboid spanning the sea channel at
  // x=20, z=0, matching the visual deck in bridge.js. Its top face is at
  // BRIDGE_DECK_Y (centre a half-thickness below). It overlaps both islands'
  // heightfields at its ends, so the character controller can step arena → bridge
  // → NAP over the channel water.
  createStatic(
    BRIDGE_LEN / 2, BRIDGE_THICK / 2, BRIDGE_WIDTH / 2,
    BRIDGE_X, BRIDGE_DECK_Y - BRIDGE_THICK / 2, BRIDGE_Z,
  );
}
