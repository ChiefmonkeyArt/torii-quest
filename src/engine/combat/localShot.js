// localShot.js — pure resolver for the LOCAL player's shot (v0.2.397).
// SP resolves damage as HITSCAN on the camera/aim ray at fire time (matching
// the MP server path), instead of via the travelling projectile. This fixes the
// long-range / near-object body-shot drops: a moving bot can no longer dodge
// during flight, and the offset gun barrel no longer clips geometry the reticle
// clears. No Three/Rapier here so it stays unit-testable.
import { classifyHeadshot } from './classifier.js';
import { shotDamage } from './damage.js';

// Resolve a local player shot against an aim-ray hit.
//   netMode true  → MP; the server is authoritative, so resolve NOTHING here.
//   no hit / no bot / dead bot → clean miss (null).
//   live-bot hit  → { bot, dmg, isHead, toi }, dmg from the shared damage model
//                   and isHead from the shared classifier (reticle == outcome).
export function resolveLocalHitscan(hit, netMode) {
  if (netMode) return null;
  if (!hit || !hit.bot || !hit.bot.alive) return null;
  const isHead = classifyHeadshot(hit.point.x, hit.point.y, hit.point.z, hit.bodyPart, hit.bot);
  return { bot: hit.bot, dmg: shotDamage(isHead), isHead, toi: hit.toi };
}
