// config.js — ALL constants. Never scatter magic numbers.
export const VERSION   = 'v0.2.262-alpha';
export const GAME_NAME = 'Torii Quest';
export const ARENA_HALF     = 20;
export const WALL_H         = 2.6;  // was 8 → 5.5 → 4.4 → 3.52 → 2.6 (reduced again, user request v0.2.57)
// East-wall gate gap (centred on z=0). Half-width — kept wider than the
// torii's footprint so a player can walk under the gate cleanly.
// Used by arena.js (wall split) AND weapons.js (skip wall collision in gap).
export const EAST_GAP_HALF  = 3.4;  // matches torii pillar outer face — wall touches pillar, no sliver gap
// NAP Zone — Non-Aggression Principle area beyond the torii gate.
// Bots will never cross east of NAP_X. The player's weapon is disabled while
// player.x > NAP_X. Walk through the gate = peace. NAP_X sits just inside the
// gate so crossing the threshold flips the rules immediately.
export const NAP_X          = ARENA_HALF; // 20 — east wall plane
export const NAP_FAR_X      = ARENA_HALF + 25; // outer edge of NAP zone floor
// Travel gateway — the metaverse PORTAL (torii-gateway-experience.glb), distinct
// from the entrance torii-gate.glb at NAP_X. Sits on the FAR side of the NAP zone
// so the player walks the full peace-zone to reach it. x=42 leaves the portal's
// outer ring (radius = trigger range 3 → x∈[39,45]) at the far floor edge.
export const TRAVEL_GATE_X  = ARENA_HALF + 22; // 42 — far-side travel portal plane (pushed into the corner)
// v0.2.246 — gateway pushed deeper into the far-right NAP corner and turned 45°
// clockwise (top-down). x=42 + z=16 places it in the corner with the outer
// detection ring (radius 3 → x∈[39,45], z∈[13,19]) clear of the z=0 proof panel
// and inside the floor edges (x≤45, z≤20). Entrance torii-gate at NAP_X untouched.
export const TRAVEL_GATE_Z  = 16; // far-right NAP corner (player's right, +z)
// Clockwise (top-down) yaw delta applied to BOTH the procedural fallback and the
// GLB gate so they stay in sync. Three.js +Y rotation is CCW from above, so
// clockwise is negative. The two base yaws differ (fallback π/2, GLB π) because
// each model was calibrated to face the approaching player; this delta is added
// on top of both, so a single tweak turns the whole gateway.
export const TRAVEL_GATE_YAW_DELTA = -Math.PI / 4; // 45° clockwise (top-down)
export const PLAYER_HP      = 100;
export const PLAYER_SPEED   = 8;
export const PLAYER_RADIUS  = 0.35;
export const JUMP_FORCE     = 10;
export const GRAVITY        = -25;
export const BOT_COUNT      = 5;
export const BOT_SPEED      = 2.2;
export const BOT_HP         = 5;
export const BOT_SHOOT_CD   = 2.6; // was 1.8 — bots were crack shots, give the player breathing room
export const BOT_SIGHT      = 14;
export const BOT_DAMAGE     = 6;   // was 12 — player now dies in ~16 hits, not 9
export const BOT_SPREAD     = 0.22; // was 0.08 — per-axis rad jitter, ~±6.3° cone
export const MAX_AMMO       = 30;
export const RELOAD_TIME    = 1.1;  // was 2.0 — felt dead-slow; snappier reload (v0.2.113)
export const SHOOT_CD       = 0.06;
export const BULLET_SPEED   = 60;
export const BULLET_LIFE    = 2.5;
export const ENTRY_SATS     = 100;
export const RESPAWN_TIME   = 4.0;
export const godMode        = false; // NEVER deploy true

