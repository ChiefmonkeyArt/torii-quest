// engine/entities/bot-agent.js — pure BotAgent SDK boundary (v0.2.122).
//
// First safe slice of the BotAgent extraction. This module holds ONLY the pure,
// dependency-light decision math behind the per-frame bot AI in src/bots.js:
// scalar steering/engagement helpers plus a `decideActions(worldState)` facade
// in the target `BotAgent.tick(worldState) -> BotAction[]` shape.
//
// Imports only the numeric tuning constants from config.js — no Three, no
// Rapier, no DOM — so it is unit-testable in plain node.
//
// Wiring status: the allocation-free SCALAR helpers (engageSpeed,
// steerComponent, inEngageRange) are consumed by src/bots.js's hot path.
// `decideActions()` is the SDK-direction facade — it allocates an array per
// call, so it is intentionally NOT wired into the per-frame loop yet (that
// would break the no-hot-path-allocation rule). It is provided + tested as the
// boundary that later non-hot-path bot logic should converge on.
import { BOT_SPEED, BOT_SIGHT } from '../../config.js';

// Tuning that mirrors the prior inline values in tickBots() exactly.
export const NEAR_DIST        = 8;    // dist (m) below which bots slow down
export const NEAR_SPEED_SCALE = 0.75; // speed multiplier inside NEAR_DIST
export const SEEK_WEIGHT      = 0.7;  // weight of the toward-player vector
export const SEP_WEIGHT       = 0.3;  // weight of the bot-bot separation vector

// Action kinds a BotAgent can emit. move/shoot map to current behaviour; the
// rest are reserved for future bot logic (NAP interactions, dialogue, idle AI).
export const BOT_ACTION = Object.freeze({
  MOVE:     'move',
  SHOOT:    'shoot',
  IDLE:     'idle',
  INTERACT: 'interact',
  SPEAK:    'speak',
});

// Speed for the current distance: full speed when chasing from afar, slower
// once close so bots don't jitter on top of the player. Pure scalar.
// `baseSpeed` defaults to the global BOT_SPEED so existing callers are
// byte-identical; the per-bot sim threads each bot's own speed (boss = slow).
export function engageSpeed(dist, baseSpeed = BOT_SPEED) {
  return baseSpeed * (dist > NEAR_DIST ? 1.0 : NEAR_SPEED_SCALE);
}

// Blend one axis of (normalised toward-player) and (bot-bot separation) into a
// single steer component. Caller multiplies by engageSpeed(). Pure scalar.
export function steerComponent(toPlayer, sep) {
  return toPlayer * SEEK_WEIGHT + sep * SEP_WEIGHT;
}

// Cheap, side-effect-free pre-gate for shooting: in sight range and the player
// is not sheltering in the NAP zone. This deliberately EXCLUDES the line-of-
// sight raycast so callers keep the short-circuit `inEngageRange(...) && hasLOS`
// — LOS is expensive and must only run when this cheap test already passed.
export function inEngageRange(dist, playerInNap) {
  return dist < BOT_SIGHT && !playerInNap;
}

// Full shoot decision (range + NAP + line of sight). `hasLOS` is the already-
// computed boolean result of the LOS raycast — pass it in, do not compute it
// here, so this stays pure. Used by the decideActions() facade.
export function wantsToShoot(dist, playerInNap, hasLOS) {
  return inEngageRange(dist, playerInNap) && !!hasLOS;
}

// SDK-direction facade: map a plain bot world-state snapshot to the actions a
// bot would take this decision. Allocation-per-call → not for the hot path yet.
//
// worldState: { alive, dist, playerInNap, hasLOS, shootReady }
export function decideActions(worldState) {
  const { alive, dist, playerInNap, hasLOS, shootReady } = worldState;
  if (!alive) return [{ type: BOT_ACTION.IDLE }];
  const actions = [{ type: BOT_ACTION.MOVE }];
  if (shootReady && wantsToShoot(dist, playerInNap, hasLOS)) {
    actions.push({ type: BOT_ACTION.SHOOT });
  }
  return actions;
}
