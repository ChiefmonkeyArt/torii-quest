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

import { createBotSim, COVER_MARGIN, EYE_Y, BOT_R } from '../../src/engine/entities/botSim.js';
import { buildCoverPoints } from '../../src/engine/entities/bot-tactics.js';
import { sampleArenaHeight } from '../../src/terrain/heightmap.js';
import { clampToCoastline, pointInCoastline, coastlineBounds } from '../../src/terrain/coastline.js';
import { isNapLand } from '../../src/terrain/tomoeShape.js';
import {
  CRATES, OBSTACLES, BOT_COUNT, BOT_HP, BOT_SHOOT_CD, BOT_SPEED, BOT_DAMAGE,
  BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_RADIUS, BOSS_NAME,
} from '../../src/config.js';
import { createHeadlessLos } from './headlessLos.js';
import { buildBotColliders, rayVsBot } from './botColliders.js';
import { createBotSnapshotRing, pushBotSnap, sampleBotsAt } from './botSnapshotRing.js';

// Default lag-comp rewind window (ms). Mirrors hitResolver.DEFAULT_LAG_COMP_MS
// for the peer path; the caller passes the live LAG_COMP_MS env override.
const DEFAULT_LAG_COMP_MS = 300;

// Arena-side static boxes (crates + obstacles west of the NAP plane; torii
// pillars / bonsai east of it are irrelevant to combat cover). Mirrors src/bots.js.
const ARENA_BOXES  = [...CRATES, ...OBSTACLES.filter((b) => !isNapLand(b[0], b[1]))];
const COVER_POINTS = buildCoverPoints(ARENA_BOXES, COVER_MARGIN);

// The server has no single fixed "player safe corner" (many players). Use a
// neutral disc far outside the fence so spawns are never rejected by it.
const NO_SAFE_CORNER = Object.freeze({ x: 9999, z: 9999, radius: 0 });

