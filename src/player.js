// player.js — movement, shoot, reload, death/respawn
import * as THREE from 'three';
import { state, isPlaying, isDead, transition, GAME_EVENT, canShoot, canReload, tickReload } from './state.js';
import { emit, EV } from './events.js';
import { keys, getYaw, getPitch, setYaw, onKeyDown, onShoot, requestLock } from './input.js';
import { scene, camera } from './scene.js';
import { stepPhysics, createKinematic, movePlayer, physicsReady } from './physics.js';
// v0.2.132 (ARS-3) — crosshair/aim ray goes through the RaycastService facade
// (same default Rapier impl as before, behaviour-identical).
import { raycastService } from './engine/physics/raycastService.js';
import { getGunBarrelWorld } from './weapons.js';
import { crosshairPoint, aimDirection, CONVERGE_DIST } from './engine/combat/aim.js';
import { playReload } from './audio.js';
import { PLAYER_HP, PLAYER_SPEED, MAX_AMMO, RELOAD_TIME, SHOOT_CD, RESPAWN_TIME, ARENA_HALF, JUMP_FORCE, GRAVITY, godMode, NAP_X, NAP_FAR_X } from './config.js';
// Player entity boundary (v0.2.114): geometry, spawn shape, and look-down POV
// math live here now. PLAYER_SAFE_CORNER is re-exported below so bots.js can keep
// importing it from player.js.
import {
  EYE, BODY_FROM_EYE,
  SPAWN_X, SPAWN_Y, SPAWN_Z, SPAWN_YAW,
  PLAYER_SAFE_CORNER,
  lookDownEyeY, lookDownEyeZ,
  forwardX, forwardZ, rightX, rightZ,
} from './engine/entities/player.js';

export { PLAYER_SAFE_CORNER, SPAWN_X, SPAWN_Z, SPAWN_YAW };
// Re-export the pure respawn-corner picker so arenaRuntime imports it from the same
// player module as setNextSpawn (it is owned by the player entity boundary).
export { pickRespawnCorner } from './engine/entities/player.js';


export const playerObj = new THREE.Object3D();
playerObj.add(camera);
scene.add(playerObj);

// Scratch — never allocate in hot path
const _fwd   = new THREE.Vector3();
const _right = new THREE.Vector3();
const _move  = new THREE.Vector3();

let _body = null;
let _collider = null;
let _vy = 0;          // vertical velocity (m/s)
let _onGround = false;
let _recoilTimer = 0;
const RECOIL_DUR = 0.08;

export function initPlayer() {
  playerObj.position.set(0, 1.7, 0);

  onKeyDown(code => {
    if (!isPlaying()) return;
    if (code === 'KeyR') startReload();
    if ((code === 'Space' || code === 'KeyE') && _onGround) {
      _vy = JUMP_FORCE;
      _onGround = false;
    }
  });

  onShoot(() => {
    if (isPlaying()) shoot();
  });
}

export function setPlayerBody(handle) {
  if (!handle) { _body = null; _collider = null; return; }
  _body = handle.body;
  _collider = handle.collider;
}

// Expose player collider so the bullet raycast can exclude it (so player
// bullets never self-hit the player's own capsule). Returns null until
// physics is ready and setPlayerBody has been called from main.js.
export function getPlayerCollider() { return _collider; }

export function spawnPlayerBody() {
  // Body is placed at capsule CENTRE, not eye. visual eye y = SPAWN_Y (1.7);
  // body centre y = SPAWN_Y + BODY_FROM_EYE = 0.9.
  return createKinematic(SPAWN_X, SPAWN_Y + BODY_FROM_EYE, SPAWN_Z);
}

// Dynamic spawn — overridden by main.js before respawn if a better spot is found
let _spawnX = SPAWN_X, _spawnZ = SPAWN_Z, _spawnYaw = SPAWN_YAW;
export function setNextSpawn(x, z, yaw) { _spawnX = x; _spawnZ = z; _spawnYaw = yaw; }

export function resetPlayerPos() {
  playerObj.position.set(_spawnX, SPAWN_Y, _spawnZ);
  if (_body) _body.setTranslation({x:_spawnX, y:SPAWN_Y + BODY_FROM_EYE, z:_spawnZ}, true);
  _vy = 0;
  _onGround = true;
  setYaw(_spawnYaw);
  // Update safe-corner so bots stay clear of the new spawn point
  PLAYER_SAFE_CORNER.x = _spawnX;
  PLAYER_SAFE_CORNER.z = _spawnZ;
}

