// weapons.js — bullet pool, FP gun viewmodel, world gun (mirror) on RightHand bone,
// hit detection (bots + walls/crates). Impact FX lives in fx.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene, gunScene } from './scene.js';
import { BULLET_SPEED, BULLET_LIFE, BOT_DAMAGE, ARENA_HALF, WALL_H, EAST_GAP_HALF, CRATES, OBSTACLES } from './config.js';
import { spawnSpark, spawnRicochet, tickFx } from './fx.js';

// -- Bullet pool ----------------------------------------------------------
const _pool   = [];
const _active = [];
// Core tracer geometry - tapered cylinder pointing along +Y. Bots get a
// thicker, longer cylinder + glow halo so incoming fire reads across the arena.
const _geo    = new THREE.CylinderGeometry(0.06, 0.02, 0.4, 6);
const _geoBot = new THREE.CylinderGeometry(0.13, 0.05, 0.7, 8);

// Per-shooter materials.
//   Player: neon purple core + neon orange tip.
//   Bots:   bright neon green core + neon pink tip + additive green halo.
// Brighter green keeps the bot tracer readable against the turquoise floor.
const _matP        = new THREE.MeshBasicMaterial({ color: 0xb84cff });
const _matB        = new THREE.MeshBasicMaterial({ color: 0x6dff3a });

const _tipMatP_geo = new THREE.SphereGeometry(0.09, 6, 4);
const _tipMatB_geo = new THREE.SphereGeometry(0.18, 8, 6);
const _tipMatP     = new THREE.MeshBasicMaterial({ color: 0xff7a00 });
const _tipMatB     = new THREE.MeshBasicMaterial({ color: 0xff2bd6 });

// Bot glow halo - additive outer sphere so the tracer carries far. Player
// bullets don't need one; purple/orange already pops against the teal floor.
const _haloMatB_geo = new THREE.SphereGeometry(0.30, 10, 8);
const _haloMatB     = new THREE.MeshBasicMaterial({
  color: 0x39ff14, transparent: true, opacity: 0.40,
  blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
});

const _bUp = new THREE.Vector3(0,1,0);
const _bQ  = new THREE.Quaternion();
const _bN  = new THREE.Vector3();

