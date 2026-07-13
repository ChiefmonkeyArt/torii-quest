// engine/entities/botSim.js — PURE headless bot AI brain (v0.2.377-alpha).
//
// The single-player bot AI/sim extracted verbatim out of src/bots.js. This module
// has ZERO render/audio/physics imports: no three, no scene, no audio, no Rapier,
// no raycastService, no lod, no BotModel, no player.js. Everything the brain needs
// from those worlds is passed in via createBotSim(deps) — line-of-sight, ground
// height, coastline clamp/containment, the precomputed static arena boxes + cover
// points, the numeric config, and a shotCallback the client wraps around
// spawnBullet + bot-shoot audio.
//
// It imports ONLY the already-pure tactics/steering helpers (bot-tactics.js,
// bot-agent.js — plain {x,z} math over config tuning), so the whole module is
// unit-testable in plain node with injected fakes.
//
// Bot state is a PURE bag (no THREE.Vector3): pos is {x,z}; the client wrapper
// (src/bots.js) holds the GLB model / Rapier colliders and reads each state's
// pos / rotY / isShooting / _isHit / _blowY / animHint every tick to drive render.
// Side-effects the brain does NOT own (state.kills++, sats, emit, audio, collider
// parking) stay in the wrapper — killBot merely returns { killed:true } so the
// wrapper can fire them.
import { engageSpeed, steerComponent } from './bot-agent.js';
import {
  tierForIndex, flankSlotForIndex, flankAnchor,
  pickCover, obstacleAvoid,
  effectiveSight, effectiveCooldown, effectiveSpread,
} from './bot-tactics.js';

// ── Tuning (mirrors src/bots.js exactly) ─────────────────────────────────────
export const BOT_R = 0.4;
export const EYE_Y = 0.9; // eye/shoot height on bot
// F4: a flying player can only be targeted below this eye altitude.
export const FLY_TARGET_CEILING = 21;
// Cover candidate outward offset margin (client uses this to build coverPoints).
export const COVER_MARGIN = BOT_R + 0.35;
// Cover re-evaluation cadence — staggered per bot so LOS rays never all fire on
// the same frame. Each bot re-scores at most ~1.6×/sec.
const COVER_EVAL_PERIOD = 0.6;   // seconds between cover re-scores per bot
const COVER_MAX_DIST    = 12;    // don't chase cover further than this
const COVER_ARRIVE_R2   = 0.6 * 0.6; // squared arrive radius at a cover point
// Obstacle-avoidance feeler influence beyond each box half-extent.
const AVOID_INFLUENCE = BOT_R + 1.1;
const AVOID_WEIGHT    = 1.4;     // how hard avoidance bends the heading
const _SPAWN_MARGIN   = 2;       // keep spawns a little inside the coast
// Multi-player target acquisition radius. A player is a *preferred* (eligible)
// target only when in-fence, non-NAP, not-too-high AND within this range.
// Deliberately arena-spanning so eligibility reduces to "shootable zone" — the
// range clause only ever breaks ties between many connected players, and the
// single-player fallback (nearest player overall) makes it a no-op for one
// player, preserving byte-identical single-player behaviour.
export const ACQUIRE_RANGE = 60;

