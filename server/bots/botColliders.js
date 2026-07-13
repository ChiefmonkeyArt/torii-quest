// server/bots/botColliders.js — pure bot capsule/head geometry + ray test.
//
// Mirrors the shipped client bot colliders from src/engine/physics/bodies.js so
// the server's player→bot ray tests line up with what players see:
//
//   Body capsule:  half-height 0.50, radius 0.26, centre 0.76 above foot.
//                  Endpoints (cap centres): p0=foot+0.26, p1=foot+1.26.
//   Head sphere:   radius 0.20, centre 1.55 above foot.
//
// A bot's sim pos is a 2D {x,z} bag planted on the arena surface; foot height is
// sampled server-side (heightmap.sampleArenaHeight) and passed in. Node-pure —
// constants are copied (NOT imported) so this stays free of any THREE import.

import { rayVsPeer } from '../combat/rayVsCapsule.js';

// Shipped constants from src/engine/physics/bodies.js — copied, not imported.
export const BOT_BODY_RADIUS = 0.26;
export const BOT_BODY_CENTRE_Y = 0.76; // radius + halfHeight
export const BOT_HEAD_RADIUS = 0.20;
export const BOT_HEAD_CENTRE_Y = 1.55;

/**
 * Build the body capsule + head sphere colliders for a bot standing at (x,z)
 * with feet on the ground at footY.
 *
 * @returns {{ bodyCap:{p0:[number,number,number],p1:[number,number,number],r:number},
 *             headSphere:{c:[number,number,number],r:number} }}
 */
export function buildBotColliders(x, z, footY) {
  const p0y = footY + BOT_BODY_RADIUS;       // bottom cap centre (foot+0.26)
  const p1y = footY + BOT_BODY_CENTRE_Y + 0.5; // top cap centre (foot+1.26)
  return {
    bodyCap: { p0: [x, p0y, z], p1: [x, p1y, z], r: BOT_BODY_RADIUS },
    headSphere: { c: [x, footY + BOT_HEAD_CENTRE_Y, z], r: BOT_HEAD_RADIUS },
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
