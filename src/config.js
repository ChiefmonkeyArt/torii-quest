// config.js — ALL constants. Never scatter magic numbers.
export const VERSION   = 'v0.2.42-alpha';
export const GAME_NAME = 'Torii Quest';
export const ARENA_HALF     = 20;
export const WALL_H         = 4.4; // was 8 → 5.5 → 4.4 (another -20%)
// East-wall gate gap (centred on z=0). Half-width — kept wider than the
// torii's footprint so a player can walk under the gate cleanly.
// Used by arena.js (wall split) AND weapons.js (skip wall collision in gap).
export const EAST_GAP_HALF  = 3.5;
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
