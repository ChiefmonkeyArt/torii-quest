// engine/entities/botIdentity.js — bot naming module (ADR-0013, v0.2.623).
//
// Purpose: a single deterministic source of truth for regular-bot names,
// shared by the server sim (`server/bots/arenaBotSim.js`) and the client
// (`src/bots.js`). Server populates `pose.name`; client falls back to
// `nameForBotId(id)` when `pose.name` is absent (SP offline path). Either
// way, the same bot id produces the same name.
//
// The pool is the seven non-Snow-White dwarves. BOT_COUNT = 5 regulars +
// 1 boss, so the pool fully covers the roster and wraps predictably on
// higher ids (`id % 7`). Respawned bots keep their name because id is
// preserved across the respawn cycle.
//
// Non-goals: this module never mutates game state, never allocates on the
// hot path (the pool is a Frozen array; a lookup is `%`+index), and never
// reads THREE / Rapier / DOM.

/** Frozen ordered pool of dwarf names — Snow White excluded (ADR-0013). */
export const DWARF_NAMES = Object.freeze([
  'Doc',
  'Grumpy',
  'Happy',
  'Sleepy',
  'Bashful',
  'Sneezy',
  'Dopey',
]);

/**
 * Deterministic name for a regular-bot id.
 *
 * @param {number} id  Bot's numeric id (any non-negative integer).
 * @returns {string}   One of DWARF_NAMES, wrapping on `id % 7`.
 */
export function nameForBotId(id) {
  // Guard: non-integer / negative ids collapse to Doc — the sim never emits
  // these but a corrupt wire message shouldn't crash the client.
  const i = Number.isInteger(id) && id >= 0 ? id : 0;
  return DWARF_NAMES[i % DWARF_NAMES.length];
}
