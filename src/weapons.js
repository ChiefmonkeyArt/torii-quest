// weapons.js — bullet pool, FP gun viewmodel, world gun (mirror) on RightHand bone,
// hit detection (bots + walls/crates). Impact FX lives in fx.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene, gunScene } from './scene.js';
import { BULLET_SPEED, BULLET_LIFE, ARENA_HALF, WALL_H } from './config.js';
import { spawnSpark, spawnRicochet, tickFx } from './fx.js';
import { sweepWalls, sweepCrates, impactPos as _impactPos, impactNrm as _impactNrm } from './bulletCollision.js';

// ── Bullet pool ──────────────────────────────────────────────────────────────
const _pool   = [];
const _active = [];
const _geo    = new THREE.CylinderGeometry(0.06, 0.02, 0.4, 6);
const _matP   = new THREE.MeshBasicMaterial({ color: 0xffffff });
const _matB   = new THREE.MeshBasicMaterial({ color: 0xff6600 });
const _bUp    = new THREE.Vector3(0,1,0);
const _bQ     = new THREE.Quaternion();
const _bN     = new THREE.Vector3();

export function spawnBullet(origin, dir, isPlayer) {
  let b = _pool.pop();
  if (!b) b = { mesh: new THREE.Mesh(_geo, _matP), vel: new THREE.Vector3(), prev: new THREE.Vector3(), life: 0, isPlayer };
  b.isPlayer = isPlayer;
  b.life = BULLET_LIFE;
  b.mesh.material = isPlayer ? _matP : _matB;
  b.mesh.position.copy(origin);
  b.prev.copy(origin);
  _bN.copy(dir).normalize();
  _bQ.setFromUnitVectors(_bUp, _bN);
  b.mesh.quaternion.copy(_bQ);
  b.vel.copy(_bN).multiplyScalar(BULLET_SPEED);
  b.mesh.visible = true;
  scene.add(b.mesh);
  _active.push(b);
  return b;
}

// ── Object-collision (swept) ─────────────────────────────────────────────────
// Helpers live in bulletCollision.js. _impactPos/_impactNrm are scratch
// vectors re-exported from that module — read after a successful sweep test.
const _reflDir       = new THREE.Vector3();
const _bodyBurstNrm  = new THREE.Vector3();


// ── Hit callbacks — set by main.js ───────────────────────────────────────────
let _onPlayerHit = null;
let _bots        = null;

export function initWeapons(bots, onPlayerHit) {
  _bots = bots;
  _onPlayerHit = onPlayerHit;
  _buildGun();
}

export function tickWeapons(dt, playerPos) {
  for (let i = _active.length-1; i >= 0; i--) {
    const b = _active[i];
    b.prev.copy(b.mesh.position);
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;

    let remove = b.life <= 0 || b.mesh.position.y < 0;

    if (!remove) {
      // 1. Bot hit
      if (b.isPlayer && _bots) {
        for (const bot of _bots) {
          if (!bot.alive) continue;
          const bp = bot.pos || bot.mesh?.position;
          if (!bp) continue;
          const bx = b.mesh.position.x - bp.x;
          const bz = b.mesh.position.z - bp.z;
          const by = b.mesh.position.y;
          const xzSq = bx*bx + bz*bz;
          if (xzSq < 0.20 && by >= -0.1 && by <= 1.95) {
            // Body-hit burst sprays back toward the shooter.
            _bodyBurstNrm.copy(b.vel).normalize().negate();
            spawnSpark(b.mesh.position, _bodyBurstNrm);
            if (window._onBotHit) window._onBotHit(bot, 3);
            remove = true; break;
          }
        }
      }

      // 2. Player hit
      if (!remove && !b.isPlayer && _onPlayerHit) {
        if (b.mesh.position.distanceToSquared(playerPos) < 0.5) {
          _onPlayerHit(12);
          remove = true;
        }
      }

      // 3. Wall / crate — swept segment test, applies to player AND bot bullets.
      // Catches fast bullets that would otherwise tunnel through thin walls.
      if (!remove && (sweepWalls(b) || sweepCrates(b))) {
        // Burst sprays outward along the surface normal; ricochet uses the
        // reflected vector (fx.js adds its own jitter).
        spawnSpark(_impactPos, _impactNrm);
        const dot = b.vel.dot(_impactNrm);
        _reflDir.copy(b.vel).addScaledVector(_impactNrm, -2 * dot).normalize();
        spawnRicochet(_impactPos, _reflDir);
        remove = true;
      }
    }

    // Safety net for out-of-bounds bullets
    if (!remove && (Math.abs(b.mesh.position.x) > ARENA_HALF + 2 ||
                    Math.abs(b.mesh.position.z) > ARENA_HALF + 2 ||
                    b.mesh.position.y > WALL_H + 4)) {
      remove = true;
    }

    if (remove) {
      scene.remove(b.mesh);
      b.mesh.visible = false;
      _pool.push(b);
      _active[i] = _active[_active.length-1]; _active.pop();
    }
  }
  tickFx(dt);
  _tickGun(dt);
}

