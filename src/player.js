// player.js — movement, shoot, reload, death/respawn
import * as THREE from 'three';
import { state, PHASE, resetRun } from './state.js';
import { emit, EV } from './events.js';
import { keys, getYaw, getPitch, setYaw, onKeyDown, onShoot, requestLock } from './input.js';
import { scene, camera } from './scene.js';
import { stepPhysics, createKinematic, physicsReady } from './physics.js';
import { getGunBarrelWorld } from './weapons.js';
import { PLAYER_HP, PLAYER_SPEED, MAX_AMMO, RELOAD_TIME, SHOOT_CD, RESPAWN_TIME, ARENA_HALF, CRATES, JUMP_FORCE, GRAVITY, godMode, EAST_GAP_HALF } from './config.js';



export const playerObj = new THREE.Object3D();
playerObj.add(camera);
scene.add(playerObj);

// Scratch — never allocate in hot path
const _fwd   = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move  = new THREE.Vector3();

let _body = null;
let _vy = 0;          // vertical velocity (m/s)
let _onGround = false;
let _recoilTimer = 0;
const RECOIL_DUR = 0.08;

export function initPlayer() {
  playerObj.position.set(0, 1.7, 0);

  onKeyDown(code => {
    if (state.phase !== PHASE.PLAYING) return;
    if (code === 'KeyR') startReload();
    if ((code === 'Space' || code === 'KeyE') && _onGround) {
      _vy = JUMP_FORCE;
      _onGround = false;
    }
  });

  onShoot(() => {
    if (state.phase === PHASE.PLAYING) shoot();
  });
}

export function setPlayerBody(body) { _body = body; }

// Safe respawn corner — southwest (-X,-Z), opposite the torii gate (east) and furthest from bots
const SPAWN_X = -14;
const SPAWN_Z = -14;
const SPAWN_Y =  1.7;
export const PLAYER_SAFE_CORNER = { x: SPAWN_X, z: SPAWN_Z, radius: 6 }; // bots stay out

export function spawnPlayerBody() {
  return createKinematic(SPAWN_X, SPAWN_Y, SPAWN_Z);
}

// Spawn yaw: face NE into arena from SW corner (-14,-14) toward centre (0,0).
// Three.js fwd = (-sin(yaw), 0, -cos(yaw)). Need fwd=(+0.707,0,+0.707).
// => sin(yaw)=-0.707, cos(yaw)=-0.707 => yaw = -3*PI/4
const SPAWN_YAW = -3 * Math.PI / 4;

// Dynamic spawn — overridden by main.js before respawn if a better spot is found
let _spawnX = SPAWN_X, _spawnZ = SPAWN_Z, _spawnYaw = SPAWN_YAW;
export function setNextSpawn(x, z, yaw) { _spawnX = x; _spawnZ = z; _spawnYaw = yaw; }

export function resetPlayerPos() {
  playerObj.position.set(_spawnX, SPAWN_Y, _spawnZ);
  if (_body) _body.setTranslation({x:_spawnX, y:SPAWN_Y, z:_spawnZ}, true);
  setYaw(_spawnYaw);
  // Update safe-corner so bots stay clear of the new spawn point
  PLAYER_SAFE_CORNER.x = _spawnX;
  PLAYER_SAFE_CORNER.z = _spawnZ;
}

