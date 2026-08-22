// lod.js — Distance-based LOD for bot models.
// < LOD_NEAR  : full GLB with AnimationMixer (already running in botModel)
// >= LOD_NEAR : disable mixer tick to save CPU; model still visible but frozen
// >= LOD_FAR  : hide model entirely (beyond render distance)
// No new allocations in tick — compare squared distances only.

const LOD_NEAR_SQ = 15 * 15; // 15 units — freeze animation
const LOD_FAR_SQ  = 35 * 35; // 35 units — hide mesh

// Hysteresis band (v0.2.608): separate show/hide thresholds so a bot hovering
// at a boundary doesn't flip visible↔hidden every frame (the "bot disappears
// then reappears" pop). Hide at 35m, re-show at 30m; freeze at 15m, unfreeze
// at 13m. The 5m/2m dead zones absorb the per-frame distance jitter.
const LOD_FAR_SHOW_SQ  = 30 * 30; // re-show threshold (must be < LOD_FAR_SQ)
const LOD_NEAR_SHOW_SQ = 13 * 13; // unfreeze threshold (must be < LOD_NEAR_SQ)

// Per-bot previous LOD level — keyed by bot id so the hysteresis is per-bot.
// WeakRef would be nicer but bots are plain objects; a Map is fine (bots are
// long-lived, never removed mid-round).
const _prevLevel = new Map();

// Called from bots.js tickBots for each bot after movement is resolved.
// `botId` is the bot's stable id (number) — used for hysteresis state.
// Returns: 'full' | 'frozen' | 'hidden'
export function getLodLevel(botPosX, botPosZ, playerPosX, playerPosZ, botId) {
  const dx = botPosX - playerPosX;
  const dz = botPosZ - playerPosZ;
  const dsq = dx * dx + dz * dz;

  // No hysteresis state (first frame or no id) → hard thresholds.
  if (botId === undefined || botId === null || !_prevLevel.has(botId)) {
    const level = dsq >= LOD_FAR_SQ ? 'hidden' : dsq >= LOD_NEAR_SQ ? 'frozen' : 'full';
    if (botId !== undefined && botId !== null) _prevLevel.set(botId, level);
    return level;
  }

  // Hysteresis: only transition when the distance crosses the FAR side of the
  // dead zone. A bot at 33m that was 'frozen' stays 'frozen' until it crosses
  // 35m (→hidden) or drops below 30m (→ stays frozen, no flicker).
  const prev = _prevLevel.get(botId);
  let next = prev;
  if (prev === 'hidden' && dsq < LOD_FAR_SHOW_SQ) next = 'frozen';
  else if (prev === 'frozen' && dsq >= LOD_FAR_SQ) next = 'hidden';
  else if (prev === 'frozen' && dsq < LOD_NEAR_SHOW_SQ) next = 'full';
  else if (prev === 'full' && dsq >= LOD_NEAR_SQ) next = 'frozen';
  // 'hidden' → 'full' directly if very close (skip frozen)
  else if (prev === 'hidden' && dsq < LOD_NEAR_SHOW_SQ) next = 'full';
  _prevLevel.set(botId, next);
  return next;
}

// Reset all hysteresis state (e.g. on arena reset / bot roster rebuild).
export function resetLodState() { _prevLevel.clear(); }

// Apply LOD to a BotModel instance — call once per frame per bot
export function applyLod(botModel, level) {
  if (!botModel?.root) return;
  if (level === 'hidden') {
    botModel.root.visible = false;
    return;
  }
  botModel.root.visible = true;
  // 'frozen': skip mixer.update (save CPU) but keep mesh visible
  // Actual skip is handled by passing skipMixer flag to BotModel.tick()
  // 'full': normal — mixer runs in BotModel.tick()
}