export function spawnBullet(origin, dir, isPlayer) {
  // Pool BY SHOOTER so a returned player bullet (small geo) can't be reused
  // as a bot bullet and silently revert the visibility upgrade. Costs one
  // linear scan; pool stays tiny in practice.
  let idx = -1;
  for (let i = _pool.length - 1; i >= 0; i--) {
    if (_pool[i].isPlayer === isPlayer) { idx = i; break; }
  }
  let b = null;
  if (idx >= 0) {
    b = _pool[idx];
    _pool.splice(idx, 1);
  } else {
    const geo = isPlayer ? _geo : _geoBot;
    const mat = isPlayer ? _matP : _matB;
    const mesh = new THREE.Mesh(geo, mat);
    const tipGeo = isPlayer ? _tipMatP_geo : _tipMatB_geo;
    const tipMat = isPlayer ? _tipMatP    : _tipMatB;
    const tip    = new THREE.Mesh(tipGeo, tipMat);
    tip.position.y = isPlayer ? 0.22 : 0.38;
    mesh.add(tip);
    let halo = null;
    if (!isPlayer) {
      halo = new THREE.Mesh(_haloMatB_geo, _haloMatB);
      halo.position.y = 0.20;
      halo.renderOrder = 1; // additive draws after opaque
      mesh.add(halo);
    }
    b = { mesh, tip, halo, vel: new THREE.Vector3(), prev: new THREE.Vector3(), life: 0, isPlayer };
  }
  b.isPlayer = isPlayer;
  b.life = BULLET_LIFE;
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
// At BULLET_SPEED ~60 m/s a bullet covers ~1 m per tick, so a point-in-AABB
// test would tunnel through thin walls and crate edges. We sweep the prev→curr
// segment instead. East-wall plane is suppressed inside the torii gate gap
// (|z| < EAST_GAP_HALF) so the opening is a real hole. _impactPos/_impactNrm
// are scratch vectors — read them after a successful sweep test, before the
// next call overwrites them.
const _impactPos     = new THREE.Vector3();
const _impactNrm     = new THREE.Vector3();
const _reflDir       = new THREE.Vector3();
const _bodyBurstNrm  = new THREE.Vector3();

function sweepWalls(b) {
  const p0 = b.prev, p1 = b.mesh.position;
  let tHit = 2, hx = 0, hy = 0, hz = 0, nx = 0, nz = 0;
  if (p1.x >= ARENA_HALF && p0.x < ARENA_HALF) {
    const t = (ARENA_HALF - p0.x) / (p1.x - p0.x);
    const zAt = p0.z + (p1.z - p0.z) * t;
    if (Math.abs(zAt) > EAST_GAP_HALF && t < tHit) {
      tHit = t; hx = ARENA_HALF; hy = p0.y + (p1.y - p0.y) * t; hz = zAt; nx = -1; nz = 0;
    }
  }
  if (p1.x <= -ARENA_HALF && p0.x > -ARENA_HALF) {
    const t = (-ARENA_HALF - p0.x) / (p1.x - p0.x);
    if (t < tHit) { tHit = t; hx = -ARENA_HALF; hy = p0.y + (p1.y - p0.y) * t; hz = p0.z + (p1.z - p0.z) * t; nx = 1; nz = 0; }
  }
  if (p1.z >= ARENA_HALF && p0.z < ARENA_HALF) {
    const t = (ARENA_HALF - p0.z) / (p1.z - p0.z);
    if (t < tHit) { tHit = t; hx = p0.x + (p1.x - p0.x) * t; hy = p0.y + (p1.y - p0.y) * t; hz = ARENA_HALF; nx = 0; nz = -1; }
  }
  if (p1.z <= -ARENA_HALF && p0.z > -ARENA_HALF) {
    const t = (-ARENA_HALF - p0.z) / (p1.z - p0.z);
    if (t < tHit) { tHit = t; hx = p0.x + (p1.x - p0.x) * t; hy = p0.y + (p1.y - p0.y) * t; hz = -ARENA_HALF; nx = 0; nz = 1; }
  }
  if (tHit > 1) return false;
  _impactPos.set(hx, hy, hz);
  _impactNrm.set(nx, 0, nz);
  return true;
}

// Slab method swept-AABB against one crate. Returns t ∈ [0,1] or -1.
function _sweepCrate(b, cx, cz, hw, hd, fullH) {
  const p0 = b.prev, p1 = b.mesh.position;
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  let tEnter = 0, tExit = 1;
  let nx = 0, ny = 0, nz = 0;
  if (Math.abs(dx) < 1e-8) { if (p0.x < cx - hw || p0.x > cx + hw) return -1; }
  else {
    let t1 = (cx - hw - p0.x) / dx, t2 = (cx + hw - p0.x) / dx, eN = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; eN = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = eN; ny = 0; nz = 0; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return -1;
  }
  if (Math.abs(dy) < 1e-8) { if (p0.y < 0 || p0.y > fullH) return -1; }
  else {
    let t1 = (0 - p0.y) / dy, t2 = (fullH - p0.y) / dy, eN = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; eN = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = 0; ny = eN; nz = 0; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return -1;
  }
  if (Math.abs(dz) < 1e-8) { if (p0.z < cz - hd || p0.z > cz + hd) return -1; }
  else {
    let t1 = (cz - hd - p0.z) / dz, t2 = (cz + hd - p0.z) / dz, eN = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; eN = 1; }
    if (t1 > tEnter) { tEnter = t1; nx = 0; ny = 0; nz = eN; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return -1;
  }
  if (tEnter < 0 || tEnter > 1) return -1;
  _impactPos.set(p0.x + dx * tEnter, p0.y + dy * tEnter, p0.z + dz * tEnter);
  _impactNrm.set(nx, ny, nz);
  return tEnter;
}

function sweepCrates(b) {
  let bestT = 2, hpx = 0, hpy = 0, hpz = 0, hnx = 0, hny = 0, hnz = 0;
  // Sweep both visual crates AND collision-only OBSTACLES (tree trunk, torii
  // pillars). Identical tuple shape so we just iterate two lists back-to-back.
  for (let src = 0; src < 2; src++) {
    const list = src === 0 ? CRATES : OBSTACLES;
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      const t = _sweepCrate(b, c[0], c[1], c[2], c[3], c[4]);
      if (t >= 0 && t < bestT) {
        bestT = t;
        hpx = _impactPos.x; hpy = _impactPos.y; hpz = _impactPos.z;
        hnx = _impactNrm.x; hny = _impactNrm.y; hnz = _impactNrm.z;
      }
    }
  }
  if (bestT > 1) return false;
  _impactPos.set(hpx, hpy, hpz);
  _impactNrm.set(hnx, hny, hnz);
  return true;
}


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
          _onPlayerHit(BOT_DAMAGE);
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

