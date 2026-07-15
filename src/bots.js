// bots.js — thin render/collider/audio/LOD wrapper around the PURE headless bot
// AI in engine/entities/botSim.js (v0.2.379-alpha).
//
// The AI brain (spawn logic, per-frame steering/cover/LOS/shoot decision, and the
// hit/kill/blowback/respawn state machine) lives in botSim.js with ZERO
// render/audio/physics imports. This module owns everything the brain does not:
// the Banker GLB model (BotModel), the Rapier hit-capsule + head-sphere colliders,
// the bot-shoot audio, LOD, and the game-state side-effects of a kill (kills/sats/
// emit). Each entry in the exported `bots[]` is a WRAPPER that pairs a model +
// colliders with a reference to its pure sim state (`bot.state`).
//
// initBots(playerObj, spawnBulletFn), tickBots(dt) and hitBot(bot, dmg) keep their
// exact signatures + externally observable behaviour — this is a pure refactor.
import * as THREE from 'three';
import { scene } from './scene.js';
import { state, isPlaying } from './state.js';
import { emit, EV } from './events.js';
import { setBossBar, hideBossBar } from './hud.js';
import {
  BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, OBSTACLES, NAP_X, BOT_SPEED, BOT_DAMAGE,
  BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_RADIUS, BOSS_NAME,
} from './config.js';
import { playBotShoot } from './audio.js';
import { BotModel, preloadBotModel, preloadBossModel } from './botModel.js';
import { getLodLevel, applyLod } from './lod.js';
import { PLAYER_SAFE_CORNER, getPlayerCollider, isPlayerOutsideFence } from './player.js';
import { createBotBody, createBotHead, setBotBodyPos, physicsReady,
         BOT_BODY_CENTRE_Y_OFFSET, BOT_HEAD_CENTRE_Y_OFFSET } from './physics.js';
import { raycastService } from './engine/physics/raycastService.js';
import { buildCoverPoints } from './engine/entities/bot-tactics.js';
import { isFlyEnabled } from './engine/debug/flyCamera.js';
import { sampleArenaHeight } from './terrain/heightmap.js';
import { clampToCoastline, pointInCoastline, coastlineBounds } from './terrain/coastline.js';
import { createBotSim, COVER_MARGIN } from './engine/entities/botSim.js';
import { createBotNetState, animHintToFlags } from './engine/entities/botNetState.js';

export const bots = [];

// Bot milestone chunk 2 (v0.2.379-alpha): in multiplayer the client is
// RENDER-ONLY — the server runs the authoritative bot AI and streams BOT_STATE.
// _netMode flips tickBots() from local-AI to interpolate-from-server, and makes
// hitBot() a no-op (damage is resolved server-side via the SHOT path).
let _netMode = false;
const _botNet = createBotNetState();
const _nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function setBotNetMode(on) {
  _netMode = !!on;
  if (!_netMode) hideBossBar();
}
export function isBotNetMode() { return _netMode; }

// Foot ground height for a bot at arena (x,z). Stage 3 (v0.2.329): the arena is a
// raised undulating island, so a bot's feet ride sampleArenaHeight() (which already
// includes ISLAND_BASE_Y). Kinematic bots don't gravity-settle, so we plant them
// on the sampled surface explicitly.
function _footY(x, z) { return sampleArenaHeight(x, z); }

// v0.2.378 fix 2: the pure sim hands shotCallback a SIM-LOCAL origin (y = EYE_Y
// above the bot's feet) plus the player world-eye `target`. Lift the origin to the
// bot's real world eye height (footY + origin.y) and re-aim at the target, so the
// enemy tracer starts at the muzzle and actually reaches the player capsule (the
// old code fired from an absolute y≈0.9, far below the player on raised terrain).
function _botShotToWorld(origin, dir, target) {
  const worldOrigin = { x: origin.x, y: _footY(origin.x, origin.z) + origin.y, z: origin.z };
  if (!target) return [worldOrigin, dir];
  let dx = target.x - worldOrigin.x, dy = target.y - worldOrigin.y, dz = target.z - worldOrigin.z;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-6) { dx /= len; dy /= len; dz /= len; }
  else { dx = dir.x; dy = dir.y; dz = dir.z; }
  return [worldOrigin, { x: dx, y: dy, z: dz }];
}

