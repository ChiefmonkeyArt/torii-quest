// config.js — ALL constants. Never scatter magic numbers.
export const VERSION   = 'v0.2.54-alpha';
export const GAME_NAME = 'Torii Quest';
export const ARENA_HALF     = 20;
export const WALL_H         = 3.52; // was 8 → 5.5 → 4.4 → 3.52 (another -20%)
// East-wall gate gap (centred on z=0). Half-width — kept wider than the
// torii's footprint so a player can walk under the gate cleanly.
// Used by arena.js (wall split) AND weapons.js (skip wall collision in gap).
export const EAST_GAP_HALF  = 3.5;
// NAP Zone — Non-Aggression Principle area beyond the torii gate.
// Bots will never cross east of NAP_X. The player's weapon is disabled while
// player.x > NAP_X. Walk through the gate = peace. NAP_X sits just inside the
// gate so crossing the threshold flips the rules immediately.
export const NAP_X          = ARENA_HALF; // 20 — east wall plane
export const NAP_FAR_X      = ARENA_HALF + 25; // outer edge of NAP zone floor
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
export const RELOAD_TIME    = 2.0;
export const SHOOT_CD       = 0.06;
export const BULLET_SPEED   = 60;
export const BULLET_LIFE    = 2.5;
export const ENTRY_SATS     = 100;
export const RESPAWN_TIME   = 4.0;
export const godMode        = false; // NEVER deploy true

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
export const OBSTACLES = [
  // cx              cz    hw    hd    fullH
  [ ARENA_HALF + 6,  0,    0.55, 0.55, 3.2 ], // bonsai trunk (NAP zone)
  [ ARENA_HALF,     -3.0,  0.4,  0.4,  WALL_H * 1.1 ], // torii pillar (north)
  [ ARENA_HALF,      3.0,  0.4,  0.4,  WALL_H * 1.1 ], // torii pillar (south)
];
