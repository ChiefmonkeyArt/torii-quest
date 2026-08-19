// config.js — ALL constants. Never scatter magic numbers.
import { npubToHex } from './engine/crypto/npub.js';

export const VERSION   = 'v0.2.606-alpha';
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
export const TRAVEL_GATE_X  = 0;   // true north of NAP tomoe
export const TRAVEL_GATE_Z  = 32;  // flush with northern edge
// v0.2.275: title-screen "ENTER NAP ZONE" button spawns the player straight into
// the NAP zone's far-left corner (deep + south, clear of the travel portal at
// (42,16) and the bonsai at (26,0)) so the grass field is immediately visible
// without walking through the torii gate. Yaw = π/2 faces due west (-X) back
// toward the gate — the whole grass field spreads out in front of the player.
export const NAP_SPAWN_X   = 0;    // center of NAP island (tomoe layout)
export const NAP_SPAWN_Z   = 25;   // upper NAP, facing south toward arena
export const NAP_SPAWN_YAW = Math.PI; // face south (-Z) toward the arena bridges

// Bonsai tree position in the NAP zone (v0.2.339). Moved FURTHER from the bridge
// (x=20, z=0) and CLOSER to the east beach (x=NAP_FAR_X=45): relocated off the
// z=0 bridge walkway axis and pushed east so it no longer crowds the bridge
// entrance. x=34 is ~11m from the east beach (was 19m), ~15.6m from the bridge
// (was 6m), and stays clear of the river (x≈20±3.5), the NAP NPC (30,5), the
// travel gate (42,16), and the spawn corner (40,-17).
export const NAP_TREE_X = 0.83;  // NAP centroid — center of the top comma shape
export const NAP_TREE_Z = 18.05;
// Yaw delta applied to BOTH the procedural fallback and the GLB gate so they
// stay in sync. Three.js +Y rotation is CCW from above, so clockwise is negative.
// The two base yaws differ (fallback π/2, GLB π) because each model was calibrated
// to face the approaching player; this delta is added on top of both, so a single
// tweak turns the whole gateway.
// v0.2.532: Set to -Math.PI/2 (90° CW) — rotates the gate 90° clockwise
// from the south-facing base yaw. Gate plane now runs north-south.
export const TRAVEL_GATE_YAW_DELTA = -Math.PI / 2;

// ── Bridges over the sea channels (v0.2.511 — tomoe layout) ───────────────
// Bridge 1: NAP ↔ Arena BL (with torii gate). Spans the west channel.
// v0.2.533: Moved 10m south + 10m west from (-24, 3).
export const BRIDGE_X      = -24;   // reset to original (NAP ↔ Arena BL channel)
export const BRIDGE_Z      = 3;     // reset to original
export const BRIDGE_DECK_Y = 1.1;   // walkable top surface (world Y)
export const BRIDGE_LEN    = 10;    // E-W span (x -39 → -29): 2m overlap each side
export const BRIDGE_WIDTH  = 4;    // N-S width
export const BRIDGE_THICK  = 0.4;   // deck slab thickness
export const BRIDGE_YAW    = Math.PI / 4;  // 45° rotation
// Bridge 2: Arena BL ↔ Arena BR (no gate). Spans the center channel at z=0.
export const BRIDGE2_X      = 0;    // v0.2.518: narrowest channel point
export const BRIDGE2_Z      = -5;   // v0.2.518: 5m south, 3m gap
export const BRIDGE2_LEN    = 8;    // 3m gap + 2.5m overlap each side
export const BRIDGE2_WIDTH  = 4;
export const BRIDGE2_THICK  = 0.4;
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
// v0.2.381 — Augustink BOSS bot: one per arena, server-authoritative, part of the
// bot roster. Big, slow, tanky, hits hard. Stats are per-bot at spawn (regular
// vs boss profile); the boss reuses the exact same AI as regular bots.
export const BOSS_COUNT         = 1;          // bosses per arena (subtracted from BOT_COUNT regulars)
export const BOSS_HP            = 60;         // vs BOT_HP=5 → ~12 hits to kill
export const BOSS_SPEED         = 1.0;        // vs BOT_SPEED=2.2 → ~half speed
export const BOSS_DAMAGE        = 14;         // vs BOT_DAMAGE=6 → hits hard
export const BOSS_SHOOT_CD      = 3.5;        // vs BOT_SHOOT_CD=2.6 → slower cadence
export const BOSS_RADIUS        = 0.8;        // vs BOT_R=0.4 → bigger body + hit capsule
export const BOSS_NAME          = 'Augustink';
export const BOSS_TARGET_HEIGHT = 3.0;        // rendered boss height in metres (~1.8x the player; render-only, combat stats above are unchanged). v0.2.389: 2.0→3.0, matching the 2× collider (radius/BOT_R) so the hitbox now envelopes the taller model.
export const MAX_AMMO       = 30;
export const RELOAD_TIME    = 1.1;  // was 2.0 — felt dead-slow; snappier reload (v0.2.113)
export const SHOOT_CD       = 0.06;
export const BULLET_SPEED   = 60;
export const BULLET_LIFE    = 2.5;
export const ENTRY_SATS     = 100;
export const RESPAWN_TIME   = 4.0;
export const godMode        = false; // NEVER deploy true
// Development safety switch. Local/server SCORE frames and caches stay active,
// but no score event may reach NIP-07 or a relay while this is false.
export const SCORE_PUBLISH_ENABLED = false;