// createBotSim(deps) — build the headless bot brain.
//
// deps = {
//   losFn(ax,ay,az,bx,by,bz, excludeCollider) -> bool,   // lineOfSight
//   footY(x,z) -> number,                                  // sampleArenaHeight
//   clampFence(x,z,margin) -> [x,z],                       // clampToCoastline
//   pointInFence(x,z) -> bool,                             // pointInCoastline
//   fenceBounds() -> {minX,maxX,minZ,maxZ},                 // coastlineBounds
//   arenaBoxes,                                            // [cx,cz,hw,hd,...] rows
//   coverPoints,                                           // precomputed [x,z] pts
//   config: { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X },
//   playerSafeCorner: { x, z, radius },                    // live spawn-reject disc
//   shotCallback(origin{x,y,z}, dir{x,y,z}),               // client: bullet + audio
//   getPlayerCollider() -> collider|null,                  // LOS self-exclude
// }
// Returns { bots, spawnAll, tick, hitBot, killBot, revive }.
export function createBotSim(deps) {
  const {
    losFn, footY, clampFence, pointInFence, fenceBounds,
    arenaBoxes, coverPoints, config, playerSafeCorner,
    shotCallback, getPlayerCollider,
  } = deps;
  const { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X } = config;

  const bots = [];

  // Scratch — plain {x,z} bags reused every tick (allocation-free hot path).
  const _sep    = { x: 0, z: 0 };
  const _avoid  = { x: 0, z: 0 };
  const _anchor = { x: 0, z: 0 };

  // ── Safe random spawn position — never inside the player's safe corner ──────
  function _safeSpawnPos() {
    const b = fenceBounds();
    let x = 0, z = 0, tries = 0;
    do {
      x = b.minX + Math.random() * (b.maxX - b.minX);
      z = b.minZ + Math.random() * (b.maxZ - b.minZ);
      if (!pointInFence(x, z)) continue;
      const dx = x - playerSafeCorner.x;
      const dz = z - playerSafeCorner.z;
      if (dx * dx + dz * dz > playerSafeCorner.radius * playerSafeCorner.radius) break;
    } while (++tries < 30);
    const [cx, cz] = clampFence(x, z, _SPAWN_MARGIN);
    return { x: cx, z: cz };
  }
  // Exposed so the client wrapper can seed model/collider spawn positions.
  function safeSpawnPos() { return _safeSpawnPos(); }

  // ── AABB pushout + coastline containment (kinematic bots ignore physics) ────
  function _pushout(nx, nz) {
    [nx, nz] = clampFence(nx, nz, BOT_R);
    if (!pointInFence(nx, nz)) { nx = 0; nz = 0; }
    for (const [cx, cz, hw, hd] of CRATES) {
      const dx = nx - cx, dz = nz - cz;
      const ox = hw + BOT_R - Math.abs(dx);
      const oz = hd + BOT_R - Math.abs(dz);
      if (ox > 0 && oz > 0) {
        if (ox < oz) nx += dx > 0 ? ox : -ox;
        else         nz += dz > 0 ? oz : -oz;
      }
    }
    return [nx, nz];
  }

  // A cover point is valid if the player has NO clear line to it — static geometry
  // blocks the player→point ray (inverse of LOS). Eye-height on both ends; player
  // capsule excluded so it never self-counts.
  function _coverBlocked(px, pz, cx, cz) {
    return !losFn(px, EYE_Y, pz, cx, EYE_Y, cz, getPlayerCollider());
  }

  // ── Spawn ─────────────────────────────────────────────────────────────────
  function _spawnBot(i) {
    const { x, z } = _safeSpawnPos();
    const state = {
      id: i,
      pos: { x, z },
      hp: BOT_HP,
      alive: true,
      shootCd: Math.random() * BOT_SHOOT_CD,
      respawnTimer: 0,
      tier: tierForIndex(i),
      _flankSlot: flankSlotForIndex(i),
      _coverPoint: null,
      _coverTimer: (i / BOT_COUNT) * COVER_EVAL_PERIOD, // staggered first eval
      _losTimer: 0,
      _isHit: false,
      _hitTimer: 0,
      _isDying: false,
      _deathHideTimer: 0,
      _blowVx: 0, _blowVz: 0, _blowVy: 0, _blowY: 0,
      isShooting: false,
      rotY: 0,
      animHint: 'walk',
    };
    bots.push(state);
    return state;
  }

  function spawnAll(count = BOT_COUNT) {
    bots.length = 0;
    for (let i = 0; i < count; i++) _spawnBot(i);
    return bots;
  }

  // Derived animation label for the client wrapper. The wrapper still drives
  // BotModel.updateAnim() with the raw (dist, isShooting, isDeath, isHit) flags to
  // guarantee byte-identical animation selection — animHint is the pure, testable
  // summary of that same decision.
  function _animHint(state, moving) {
    if (!state.alive) return 'die';
    if (state._isHit) return 'hit';
    if (state.isShooting) return 'shoot';
    return moving ? 'walk' : 'idle';
  }

  // Is this player a valid shooting/engage target? In-fence, non-NAP, and (for a
  // flying player) below the targeting ceiling. Mirrors the shooting gate.
  function _eligible(p) {
    return !p.outsideFence && p.x <= NAP_X &&
           !(p.flyEnabled && p.y >= FLY_TARGET_CEILING);
  }

  // Per-bot target = the NEAREST ELIGIBLE player within ACQUIRE_RANGE. If none is
  // eligible, fall back to the nearest player overall so the bot still flanks the
  // closest threat (this fallback is what keeps a 1-element array — single-player
  // — byte-identical: the sole player is always the target, engage-gated exactly
  // as before). Returns null only when there are zero players (server idle).
  function _selectTarget(state) {
    const bx = state.pos.x, bz = state.pos.z;
    let bestEli = null, bestEliD2 = Infinity;
    let bestAny = null, bestAnyD2 = Infinity;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      const dx = p.x - bx, dz = p.z - bz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestAnyD2) { bestAnyD2 = d2; bestAny = p; }
      if (d2 <= ACQUIRE_RANGE * ACQUIRE_RANGE && _eligible(p) && d2 < bestEliD2) {
        bestEliD2 = d2; bestEli = p;
      }
    }
    return bestEli || bestAny;
  }

  // ── Tick ────────────────────────────────────────────────────────────────────
  // players = array of { x, y, z, outsideFence, flyEnabled }. A single object is
  // accepted too (normalised to a 1-element array) so single-player callers and
  // the chunk-1 tests keep working. Each bot picks its own nearest-eligible
  // target; inNap/safe/too-high are derived PER TARGET (were global in chunk 1,
  // identical when there is one player).
  let players = [];
  function tick(dt, playerStateOrArray) {
    players = Array.isArray(playerStateOrArray)
      ? playerStateOrArray
      : (playerStateOrArray ? [playerStateOrArray] : []);

    bots.forEach(state => {
      // Dead — tick blowback physics + death timer, then wait for respawn.
      if (!state.alive) {
        state.isShooting = false;
        if (state._isDying) {
          const GRAVITY = -14;   // gentler gravity = longer hang time
          const FRICTION = 0.995; // near-zero friction = full distance
          state._blowVy += GRAVITY * dt;
          state._blowVx *= Math.pow(FRICTION, dt * 60);
          state._blowVz *= Math.pow(FRICTION, dt * 60);
          state.pos.x += state._blowVx * dt;
          state.pos.z += state._blowVz * dt;
          const [bcx, bcz] = clampFence(state.pos.x, state.pos.z, 0.5);
          state.pos.x = bcx;
          state.pos.z = bcz;
          state._blowY = Math.max(footY(state.pos.x, state.pos.z), state._blowY + state._blowVy * dt);
          state._deathHideTimer -= dt;
          if (state._deathHideTimer <= 0) state._isDying = false;
        }
        state.animHint = 'die';
        state.respawnTimer -= dt;
        if (state.respawnTimer <= 0) revive(state);
        return;
      }

      // Hit flash timer
      if (state._hitTimer > 0) {
        state._hitTimer -= dt;
        if (state._hitTimer <= 0) state._isHit = false;
      }

      // Per-bot target = nearest eligible player (fallback: nearest overall).
      // No players at all (server idle) → sit idle, no movement/shooting.
      const pp = _selectTarget(state);
      if (!pp) {
        state.isShooting = false;
        state._losTimer = 0;
        state.animHint = _animHint(state, false);
        return;
      }
      // Per-target gates (were global in chunk 1; identical for one player).
      const playerSafe     = !!pp.outsideFence;
      const playerInNap     = pp.x > NAP_X;
      const tooHighToTarget = !!pp.flyEnabled && pp.y >= FLY_TARGET_CEILING;

      const px = state.pos.x, pz = state.pos.z;
      const tier = state.tier;
      const dist = Math.hypot(pp.x - px, pp.z - pz);

      // ── Cover eval — STAGGERED per bot, never every frame ────────────────────
      state._coverTimer -= dt;
      if (state._coverTimer <= 0) {
        state._coverTimer = COVER_EVAL_PERIOD;
        const pressured = state.hp <= BOT_HP * 0.5 || state._isHit ||
                          tier.id === 'hard' || state.shootCd > 0;
        if (!playerSafe && pressured && Math.random() < tier.coverBias) {
          const ci = pickCover(px, pz, pp.x, pp.z, coverPoints, _coverBlocked, COVER_MAX_DIST);
          state._coverPoint = ci >= 0 ? coverPoints[ci] : null;
        } else if (Math.random() > tier.persistence) {
          state._coverPoint = null; // low-persistence bots let cover lapse
        }
      }

      // ── Desired target: held cover point, else the flank anchor ──────────────
      let tx, tz;
      if (state._coverPoint) {
        tx = state._coverPoint[0]; tz = state._coverPoint[1];
      } else {
        flankAnchor(pp.x, pp.z, px, pz, state._flankSlot.angle, tier.flankBias, _anchor);
        tx = _anchor.x; tz = _anchor.z;
      }
      const dtx = tx - px, dtz = tz - pz;
      const tlen = Math.hypot(dtx, dtz);
      let dirx = 0, dirz = 0;
      if (!(state._coverPoint && tlen * tlen <= COVER_ARRIVE_R2) && tlen > 1e-4) {
        dirx = dtx / tlen; dirz = dtz / tlen;
      }

      // Bot-bot separation — stops bots stacking / sharing a flank slot.
      _sep.x = 0; _sep.z = 0;
      bots.forEach(o => {
        if (o === state || !o.alive) return;
        const dx = px - o.pos.x;
        const dz = pz - o.pos.z;
        const d  = Math.sqrt(dx * dx + dz * dz);
        if (d < BOT_R * 2.5 && d > 0) { _sep.x += dx / d; _sep.z += dz / d; }
      });

      // Obstacle avoidance — analytic feelers around the static arena boxes.
      obstacleAvoid(px, pz, dirx, dirz, arenaBoxes, AVOID_INFLUENCE, _avoid);

      // Blend seek + separation + avoidance, normalise so avoidance BENDS the
      // heading rather than boosting speed. Speed scales with engage distance and
      // the tier speed multiplier.
      const hx = steerComponent(dirx, _sep.x) + _avoid.x * AVOID_WEIGHT;
      const hz = steerComponent(dirz, _sep.z) + _avoid.z * AVOID_WEIGHT;
      const hlen = Math.hypot(hx, hz);
      const spd = engageSpeed(dist) * tier.speedScale;
      const vx = hlen > 1e-4 ? (hx / hlen) * spd : 0;
      const vz = hlen > 1e-4 ? (hz / hlen) * spd : 0;

      const [nx, nz] = _pushout(px + vx * dt, pz + vz * dt);
      state.pos.x = nx;
      state.pos.z = nz;
      const moving = hlen > 1e-4 && spd > 0;

      state.rotY = Math.atan2(pp.x - nx, pp.z - nz);

      // Shooting — suppressed in the NAP zone, when the player is outside the
      // fence, or when a flying player is above the targeting ceiling.
      let isShooting = false;
      const hasLos = !tooHighToTarget && !playerSafe && !playerInNap &&
          dist <= effectiveSight(tier) &&
          losFn(nx, EYE_Y, nz, pp.x, pp.y, pp.z, getPlayerCollider());
      if (hasLos) {
        state._losTimer += dt;
        state.shootCd   -= dt;
        if (state._losTimer >= tier.reaction && state.shootCd <= 0) {
          state.shootCd = effectiveCooldown(tier) + Math.random() * 0.8;
          const spread = effectiveSpread(tier);
          const ox = nx, oy = EYE_Y, oz = nz;
          let dx = pp.x - nx, dy = pp.y - EYE_Y, dz = pp.z - nz;
          let dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
          dx += ((Math.random() + Math.random()) - 1) * spread;
          dy += ((Math.random() + Math.random()) - 1) * spread * 0.5;
          dz += ((Math.random() + Math.random()) - 1) * spread;
          dl = Math.hypot(dx, dy, dz) || 1;
          dx /= dl; dy /= dl; dz /= dl;
          if (shotCallback) shotCallback({ x: ox, y: oy, z: oz }, { x: dx, y: dy, z: dz });
          isShooting = true;
        }
      } else {
        state._losTimer = 0;
      }
      state.isShooting = isShooting;
      state.animHint = _animHint(state, moving);
    });
  }

  // ── Hit / Kill / Revive — pure state mutations ────────────────────────────────
  // hitBot returns { hit, killed }. When killed, the client wrapper owns the
  // side-effects (state.kills++, sats, emit, collider parking, death anim).
  function hitBot(state, dmg, playerPos) {
    state.hp -= dmg;
    state._isHit    = true;
    state._hitTimer = 0.3;
    if (state.hp <= 0) {
      killBot(state, playerPos);
      return { hit: true, killed: true };
    }
    return { hit: true, killed: false };
  }

  function killBot(state, playerPos) {
    state.alive    = false;
    state.isShooting = false;
    state._isHit   = false;
    state._isDying = true;
    state._deathHideTimer = 2.67; // exact Shot_and_Blown_Back duration
    if (playerPos) {
      const dx = state.pos.x - playerPos.x;
      const dz = state.pos.z - playerPos.z;
      const len = Math.sqrt(dx * dx + dz * dz) || 1;
      const BLOWBACK = 28;
      state._blowVx = (dx / len) * BLOWBACK;
      state._blowVz = (dz / len) * BLOWBACK;
      state._blowVy = 9.0;
      state._blowY  = footY(state.pos.x, state.pos.z);
    } else {
      state._blowVx = state._blowVz = state._blowVy = 0;
      state._blowY  = footY(state.pos.x, state.pos.z);
    }
    state.animHint = 'die';
    state.respawnTimer = 8.0;
    return { killed: true };
  }

  function revive(state) {
    state.alive    = true;
    state.hp       = BOT_HP;
    state._isHit   = false;
    state._isDying = false;
    state._blowVx  = state._blowVz = state._blowVy = state._blowY = 0;
    state._coverPoint = null;
    state._losTimer   = 0;
    state._coverTimer = Math.random() * COVER_EVAL_PERIOD;
    const { x: rx, z: rz } = _safeSpawnPos();
    state.pos.x = rx;
    state.pos.z = rz;
    state.isShooting = false;
    state.animHint = 'walk';
    return state;
  }

  return { bots, spawnAll, safeSpawnPos, tick, hitBot, killBot, revive };
}