// Cover candidate points are precomputed ONCE from the static arena-side boxes
// (crates + arena-side obstacles west of the NAP plane — the torii pillars/bonsai
// east of it are irrelevant to combat cover). Offset outward from each box by
// (BOT_R + margin) so a bot standing on the point clears the box.
const _arenaBoxes  = [...CRATES, ...OBSTACLES.filter(b => b[0] < NAP_X)];
const _coverPoints = buildCoverPoints(_arenaBoxes, COVER_MARGIN);

let _spawnBulletFn = null;
let _playerObj     = null;
let _modelsReady   = false;

// The pure headless brain. All render/audio/physics access is injected — the sim
// itself imports none of it. shotCallback wraps spawnBullet + bot-shoot audio; the
// LOS/height/coastline deps forward to the render-side services.
const sim = createBotSim({
  losFn: (ax, ay, az, bx, by, bz, excl) => raycastService.lineOfSight(ax, ay, az, bx, by, bz, excl),
  footY: _footY,
  clampFence: clampToCoastline,
  pointInFence: pointInCoastline,
  fenceBounds: coastlineBounds,
  arenaBoxes: _arenaBoxes,
  coverPoints: _coverPoints,
  config: {
    BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X, BOT_SPEED, BOT_DAMAGE,
    BOSS_COUNT, BOSS_HP, BOSS_SPEED, BOSS_DAMAGE, BOSS_SHOOT_CD, BOSS_RADIUS, BOSS_NAME,
  },
  playerSafeCorner: PLAYER_SAFE_CORNER,
  shotCallback: (origin, dir, target, shooter) => {
    if (_spawnBulletFn) {
      const [worldOrigin, worldDir] = _botShotToWorld(origin, dir, target);
      // Pass the shooting bot's per-bot damage so the boss's bullet hits harder
      // (single-player). MP damage is server-authoritative regardless.
      _spawnBulletFn(worldOrigin, worldDir, false, shooter ? shooter.damage : undefined);
    }
    playBotShoot();
  },
  getPlayerCollider,
});

export function initBots(playerObj, spawnBulletFn) {
  _playerObj     = playerObj;
  _spawnBulletFn = spawnBulletFn;

  // Pre-load the shared GLB template, then spawn all bots (sim owns spawn logic;
  // this wrapper attaches a model + colliders to each resulting sim state).
  //
  // v0.2.391 empty-arena fix: attach the REGULAR bots the instant the small
  // regular GLB is ready — do NOT block them on the 7.6MB boss GLB. The old code
  // attached every bot inside `bossReady.then(...)`, so the whole arena stayed
  // empty for the several seconds the boss model took to stream. The boss model
  // is fetched in PARALLEL and its single wrapper is attached whenever it lands
  // (falling back to the regular model if the boss GLB fails).
  preloadBotModel().then(() => {
    _modelsReady = true;
    sim.spawnAll(BOT_COUNT);

    const bossStates = sim.bots.filter(st => st.kind === 'boss');
    // Kick off the boss GLB fetch NOW, in parallel with attaching regulars.
    const bossReady = bossStates.length
      ? preloadBossModel().then(() => true).catch(err => {
          console.warn('[bots] boss GLB load failed, using regular model:', err);
          return false;
        })
      : Promise.resolve(false);

    // Phase 1: regular bots populate the arena immediately.
    sim.bots.forEach(st => {
      if (st.kind !== 'boss') _attachModelBot(st, 'regular');
    });

    // Phase 2: attach the boss once its (parallel) GLB resolves.
    bossReady.then(bossOk => {
      bossStates.forEach(st => _attachModelBot(st, bossOk ? 'boss' : 'regular'));
    });
  }).catch(err => {
    console.warn('[bots] GLB load failed, falling back to capsules:', err);
    _spawnCapsuleBots();
  });
}

