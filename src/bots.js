// bots.js — thin render/collider/audio/LOD wrapper around the PURE headless bot
// AI in engine/entities/botSim.js (v0.2.376-alpha).
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
import { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, OBSTACLES, NAP_X } from './config.js';
import { playBotShoot } from './audio.js';
import { BotModel, preloadBotModel } from './botModel.js';
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

export const bots = [];

// Foot ground height for a bot at arena (x,z). Stage 3 (v0.2.329): the arena is a
// raised undulating island, so a bot's feet ride sampleArenaHeight() (which already
// includes ISLAND_BASE_Y). Kinematic bots don't gravity-settle, so we plant them
// on the sampled surface explicitly.
function _footY(x, z) { return sampleArenaHeight(x, z); }

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
  config: { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, CRATES, NAP_X },
  playerSafeCorner: PLAYER_SAFE_CORNER,
  shotCallback: (origin, dir) => {
    if (_spawnBulletFn) _spawnBulletFn(origin, dir, false);
    playBotShoot();
  },
  getPlayerCollider,
});

export function initBots(playerObj, spawnBulletFn) {
  _playerObj     = playerObj;
  _spawnBulletFn = spawnBulletFn;

  // Pre-load the shared GLB template, then spawn all bots (sim owns spawn logic;
  // this wrapper attaches a model + colliders to each resulting sim state).
  preloadBotModel().then(() => {
    _modelsReady = true;
    sim.spawnAll(BOT_COUNT);
    sim.bots.forEach(st => _attachModelBot(st));
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

function _attachModelBot(st) {
  const model = new BotModel();
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
  const pp = _playerObj.position;
  const playerState = {
    x: pp.x, y: pp.y, z: pp.z,
    outsideFence: isPlayerOutsideFence(),
    flyEnabled: isFlyEnabled(),
  };
  // The brain moves + decides for every bot; the wrapper only renders the result.
  sim.tick(dt, playerState);
  bots.forEach(bot => _syncBot(bot, dt));
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
