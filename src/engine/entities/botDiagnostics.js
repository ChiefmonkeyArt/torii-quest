// engine/entities/botDiagnostics.js — structured console logging for bot
// combat events (ADR-0013, v0.2.623).
//
// Purpose: correlate what the player saw (a specific dwarf-labelled bot) with
// what the code did (hp, alive, isDying, lod, distance). Gated behind
// `window.__toriiBotDiag` so it can be flipped off in production without a
// code change. Zero side-effects beyond `console.log`; never mutates state.
//
// Log shapes (single line each, greppable):
//   [SHOT]    botId=N name=<name> hp=<before>→<after> zone=<head|body|limb> alive=<bool> isDying=<bool> lod=<full|far|capsule> dist=<meters>
//   [KILL]    botId=N name=<name> causedBy=<player|other|unknown> headshot=<bool>
//   [RESPAWN] botId=N name=<name> at=(<x>,<z>)
//
// The default is ON while ADR-0013 is Accepted and the stuck-bot bug is being
// diagnosed. Flip to OFF once fixed:
//   window.__toriiBotDiag = false;

import { nameForBotId } from './botIdentity.js';

/** Read the runtime diag flag; default ON (only true diagnostic session). */
function _enabled() {
  try {
    if (typeof window === 'undefined') return false;
    // Explicit false disables; anything else (including undefined) enables.
    return window.__toriiBotDiag !== false;
  } catch {
    return false;
  }
}

/** Resolve a name from either a supplied string, a bot's state, or the id. */
function _name(botOrId, explicit) {
  if (explicit) return explicit;
  if (botOrId && typeof botOrId === 'object') {
    return botOrId.state?.name || botOrId.name || nameForBotId(botOrId.state?.id ?? botOrId.id ?? 0);
  }
  return nameForBotId(botOrId ?? 0);
}

/** Round to 1 dp for compact logs (nothing depends on this precision). */
function _r1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN;
}

/**
 * Log a player→bot shot resolution.
 *
 * @param {object} opts
 * @param {number} opts.botId
 * @param {string} [opts.name]      Explicit name (else derived from id).
 * @param {number} opts.hpBefore
 * @param {number} opts.hpAfter
 * @param {string} opts.zone        'head' | 'body' | 'limb'
 * @param {boolean} opts.alive
 * @param {boolean} [opts.isDying]
 * @param {string} [opts.lod]       'full' | 'far' | 'capsule'
 * @param {number} [opts.dist]      Metres to player at shot time.
 */
export function logBotShot(opts) {
  if (!_enabled()) return;
  const name = _name(opts.botId, opts.name);
  // eslint-disable-next-line no-console
  console.log(
    `[SHOT] botId=${opts.botId} name=${name} hp=${opts.hpBefore}→${opts.hpAfter} zone=${opts.zone} alive=${!!opts.alive} isDying=${!!opts.isDying} lod=${opts.lod || 'unknown'} dist=${_r1(opts.dist)}`
  );
}

/**
 * Log a bot kill.
 *
 * @param {object} opts
 * @param {number} opts.botId
 * @param {string} [opts.name]
 * @param {string} [opts.causedBy]   'player' | 'other' | 'unknown'
 * @param {boolean} [opts.headshot]
 */
export function logBotKill(opts) {
  if (!_enabled()) return;
  const name = _name(opts.botId, opts.name);
  // eslint-disable-next-line no-console
  console.log(
    `[KILL] botId=${opts.botId} name=${name} causedBy=${opts.causedBy || 'unknown'} headshot=${!!opts.headshot}`
  );
}

/**
 * Log a bot respawn (server-driven or SP sim).
 *
 * @param {object} opts
 * @param {number} opts.botId
 * @param {string} [opts.name]
 * @param {number} [opts.x]
 * @param {number} [opts.z]
 */
export function logBotRespawn(opts) {
  if (!_enabled()) return;
  const name = _name(opts.botId, opts.name);
  // eslint-disable-next-line no-console
  console.log(
    `[RESPAWN] botId=${opts.botId} name=${name} at=(${_r1(opts.x)},${_r1(opts.z)})`
  );
}