// Build a wrapper bot around a sim state. `alive`/`hp` proxy the sim state so the
// combat raycast (which resolves colliders → this wrapper) reads live values; `pos`
// is a THREE.Vector3 mirror kept at y=0 (matching the original) for the headshot
// classifier. `mesh` points at the model root (or the capsule) for hit-detection.
function _makeWrapper(st, model, capsuleMesh) {
  const bot = {
    model,
    _capsuleMesh: capsuleMesh || null,
    state: st,
    pos: new THREE.Vector3(st.pos.x, 0, st.pos.z),
    _prevAlive: st.alive,
    _prevDying: st._isDying,
    rapierBody:     null,
    rapierCollider: null,
    rapierHeadBody: null,
    rapierHeadCollider: null,
    get mesh() { return this.model ? this.model.root : this._capsuleMesh; },
    get alive() { return this.state.alive; },
    get hp() { return this.state.hp; },
  };
  return bot;
}

function _attachModelBot(st, renderKind = 'regular') {
  const model = new BotModel(renderKind);
  model.init({ x: st.pos.x, y: _footY(st.pos.x, st.pos.z), z: st.pos.z });
  const bot = _makeWrapper(st, model, null);
  bots.push(bot);
  if (physicsReady) _ensureBotColliders(bot, st.pos.x, st.pos.z);
}

// Create (or re-position) both the body capsule AND head sphere for a bot.
// Body centre  = foot + BOT_BODY_CENTRE_Y_OFFSET (0.76)
// Head  centre = foot + BOT_HEAD_CENTRE_Y_OFFSET (1.55)
function _ensureBotColliders(bot, x, z) {
  if (!physicsReady) return;
  const fy = _footY(x, z);
  if (!bot.rapierBody) {
    const h = createBotBody(bot, x, fy + BOT_BODY_CENTRE_Y_OFFSET, z);
    if (h) { bot.rapierBody = h.body; bot.rapierCollider = h.collider; }
  } else {
    setBotBodyPos(bot.rapierBody, x, fy + BOT_BODY_CENTRE_Y_OFFSET, z);
  }
  if (!bot.rapierHeadBody) {
    const h = createBotHead(bot, x, fy + BOT_HEAD_CENTRE_Y_OFFSET, z);
    if (h) { bot.rapierHeadBody = h.body; bot.rapierHeadCollider = h.collider; }
  } else {
    setBotBodyPos(bot.rapierHeadBody, x, fy + BOT_HEAD_CENTRE_Y_OFFSET, z);
  }
}

// Fallback if GLB fails — original capsule bots (still driven by the sim brain).
const _botGeo  = new THREE.CapsuleGeometry(0.35, 1.1, 4, 8);
const _colors  = [0x8b5cf6, 0xf7931a, 0x22d3ee, 0xf43f5e, 0x4ade80];
function _spawnCapsuleBots() {
  sim.spawnAll(BOT_COUNT);
  sim.bots.forEach((st, i) => {
    const mesh = new THREE.Mesh(
      _botGeo,
      new THREE.MeshStandardMaterial({ color: _colors[i % _colors.length], roughness: 0.6 })
    );
    mesh.position.set(st.pos.x, 1.15 + _footY(st.pos.x, st.pos.z), st.pos.z);
    scene.add(mesh);
    bots.push(_makeWrapper(st, null, mesh));
  });
}

export function initBotPhysics() {} // API compat