// Compact, JSON-serialisable tuning snapshot (v0.2.130) — surfaced via
// ToriiDebug.snapshot().config so a tester can paste the live balance values
// alongside their playtest feedback. Mirror of the constants above; keep in sync.
export const TUNING = Object.freeze({
  PLAYER_HP, PLAYER_SPEED, MAX_AMMO, RELOAD_TIME, SHOOT_CD,
  BULLET_SPEED, BULLET_LIFE,
  BOT_COUNT, BOT_HP, BOT_DAMAGE, BOT_SPEED, BOT_SHOOT_CD, BOT_SIGHT, BOT_SPREAD,
  ARENA_HALF, godMode,
});

// CRATES — single source of truth for geometry AND collision.
// Format: [cx, cz, halfW, halfD, fullH]
// arena.js builds BoxGeometry(halfW*2, fullH, halfD*2) centred at (cx, fullH/2, cz)
// player.js + bots.js use these same values for AABB pushout.
export const CRATES = [
  // cx    cz    hw    hd    fullH
  [ -8,   -8,  0.75, 0.75,  1.5 ],
  [  8,   -8,  0.75, 0.75,  1.5 ],
  [ -8,    8,  0.75, 0.75,  1.5 ],
  [  8,    8,  0.75, 0.75,  1.5 ],
  [  0,    0,  1.0,  1.0,   1.0 ],
  [-14,    0,  0.75, 0.75,  2.0 ],
  [ 14,    0,  0.75, 0.75,  2.0 ],
  [ -5,   13,  1.5,  0.5,   1.0 ],
  [  5,  -13,  1.5,  0.5,   1.0 ],
];

// OBSTACLES — collision-only colliders (no visual mesh built from this list).
// Same shape as CRATES: [cx, cz, halfW, halfD, fullH]. Player + bots run AABB
// pushout against this list in addition to CRATES; weapons sweep both lists
// for bullet impacts. Add anything solid that doesn't belong in CRATES.
//   - Bonsai tree trunk at (NAP_X+6, 0) — the NAP-zone tree must be solid.
//   - Torii pillars at the east gate — z=±3.0 just inside EAST_GAP_HALF (3.5)
//     so the central walkway stays clear. Half-width 0.4 covers the GLB pillar.
// East-wall segments as colliders. arena.js builds these as visual meshes only;
// adding them here makes them solid from BOTH sides — the previous code only
// blocked east-bound players via a gap-aware clamp, which leaked when a player
// in the NAP zone tried to walk back through the wall above/below the gap.
// East-wall collider segments OVERLAP the torii pillars by 0.5m so there's no
// micro-gap a capsule (radius 0.35 + Rapier offset 0.05 = 0.4) can squeeze
// through. Pillars span z = ±[2.6, 3.4]; we start the wall at z = ±2.9 inward
// of the pillar centre. Visual wall is unchanged — only the collider extends.
// midZ = (2.9 + 20)/2 = 11.45,  halfD = (20 - 2.9)/2 = 8.55
const _EAST_SEG_INNER = 2.9; // 0.5m inside EAST_GAP_HALF (3.4) for pillar overlap
const _EAST_SEG_MIDZ  = (_EAST_SEG_INNER + ARENA_HALF) / 2;
const _EAST_SEG_HALFD = (ARENA_HALF - _EAST_SEG_INNER) / 2;

export const OBSTACLES = [
  // cx              cz                 hw    hd                 fullH
  [ ARENA_HALF + 6,  0,                 0.55, 0.55,              4.4 ], // bonsai trunk (NAP zone)
  [ ARENA_HALF,     -3.0,               0.4,  0.4,               WALL_H * 1.3 ], // torii pillar (north) — matches gate ×1.3 scale
  [ ARENA_HALF,      3.0,               0.4,  0.4,               WALL_H * 1.3 ], // torii pillar (south) — matches gate ×1.3 scale
  [ ARENA_HALF,     -_EAST_SEG_MIDZ,    0.25, _EAST_SEG_HALFD,   WALL_H ],       // east-north wall segment
  [ ARENA_HALF,      _EAST_SEG_MIDZ,    0.25, _EAST_SEG_HALFD,   WALL_H ],       // east-south wall segment
];
