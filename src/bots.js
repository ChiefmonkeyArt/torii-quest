// bots.js — spawn, AI tick, collision, kill, revive. Banker GLB via BotModel.
import * as THREE from 'three';
import { scene } from './scene.js';
import { state, isPlaying } from './state.js';
import { emit, EV } from './events.js';
import { BOT_COUNT, BOT_HP, BOT_SHOOT_CD, BOT_SPREAD, CRATES, NAP_X } from './config.js';
import { playBotShoot } from './audio.js';
import { BotModel, preloadBotModel } from './botModel.js';
import { getLodLevel, applyLod } from './lod.js';
import { PLAYER_SAFE_CORNER, getPlayerCollider, isPlayerOutsideFence } from './player.js';
import { createBotBody, createBotHead, setBotBodyPos, physicsReady,
         BOT_BODY_CENTRE_Y_OFFSET, BOT_HEAD_CENTRE_Y_OFFSET } from './physics.js';
import { raycastService } from './engine/physics/raycastService.js';
import { engageSpeed, steerComponent, inEngageRange } from './engine/entities/bot-agent.js';
import { isFlyEnabled } from './engine/debug/flyCamera.js';
import { sampleArenaHeight } from './terrain/heightmap.js';
import { clampToCoastline, pointInCoastline, coastlineBounds } from './terrain/coastline.js';

export const bots = [];

// Foot ground height for a bot at arena (x,z). Stage 3 (v0.2.329): the arena is
// a raised undulating island, so a bot's feet ride sampleArenaHeight() (which
// already includes ISLAND_BASE_Y) instead of the old flat y=0. Kinematic bots
// don't gravity-settle, so we plant them on the sampled surface explicitly.
function _footY(x, z) { return sampleArenaHeight(x, z); }

// Scratch — no hot-path allocations
const _toPlayer = new THREE.Vector3();
const _sep      = new THREE.Vector3();
const _shootOrigin = new THREE.Vector3();
const _shootDir    = new THREE.Vector3();

const BOT_R  = 0.4;
const EYE_Y  = 0.9; // eye/shoot height on bot
// F4: a flying player can only be targeted below this eye altitude. player.js
// keeps playerObj.position (and the hit-capsule) under the fly eye while flying,
// so pp.y IS the flying eye Y — bots aim at it below the ceiling and can't
// acquire/shoot above it.
const FLY_TARGET_CEILING = 21;

let _spawnBulletFn = null;
let _playerObj     = null;
let _modelsReady   = false;

export function initBots(playerObj, spawnBulletFn) {
  _playerObj     = playerObj;
  _spawnBulletFn = spawnBulletFn;

  // Pre-load the shared GLB template, then spawn all bots
  preloadBotModel().then(() => {
    _modelsReady = true;
    for (let i = 0; i < BOT_COUNT; i++) _spawnBot(i);
  }).catch(err => {
    console.warn('[bots] GLB load failed, falling back to capsules:', err);
    _spawnCapsuleBots();
  });
}