export function tickPlayer(dt) {
  if (state.phase !== PHASE.PLAYING) return;

  // Rotation from input
  playerObj.rotation.y = getYaw();
  camera.rotation.x   = getPitch();

  // Movement
  _fwd.set(-Math.sin(getYaw()), 0, -Math.cos(getYaw()));
  _right.set(Math.cos(getYaw()), 0, -Math.sin(getYaw()));
  _move.set(0, 0, 0);

  if (keys['KeyW'] || keys['ArrowUp'])    _move.addScaledVector(_fwd,   1);
  if (keys['KeyS'] || keys['ArrowDown'])  _move.addScaledVector(_fwd,  -1);
  if (keys['KeyA'] || keys['ArrowLeft'])  _move.addScaledVector(_right,-1);
  if (keys['KeyD'] || keys['ArrowRight']) _move.addScaledVector(_right, 1);

  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(PLAYER_SPEED);

  const PR  = 0.4;   // player XZ radius
  const EYE = 1.7;   // eye offset above foot

  // --- Gravity + vertical ---
  _vy += GRAVITY * dt;
  const cx = playerObj.position;
  let ny = cx.y + _vy * dt;
  let nx = cx.x + _move.x * dt;
  let nz = cx.z + _move.z * dt;

  // Arena wall clamp XZ. East wall has a gate gap centred on z=0 — only
  // block the east plane when the player is outside that opening.
  nx = Math.max(-ARENA_HALF + PR, nx);
  const inGap = Math.abs(nz) < EAST_GAP_HALF - PR;
  if (!inGap) nx = Math.min(ARENA_HALF - PR, nx);
  nz = Math.max(-ARENA_HALF + PR, Math.min(ARENA_HALF - PR, nz));

  // Default ground
  _onGround = false;
  if (ny <= EYE) { ny = EYE; _vy = 0; _onGround = true; }

  // Per-crate AABB: top landing + side pushout.
  // Run twice so corner cases resolve after a first-pass pushout.
  for (let pass = 0; pass < 2; pass++) {
    for (const [cx2, cz2, hw, hd, ch] of CRATES) {
      const footY  = ny - EYE;
      const dX     = nx - cx2;
      const dZ     = nz - cz2;
      const overlapX = hw + PR - Math.abs(dX);
      const overlapZ = hd + PR - Math.abs(dZ);
      if (overlapX <= 0 || overlapZ <= 0) continue; // no XZ overlap

      if (footY >= ch - 0.05 && _vy <= 0) {
        // Standing/landing on top of crate
        ny = ch + EYE;
        _vy = 0;
        _onGround = true;
      } else if (footY < ch) {
        // Inside crate column — push out on the smallest penetration axis
        if (overlapX <= overlapZ) {
          nx += dX >= 0 ?  overlapX : -overlapX;
        } else {
          nz += dZ >= 0 ?  overlapZ : -overlapZ;
        }
      }
    }
  }

  playerObj.position.set(nx, ny, nz);
  if (_body) _body.setNextKinematicTranslation({ x: nx, y: ny, z: nz });

  // Reload tick
  if (state.reloading) {
    state.reloadTimer -= dt;
    if (state.reloadTimer <= 0) {
      state.reloading = false;
      state.ammo = MAX_AMMO;
      emit(EV.HUD_UPDATE);
    }
  }
  if (state.shootCd > 0) state.shootCd -= dt;

  // Recoil timer
  if (_recoilTimer > 0) _recoilTimer = Math.max(0, _recoilTimer - dt);
}

export function getRecoilT() { return _recoilTimer / RECOIL_DUR; }

const _shootOrigin = new THREE.Vector3();
const _shootDir    = new THREE.Vector3();

export function shoot() {
  if (state.shootCd > 0 || state.reloading || state.ammo <= 0) return null;
  state.ammo--;
  state.shootCd = SHOOT_CD;
  _recoilTimer  = RECOIL_DUR;
  camera.getWorldDirection(_shootDir);
  // Bullet spawns from barrel tip in world space
  _shootOrigin.copy(getGunBarrelWorld(camera));
  // Direction: straight toward crosshair (camera forward = screen centre)
  // but we nudge origin so bullet actually travels from barrel to where you're aiming
  emit(EV.SHOOT, { origin: _shootOrigin.clone(), dir: _shootDir.clone() });
  emit(EV.HUD_UPDATE);
  if (state.ammo === 0) startReload();
}

export function startReload() {
  if (state.reloading || state.ammo === MAX_AMMO) return;
  state.reloading   = true;
  state.reloadTimer = RELOAD_TIME;
  emit(EV.HUD_UPDATE);
}

export function takeDamage(dmg) {
  if (godMode) return;
  state.hp = Math.max(0, state.hp - dmg);
  emit(EV.PLAYER_HIT, { dmg });
  emit(EV.HUD_UPDATE);
  if (state.hp <= 0) killPlayer();
}

export function killPlayer() {
  if (state.phase !== PHASE.PLAYING) return;
  state.phase = PHASE.DEAD;
  state.deaths++;
  state.respawnTimer = RESPAWN_TIME;
  emit(EV.PLAYER_KILLED);
}

export function tickDeath(dt, renderer) {
  if (state.phase !== PHASE.DEAD) return;
  state.respawnTimer -= dt;
  if (state.respawnTimer <= 0) {
    state.hp = PLAYER_HP;
    state.ammo = MAX_AMMO;
    state.reloading = false;
    resetPlayerPos();
    state.phase = PHASE.PLAYING;
    emit(EV.PLAYER_RESPAWN);
    emit(EV.HUD_UPDATE);
    requestLock(renderer.domElement);
  }
}
