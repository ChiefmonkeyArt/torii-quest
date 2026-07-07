// config.js — ALL constants. Never scatter magic numbers.
export const VERSION   = 'v0.2.352-alpha';
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
// v0.2.275: title-screen "ENTER NAP ZONE" button spawns the player straight into
// the NAP zone's far-left corner (deep + south, clear of the travel portal at
// (42,16) and the bonsai at (26,0)) so the grass field is immediately visible
// without walking through the torii gate. Yaw = π/2 faces due west (-X) back
// toward the gate — the whole grass field spreads out in front of the player.
export const NAP_SPAWN_X   = NAP_FAR_X - 5;   // 40 — deep in NAP, 2u clear of the travel gate
export const NAP_SPAWN_Z   = -(ARENA_HALF - 3); // -17 — south (player's left) corner
export const NAP_SPAWN_YAW = Math.PI / 2;     // face west (-X) across the grass toward the gate

// Bonsai tree position in the NAP zone (v0.2.339). Moved FURTHER from the bridge
// (x=20, z=0) and CLOSER to the east beach (x=NAP_FAR_X=45): relocated off the
// z=0 bridge walkway axis and pushed east so it no longer crowds the bridge
// entrance. x=34 is ~11m from the east beach (was 19m), ~15.6m from the bridge
// (was 6m), and stays clear of the river (x≈20±3.5), the NAP NPC (30,5), the
// travel gate (42,16), and the spawn corner (40,-17).
export const NAP_TREE_X = NAP_X + 14;   // 34 — further from bridge, closer to east beach
export const NAP_TREE_Z = 7;            // off the z=0 bridge axis
// Clockwise (top-down) yaw delta applied to BOTH the procedural fallback and the
// GLB gate so they stay in sync. Three.js +Y rotation is CCW from above, so
// clockwise is negative. The two base yaws differ (fallback π/2, GLB π) because
// each model was calibrated to face the approaching player; this delta is added
// on top of both, so a single tweak turns the whole gateway.
export const TRAVEL_GATE_YAW_DELTA = -Math.PI / 4; // 45° clockwise (top-down)

// ── Bridge over the sea channel (Stage 4, v0.2.331) ──────────────────────────
// A static deck crossing the x=20 channel E-W at z=0, connecting the arena and
// NAP islands. It overlaps the land ~3m on each side (x∈[BRIDGE_X±BRIDGE_LEN/2])
// so it meets both islands' terrain, and its walkable top sits at BRIDGE_DECK_Y
// (a hair above ISLAND_BASE_Y so the character controller steps up onto it). The
// decorative torii-gate is placed ON this deck. Shared by bridge.js (mesh) and
// physics.js (cuboid deck collider).
export const BRIDGE_X      = ARENA_HALF; // 20 — channel centreline
export const BRIDGE_Z      = 0;          // aligned with the east-wall gate gap
export const BRIDGE_DECK_Y = 0.7;        // walkable top surface (world Y)
export const BRIDGE_LEN    = 12;         // E-W span (x 14 → 26): 3m onto each island
export const BRIDGE_WIDTH  = 4;          // N-S width (z −2 → +2)
export const BRIDGE_THICK  = 0.4;        // deck slab thickness
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
  [-10,  -10,  0.75, 0.75,  2.0 ], // was [14,0] — relocated off the arena bridge foot (v0.2.333)
  [ -5,   13,  1.5,  0.5,   1.0 ],
  [  5,  -13,  1.5,  0.5,   1.0 ],
];

// OBSTACLES — collision-only colliders (no visual mesh built from this list).
// Same shape as CRATES: [cx, cz, halfW, halfD, fullH]. Player + bots run AABB
// pushout against this list in addition to CRATES; weapons sweep both lists
// for bullet impacts. Add anything solid that doesn't belong in CRATES.
//   - Bonsai tree trunk at (NAP_TREE_X, NAP_TREE_Z) — the NAP-zone tree must be solid.
//   - Torii pillars at the east gate — z=±3.0 just inside EAST_GAP_HALF (3.5)
//     so the central walkway stays clear. Half-width 0.4 covers the GLB pillar.
// v0.2.333: the east-wall collider segments were REMOVED along with the rest of
// the arena perimeter walls — the island is now open to the sea on all sides.
// The torii pillars remain (they belong to the decorative gate on the bridge
// deck, not the wall), and the bonsai trunk stays solid.
export const OBSTACLES = [
  // cx              cz                 hw    hd                 fullH
  [ NAP_TREE_X,     NAP_TREE_Z,        0.55, 0.55,              4.4 ], // bonsai trunk (NAP zone)
  [ ARENA_HALF,     -3.0,               0.4,  0.4,               WALL_H * 1.3 ], // torii pillar (north) — matches gate ×1.3 scale
  [ ARENA_HALF,      3.0,               0.4,  0.4,               WALL_H * 1.3 ], // torii pillar (south) — matches gate ×1.3 scale
];
