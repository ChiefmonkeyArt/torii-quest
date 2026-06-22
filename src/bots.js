// bots.js — spawn, AI tick, collision, kill, revive. Banker GLB via BotModel.
import * as THREE from 'three';
import { scene } from './scene.js';
import { state, PHASE } from './state.js';
import { emit, EV } from './events.js';
import { BOT_COUNT, BOT_SPEED, BOT_HP, BOT_SHOOT_CD, BOT_SIGHT, BOT_SPREAD, ARENA_HALF, CRATES, EAST_GAP_HALF } from './config.js';
import { BotModel, preloadBotModel } from './botModel.js';
import { getLodLevel, applyLod } from './lod.js';
import { PLAYER_SAFE_CORNER } from './player.js';

export const bots = [];

// Scratch — no hot-path allocations
const _toPlayer = new THREE.Vector3();
const _sep      = new THREE.Vector3();
const _shootOrigin = new THREE.Vector3();
const _shootDir    = new THREE.Vector3();

const BOT_R  = 0.4;
const EYE_Y  = 0.9; // eye/shoot height on bot

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
const _SPAWN_MARGIN = 3; // keep bots away from walls too
function _safeSpawnPos() {
  const limit = ARENA_HALF - _SPAWN_MARGIN;
  let x, z, tries = 0;
  do {
    x = (Math.random() * 2 - 1) * limit;
    z = (Math.random() * 2 - 1) * limit;
    const dx = x - PLAYER_SAFE_CORNER.x;
    const dz = z - PLAYER_SAFE_CORNER.z;
    if (dx*dx + dz*dz > PLAYER_SAFE_CORNER.radius * PLAYER_SAFE_CORNER.radius) break;
  } while (++tries < 20);
  return { x, z };
}

// ── Spawn ─────────────────────────────────────────────────────────────────────
function _spawnBot(i) {
  const { x, z } = _safeSpawnPos();

  const model = new BotModel();
  model.init({ x, y: 0, z });

  bots.push({
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
  });
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
    mesh.position.set(x, 1.15, z);
    scene.add(mesh);
    const pos = new THREE.Vector3(x, 0, z);
    bots.push({ model: null, mesh, hp: BOT_HP, alive: true,
      shootCd: Math.random() * BOT_SHOOT_CD, respawnTimer: 0,
      pos, _isHit: false, _hitTimer: 0 });
  }
}

export function initBotPhysics() {} // API compat

// ── AABB pushout — same as player.js ─────────────────────────────────────────
function _pushout(nx, nz) {
  // East wall gate gap — same opening as player.js so bots can chase through.
  nx = Math.max(-ARENA_HALF + BOT_R, nx);
  const inGap = Math.abs(nz) < EAST_GAP_HALF - BOT_R;
  if (!inGap) nx = Math.min(ARENA_HALF - BOT_R, nx);
  nz = Math.max(-ARENA_HALF + BOT_R, Math.min(ARENA_HALF - BOT_R, nz));
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
  if (state.phase !== PHASE.PLAYING) return;

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
        bot._blowY = Math.max(0, bot._blowY + bot._blowVy * dt);
        // Clamp to arena bounds
        const A = ARENA_HALF - 0.5;
        bot.pos.x = Math.max(-A, Math.min(A, bot.pos.x));
        bot.pos.z = Math.max(-A, Math.min(A, bot.pos.z));
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

    const spd = BOT_SPEED * (dist > 8 ? 1.0 : 0.75);
    const vx  = (_toPlayer.x * 0.7 + _sep.x * 0.3) * spd;
    const vz  = (_toPlayer.z * 0.7 + _sep.z * 0.3) * spd;

    const [nx, nz] = _pushout(px + vx * dt, pz + vz * dt);
    bot.pos.x = nx;
    bot.pos.z = nz;

    const rotY = Math.atan2(pp.x - nx, pp.z - nz);

    // Shooting
    let isShooting = false;
    if (dist < BOT_SIGHT) {
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
        isShooting = true;
      }
    }

    // LOD — skip mixer on distant bots, hide very distant ones
    const lod = getLodLevel(nx, nz, _playerObj.position.x, _playerObj.position.z);
    applyLod(bot.model, lod);

    // Sync model
    if (bot.model?.loaded) {
      bot.model.syncTo(nx, 0, nz, rotY);
      if (lod === 'full') {
        bot.model.updateAnim(dist, isShooting, false, bot._isHit);
        bot.model.tick(dt);
      }
    } else if (bot.mesh && !bot.model) {
      // Capsule fallback
      bot.mesh.position.set(nx, 1.15, nz);
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
    bot._blowY  = 0;   // current Y offset
  } else {
    bot._blowVx = bot._blowVz = bot._blowVy = 0;
    bot._blowY  = 0;
  }

  // Trigger death animation
  if (bot.model?.loaded) {
    bot.model.updateAnim(0, false, true, false);
  } else if (bot.mesh) {
    bot.mesh.visible = false;
    bot._isDying = false;
  }

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

  if (bot.model?.root) {
    bot.model.show();
    bot.model.syncTo(bot.pos.x, 0, bot.pos.z, 0);
    bot.model.play('Walking', true);
  } else if (bot.mesh) {
    bot.mesh.position.set(bot.pos.x, 1.15, bot.pos.z);
    bot.mesh.visible = true;
  }
}