// Phase 0f — gamestr.io score integration (kind 30762). OFF by default; the
// operator opts in. When true AND the player explicitly publishes a score (the
// existing "PUBLISH MY SCORE" consent path), a gamestr.io-format event is signed
// via NIP-07 and fanned out to GAMESTR_RELAYS. This is SEPARATE from the in-app
// NIP-78 leaderboard (kind 30000, gated by SCORE_PUBLISH_ENABLED above): gamestr
// is a distinct destination with its own toggle. A gamestr failure is best-effort
// and must never block the in-app leaderboard publish.
export const GAMESTR_ENABLED = false;

// MP-1 multiplayer flag. FALSE = single-player, identical to pre-MP-1 behaviour;
// TRUE = client dials wss://<origin>/mp on entry and syncs with other peers.
// Ships FALSE by default (see MP_1_SPEC.md §6). An admin can toggle it at
// runtime from Instance Settings; a per-zone flag can further narrow scope.
export const MP_ENABLED     = true; // MP-1.5: VPS-hosted arena, live on chiefmonkey.art/quest
// MP-1 WebSocket relative path on the operator's domain. Combined with
// window.location.host at runtime — no client-side URL config.
export const MP_WS_PATH     = '/mp';

// v0.2.606-alpha (UPD-2): admin identity for the server-side "Update Now" gate.
// QUEST_ADMIN_NPUB is read from the SERVER environment only (arena-ws), accepting
// either an `npub1…` or a raw hex64 pubkey. An npub is a PUBLIC key, so surfacing
// it (e.g. via the public capability endpoint) leaks nothing — but the value is
// still sourced from the server env, never hard-coded into the client bundle. In a
// browser `process` is undefined, so this reads as '' there and the admin gate is
// simply inert client-side (the real gate lives in arena-ws). ADMIN_PUBKEY_HEX is
// the normalised hex form (or '' when unset / unparseable), computed once here.
const _adminEnv = (typeof process !== 'undefined' && process && process.env
  && typeof process.env.QUEST_ADMIN_NPUB === 'string')
  ? process.env.QUEST_ADMIN_NPUB.trim() : '';
export const ADMIN_NPUB      = _adminEnv;
export const ADMIN_PUBKEY_HEX = npubToHex(_adminEnv) || '';

// Compact, JSON-serialisable tuning snapshot (v0.2.130) — surfaced via
// ToriiDebug.snapshot().config so a tester can paste the live balance values
// alongside their playtest feedback. Mirror of the constants above; keep in sync.
export const TUNING = Object.freeze({
  PLAYER_HP, PLAYER_SPEED, MAX_AMMO, RELOAD_TIME, SHOOT_CD,
  BULLET_SPEED, BULLET_LIFE,
  BOT_COUNT, BOT_HP, BOT_DAMAGE, BOT_SPEED, BOT_SHOOT_CD, BOT_SIGHT, BOT_SPREAD,
  BOSS_COUNT, BOSS_HP, BOSS_DAMAGE, BOSS_SPEED, BOSS_SHOOT_CD, BOSS_RADIUS,
  ARENA_HALF, godMode, MP_ENABLED, MP_WS_PATH,
});

// CRATES — single source of truth for geometry AND collision.
// Format: [cx, cz, halfW, halfD, fullH]
// arena.js builds BoxGeometry(halfW*2, fullH, halfD*2) centred at (cx, fullH/2, cz)
// player.js + bots.js use these same values for AABB pushout.
export const CRATES = [
  // v0.2.516: All crates moved well inside the play zone (inset from coast)
  // cx    cz    hw    hd    fullH
  [-12,   -6,  0.75, 0.75,  1.5 ],   // Arena BL interior
  [ 12,   -8,  0.75, 0.75,  1.5 ],   // Arena BR interior
  [-14,  -10,  0.75, 0.75,  1.5 ],   // Arena BL mid-west
  [ 14,  -10,  0.75, 0.75,  1.5 ],   // Arena BR mid-east
  [ -8,  -12,  1.0,  1.0,   1.0 ],   // Arena BL south
  [  8,  -12,  1.0,  1.0,   1.0 ],   // Arena BR south
  [-10,    0,  0.75, 0.75,  2.0 ],   // Arena BL center
  [ 10,    0,  0.75, 0.75,  2.0 ],   // Arena BR center
  [ -6,   -3,  1.5,  0.5,   1.0 ],   // Arena BL center (moved from -3,-6 to avoid bridge 2 overlap)
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
  [ BRIDGE_X,       BRIDGE_Z - 3.0,    0.4,  0.4,               WALL_H * 1.3 ], // torii pillar (north) — on bridge 1
  [ BRIDGE_X,       BRIDGE_Z + 3.0,    0.4,  0.4,               WALL_H * 1.3 ], // torii pillar (south) — on bridge 1
];