export function tickPlayer(dt) {
  if (!isPlaying()) return;

  // Rotation from input
  playerObj.rotation.y = getYaw();
  const pitch = getPitch();             // 0 level, → -PI/2 looking straight down
  camera.rotation.x   = pitch;

  // Neck-pivot look-down arc (v0.2.112), now sourced from the player boundary
  // (engine/entities/player.js). Allocation-free scalar helpers; same formula.
  camera.position.y = lookDownEyeY(pitch);
  camera.position.z = lookDownEyeZ(pitch);

  // Movement — heading basis sourced from the player boundary
  // (engine/entities/player.js). Allocation-free scalars; same formula.
  const yaw = getYaw();
  _fwd.set(forwardX(yaw), 0, forwardZ(yaw));
  _right.set(rightX(yaw), 0, rightZ(yaw));
  _move.set(0, 0, 0);

  if (keys['KeyW'] || keys['ArrowUp'])    _move.addScaledVector(_fwd,   1);
  if (keys['KeyS'] || keys['ArrowDown'])  _move.addScaledVector(_fwd,  -1);
  if (keys['KeyA'] || keys['ArrowLeft'])  _move.addScaledVector(_right,-1);
  if (keys['KeyD'] || keys['ArrowRight']) _move.addScaledVector(_right, 1);

  if (_move.lengthSq() > 0) _move.normalize().multiplyScalar(PLAYER_SPEED);

  // --- Rapier kinematic character controller (v0.2.61-alpha Phase 1) ---
  // Replaces the manual AABB pushout. We compute the *desired* delta (XZ from
  // input, Y from gravity), hand it to Rapier, and it returns the corrected
  // delta after sliding against walls, crates, obstacles, and the floor.
  _vy += GRAVITY * dt;
  const desiredDX = _move.x * dt;
  const desiredDY = _vy   * dt;
  const desiredDZ = _move.z * dt;

  if (_collider && _body) {
    const result = movePlayer(_collider, desiredDX, desiredDY, desiredDZ);

    // Kinematic bodies move via setNextKinematicTranslation, NOT setTranslation,
    // so Rapier can resolve contacts with dynamic bodies in future phases.
    const t  = _body.translation();
    const bx = t.x + result.dx;
    const by = t.y + result.dy;
    const bz = t.z + result.dz;
    _body.setNextKinematicTranslation({ x: bx, y: by, z: bz });

    // Visual follows body: eye sits BODY_FROM_EYE below the capsule centre.
    playerObj.position.set(bx, by - BODY_FROM_EYE, bz);

    _onGround = result.grounded;
    if (_onGround && _vy < 0) _vy = 0;
  } else {
    // Pre-physics fallback during the ~100ms Rapier init window.
    playerObj.position.x += desiredDX;
    playerObj.position.z += desiredDZ;
    playerObj.position.y  = EYE;
    _vy = 0; _onGround = true;
  }

  // NAP-zone z-clamp — there are no walls past the gate, so Rapier won't
  // bound z out there. Clamp the visual + body to arena width so the player
  // can't drift into the void around the bonsai tree.
  if (playerObj.position.x > NAP_X) {
    const zClamped = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, playerObj.position.z));
    if (zClamped !== playerObj.position.z) {
      playerObj.position.z = zClamped;
      if (_body) {
        const t2 = _body.translation();
        _body.setNextKinematicTranslation({ x: t2.x, y: t2.y, z: zClamped });
      }
    }
  }

  // Arena boundary + fall-hole safety net (v0.2.104). Rapier occasionally lets
  // the capsule squeeze past a wall seam or drop through a collider gap. If the
  // body falls below the floor, respawn; otherwise hard-clamp X/Z to the legal
  // play area (arena + NAP corridor) so the player can never end up in the void.
  if (_body) {
    const t = _body.translation();
    if (t.y < -2) {
      resetPlayerPos();
    } else {
      const cx = Math.max(-19.5, Math.min(44.5, t.x));
      const cz = Math.max(-19.5, Math.min(19.5, t.z));
      if (cx !== t.x || cz !== t.z) {
        _body.setNextKinematicTranslation({ x: cx, y: t.y, z: cz });
        playerObj.position.set(cx, t.y - BODY_FROM_EYE, cz);
      }
    }
  }

  // Reload tick — the timer/refill now lives in state.tickReload (ARS-4 fold);
  // it returns true on the frame the reload completes so we emit the HUD update.
  if (tickReload(dt)) emit(EV.HUD_UPDATE);
  if (state.shootCd > 0) state.shootCd -= dt;

  // Recoil timer
  if (_recoilTimer > 0) _recoilTimer = Math.max(0, _recoilTimer - dt);
}