// ── FP gun viewmodel (gunScene — always rendered on top) ─────────────────────
const _barrelWorld = new THREE.Vector3();
let _gunMesh   = null;
let _gunPlaceholder = null;
let _recoilTimer = 0;

// FP gun rest position — brought further into player's view in v0.2.48.
// Closer to camera (less negative Z) and pushed up so more body is visible.
const FP_REST_X = 0.22;
const FP_REST_Y = -0.10;
const FP_REST_Z = -0.24;

function _buildGun() {
  _gunPlaceholder = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.8 })
  );
  _gunPlaceholder.position.set(FP_REST_X, FP_REST_Y, FP_REST_Z);
  gunScene.add(_gunPlaceholder);

  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  loader.load('/gun-steampunk.glb', gltf => {
    _gunMesh = gltf.scene;
    // Auto-scale: fit within 0.34m bounding box (was 0.25 — bigger = closer feel)
    const bbox = new THREE.Box3().setFromObject(_gunMesh);
    const maxDim = Math.max(
      bbox.max.x - bbox.min.x,
      bbox.max.y - bbox.min.y,
      bbox.max.z - bbox.min.z
    ) || 1;
    _gunMesh.scale.setScalar(0.34 / maxDim);
    _gunMesh.position.set(FP_REST_X, FP_REST_Y, FP_REST_Z);
    _gunMesh.rotation.set(0, -Math.PI/2, 0);
    gunScene.add(_gunMesh);
    gunScene.remove(_gunPlaceholder);

    // Also build the world-gun copy now that the GLB is decoded.
    _buildWorldGun(gltf.scene);
  });
}

export function triggerRecoil() { _recoilTimer = 0.08; }

const _bFwd   = new THREE.Vector3();
const _bRight = new THREE.Vector3();
const _bUp2   = new THREE.Vector3();

// Returns barrel tip in world space (used to spawn bullets from the gun barrel).
export function getGunBarrelWorld(mainCamera) {
  mainCamera.getWorldPosition(_barrelWorld);
  _bFwd  .set(0, 0, -1).applyQuaternion(mainCamera.quaternion);
  _bRight.set(1, 0,  0).applyQuaternion(mainCamera.quaternion);
  _bUp2  .set(0, 1,  0).applyQuaternion(mainCamera.quaternion);
  _barrelWorld.addScaledVector(_bFwd,   0.30);
  _barrelWorld.addScaledVector(_bRight, 0.12);
  _barrelWorld.addScaledVector(_bUp2,  -0.10);
  return _barrelWorld;
}

function _tickGun(dt) {
  if (_recoilTimer <= 0) return;
  _recoilTimer = Math.max(0, _recoilTimer - dt);
  const kick = (_recoilTimer / 0.08) * 0.05;
  const mesh = _gunMesh || _gunPlaceholder;
  if (mesh) mesh.position.z = FP_REST_Z + kick;
}

// ── World gun — clone attached to RightHand bone for mirror visibility ───────
// Layer 1 (same as the player body) so it's hidden from the FP camera but
// visible in the mirror's reflection camera.
let _worldGunSrc   = null;
let _worldGun      = null;
let _rightHandBone = null;

function _buildWorldGun(srcScene) {
  _worldGunSrc = srcScene;
  if (_rightHandBone && !_worldGun) _attachWorldGun();
}

export function setRightHandBone(bone) {
  _rightHandBone = bone;
  if (_worldGunSrc && !_worldGun) _attachWorldGun();
}

function _attachWorldGun() {
  _worldGun = _worldGunSrc.clone(true);
  // Bone-local placement — small offset positions the grip in the hand and
  // orients the barrel away from the wrist.
  _worldGun.scale.setScalar(0.5);
  _worldGun.position.set(0.04, 0.01, 0.06);
  _worldGun.rotation.set(0, Math.PI / 2, Math.PI / 2);
  _worldGun.traverse(o => {
    if (o.isMesh) {
      o.layers.set(1);
      o.frustumCulled = false;
      o.castShadow = true;
      if (o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          m.transparent = false;
          m.depthWrite  = true;
          m.alphaTest   = 0;
          m.needsUpdate = true;
        }
      }
    }
  });
  _rightHandBone.add(_worldGun);
  console.log('[weapons] world gun attached to RightHand bone');
}
