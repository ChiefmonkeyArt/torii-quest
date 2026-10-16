// src/gamezone/core/constants.js — Game Zone v2 tuning (ADR-0130).
//
// One table, imported by the authoritative simulation (server AND the in-browser
// single-player authority) and by the client presentation layer, so nothing can
// drift between the two. Node-pure: no THREE, no DOM, no Rapier.
//
// The POINT SYSTEM is deliberately unchanged from the legacy arena (user decision,
// 2026-10-16): head 9 / body 3 damage, regular bot 5 HP, boss 60 HP, player 100 HP,
// +5 sats per bot kill. Only the machinery that decides WHEN those apply is new.

import {
  BOT_COUNT, BOT_HP, BOT_SPEED, BOT_SHOOT_CD, BOT_SIGHT, BOT_DAMAGE, BOT_SPREAD,
  BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_NAME,
  PLAYER_HP, RESPAWN_TIME,
} from '../../config.js';

export const GZ_PROTOCOL = 1;

// ── Fixed simulation clock ────────────────────────────────────────────────────
// Everything that matters is expressed in TICKS, never wall-clock milliseconds,
// so the client can name the exact instant it was looking at ("render tick
// 1234.6") and the authority can rebuild that instant byte-for-byte from the same
// history. That removes the clock-sync guesswork behind the legacy viewLag rewind.
export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ;
export const TICK_DT = 1 / TICK_HZ;

export const HISTORY_TICKS = 48;      // 2.4 s of pose history kept per entity
export const MAX_REWIND_TICKS = 10;   // 500 ms — the most the authority will rewind a shot
export const INTERP_DELAY_TICKS = 2;  // clients render 100 ms behind the newest snapshot

// ── Points (unchanged) ────────────────────────────────────────────────────────
export const HEAD_DAMAGE = 9;
export const BODY_DAMAGE = 3;
export const KILL_SATS = 5;
export { BOT_HP, BOSS_HP, PLAYER_HP, BOSS_NAME };

// ── Roster ────────────────────────────────────────────────────────────────────
export const ROSTER = Object.freeze({ total: BOT_COUNT, bosses: BOSS_COUNT });

// ── Bot behaviour ─────────────────────────────────────────────────────────────
export const BOT_KINDS = Object.freeze({
  regular: Object.freeze({
    hp: BOT_HP, speed: BOT_SPEED, runSpeed: BOT_SPEED * 1.45, shootCd: BOT_SHOOT_CD,
    damage: BOT_DAMAGE, spread: BOT_SPREAD, sight: BOT_SIGHT,
    // Coarse envelope used by the authority. Measured against banker-rigged.glb
    // (root motion stripped): standing height 1.80 m incl. hat, neck at ~1.42 m,
    // arms/gun reach up to ~1.05 m from the root in the clips we play.
    radius: 0.35, height: 1.80, neckY: 1.42, envR: 1.25, headMinY: 0.85, muzzleY: 1.35,
  }),
  boss: Object.freeze({
    hp: BOSS_HP, speed: BOSS_SPEED, runSpeed: BOSS_SPEED * 1.4, shootCd: BOSS_SHOOT_CD,
    damage: BOSS_DAMAGE, spread: BOT_SPREAD * 0.8, sight: BOT_SIGHT * 1.3,
    // augustink4.glb rendered at 3.0 m (BOSS_TARGET_HEIGHT).
    radius: 0.8, height: 3.15, neckY: 2.45, envR: 2.4, headMinY: 1.9, muzzleY: 2.3,
  }),
});

export const ENGAGE_MIN = 5;      // m — back off when closer than this
export const ENGAGE_MAX = 10;     // m — close in when farther than this
export const TURN_RATE = 7;       // rad/s
export const AIM_CONE = 0.35;     // rad — must be roughly facing the target to fire
export const SHOT_RANGE = 60;     // m — bot hitscan reach
export const FIRE_RANGE = 120;    // m — player hitscan reach
export const SHOOT_ANIM_MS = 450; // how long a bot reads as "shooting" after a shot

// ── Lifecycle ─────────────────────────────────────────────────────────────────
export const BOT_DYING_MS = 1400;    // death clip window; not hittable, no nameplate
export const BOT_RESPAWN_MS = 6000;  // dead (invisible) before respawning
export const PLAYER_RESPAWN_MS = Math.round(RESPAWN_TIME * 1000);
export const SPAWN_PROTECT_MS = 1500;

// ── Player body (peers + local player as a target) ────────────────────────────
export const PLAYER_EYE = 1.7;      // MOVE pos.y is the eye
export const PLAYER_BODY = Object.freeze({
  radius: 0.32, height: 1.80, neckY: 1.45, envR: 0.9, headMinY: 1.2,
});

// ── Anti-abuse (authority) ────────────────────────────────────────────────────
export const MAX_SHOTS_PER_TICK = 3;   // SHOOT_CD 0.06 s ≈ 0.83 shots / tick at 20 Hz
export const MAX_ORIGIN_DRIFT = 2.5;   // m — shot origin must be near the shooter's eye

export const ANIMS = Object.freeze(['idle', 'walk', 'run', 'shoot', 'strafeL', 'strafeR', 'die']);
export const BOT_STATES = Object.freeze(['alive', 'dying', 'dead']);
