// server/combat/damageTable.js — pure damage lookup (MP-2, v0.2.364-alpha).
//
// PARITY CONTRACT with src/engine/combat/damage.js:
//   • HEADSHOT_DAMAGE, BODY_DAMAGE MUST match the shipped client values.
//   • tests/multiplayer/damage-table-parity.test.js imports BOTH modules and
//     asserts equality — any drift breaks CI.
//
// We copy the constants (rather than import from the client tree) so the
// server module has zero coupling to src/. The parity test guards drift.

export const HEADSHOT_DAMAGE = 9;
export const BODY_DAMAGE     = 3;

/**
 * Look up damage for a hit zone. Unknown zones return 0 (no damage), which
 * makes the ledger robust against corrupt wire input.
 *
 * @param {string} zone   'head' | 'body' | 'limb'
 * @param {string} [_weapon]   reserved for future per-weapon multipliers
 */
export function damageFor(zone, _weapon) {
  if (zone === 'head') return HEADSHOT_DAMAGE;
  if (zone === 'body') return BODY_DAMAGE;
  // 'limb' is valid on the wire but never emitted by the shipped ray tester
  // (see rayVsCapsule.js — 2 zones). Reserved for future granularity;
  // treated as body damage for forward compatibility.
  if (zone === 'limb') return BODY_DAMAGE;
  return 0;
}
