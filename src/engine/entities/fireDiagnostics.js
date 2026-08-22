// engine/entities/fireDiagnostics.js — one log line per trigger pull
// (ADR-0014, v0.2.624). Independent from ADR-0013's botDiagnostics; both flags
// can be toggled separately at runtime.
//
// Log shape (single line, greppable):
//   [FIRE] mode=<sp|mp> hit=<none|bot|terrain|dead-bot|other>
//          botId=<N|-> name=<Name|-> zone=<head|body|limb|->
//          toi=<meters|-> resolved=<yes|no|mp> reason=<...>
//
// Purpose: catch trigger pulls that never resolved to a bot hit. ADR-0013
// only logs when damage lands ([SHOT]); this fires on EVERY click, so a
// "shot many times to no effect" symptom becomes visible as a stream of
// [FIRE] lines with hit != bot or resolved != yes.

/** Runtime gate — default ON while chasing the missing-shots bug. */
function _enabled() {
  try {
    if (typeof window === 'undefined') return false;
    return window.__toriiFireDiag !== false;
  } catch {
    return false;
  }
}

/** Round to 1 dp for compact logs (nothing depends on this precision). */
function _r1(n) {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : NaN;
}

/**
 * Classify the aim-ray outcome into one of the ADR-0014 hit buckets.
 *
 * @param {object|null} aimHit  raycastService.ray result — { bot?, bodyPart?, toi, point } | null
 * @returns {'none' | 'bot' | 'terrain' | 'dead-bot' | 'other'}
 */
export function classifyFireHit(aimHit) {
  if (!aimHit) return 'none';
  if (aimHit.bot) {
    // Alive-bit is the only source of truth for aliveness here (matches
    // resolveLocalHitscan's own gate). Boss + regular share the same field.
    return aimHit.bot.alive ? 'bot' : 'dead-bot';
  }
  // Ray hit something, but it wasn't a bot-owned collider. Terrain, trees,
  // mirrors, etc. all fall into this bucket — we don't need to distinguish
  // them for this diagnostic.
  return 'terrain';
}

/**
 * Compose the [FIRE] line as a plain object, then log it. Split like this so
 * a test can assert the composed fields without mocking `console.log`.
 *
 * @param {object} opts
 * @param {boolean} opts.netMode       true = MP (server-authoritative), false = SP
 * @param {object|null} opts.aimHit    raycast result on the aim/camera ray
 * @param {object|null} opts.local     resolveLocalHitscan(...) return
 * @param {string} [opts.zone]         'head' | 'body' | 'limb' (only when hit=bot)
 */
export function composeFireLine(opts) {
  const netMode = !!opts.netMode;
  const hit = classifyFireHit(opts.aimHit);
  const bot = opts.aimHit?.bot || null;

  // resolved:
  //   MP → 'mp'  (server will resolve; SP resolver returned null by design)
  //   SP → 'yes' if resolver approved, else 'no'
  let resolved;
  if (netMode) resolved = 'mp';
  else resolved = opts.local ? 'yes' : 'no';

  // reason:
  //   clean-hit   → SP resolved a live bot
  //   miss        → ray hit nothing
  //   dead        → ray hit a dead bot's parked collider
  //   net         → MP, deferred to server
  //   other       → ray hit non-bot geometry
  let reason;
  if (resolved === 'yes') reason = 'clean-hit';
  else if (hit === 'none') reason = 'miss';
  else if (hit === 'dead-bot') reason = 'dead';
  else if (netMode) reason = 'net';
  else reason = 'other';

  return {
    mode: netMode ? 'mp' : 'sp',
    hit,
    botId: (hit === 'bot' || hit === 'dead-bot') && bot ? (bot.id ?? '-') : '-',
    name:  (hit === 'bot' || hit === 'dead-bot') && bot ? (bot.name || '-') : '-',
    zone:  hit === 'bot' ? (opts.zone || '-') : '-',
    toi:   opts.aimHit ? _r1(opts.aimHit.toi) : '-',
    resolved,
    reason,
  };
}

/** Emit a [FIRE] line for one trigger pull. Silent when the gate is off. */
export function logShotFired(opts) {
  if (!_enabled()) return;
  const f = composeFireLine(opts);
  // eslint-disable-next-line no-console
  console.log(
    `[FIRE] mode=${f.mode} hit=${f.hit} botId=${f.botId} name=${f.name} zone=${f.zone} toi=${f.toi} resolved=${f.resolved} reason=${f.reason}`
  );
}