// ── Tick ──────────────────────────────────────────────────────────────────────
export function tickBots(dt) {
  if (!isPlaying()) return;
  // MP: render-only. Interpolate positions from the server's BOT_STATE stream
  // and drive animation from animHint; never run the local AI or apply damage.
  if (_netMode) { _tickNet(dt); return; }
  const pp = _playerObj.position;
  const playerState = {
    x: pp.x, y: pp.y, z: pp.z,
    outsideFence: isPlayerOutsideFence(),
    flyEnabled: isFlyEnabled(),
  };
  // The brain moves + decides for every bot; the wrapper only renders the result.
  // Single-player passes a 1-element array → byte-identical target selection.
  sim.tick(dt, [playerState]);
  bots.forEach(bot => _syncBot(bot, dt));
}

// ── MP render-only path ─────────────────────────────────────────────────────
function _botById(id) { return bots.find(b => b.state.id === id) || null; }

// Ingest a server BOT_STATE roster (throttled continuous stream OR a full
// late-join snapshot). Positions are buffered for interpolation.
export function ingestBotState(states) {
  if (!Array.isArray(states)) return;
  _botNet.ingest(states, _nowMs());
}

// A bot fired — spawn the enemy tracer bullet + play the bot-shoot cue. Mirrors
// the single-player shotCallback so the visual/audio is identical.
export function applyBotShot(originArr, dirArr) {
  if (!Array.isArray(originArr) || !Array.isArray(dirArr)) return;
  const origin = { x: originArr[0], y: originArr[1], z: originArr[2] };
  const dir = { x: dirArr[0], y: dirArr[1], z: dirArr[2] };
  if (_spawnBulletFn) _spawnBulletFn(origin, dir, false);
  playBotShoot();
}

// Server says a player's shot hit a bot — sync authoritative HP + hit flash.
export function applyBotHit(botId, hp) {
  // Fold the authoritative hp into botNetState FIRST so the next _syncNetBot
  // frame samples the event hp — not the stale pre-hit snapshot (v0.2.383 fix).
  _botNet.applyHit(botId, hp);
  const bot = _botById(botId);
  if (!bot) return;
  bot.state.hp = hp;
  bot.state._isHit = true;
  bot.state._hitTimer = 0.3;
}

// Server says a bot died — mark it dead so the render path hides it. Fold the
// kill into botNetState (sets alive=false + snaps) so the next _syncNetBot frame
// sees dead — not the stale pre-kill snapshot that would un-kill it (v0.2.383).
export function applyBotKill(botId) {
  _botNet.applyKill(botId);
  const bot = _botById(botId);
  if (bot) bot.state.alive = false;
}

function _tickNet(dt) {
  const poses = _botNet.sample(_nowMs());
  let bossPose = null;
  for (const p of poses) {
    const bot = _botById(p.id);
    if (bot) _syncNetBot(bot, p, dt);
    if (!bossPose && p.kind === 'boss') bossPose = p;
  }
  if (bossPose && bossPose.alive) {
    setBossBar({
      id: bossPose.id,
      name: bossPose.name || 'BOSS',
      hp: bossPose.hp,
      maxHp: BOSS_HP,
      alive: true,
    });
  } else {
    hideBossBar();
  }
}

