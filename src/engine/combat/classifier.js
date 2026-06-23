// engine/combat/classifier.js — pure headshot classifier (SDK boundary).
// Extracted from weapons.js (v0.2.120) so the head-vs-body rule can be unit
// tested without pulling Three.js / Rapier / the browser. Imports ONLY the
// head-sphere geometry constants from bodies.js (themselves pure, no Rapier at
// module load), so this file is safe to import in a plain node test.
//
// This is the single shared classifier used by BOTH the bullet hit path
// (weapons.js) AND the on-screen target reticle preview (targetReticle.js) so
// what the player SEES before firing matches what the shot actually scores.
import { BOT_HEAD_CENTRE_Y_OFFSET, BOT_HEAD_RADIUS } from '../physics/bodies.js';

// Headshot region, derived from the head sphere geometry (single source of
// truth in bodies.js). The sphere spans [HEAD_BOTTOM, HEAD_TOP] above the bot
// foot; HEAD_BOTTOM is retained purely as a debug/inspection reference.
export const HEAD_BOTTOM   = BOT_HEAD_CENTRE_Y_OFFSET - BOT_HEAD_RADIUS; // 1.43
// Proximity backstop: impacts within (head radius + 5cm) of the head centre
// count as headshots even if the ray resolved the body collider on an
// overlap frame. Squared to avoid a sqrt in the hot path.
export const HEAD_PROX     = BOT_HEAD_RADIUS + 0.05;
export const HEAD_PROX_SQ  = HEAD_PROX * HEAD_PROX;

// Rule (predictable, two-tier — the loose height fallback from v0.2.112 was
// dropped to stop shoulder/upper-torso shots being mis-promoted to headshots):
//   1) the ray resolved the head sphere collider outright (bodyPart==='head'); or
//   2) the impact lies inside the head sphere (proximity backstop for the
//      one frame where the head/body colliders overlap and Rapier's closest
//      pick returns 'body' for a genuine head hit).
// (px,py,pz) is the world-space impact; bot.pos is the bot foot (y≈0 alive).
export function isInHeadSphere(px, py, pz, bot) {
  const bx = bot.pos ? bot.pos.x : 0;
  const bz = bot.pos ? bot.pos.z : 0;
  const fy = bot.pos ? bot.pos.y : 0;
  const dx = px - bx;
  const dy = (py - fy) - BOT_HEAD_CENTRE_Y_OFFSET;
  const dz = pz - bz;
  return (dx * dx + dy * dy + dz * dz) <= HEAD_PROX_SQ;
}

export function classifyHeadshot(px, py, pz, bodyPart, bot) {
  return bodyPart === 'head' || isInHeadSphere(px, py, pz, bot);
}
