// server/bots/botColliders.js — pure bot capsule/head geometry + ray test.
//
// Mirrors the shipped client bot colliders from src/engine/physics/bodies.js so
// the server's player→bot ray tests line up with what players see:
//
//   Body capsule:  half-height 0.50, radius 0.30, centre 0.76 above foot.
//                  Endpoints (cap centres): p0=foot+0.30, p1=foot+1.26.
//   Head sphere:   radius 0.30, centre 1.55 above foot.
//
// v0.2.386-alpha: body/head radius widened (~+15%) for hitbox forgiveness — the
// capsule was narrower than the visual bot model (arms/shoulders), so shots that
// visually hit the body missed. Only the radii grow; centres stay put (foot stays
// planted: bottom cap centre = foot + radius, so the sphere bottom is still foot).
//
// v0.2.389-alpha: head radius 0.23 → 0.30 (== body radius). At head height the
// body cap's top hemisphere protruded farther than the smaller head sphere, so
// rayVsPeer resolved face shots as 'body' (3 dmg) — regular bots took 2 hits, not
// the intended 1-shot headshot (HEADSHOT_DAMAGE=9 ≥ BOT_HP=5). Matching radii lets
// the head win those ties. Body coverage is unchanged; chest shots stay 'body'.
//
// A bot's sim pos is a 2D {x,z} bag planted on the arena surface; foot height is
// sampled server-side (heightmap.sampleArenaHeight) and passed in. Node-pure —
// constants are copied (NOT imported) so this stays free of any THREE import.

import { rayVsPeer } from '../combat/rayVsCapsule.js';

// Shipped constants from src/engine/physics/bodies.js — copied, not imported.
export const BOT_BODY_RADIUS = 0.30;
export const BOT_BODY_CENTRE_Y = 0.76; // unchanged — top cap stays at foot+1.26
export const BOT_HEAD_RADIUS = 0.30;
export const BOT_HEAD_CENTRE_Y = 1.55;

/**
 * Build the body capsule + head sphere colliders for a bot standing at (x,z)
 * with feet on the ground at footY.
 *
 * @returns {{ bodyCap:{p0:[number,number,number],p1:[number,number,number],r:number},
 *             headSphere:{c:[number,number,number],r:number} }}
 */
export function buildBotColliders(x, z, footY, scale = 1) {
  // scale > 1 grows the whole capsule uniformly for a bigger/taller bot (the
  // Augustink boss). All Y offsets are measured from the foot, so scaling them
  // keeps the feet planted while the body + head grow upward (v0.2.381).
  const bodyR = BOT_BODY_RADIUS * scale;
  const headR = BOT_HEAD_RADIUS * scale;
  const p0y = footY + bodyR;                          // bottom cap centre
  const p1y = footY + (BOT_BODY_CENTRE_Y + 0.5) * scale; // top cap centre
  return {
    bodyCap: { p0: [x, p0y, z], p1: [x, p1y, z], r: bodyR },
    headSphere: { c: [x, footY + BOT_HEAD_CENTRE_Y * scale, z], r: headR },
  };
}

/**
 * Ray-vs-bot. Returns { hit, t, zone } exactly like rayVsPeer.
 * @param {[number,number,number]} origin
 * @param {[number,number,number]} dir
 * @param {object} colliders  from buildBotColliders
 */
export function rayVsBot(origin, dir, colliders) {
  return rayVsPeer(origin, dir, colliders);
}