function _syncNetBot(bot, pose, dt) {
  const st = bot.state;
  // Mirror the interpolated server pose into the wrapper's sim-state bag so the
  // rest of the client (HUD, headshot classifier, etc.) reads live values.
  st.pos.x = pose.x; st.pos.z = pose.z; st.rotY = pose.rotY;
  st.hp = pose.hp; st.animHint = pose.animHint;
  bot.pos.set(pose.x, 0, pose.z);
  const fy = _footY(pose.x, pose.z);
  const flags = animHintToFlags(pose.animHint);

  if (!pose.alive) {
    st.alive = false;
    if (bot.model?.loaded) {
      if (bot._prevAlive) { bot.model.updateAnim(0, false, true, false); bot._deathT = 0; } // death on transition
      // v0.2.389: restore the dramatic launch arc. The snapshot carries the
      // horizontal blowback slide (pose.x/z move as the server integrates it) but
      // NOT the vertical component, so a server-driven corpse used to stay pinned
      // to the ground. Reconstruct the arc client-side from the death clock,
      // mirroring botSim's integration (initial up-velocity 9 m/s, gravity
      // −14 m/s²): height = 9t − 7t², a ~2.9 m peak at ~0.64 s, back to ground by
      // ~1.3 s — the corpse now flies up and back across the arena as it did in SP.
      bot._deathT = (bot._deathT || 0) + dt;
      const arc = Math.max(0, 9.0 * bot._deathT - 7.0 * bot._deathT * bot._deathT);
      bot.model.syncTo(pose.x, fy + arc, pose.z, pose.rotY);
      bot.model.tick(dt);
    } else if (bot._capsuleMesh) {
      bot._capsuleMesh.visible = false;
    }
    // Park VISUAL-ONLY colliders below the floor so local bullets can't resolve
    // a hit on a dead bot (damage is server-authoritative regardless).
    if (bot.rapierBody)     setBotBodyPos(bot.rapierBody,     pose.x, -100, pose.z);
    if (bot.rapierHeadBody) setBotBodyPos(bot.rapierHeadBody, pose.x, -100, pose.z);
    bot._prevAlive = false;
    return;
  }

  st.alive = true;
  // Spawn/respawn transition — (re)create + show.
  if (!bot._prevAlive) {
    _ensureBotColliders(bot, pose.x, pose.z);
    if (bot.model?.root) { bot.model.show(); bot.model.play('Walking', true); }
    else if (bot._capsuleMesh) bot._capsuleMesh.visible = true;
  }
  if (!bot.rapierBody || !bot.rapierHeadBody) {
    _ensureBotColliders(bot, pose.x, pose.z);
  } else {
    setBotBodyPos(bot.rapierBody,     pose.x, fy + BOT_BODY_CENTRE_Y_OFFSET, pose.z);
    setBotBodyPos(bot.rapierHeadBody, pose.x, fy + BOT_HEAD_CENTRE_Y_OFFSET, pose.z);
  }

  const pPos = _playerObj.position;
  const dist = Math.hypot(pPos.x - pose.x, pPos.z - pose.z);
  const lod = getLodLevel(pose.x, pose.z, pPos.x, pPos.z);
  applyLod(bot.model, lod);
  if (bot.model?.loaded) {
    bot.model.syncTo(pose.x, fy, pose.z, pose.rotY);
    if (lod === 'full') {
      bot.model.updateAnim(dist, flags.isShooting, false, flags.isHit);
      bot.model.tick(dt);
    }
  } else if (bot._capsuleMesh && !bot.model) {
    bot._capsuleMesh.position.set(pose.x, 1.15 + fy, pose.z);
    bot._capsuleMesh.rotation.y = pose.rotY;
  }
  bot._prevAlive = true;
}