const _wsScale = new THREE.Vector3();
function _attachWorldGun() {
  _worldGun = _worldGunSrc.clone(true);

  // The Mixamo skeleton inherits a uniform character-root scale of ~1/175
  // (TARGET_HEIGHT/geoH, cm → m) that cascades to every bone. A child added
  // to RightHand renders at that tiny scale by default — effectively invisible.
  //
  // We solve this with a NORMALIZER GROUP: a wrapper that counter-scales the
  // bone's world scale back to 1.0, then we place the gun inside the wrapper
  // in plain world-unit values (cm-friendly). This is more robust than baking
  // `inv` into the gun's own scale/position because the wrapper transform
  // composes cleanly with any future bone animation — we never have to re-read
  // world scale or fight with cm/m mismatches at the gun's own level.
  _rightHandBone.updateWorldMatrix(true, false);
  _rightHandBone.getWorldScale(_wsScale);
  const inv = 1 / Math.max(_wsScale.x, 1e-6);

  const wrap = new THREE.Group();
  wrap.name = 'world-gun-normalizer';
  wrap.scale.setScalar(inv); // cancels inherited bone scale — wrap interior = world units
  _rightHandBone.add(wrap);

  // Place + orient the gun inside the wrapper in straightforward world units.
  //
  // Mixamo RightHand bone local axes (approx, after the root-scale cascade is
  // cancelled by `wrap`):
  //   +Y down the fingers (toward fingertips)
  //   +X across the palm (toward the thumb on a right hand)
  //   +Z out the BACK of the hand (knuckle side)
  //   -Z into the PALM
  //
  // The gun-steampunk GLB sits in its own default orientation. The FP view-
  // model uses rotation.y = -π/2, which means in GLB space the barrel points
  // along +X by default and we yaw it to look down -Z for the FP camera.
  //
  // For the world gun we want:
  //   barrel pointing along bone +Y  (down the fingers)
  //   grip   pointing along bone -Z  (into the palm)
  //
  // Previous rotation `(0, π/2, -π/2)` left the gun's SIDE pressed against the
  // palm (the grip was perpendicular to the fingers — "the side of the gun is
  // stuck to the palm"). Replace with a rotation that swings the barrel along
  // bone +Y and rolls the grip into the palm.
  //
  // Euler XYZ: rotate -π/2 around Z first (puts default-+X-barrel onto +Y,
  // i.e. down the fingers), then -π/2 around Y (rolls the grip from pointing
  // along +X to pointing along -Z, i.e. into the palm).
  _worldGun.scale.setScalar(0.22);
  _worldGun.position.set(0.0, 0.06, -0.03); // sit gun in the palm, slid up along the fingers
  _worldGun.rotation.set(0, -Math.PI / 2, -Math.PI / 2);
  wrap.add(_worldGun);

  // Layer 1 = visible to mirror reflection camera, hidden from FP camera.
  // Force opaque + no-cull so it never vanishes from skinned bounds or alpha.
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
  console.log('[weapons] world gun attached via normalizer (boneScale=', _wsScale.x.toFixed(4), 'inv=', inv.toFixed(2), ')');
}
