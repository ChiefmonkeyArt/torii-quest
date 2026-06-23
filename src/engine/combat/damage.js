// engine/combat/damage.js — pure combat damage model (SDK boundary, v0.2.125).
// Extracted from the inline `isHead ? 9 : 3` literal in weapons.js so the
// headshot/body damage mapping AND the kill-threshold behaviour can be unit
// tested without Three / Rapier / the browser. Imports nothing — pure leaf.
//
// Design contract (locked by tests/combat-damage.test.js against BOT_HP):
//   • a clean HEADSHOT one-shots a bot   (HEADSHOT_DAMAGE >= BOT_HP)
//   • a single BODY shot does NOT kill   (BODY_DAMAGE < BOT_HP)
//   • two BODY shots DO kill             (2 * BODY_DAMAGE >= BOT_HP)
// Tuning the numbers here will fail those tests if the contract breaks.

export const HEADSHOT_DAMAGE = 9; // 3× body — one-shots a BOT_HP (5) bot
export const BODY_DAMAGE     = 3; // two body shots to kill

// Damage a single registered hit deals, given whether it landed in the head.
export function shotDamage(isHead) {
  return isHead ? HEADSHOT_DAMAGE : BODY_DAMAGE;
}

// Remaining HP after applying damage (may go negative — caller treats <=0 dead).
export function applyDamage(hp, dmg) {
  return hp - dmg;
}

// Would this hit drop the target to 0 HP or below?
export function isLethal(hp, dmg) {
  return hp - dmg <= 0;
}