// ADR-0018 (v0.2.627-alpha): env-var overrides for controlled test environments.
// BOT_COUNT_OVERRIDE  — total bot roster size (regulars + bosses). Default: BOT_COUNT.
// BOSS_COUNT_OVERRIDE — how many of the roster are bosses. Default: BOSS_COUNT.
// Non-negative integers only; invalid values fall back to the config default.
// Server-only; client is untouched (learns roster from BOT_STATE snapshots in MP).
function _envInt(key, def) {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return def;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : def;
}
// TEST_MODE is the one-stop flag for a clean, fast test rig: defaults the roster
// to 1 regular bot / 0 bosses (granular overrides still win) AND enables instant
// respawn (no death arc, no 8s wait). Any of '1'/'true'/'yes'/'on' enables it.
function _envBool(key) {
  const raw = (process.env[key] || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
const _TEST_MODE = _envBool('TEST_MODE');
const _BOT_COUNT_EFF  = _envInt('BOT_COUNT_OVERRIDE',  _TEST_MODE ? 1 : BOT_COUNT);
const _BOSS_COUNT_EFF = _envInt('BOSS_COUNT_OVERRIDE', _TEST_MODE ? 0 : BOSS_COUNT);
if (_TEST_MODE || _BOT_COUNT_EFF !== BOT_COUNT || _BOSS_COUNT_EFF !== BOSS_COUNT) {
  // eslint-disable-next-line no-console
  console.log(`[BOT_SIM] env override active: TEST_MODE=${_TEST_MODE} BOT_COUNT=${_BOT_COUNT_EFF} BOSS_COUNT=${_BOSS_COUNT_EFF} (defaults ${BOT_COUNT}/${BOSS_COUNT})`);
}

/**
 * @param {object} opts
 * @param {(origin:{x:number,y:number,z:number}, dir:{x:number,y:number,z:number}) => void} opts.onBotShot
 */
export function createArenaBotSim(opts = {}) {
  const onBotShot = typeof opts.onBotShot === 'function' ? opts.onBotShot : null;

  // v0.2.385-alpha: bot position history for lag-compensated player→bot shots.
  const ring = createBotSnapshotRing();

  const sim = createBotSim({
    losFn: createHeadlessLos(ARENA_BOXES, EYE_Y),
    footY: (x, z) => sampleArenaHeight(x, z),
    clampFence: clampToCoastline,
    pointInFence: pointInCoastline,
    fenceBounds: coastlineBounds,
    arenaBoxes: ARENA_BOXES,
    coverPoints: COVER_POINTS,
    config: {
      // ADR-0018/0019: env-driven overrides so operators can flip a single-bot test
      // environment via systemd env without a code change. Defaults unchanged.
      BOT_COUNT: _BOT_COUNT_EFF, BOT_HP, BOT_SHOOT_CD, CRATES, BOT_SPEED, BOT_DAMAGE,
      BOSS_COUNT: _BOSS_COUNT_EFF, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_RADIUS, BOSS_NAME,
      TEST_MODE: _TEST_MODE,
    },
    playerSafeCorner: NO_SAFE_CORNER,
    // v0.2.378 fix 2: lift the SIM-LOCAL origin (y = EYE_Y above feet) to the
    // bot's real world eye height and re-aim at the player world-eye `target`, so
    // the bot→player ray starts at the muzzle and reaches the capsule. The old
    // path forwarded a raw y≈0.9 that missed the player (sess.pos.y ≈ 3.1).
    shotCallback: (origin, dir, target, shooter) => {
      if (!onBotShot) return;
      const footY = sampleArenaHeight(origin.x, origin.z);
      const worldOrigin = { x: origin.x, y: footY + origin.y, z: origin.z };
      let worldDir = dir;
      if (target) {
        let dx = target.x - worldOrigin.x, dy = target.y - worldOrigin.y, dz = target.z - worldOrigin.z;
        const len = Math.hypot(dx, dy, dz);
        if (len > 1e-6) worldDir = { x: dx / len, y: dy / len, z: dz / len };
      }
      // v0.2.381: forward the shooting bot's per-bot damage so bot→player applies
      // the boss's higher hit (arena-ws uses it instead of the global BOT_DAMAGE).
      onBotShot(worldOrigin, worldDir, shooter ? shooter.damage : undefined);
    },
    getPlayerCollider: () => null,
  });

  // ADR-0018: default to the env-driven effective count so `arenaBotSim.spawn()`
  // in arena-ws.js picks up BOT_COUNT_OVERRIDE without an explicit arg. Callers
  // that pass a count still override (used by unit tests).
  function spawn(count = _BOT_COUNT_EFF) { return sim.spawnAll(count); }

  // Advance the AI one tick against the live player roster.
  // players = [{ x, y, z, outsideFence, flyEnabled }]
  function tick(dt, players) { sim.tick(dt, players); }

  // Compact continuous-state snapshot broadcast at ~15Hz (throttled by caller).
  function snapshot() {
    return sim.bots.map((st) => {
      const isBoss = st.kind === 'boss';
      const s = {
        id: st.id,
        x: round2(st.pos.x),
        z: round2(st.pos.z),
        rotY: round3(st.rotY),
        hp: st.hp,
        alive: st.alive,
        animHint: st.animHint,
      };
      // v0.2.381 additive fields (PROTOCOL_VERSION unchanged). Only stamped for
      // the boss so regular-bot frames stay byte-identical on the wire; clients
      // treat a missing kind as 'regular'.
      if (isBoss) {
        s.kind = 1;                              // 0=regular, 1=boss
        s.name = st.name || BOSS_NAME;
        s.scale = round2(st.radius / BOT_R);     // size multiplier vs a normal bot
      }
      return s;
    });
  }

  // v0.2.385-alpha: record every bot's position at the sim tick so player→bot
  // shots can be rewound to the shot ts (lag-comp), exactly as peers are.
  function currentRows() {
    return sim.bots.map((st) => ({
      id: st.id,
      x: st.pos.x,
      z: st.pos.z,
      footY: sampleArenaHeight(st.pos.x, st.pos.z),
      radius: st.radius,
      alive: st.alive,
    }));
  }

  function recordSnapshot(ts) {
    const t = Number.isFinite(ts) ? ts : Date.now();
    pushBotSnap(ring, { ts: t, bots: currentRows() });
  }

  // The bot rows to ray-test for a shot: rewound to the (clamped) shot ts when a
  // finite ts + history are available, else the bots' CURRENT positions (the
  // pre-lag-comp fallback, which also keeps the 2-arg call signature working).
  function shotTimeRows(shotTs, now, lagCompMs) {
    if (Number.isFinite(shotTs) && ring.size > 0) {
      const nowMs = Number.isFinite(now) ? now : Date.now();
      const lag = Number.isFinite(lagCompMs) ? lagCompMs : DEFAULT_LAG_COMP_MS;
      // Same clamp the peer resolver uses: shot.ts ∈ [now - lagCompMs, now].
      const rewindTs = Math.max(nowMs - lag, Math.min(shotTs, nowMs));
      const sampled = sampleBotsAt(ring, rewindTs);
      if (sampled) return sampled;
    }
    return currentRows();
  }

  // Resolve one player shot against ALL alive bots. Returns the NEAREST hit
  // (smallest t) or null. Caller compares this t against the nearest peer hit
  // so a single bullet only ever applies one hit (no piercing).
  //
  // v0.2.385-alpha: when a shot ts is supplied, bots are rewound to that ts
  // (lag-comp) before building colliders — the same rewind peers already get —
  // so a hit lands where the player aimed at the ~100ms-old rendered bot. Boss
  // collider scaling (radius / BOT_R) is preserved on the rewound positions.
  function resolvePlayerShot(origin, dir, shotTs, now, lagCompMs) {
    const rows = shotTimeRows(shotTs, now, lagCompMs);
    let best = null;
    for (const r of rows) {
      // ADR-0015 (v0.2.625-alpha): accept a hit when the bot was alive at the
      // rewound shot instant OR is alive right now. The pre-0.2.625 gate
      // (`live.alive` only) fixed the respawn-side window (v0.2.383: a freshly
      // respawned bot must be hittable immediately) but opened the mirror
      // window on the death side — for the ~viewLag ms between server-death
      // and BOT_KILL reaching the client, every client-confirmed hit was
      // silently dropped even though the shooter saw a live target. The v0.2.624
      // diagnostics captured 8-14 consecutive [FIRE] hit=bot with zero [SHOT]
      // matching this exact fingerprint. `wasAlive || isAlive` closes the death
      // window without reopening the respawn one. Damage against a bot that
      // has since died is safely absorbed by applyDamage's hp≤0 short-circuit
      // (outcome.applied=0, outcome.killed=false) — no double-kill risk.
      const live = getBot(r.id);
      const wasAlive = !!r.alive;
      const isAlive = !!live?.alive;
      if (!wasAlive && !isAlive) continue;
      const colliders = buildBotColliders(r.x, r.z, r.footY, r.radius / BOT_R);
      const res = rayVsBot(origin, dir, colliders);
      if (!res.hit) continue;
      if (!best || res.t < best.t) best = { botId: r.id, zone: res.zone, t: res.t };
    }
    return best;
  }

  // Diagnostic (v0.2.382): nearest alive bot to the shot ray in the XZ plane,
  // with its collider footY, so [SHOT-RESOLVE] can log origin.y vs bot footY and
  // the vertical delta while a player shoots bots on a live server. Never used
  // for hit resolution — purely for the ≤1/sec log line. Returns null if no bots.
  function nearestBotDiag(origin) {
    if (!origin) return null;
    const ox = origin[0], oz = origin[2];
    let best = null;
    for (const st of sim.bots) {
      if (!st.alive) continue;
      const dx = st.pos.x - ox, dz = st.pos.z - oz;
      const d2 = dx * dx + dz * dz;
      if (!best || d2 < best.d2) {
        best = { d2, botId: st.id, footY: sampleArenaHeight(st.pos.x, st.pos.z), pos: { ...st.pos } };
      }
    }
    return best;
  }

  // Diagnostic (v0.2.392): for the nearest alive bot to the shot origin (XZ),
  // return its CURRENT position and the position it was REWOUND to at rewindTs
  // (server time), plus the XZ distance between them. Purely for the ≤1/sec
  // [SHOT-RESOLVE] log so a live capture can confirm the server-time rewind
  // lands the collider where the player saw the bot. Never used for resolution.
  function rewoundNearestDiag(origin, rewindTs, now, lagCompMs) {
    const near = nearestBotDiag(origin);
    if (!near) return null;
    const rows = shotTimeRows(rewindTs, now, lagCompMs);
    const r = rows.find((row) => row.id === near.botId);
    const cur = { x: near.pos.x, z: near.pos.z };
    const rew = r ? { x: r.x, z: r.z } : cur;
    const dxz = Math.hypot(cur.x - rew.x, cur.z - rew.z);
    return { botId: near.botId, cur, rew, dxz };
  }

  // Closest distance between a ray (origin o, UNIT dir u, t>=0) and the segment
  // p0->p1. Used only by missGeomDiag. Minimising |o + s*u - (p0 + t*v)|^2 gives
  // s = t*b - (u.w0) when |u|=1; t is clamped to the segment and s to the ray.
  function _raySegDist(o, u, p0, p1) {
    const v  = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const w0 = [o[0] - p0[0], o[1] - p0[1], o[2] - p0[2]];
    const b  = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const c  = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    const dd = u[0] * w0[0] + u[1] * w0[1] + u[2] * w0[2];
    const e  = v[0] * w0[0] + v[1] * w0[1] + v[2] * w0[2];
    const den = c - b * b;   // a = |u|^2 = 1
    let t = den < 1e-9 ? (c > 1e-9 ? e / c : 0) : (e - b * dd) / den;
    t = Math.min(1, Math.max(0, t));
    const s = Math.max(0, b * t - dd);
    const ps = [o[0] + u[0] * s, o[1] + u[1] * s, o[2] + u[2] * s];
    const qt = [p0[0] + v[0] * t, p0[1] + v[1] * t, p0[2] + v[2] * t];
    return Math.hypot(ps[0] - qt[0], ps[1] - qt[1], ps[2] - qt[2]);
  }

  // Diagnostic (ADR-0023): HOW FAR a shot missed by, and in which dimension.
  //
  // `decision=miss` alone cannot distinguish "grazed the head sphere by 4cm"
  // (a lag-comp / aim-precision issue) from "went a metre wide" (a framing or
  // occlusion issue) - those have completely different fixes. For the nearest
  // alive bot, rewound exactly as resolution does, report the ray's closest
  // approach to the head sphere centre and to the body capsule axis, each with
  // its signed GAP (distance - radius; >0 means missed by that much), plus the
  // head miss split into vertical and horizontal parts so an "over the hat"
  // miss is distinguishable from a "beside the head" one.
  //
  // DESIGN INTENT - do not "fix" this: the head sphere deliberately reaches
  // foot+1.90 on a 1.70m model. These bots wear hats and the hat is
  // INTENTIONALLY part of the headshot zone, because they are small characters
  // and their size would otherwise be an unfair advantage in a shooter. A
  // positive headVert near the top of the sphere is therefore EXPECTED and must
  // NOT be corrected by shrinking the sphere.
  //
  // Never used for hit resolution - log line only.
  function missGeomDiag(origin, dir, rewindTs, now, lagCompMs) {
    if (!origin || !dir) return null;
    const near = nearestBotDiag(origin);
    if (!near) return null;
    const rows = shotTimeRows(rewindTs, now, lagCompMs);
    const r = rows.find((row) => row.id === near.botId);
    if (!r) return null;
    const col = buildBotColliders(r.x, r.z, r.footY, r.radius / BOT_R);
    const dl = Math.hypot(dir[0], dir[1], dir[2]) || 1;
    const u = [dir[0] / dl, dir[1] / dl, dir[2] / dl];

    const hc = col.headSphere.c;
    const hr = col.headSphere.r;
    const w  = [hc[0] - origin[0], hc[1] - origin[1], hc[2] - origin[2]];
    const tH = Math.max(0, w[0] * u[0] + w[1] * u[1] + w[2] * u[2]);
    const p  = [origin[0] + u[0] * tH, origin[1] + u[1] * tH, origin[2] + u[2] * tH];
    const headDist = Math.hypot(p[0] - hc[0], p[1] - hc[1], p[2] - hc[2]);
    const bodyDist = _raySegDist(origin, u, col.bodyCap.p0, col.bodyCap.p1);

    return {
      botId: near.botId,
      headDist, headGap: headDist - hr,
      headVert: p[1] - hc[1],
      headHorz: Math.hypot(p[0] - hc[0], p[2] - hc[2]),
      bodyDist, bodyGap: bodyDist - col.bodyCap.r,
      rng: tH,
    };
  }

  function getBot(botId) { return sim.bots.find((b) => b.id === botId) || null; }

  // Apply authoritative damage to a bot. playerPos ({x,z}) drives blowback dir.
  function applyBotDamage(botId, dmg, playerPos) {
    const st = getBot(botId);
    if (!st || !st.alive) {
      // DIAG v0.2.662: show when a shot hits a DEAD/missing bot (corpse linger).
      console.log(`[BOT-DMG] bot=${botId} SKIP alive=${st ? st.alive : 'no-bot'} hp=${st ? st.hp : 0} dmg=${dmg}`);
      return { hit: false, killed: false, hpAfter: st ? st.hp : 0 };
    }
    const hpBefore = st.hp;
    const res = sim.hitBot(st, dmg, playerPos);
    // DIAG v0.2.662: hp before/after + whether killBot fired. Remove after triage.
    console.log(`[BOT-DMG] bot=${botId} hp=${hpBefore}->${st.hp} dmg=${dmg} killed=${res.killed} alive=${st.alive}`);
    return { hit: res.hit, killed: res.killed, hpAfter: st.hp };
  }

  return {
    spawn, tick, snapshot, recordSnapshot,
    resolvePlayerShot, applyBotDamage, getBot, nearestBotDiag, rewoundNearestDiag, missGeomDiag,
    get bots() { return sim.bots; },
  };
}

function round2(n) { return Math.round(n * 100) / 100; }
function round3(n) { return Math.round(n * 1000) / 1000; }
