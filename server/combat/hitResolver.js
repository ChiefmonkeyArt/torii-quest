// server/combat/hitResolver.js — pure server-authoritative hit resolution (MP-2).
//
// Given a SHOT from one session, rewind every other authed session's snapshot
// ring to the shot's timestamp (clamped by LAG_COMP_MS), build their colliders,
// intersect the shot ray, and return the NEAREST peer's HIT (or null).
//
// Contract:
//   • No side effects. Ledger updates + broadcasts happen in the caller
//     (arena-ws.js).
//   • Iterates a plain array of {id, ring} handed in by the caller — the
//     resolver never touches Session objects directly, keeping tests pure.
//   • Clamps shot.ts to [now - LAG_COMP_MS, now] before rewinding.

import { sampleAt } from './snapshotRing.js';
import { buildColliders } from './capsuleModel.js';
import { rayVsPeer } from './rayVsCapsule.js';

export const DEFAULT_LAG_COMP_MS = 300;

/**
 * @param {object} args
 * @param {string} args.shooterId
 * @param {{origin:[number,number,number], dir:[number,number,number], ts:number}} args.shot
 * @param {Array<{id:string, ring:object}>} args.peerRings   other authed peers only
 * @param {number} [args.now]                                Date.now() at handling time
 * @param {number} [args.lagCompMs]                          override rewind cap
 * @returns {{ targetId:string, zone:'head'|'body', hitPoint:[number,number,number], t:number } | null}
 */
export function resolveShot(args) {
  const { shooterId, shot, peerRings } = args;
  const now = typeof args.now === 'number' ? args.now : Date.now();
  const lagCompMs = typeof args.lagCompMs === 'number' ? args.lagCompMs : DEFAULT_LAG_COMP_MS;

  if (!shot || !Array.isArray(shot.origin) || !Array.isArray(shot.dir)) return null;
  if (typeof shot.ts !== 'number' || !Number.isFinite(shot.ts))         return null;

  // Clamp rewind window: shot.ts must be within [now - lagCompMs, now].
  const rewindTs = Math.max(now - lagCompMs, Math.min(shot.ts, now));

  let best = null;
  for (const { id, ring } of peerRings) {
    if (id === shooterId) continue;
    const snap = sampleAt(ring, rewindTs);
    if (!snap) continue; // no history for this peer yet — skip.
    const colliders = buildColliders(snap);
    const res = rayVsPeer(shot.origin, shot.dir, colliders);
    if (!res.hit) continue;
    if (!best || res.t < best.t) {
      // Compute hit point from origin + normalised dir * t.
      const dLen = Math.hypot(shot.dir[0], shot.dir[1], shot.dir[2]) || 1;
      const dx = shot.dir[0] / dLen;
      const dy = shot.dir[1] / dLen;
      const dz = shot.dir[2] / dLen;
      best = {
        targetId: id,
        zone: res.zone,
        hitPoint: [
          shot.origin[0] + dx * res.t,
          shot.origin[1] + dy * res.t,
          shot.origin[2] + dz * res.t,
        ],
        t: res.t,
      };
    }
  }
  return best;
}
