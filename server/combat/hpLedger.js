// server/combat/hpLedger.js — pure HP + respawn bookkeeping (MP-2).
//
// Server-side ledger of every session's HP. applyDamage clamps at 0 and
// reports whether this hit killed the target. respawn resets HP and returns
// a fresh spawn point chosen "farthest from the killer" to avoid instant
// re-fragging.
//
// Constants mirror shipped client values:
//   • HP_MAX = PLAYER_HP (100) from src/config.js
//   • RESPAWN_CORNERS = ±14, ±14 from src/engine/entities/player.js SPAWN_MAG
//
// This module is pure — no timers, no I/O. The `arena-ws.js` wiring layer
// owns the actual setTimeout for RESPAWN_MS.

export const HP_MAX = 100;
export const SPAWN_MAG = 14; // matches engine/entities/player.js SPAWN_MAG

// Four arena corners at (±SPAWN_MAG, footY≈EYE_HEIGHT, ±SPAWN_MAG).
// EYE_HEIGHT is baked into snapshot.pos (see capsuleModel.js), so the
// respawn pos here is EYE-LEVEL to match the MOVE wire convention.
export const RESPAWN_CORNERS = Object.freeze([
  Object.freeze([-SPAWN_MAG, 3.1, -SPAWN_MAG]),
  Object.freeze([ SPAWN_MAG, 3.1, -SPAWN_MAG]),
  Object.freeze([ SPAWN_MAG, 3.1,  SPAWN_MAG]),
  Object.freeze([-SPAWN_MAG, 3.1,  SPAWN_MAG]),
]);

/** Create a fresh ledger. Sessions register lazily on first damage/respawn. */
export function createHpLedger(hpMax = HP_MAX) {
  return {
    hpMax,
    /** @type {Map<string, number>} sid → current HP */
    hp: new Map(),
  };
}

/** Register a new session at full HP. Idempotent. */
export function register(ledger, sid) {
  if (!ledger.hp.has(sid)) ledger.hp.set(sid, ledger.hpMax);
}

/** Remove a session (peer left). */
export function unregister(ledger, sid) {
  ledger.hp.delete(sid);
}

/** Peek current HP without mutation. Returns hpMax for unknown sids. */
export function getHp(ledger, sid) {
  return ledger.hp.has(sid) ? ledger.hp.get(sid) : ledger.hpMax;
}

/**
 * Apply damage. Negative or zero damage is rejected (returns unchanged).
 * Killing a target LEAVES their HP at 0 — the ledger doesn't respawn
 * automatically; the arena-ws.js wiring calls respawn() after RESPAWN_MS.
 *
 * @returns {{ hpAfter:number, killed:boolean, applied:number }}
 */
export function applyDamage(ledger, sid, dmg) {
  if (!Number.isFinite(dmg) || dmg <= 0) {
    return { hpAfter: getHp(ledger, sid), killed: false, applied: 0 };
  }
  register(ledger, sid);
  const before = ledger.hp.get(sid);
  if (before <= 0) {
    // Already dead — extra damage is ignored (would re-kill on the wire).
    return { hpAfter: 0, killed: false, applied: 0 };
  }
  const after = Math.max(0, before - dmg);
  ledger.hp.set(sid, after);
  return { hpAfter: after, killed: after <= 0, applied: before - after };
}

/**
 * Reset a session to full HP and pick a spawn corner farthest from the
 * killer (if known). Returns { pos:[x,y,z], hp }.
 */
export function respawn(ledger, sid, killerPos) {
  register(ledger, sid);
  ledger.hp.set(sid, ledger.hpMax);
  const corner = pickSpawnFarthest(killerPos);
  return { pos: [corner[0], corner[1], corner[2]], hp: ledger.hpMax };
}

/** Pure spawn-corner picker. Farthest from killer (if provided), else corner 0. */
export function pickSpawnFarthest(killerPos) {
  if (!Array.isArray(killerPos) || killerPos.length !== 3) return RESPAWN_CORNERS[0];
  let best = RESPAWN_CORNERS[0];
  let bestD2 = -1;
  for (const c of RESPAWN_CORNERS) {
    const dx = c[0] - killerPos[0];
    const dz = c[2] - killerPos[2];
    const d2 = dx*dx + dz*dz;
    if (d2 > bestD2) { bestD2 = d2; best = c; }
  }
  return best;
}