// ── Safe random spawn position — never inside the player's safe corner ──────
const _SPAWN_MARGIN = 2; // keep spawns a little inside the coast
function _safeSpawnPos() {
  // Sample within the coastline's axis-aligned bounds, rejecting points outside
  // the organic polygon (v0.2.342) and inside the player's safe corner. Falls
  // back to the last sample after the retry budget (always polygon-clamped below).
  const b = coastlineBounds();
  let x = 0, z = 0, tries = 0;
  do {
    x = b.minX + Math.random() * (b.maxX - b.minX);
    z = b.minZ + Math.random() * (b.maxZ - b.minZ);
    if (!pointInCoastline(x, z)) continue;
    const dx = x - PLAYER_SAFE_CORNER.x;
    const dz = z - PLAYER_SAFE_CORNER.z;
    if (dx*dx + dz*dz > PLAYER_SAFE_CORNER.radius * PLAYER_SAFE_CORNER.radius) break;
  } while (++tries < 30);
  // Guarantee the returned point is safely inside the coast.
  const [cx, cz] = clampToCoastline(x, z, _SPAWN_MARGIN);
  return { x: cx, z: cz };
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
function _spawnBot(i) {
  const { x, z } = _safeSpawnPos();

  const model = new BotModel();
  model.init({ x, y: _footY(x, z), z });

  const bot = {
    model,
    // mesh ref for hit-detection compatibility (points to model root)
    get mesh() { return model.root; },
    hp: BOT_HP,
    alive: true,
    shootCd: Math.random() * BOT_SHOOT_CD,
    respawnTimer: 0,
    // position convenience — kept in sync with model
    pos: new THREE.Vector3(x, 0, z),
    _isHit: false,
    _hitTimer: 0,
    _isDying: false,
    _deathHideTimer: 0,
    _blowVx: 0, _blowVz: 0, _blowVy: 0, _blowY: 0,
    // Rapier hit-capsule + head sphere (created lazily after physics is ready).
    // v0.2.64: slim body capsule (hugs Banker silhouette) + separate head sphere
    // for headshot detection.
    rapierBody:     null,
    rapierCollider: null,
    rapierHeadBody: null,
    rapierHeadCollider: null,
  };
  bots.push(bot);
  if (physicsReady) _ensureBotColliders(bot, x, z);
}

// Create (or re-position) both the body capsule AND head sphere for a bot.
// Body centre  = foot + BOT_BODY_CENTRE_Y_OFFSET (0.76)
// Head  centre = foot + BOT_HEAD_CENTRE_Y_OFFSET (1.55, v0.2.128 — was 1.65)
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

// Fallback if GLB fails — original capsule bots
const _botGeo  = new THREE.CapsuleGeometry(0.35, 1.1, 4, 8);
const _colors  = [0x8b5cf6, 0xf7931a, 0x22d3ee, 0xf43f5e, 0x4ade80];
function _spawnCapsuleBots() {
  for (let i = 0; i < BOT_COUNT; i++) {
    const { x, z } = _safeSpawnPos();
    const mesh = new THREE.Mesh(
      _botGeo,
      new THREE.MeshStandardMaterial({ color: _colors[i % _colors.length], roughness: 0.6 })
    );
    mesh.position.set(x, 1.15 + _footY(x, z), z);
    scene.add(mesh);
    const pos = new THREE.Vector3(x, 0, z);
    bots.push({ model: null, mesh, hp: BOT_HP, alive: true,
      shootCd: Math.random() * BOT_SHOOT_CD, respawnTimer: 0,
      pos, _isHit: false, _hitTimer: 0 });
  }
}

export function initBotPhysics() {} // API compat

// ── AABB pushout — NAP-aware variant of the player clamp ───────────────────
function _pushout(nx, nz) {
  // Bots are LOCKED INSIDE the arena by the organic coastline polygon (v0.2.342).
  // This clamp is INDEPENDENT of the player's glass wall — kinematic bots ignore
  // physics, so the wall collider does nothing for them; the math clamp is the
  // only thing keeping them in. The full closed polygon is used (no gate gap), so
  // bots can never cross the coast — including east toward the bridge/NAP zone,
  // preserving the Non-Aggression Principle (step through the gate = peace).
  [nx, nz] = clampToCoastline(nx, nz, BOT_R);
  // Defensive: a clamp result should always be inside; if numerical edge cases
  // ever leave it outside, snap back to a known-inside point (the origin).
  if (!pointInCoastline(nx, nz)) { nx = 0; nz = 0; }
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

// ── Tick ──────────────────────────────────────────────────────────────────────
export function tickBots(dt) {
  if (!isPlaying()) return;

  bots.forEach(bot => {
    // Dead — tick blowback physics + death anim, then wait for respawn
    if (!bot.alive) {
      if (bot._isDying) {
        // Blowback physics — gravity on Y, friction on XZ
        const GRAVITY = -14; // gentler gravity = longer hang time
        const FRICTION = 0.995; // near-zero friction = full distance
        bot._blowVy += GRAVITY * dt;
        bot._blowVx *= Math.pow(FRICTION, dt * 60);
        bot._blowVz *= Math.pow(FRICTION, dt * 60);
        bot.pos.x += bot._blowVx * dt;
        bot.pos.z += bot._blowVz * dt;
        // Clamp blown-back bodies to the coastline so corpses never sail past the
        // boundary into the sea (v0.2.342).
        const [bcx, bcz] = clampToCoastline(bot.pos.x, bot.pos.z, 0.5);
        bot.pos.x = bcx;
        bot.pos.z = bcz;
        // Body rests on the raised island surface, not y=0.
        bot._blowY = Math.max(_footY(bot.pos.x, bot.pos.z), bot._blowY + bot._blowVy * dt);
        // Sync model to blown-back position
        if (bot.model?.root) {
          bot.model.tick(dt);
          bot.model.syncTo(bot.pos.x, bot._blowY, bot.pos.z, bot.model.root.rotation.y);
        }
        // Hide when anim done
        bot._deathHideTimer -= dt;
        if (bot._deathHideTimer <= 0) {
          bot._isDying = false;
          bot.model?.hide();
        }
      }
      // Wait for respawn timer regardless
      bot.respawnTimer -= dt;
      if (bot.respawnTimer <= 0) _reviveBot(bot);
      return;
    }
    // Hit flash timer
    if (bot._hitTimer > 0) {
      bot._hitTimer -= dt;
      if (bot._hitTimer <= 0) bot._isHit = false;
    }

    const px = bot.pos.x, pz = bot.pos.z;
    const pp = _playerObj.position;

    _toPlayer.set(pp.x - px, 0, pp.z - pz);
    const dist = _toPlayer.length();
    _toPlayer.normalize();

    // Bot-bot separation
    _sep.set(0, 0, 0);
    bots.forEach(o => {
      if (o === bot || !o.alive) return;
      const dx = px - o.pos.x;
      const dz = pz - o.pos.z;
      const d  = Math.sqrt(dx * dx + dz * dz);
      if (d < BOT_R * 2.5 && d > 0) { _sep.x += dx / d; _sep.z += dz / d; }
    });

    const spd = engageSpeed(dist);
    const vx  = steerComponent(_toPlayer.x, _sep.x) * spd;
    const vz  = steerComponent(_toPlayer.z, _sep.z) * spd;

    const [nx, nz] = _pushout(px + vx * dt, pz + vz * dt);
    bot.pos.x = nx;
    bot.pos.z = nz;

    // Sync Rapier body + head colliders. Lazy-create here if they're missing
    // (covers the race where bot GLB loaded before physics finished init).
    if (!bot.rapierBody || !bot.rapierHeadBody) {
      _ensureBotColliders(bot, nx, nz);
    } else {
      // Hit capsule + head sphere ride the undulating arena surface with the
      // visual model — their centres are the sampled foot height plus the fixed
      // body/head offsets (NOT a flat offset), so headshots/bodyshots stay
      // aligned to the bot as it climbs and descends the hills (v0.2.330).
      const fy = _footY(nx, nz);
      setBotBodyPos(bot.rapierBody,     nx, fy + BOT_BODY_CENTRE_Y_OFFSET, nz);
      setBotBodyPos(bot.rapierHeadBody, nx, fy + BOT_HEAD_CENTRE_Y_OFFSET, nz);
    }

    const rotY = Math.atan2(pp.x - nx, pp.z - nz);

    // Shooting — suppressed entirely when the player is in the NAP zone.
    // Bots respect the Non-Aggression Principle past the torii gate.
    let isShooting = false;
    const playerInNap = pp.x > NAP_X;
    // F4: too-high flying player is out of reach — bots can't acquire/shoot above
    // the ceiling (below it, pp.y is the fly eye and targeting proceeds normally).
    const tooHighToTarget = isFlyEnabled() && pp.y >= FLY_TARGET_CEILING;
    // Safe zone (v0.2.345): a player OUTSIDE the fence (in the 1m safe zone or on
    // the beach) is off-limits — bots neither acquire nor fire at them. Read from
    // the once-per-tick flag computed in player.js (no per-bot polygon test here).
    const playerSafe = isPlayerOutsideFence();
    // LOS gate (v0.2.105): a bot only fires when it has a clear Rapier line to
    // the player — no wall, crate or obstacle in the way. Stops bots shooting
    // through cover. Eye-to-eye segment, player capsule excluded so it doesn't
    // self-block.
    if (!tooHighToTarget && !playerSafe &&
        inEngageRange(dist, playerInNap) &&
        raycastService.lineOfSight(nx, EYE_Y, nz, pp.x, pp.y, pp.z, getPlayerCollider())) {
      bot.shootCd -= dt;
      if (bot.shootCd <= 0) {
        bot.shootCd = BOT_SHOOT_CD + Math.random() * 0.8;
        _shootOrigin.set(nx, EYE_Y, nz);
        _shootDir.set(pp.x - nx, pp.y - EYE_Y, pp.z - nz).normalize();
        // Per-axis Gaussian-ish spread — sum of two uniforms is bell-shaped, so
        // most shots land near centre but the occasional wide miss feels human.
        _shootDir.x += ((Math.random() + Math.random()) - 1) * BOT_SPREAD;
        _shootDir.y += ((Math.random() + Math.random()) - 1) * BOT_SPREAD * 0.5;
        _shootDir.z += ((Math.random() + Math.random()) - 1) * BOT_SPREAD;
        _shootDir.normalize();
        if (_spawnBulletFn) _spawnBulletFn(_shootOrigin, _shootDir, false);
        playBotShoot();
        isShooting = true;
      }
    }

    // LOD — skip mixer on distant bots, hide very distant ones
    const lod = getLodLevel(nx, nz, _playerObj.position.x, _playerObj.position.z);
    applyLod(bot.model, lod);

    // Sync model
    if (bot.model?.loaded) {
      bot.model.syncTo(nx, _footY(nx, nz), nz, rotY);
      if (lod === 'full') {
        bot.model.updateAnim(dist, isShooting, false, bot._isHit);
        bot.model.tick(dt);
      }
    } else if (bot.mesh && !bot.model) {
      // Capsule fallback
      bot.mesh.position.set(nx, 1.15 + _footY(nx, nz), nz);
      bot.mesh.rotation.y = rotY;
    }
  });
}

// ── Hit / Kill / Revive ───────────────────────────────────────────────────────
export function hitBot(bot, dmg) {
  bot.hp -= dmg;
  bot._isHit    = true;
  bot._hitTimer = 0.3;
  if (bot.hp <= 0) killBot(bot);
  else emit(EV.BOT_HIT, { bot });
}

export function killBot(bot) {
  bot.alive     = false;
  bot._isHit    = false;
  bot._isDying  = true;  // still ticking for death anim + blowback
  bot._deathHideTimer = 2.67; // exact Shot_and_Blown_Back duration

  // Blowback velocity — away from player, strong horizontal impulse
  if (_playerObj) {
    const pp = _playerObj.position;
    const dx = bot.pos.x - pp.x;
    const dz = bot.pos.z - pp.z;
    const len = Math.sqrt(dx*dx + dz*dz) || 1;
    const BLOWBACK = 28; // units/sec — flies across the arena
    bot._blowVx = (dx / len) * BLOWBACK;
    bot._blowVz = (dz / len) * BLOWBACK;
    bot._blowVy = 9.0; // strong upward arc
    bot._blowY  = _footY(bot.pos.x, bot.pos.z); // current foot Y (island surface)
  } else {
    bot._blowVx = bot._blowVz = bot._blowVy = 0;
    bot._blowY  = _footY(bot.pos.x, bot.pos.z);
  }

  // Trigger death animation
  if (bot.model?.loaded) {
    bot.model.updateAnim(0, false, true, false);
  } else if (bot.mesh) {
    bot.mesh.visible = false;
    bot._isDying = false;
  }

  // Park BOTH colliders far below the floor so bullets can't hit a dying bot.
  // Cheaper than removing/recreating each respawn.
  if (bot.rapierBody)     setBotBodyPos(bot.rapierBody,     bot.pos.x, -100, bot.pos.z);
  if (bot.rapierHeadBody) setBotBodyPos(bot.rapierHeadBody, bot.pos.x, -100, bot.pos.z);

  state.kills++;
  state.sats += 5;
  bot.respawnTimer = 8.0;
  emit(EV.BOT_KILLED, { sats: 5 });
  emit(EV.HUD_UPDATE);
}

function _reviveBot(bot) {
  bot.alive    = true;
  bot.hp       = BOT_HP;
  bot._isHit   = false;
  bot._isDying = false;
  bot._blowVx  = bot._blowVz = bot._blowVy = bot._blowY = 0;
  const { x: rx, z: rz } = _safeSpawnPos();
  bot.pos.set(rx, 0, rz);
  // Lazy-create or re-position BOTH colliders.
  _ensureBotColliders(bot, rx, rz);

  if (bot.model?.root) {
    bot.model.show();
    bot.model.syncTo(bot.pos.x, _footY(bot.pos.x, bot.pos.z), bot.pos.z, 0);
    bot.model.play('Walking', true);
  } else if (bot.mesh) {
    bot.mesh.position.set(bot.pos.x, 1.15 + _footY(bot.pos.x, bot.pos.z), bot.pos.z);
    bot.mesh.visible = true;
  }
}