// Render one wrapper bot from its (already-ticked) sim state.
function _syncBot(bot, dt) {
  const st = bot.state;
  bot.pos.set(st.pos.x, 0, st.pos.z);

  // Dead — blowback corpse anim + hide, then wait for respawn (sim owns timers).
  if (!st.alive) {
    if (st._isDying && bot.model?.root) {
      bot.model.tick(dt);
      bot.model.syncTo(st.pos.x, st._blowY, st.pos.z, bot.model.root.rotation.y);
    }
    // Hide exactly on the frame the death anim finishes (matches the original).
    if (bot._prevDying && !st._isDying) bot.model?.hide();
    bot._prevDying = st._isDying;
    bot._prevAlive = st.alive;
    return;
  }

  // Revive transition — mirror the original _reviveBot render; the full AI tick
  // resumes next frame (the sim likewise skips movement on the revive frame).
  if (!bot._prevAlive) {
    _ensureBotColliders(bot, st.pos.x, st.pos.z);
    if (bot.model?.root) {
      bot.model.show();
      bot.model.syncTo(st.pos.x, _footY(st.pos.x, st.pos.z), st.pos.z, 0);
      bot.model.play('Walking', true);
    } else if (bot._capsuleMesh) {
      bot._capsuleMesh.position.set(st.pos.x, 1.15 + _footY(st.pos.x, st.pos.z), st.pos.z);
      bot._capsuleMesh.visible = true;
    }
    bot._prevDying = false;
    bot._prevAlive = true;
    return;
  }

  // Sync Rapier body + head colliders. Lazy-create here if missing (covers the
  // race where the GLB loaded before physics finished init). Centres ride the
  // sampled foot height + fixed body/head offsets so headshots stay aligned.
  if (!bot.rapierBody || !bot.rapierHeadBody) {
    _ensureBotColliders(bot, st.pos.x, st.pos.z);
  } else {
    const fy = _footY(st.pos.x, st.pos.z);
    setBotBodyPos(bot.rapierBody,     st.pos.x, fy + BOT_BODY_CENTRE_Y_OFFSET, st.pos.z);
    setBotBodyPos(bot.rapierHeadBody, st.pos.x, fy + BOT_HEAD_CENTRE_Y_OFFSET, st.pos.z);
  }

  const pPos = _playerObj.position;
  const dist = Math.hypot(pPos.x - st.pos.x, pPos.z - st.pos.z);

  // LOD — skip mixer on distant bots, hide very distant ones.
  const lod = getLodLevel(st.pos.x, st.pos.z, pPos.x, pPos.z);
  applyLod(bot.model, lod);

  if (bot.model?.loaded) {
    bot.model.syncTo(st.pos.x, _footY(st.pos.x, st.pos.z), st.pos.z, st.rotY);
    if (lod === 'full') {
      bot.model.updateAnim(dist, st.isShooting, false, st._isHit);
      bot.model.tick(dt);
    }
  } else if (bot._capsuleMesh && !bot.model) {
    bot._capsuleMesh.position.set(st.pos.x, 1.15 + _footY(st.pos.x, st.pos.z), st.pos.z);
    bot._capsuleMesh.rotation.y = st.rotY;
  }

  bot._prevDying = st._isDying;
  bot._prevAlive = st.alive;
}

// ── Hit / Kill ────────────────────────────────────────────────────────────────
export function hitBot(bot, dmg) {
  // MP: damage is server-authoritative (resolved via the SHOT path → BOT_HIT).
  // The client must NEVER apply local bot damage.
  if (_netMode) return;
  const pp = _playerObj ? _playerObj.position : null;
  const res = sim.hitBot(bot.state, dmg, pp);
  if (res.killed) _applyKillRender(bot);
  else emit(EV.BOT_HIT, { bot });
}

// The render + game-state side-effects of a kill (the sim only mutated the pure
// state). Death anim, park BOTH colliders far below the floor so bullets can't hit
// a dying bot, then the score/emit side-effects the brain deliberately does NOT own.
function _applyKillRender(bot) {
  const st = bot.state;
  if (bot.model?.loaded) {
    bot.model.updateAnim(0, false, true, false);
  } else if (bot.mesh) {
    bot.mesh.visible = false;
    st._isDying = false; // capsule fallback has no death anim
  }
  if (bot.rapierBody)     setBotBodyPos(bot.rapierBody,     bot.pos.x, -100, bot.pos.z);
  if (bot.rapierHeadBody) setBotBodyPos(bot.rapierHeadBody, bot.pos.x, -100, bot.pos.z);
  bot._prevAlive = false;
  bot._prevDying = st._isDying;

  state.kills++;
  state.sats += 5;
  emit(EV.BOT_KILLED, { sats: 5 });
  emit(EV.HUD_UPDATE);
}