export function getRecoilT() { return _recoilTimer / RECOIL_DUR; }

const _shootOrigin     = new THREE.Vector3();
const _shootDir        = new THREE.Vector3();
const _camFwd          = new THREE.Vector3();
const _camPos          = new THREE.Vector3();
const _aimPoint        = new THREE.Vector3();
// Camera ray reach (m) used to find what the crosshair is on. Matches the
// reticle/diagnostic range so the bullet aims through the same target the
// reticle previews.
const AIM_RANGE = 80;

export function shoot() {
  if (!canShoot()) return null;
  state.ammo--;
  state.shootCd = SHOOT_CD;
  _recoilTimer  = RECOIL_DUR;

  // Camera forward + position = the crosshair's true aim line in world space.
  camera.getWorldDirection(_camFwd);
  _camPos.setFromMatrixPosition(camera.matrixWorld);

  // v0.2.126 — barrel-origin projectile aimed THROUGH the crosshair. The bullet
  // starts at the gun's actual muzzle, but it flies toward the point the
  // crosshair is on, so the shot stays honest at every range. We find that
  // point by casting the camera/crosshair ray: its first hit is what the reticle
  // is previewing; if it hits nothing we fall back to a convergence point.
  // Then the bullet direction is barrel → that point, so the projectile passes
  // through the exact spot the reticle classified (a previewed headshot lands as
  // a headshot) without pretending the muzzle sits at the camera (the v0.2.125
  // camera-origin experiment, now retired — it moved the muzzle off the gun).
  const aimHit = raycastService.ray(
    _camPos.x, _camPos.y, _camPos.z,
    _camFwd.x, _camFwd.y, _camFwd.z,
    AIM_RANGE, _collider || null,
  );
  const aimDist = aimHit ? aimHit.toi : CONVERGE_DIST;
  crosshairPoint(_camPos.x, _camPos.y, _camPos.z, _camFwd.x, _camFwd.y, _camFwd.z, aimDist, _aimPoint);

  // Bullet ORIGIN = gun barrel/muzzle world position.
  _shootOrigin.copy(getGunBarrelWorld(camera));
  // Bullet DIRECTION = barrel → crosshair target point (camera forward fallback).
  aimDirection(
    _shootOrigin.x, _shootOrigin.y, _shootOrigin.z,
    _aimPoint.x, _aimPoint.y, _aimPoint.z,
    _camFwd.x, _camFwd.y, _camFwd.z,
    _shootDir,
  );

  // aimOrigin/aimDir = the CAMERA crosshair line (what the reticle is on);
  // origin/dir = the bullet line (barrel → crosshair target). Both travel on
  // EV.SHOOT so the v0.2.124 shot diagnostics honestly compare the two paths.
  emit(EV.SHOOT, {
    origin: _shootOrigin.clone(), dir: _shootDir.clone(),
    aimOrigin: _camPos.clone(), aimDir: _camFwd.clone(),
  });
  emit(EV.HUD_UPDATE);
  if (state.ammo === 0) startReload();
}

export function startReload() {
  if (!canReload()) return;
  state.reloading   = true;
  state.reloadTimer = RELOAD_TIME;
  playReload();
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
  // PLAYING → DEAD; no-op (early return) from any other phase, exactly as the
  // old `if (phase !== PLAYING) return;` guard did.
  if (!transition(GAME_EVENT.DIE)) return;
  state.deaths++;
  state.respawnTimer = RESPAWN_TIME;
  emit(EV.PLAYER_KILLED);
}

export function tickDeath(dt, renderer) {
  if (!isDead()) return;
  state.respawnTimer -= dt;
  if (state.respawnTimer <= 0) {
    state.hp = PLAYER_HP;
    state.ammo = MAX_AMMO;
    state.reloading = false;
    resetPlayerPos();
    transition(GAME_EVENT.RESPAWN); // DEAD → PLAYING
    emit(EV.PLAYER_RESPAWN);
    emit(EV.HUD_UPDATE);
    requestLock(renderer.domElement);
  }
}
