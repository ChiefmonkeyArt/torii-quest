// server/bots/arenaBotSim.js — server-authoritative bot controller (chunk 2).
//
// Wraps the shared PURE bot brain (src/engine/entities/botSim.js) with headless
// dependencies so the SERVER can run the exact same AI the single-player client
// runs — but authoritatively, once, against the live player roster, and broadcast
// the result to every client.
//
// Dependencies injected into createBotSim:
//   • losFn        → headless 2D segment-vs-AABB LOS (NOT Rapier; see headlessLos)
//   • footY        → terrain/heightmap.sampleArenaHeight (pure)
//   • clampFence / pointInFence / fenceBounds → terrain/coastline (pure)
//   • arenaBoxes / coverPoints → config CRATES + arena-side OBSTACLES (pure)
//   • shotCallback → forwards (origin,dir) to onBotShot so arena-ws can broadcast
//                    a BOT_SHOT tracer AND resolve bot→player damage.
//
// This module imports ONLY pure modules — no THREE, no Rapier, no scene. The
// import-smoke test asserts that (tests/multiplayer/server-import-smoke.test.js).

import { createBotSim, COVER_MARGIN, EYE_Y } from '../../src/engine/entities/botSim.js';
import { buildCoverPoints } from '../../src/engine/entities/bot-tactics.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { clampToCoastline, pointInCoastline, coastlineBounds } from '../../src/terrain/coastline.js';
import { CRATES, OBSTACLES, NAP_X, BOT_COUNT, BOT_HP, BOT_SHOOT_CD } from '../../src/config.js';
import { createHeadlessLos } from './headlessLos.js';
import { buildBotColliders, rayVsBot } from './botColliders.js';

// Arena-side static boxes (crates + obstacles west of the NAP plane; torii
// pillars / bonsai east of it are irrelevant to combat cover). Mirrors src/bots.js.
const ARENA_BOXES  = [...CRATES, ...OBSTACLES.filter((b) => b[0] < NAP_X)];
const COVER_POINTS = buildCoverPoints(ARENA_BOXES, COVER_MARGIN);

// The server has no single fixed "player safe corner" (many players). Use a
// neutral disc far outside the fence so spawns are never rejected by it.
const NO_SAFE_CORNER = Object.freeze({ x: 9999, z: 9999, radius: 0 });

/**
 * @param {object} opts
 * @param {(origin:{x:number,y:number,z:number}, dir:{x:number,y:number,z:number}) => void} opts.onBotShot
 */
export function createArenaBotSim(opts = {}) {
  const onBotShot = typeof opts.onBotShot === 'function' ? opts.onBotShot : null;

  const sim = createBotSim({
    losFn: createHeadlessLos(ARENA_BOXES, EYE_Y),
    footY: (x, z) => sampleArenaHeight(x, z),
    clampFence: clampToCoastline,
    pointInFence: pointInCoastline,
    fenceBounds: coastlineBounds,
    arenaBoxes: ARENA_BOXES,
    coverPoints: COVER_POINTS,
    config: { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X },
    playerSafeCorner: NO_SAFE_CORNER,
    // v0.2.378 fix 2: lift the SIM-LOCAL origin (y = EYE_Y above feet) to the
    // bot's real world eye height and re-aim at the player world-eye `target`, so
    // the bot→player ray starts at the muzzle and reaches the capsule. The old
    // path forwarded a raw y≈0.9 that missed the player (sess.pos.y ≈ 3.1).
    shotCallback: (origin, dir, target) => {
      if (!onBotShot) return;
      const footY = sampleArenaHeight(origin.x, origin.z);
      const worldOrigin = { x: origin.x, y: footY + origin.y, z: origin.z };
      let worldDir = dir;
      if (target) {
        let dx = target.x - worldOrigin.x, dy = target.y - worldOrigin.y, dz = target.z - worldOrigin.z;
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-6) worldDir = { x: dx / len, y: dy / len, z: dz / len };
      }
      onBotShot(worldOrigin, worldDir);
    },
    getPlayerCollider: () => null,
  });

  function spawn(count = BOT_COUNT) { return sim.spawnAll(count); }

  // Advance the AI one tick against the live player roster.
  // players = [{ x, y, z, outsideFence, flyEnabled }]
  function tick(dt, players) { sim.tick(dt, players); }

  // Compact continuous-state snapshot broadcast at ~15Hz (throttled by caller).
  function snapshot() {
    return sim.bots.map((st) => ({
      id: st.id,
      x: round2(st.pos.x),
      z: round2(st.pos.z),
      rotY: round3(st.rotY),
      hp: st.hp,
      alive: st.alive,
      animHint: st.animHint,
    }));
  }

  // Resolve one player shot against ALL alive bots. Returns the NEAREST hit
  // (smallest t) or null. Caller compares this t against the nearest peer hit
  // so a single bullet only ever applies one hit (no piercing).
  function resolvePlayerShot(origin, dir) {
    let best = null;
    for (const st of sim.bots) {
      if (!st.alive) continue;
      const footY = sampleArenaHeight(st.pos.x, st.pos.z);
      const colliders = buildBotColliders(st.pos.x, st.pos.z, footY);
      const res = rayVsBot(origin, dir, colliders);
      if (!res.hit) continue;
      if (!best || res.t < best.t) best = { botId: st.id, zone: res.zone, t: res.t };
    }
    return best;
  }

  function getBot(botId) { return sim.bots.find((b) => b.id === botId) || null; }

  // Apply authoritative damage to a bot. playerPos ({x,z}) drives blowback dir.
  function applyBotDamage(botId, dmg, playerPos) {
    const st = getBot(botId);
    if (!st || !st.alive) return { hit: false, killed: false, hpAfter: st ? st.hp : 0 };
    const res = sim.hitBot(st, dmg, playerPos);
    return { hit: res.hit, killed: res.killed, hpAfter: st.hp };
  }

  return {
    spawn, tick, snapshot,
    resolvePlayerShot, applyBotDamage, getBot,
    get bots() { return sim.bots; },
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
