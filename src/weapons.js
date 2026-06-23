// weapons.js — bullet pool, FP gun viewmodel, world gun (mirror) on RightHand bone,
// hit detection (bots + walls/crates). Impact FX lives in fx.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene, gunScene } from './scene.js';
import { state } from './state.js';
import { emit, EV } from './events.js';
import { BULLET_SPEED, BULLET_LIFE, BOT_DAMAGE, ARENA_HALF, WALL_H, RELOAD_TIME } from './config.js';
import { spawnSpark, spawnRicochet, tickFx } from './fx.js';
import { castRay, castRayStatic,
         BOT_HEAD_CENTRE_Y_OFFSET, BOT_HEAD_RADIUS } from './physics.js';
// v0.2.120 — the shared headshot classifier was extracted to a pure module
// (no Three/Rapier) so it can be unit tested. Re-exported here unchanged so
// every existing `from './weapons.js'` import site keeps working.
import { isInHeadSphere, classifyHeadshot, HEAD_BOTTOM } from './engine/combat/classifier.js';
export { isInHeadSphere, classifyHeadshot };
// v0.2.124 — target-practice diagnostics. Pure aim-vs-outcome miss classifier
// (no Three/Rapier) so "why did my shot miss?" is explainable from the console.
import { classifyShotOutcome } from './engine/combat/shotDiagnostics.js';
// v0.2.129 — barrel/muzzle origin math extracted to a pure module so the
// +right (visible right-hand gun) side convention is unit-testable without the
// WebGL renderer. The helper builds the offset basis from the camera's WORLD
// quaternion so the muzzle tracks player yaw (fixes the bullet-from-the-left bug).
import { barrelWorldFromCamera } from './engine/weapons/muzzle.js';
// v0.2.125 — pure damage model (head/body damage + kill threshold), extracted
// from the old inline `isHead ? 9 : 3` so it is unit-testable and the
// one-shot-headshot contract is locked by tests against BOT_HP.
import { shotDamage } from './engine/combat/damage.js';
// v0.2.127 — pure reload viewmodel pose curve ("click down, clack snap back"),
// extracted so the snap timing is unit-testable and allocation-free.
import { reloadDip } from './engine/weapons/reloadPose.js';

// Last bot-hit classification, surfaced through ToriiDebug.combat.lastHit for
// in-arena tuning. Mutated in place — never reallocated in the hot path.
const _lastHit = {
  part: null, classified: null, impactY: 0, footY: 0, relY: 0,
  neckLine: HEAD_BOTTOM, headCentreY: BOT_HEAD_CENTRE_Y_OFFSET,
  headRadius: BOT_HEAD_RADIUS, inHeadSphere: false, dmg: 0,
  botName: null, dist: 0,
};
export function getLastHit() { return _lastHit; }

// v0.2.124 — per-shot diagnostics (target practice). At fire time we record what
// the player's AIM line (camera/crosshair ray) was on AND what the bullet line
// would hit if nothing moved; at resolution we record what the bullet ACTUALLY
// connected with and derive a miss reason. Per-shot objects (one alloc per
// trigger pull, NOT per frame) — surfaced via ToriiDebug.combat.lastShot/lastMiss.
const DIAG_RANGE = 80; // m — diagnostic ray reach (≈ crosshair convergence dist)
let _lastShot = null;  // most recent fired player shot (predicted + resolved)
let _lastMiss = null;  // most recent player shot that did NOT hit a live bot
export function getLastShot() { return _lastShot; }
export function getLastMiss() { return _lastMiss; }

function _mkTarget() { return { kind: 'none', isHead: false, botName: null, dist: Infinity }; }
function _mkDiag() {
  return {
    origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 },
    aim: _mkTarget(),      // camera/crosshair ray at fire time
    pred: _mkTarget(),     // bullet line at fire time (if nothing moved)
    outcome: _mkTarget(),  // what the bullet actually resolved to
    predicted: null,       // {reason,label} aim-vs-pred, computed at fire
    reason: null, label: null, // {reason,label} aim-vs-outcome, set at resolution
    resolved: false, flightTime: 0,
  };
}
// Translate a castRay() hit into the plain diagnostic target shape. Reads the
// shared hit.point scratch immediately, before the next cast overwrites it.
function _describeInto(t, hit) {
  if (!hit) { t.kind = 'none'; t.isHead = false; t.botName = null; t.dist = Infinity; return; }
  t.dist = hit.toi;
  if (hit.bot && hit.bot.alive) {
    t.kind = 'bot';
    t.isHead = classifyHeadshot(hit.point.x, hit.point.y, hit.point.z, hit.bodyPart, hit.bot);
    t.botName = hit.bot.name || null;
  } else if (hit.crate) {
    t.kind = 'crate'; t.isHead = false; t.botName = null;
  } else {
    t.kind = 'wall'; t.isHead = false; t.botName = null;
  }
}

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

// Scratch vectors for impact resolution. Read immediately after a hit, before
// the next bullet overwrites them.
const _impactPos     = new THREE.Vector3();
const _impactNrm     = new THREE.Vector3();
const _reflDir       = new THREE.Vector3();
const _bodyBurstNrm  = new THREE.Vector3();

// v0.2.113 — crate nudge. When a player bullet resolves a dynamic crate body
// (hit.crate, set by raycast.js via colliderToCrate), apply a small impulse at
// the impact point along the bullet's travel direction with a slight upward
// kick so the crate visibly shifts/tips without launching. Plain reused {x,y,z}
// objects — Rapier accepts bare vector-likes, so no THREE allocation in the hot
// path. Tuned low: BULLET_SPEED-normalized dir × CRATE_IMPULSE.
const CRATE_IMPULSE  = 2.2;  // N·s along bullet dir
const CRATE_LIFT     = 0.6;  // N·s upward component
const _crateImp      = { x: 0, y: 0, z: 0 };
const _cratePt       = { x: 0, y: 0, z: 0 };

// ── Hit callbacks — set by main.js ───────────────────────────────────────────
let _onPlayerHit = null;
let _bots        = null;
// Getter (not the collider itself) — player collider is created async after
// Rapier inits, so we resolve it lazily each shot.
let _getPlayerCollider = () => null;

export function initWeapons(bots, onPlayerHit, getPlayerCollider) {
  _bots = bots;
  _onPlayerHit = onPlayerHit;
  if (getPlayerCollider) _getPlayerCollider = getPlayerCollider;
  _buildGun();
}

// Scratch for the per-bullet raycast (Rapier path, player bullets only in v0.2.63).
const _rayDirN = new THREE.Vector3();
const _rayHitP = new THREE.Vector3();

// Scratch for the diagnostic bullet-line predictive ray (fire time only — runs
// during the player update, never inside the per-frame bullet loop).
const _diagDir = new THREE.Vector3();

// v0.2.124 — record a player shot's intent at fire time. `b` is the freshly
// spawned bullet (b.prev = muzzle origin, b.vel = velocity along the bullet
// line). (ax,ay,az)/(adx,ady,adz) is the CAMERA crosshair ray (the reticle's
// aim line). We cast both the aim line and the bullet line once and stash the
// snapshot on the bullet so resolution can finalise the miss reason. Per-shot.
export function recordPlayerShot(b, ax, ay, az, adx, ady, adz) {
  if (!b) return null;
  const d = _mkDiag();
  d.origin.x = b.prev.x; d.origin.y = b.prev.y; d.origin.z = b.prev.z;
  _diagDir.copy(b.vel);
  const L = _diagDir.length();
  if (L > 1e-5) _diagDir.multiplyScalar(1 / L);
  d.dir.x = _diagDir.x; d.dir.y = _diagDir.y; d.dir.z = _diagDir.z;

  const excl = _getPlayerCollider() || null;
  // Aim line (camera/crosshair) — what the reticle is on.
  const aimHit = castRay(ax, ay, az, adx, ady, adz, DIAG_RANGE, excl);
  _describeInto(d.aim, aimHit);
  // Bullet line (muzzle → convergence) — what the projectile would hit if static.
  const predHit = castRay(d.origin.x, d.origin.y, d.origin.z, d.dir.x, d.dir.y, d.dir.z, DIAG_RANGE, excl);
  _describeInto(d.pred, predHit);

  d.predicted = classifyShotOutcome(d.aim, d.pred);
  b._diag = d;
  _lastShot = d;
  return d;
}

// Finalise the resolved outcome of a player shot and derive the miss reason
// (aim intent vs what the bullet actually hit). Called once per player bullet
// when it resolves (bot/geometry hit) or expires.
function _finalizeShot(b, kind, isHead, bot, dist) {
  const d = b && b._diag;
  if (!d || d.resolved) return;
  d.outcome.kind = kind;
  d.outcome.isHead = isHead;
  d.outcome.botName = bot ? (bot.name || null) : null;
  d.outcome.dist = dist;
  d.resolved = true;
  d.flightTime = BULLET_LIFE - b.life;
  const r = classifyShotOutcome(d.aim, d.outcome);
  d.reason = r.reason; d.label = r.label;
  if (kind !== 'bot') _lastMiss = d;
}

export function tickWeapons(dt, playerPos) {
  for (let i = _active.length-1; i >= 0; i--) {
    const b = _active[i];
    b.prev.copy(b.mesh.position);
    b.mesh.position.addScaledVector(b.vel, dt);
    b.life -= dt;

    let remove = b.life <= 0 || b.mesh.position.y < 0;

    if (!remove) {
      // ── PLAYER bullets — Rapier raycast (v0.2.63 Phase 2a) ────────────────
      // Cast prev → curr against the unified Rapier world. One call resolves
      // bots, walls, crates, obstacles, ground — collider→bot map translates a
      // hit on a bot capsule back to the game-side bot reference. Excludes the
      // player's own collider so muzzle-spawned bullets never self-hit.
      if (b.isPlayer) {
        _rayDirN.copy(b.vel);
        const segLen = _rayDirN.length() * dt;          // tick distance, ~1 m
        if (segLen > 1e-5) {
          _rayDirN.multiplyScalar(1 / (segLen / dt));   // normalize (== /BULLET_SPEED)
          const hit = castRay(
            b.prev.x, b.prev.y, b.prev.z,
            _rayDirN.x, _rayDirN.y, _rayDirN.z,
            segLen,
            _getPlayerCollider() || null
          );
          if (hit) {
            _rayHitP.set(hit.point.x, hit.point.y, hit.point.z);
            if (hit.bot && hit.bot.alive) {
              // Bot hit — spark sprays back at shooter. Headshots deal 3× body
              // damage (9 vs 3). v0.2.64 introduced the head sphere collider;
              // hit.bodyPart === 'head' for the sphere, 'body' for the capsule.
              _bodyBurstNrm.copy(b.vel).normalize().negate();
              spawnSpark(_rayHitP, _bodyBurstNrm);
              // Deterministic, geometry-consistent head classification (v0.2.113).
              // Shared classifier (isInHeadSphere/classifyHeadshot) — same rule the
              // on-screen target reticle uses, so preview matches outcome. Two-tier:
              //   1) the ray resolved the head sphere collider outright; else
              //   2) the impact lies inside the head sphere — proximity backstop for
              //      the overlap frame where Rapier's closest pick says 'body'.
              const footY  = hit.bot.pos ? hit.bot.pos.y : 0;
              const relY   = _rayHitP.y - footY;
              const inHeadSphere = isInHeadSphere(_rayHitP.x, _rayHitP.y, _rayHitP.z, hit.bot);
              const isHead = classifyHeadshot(_rayHitP.x, _rayHitP.y, _rayHitP.z, hit.bodyPart, hit.bot);
              const dmg    = shotDamage(isHead);
              // Debug snapshot for ToriiDebug.combat.lastHit (no alloc).
              _lastHit.part = hit.bodyPart; _lastHit.classified = isHead ? 'head' : 'body';
              _lastHit.impactY = _rayHitP.y; _lastHit.footY = footY; _lastHit.relY = relY;
              _lastHit.inHeadSphere = inHeadSphere; _lastHit.dmg = dmg;
              _lastHit.botName = hit.bot.name || null; _lastHit.dist = hit.toi;
              // v0.2.124 — resolve the per-shot diagnostic as a bot hit.
              _finalizeShot(b, 'bot', isHead, hit.bot, hit.toi);
              // Second spark on headshots so the hit reads as more impactful.
              if (isHead) spawnSpark(_rayHitP, _bodyBurstNrm);
              // Player bullet struck a bot — publish on the bus (v0.2.117). The
              // subscriber in main.js applies damage + crosshair flash. Replaces
              // the old `window._onBotHit` global bridge; per-shot, not per-frame.
              emit(EV.BOT_HIT_BY_PLAYER, { bot: hit.bot, dmg, isHead });
            } else {
              // Wall / crate / obstacle / ground — use Rapier-provided normal.
              _impactNrm.set(hit.normal.x, hit.normal.y, hit.normal.z);
              spawnSpark(_rayHitP, _impactNrm);
              const dot = b.vel.dot(_impactNrm);
              _reflDir.copy(b.vel).addScaledVector(_impactNrm, -2 * dot).normalize();
              spawnRicochet(_rayHitP, _reflDir);
              // v0.2.113 — dynamic crate? nudge it along the bullet direction.
              if (hit.crate) {
                _crateImp.x = _rayDirN.x * CRATE_IMPULSE;
                _crateImp.y = _rayDirN.y * CRATE_IMPULSE + CRATE_LIFT;
                _crateImp.z = _rayDirN.z * CRATE_IMPULSE;
                _cratePt.x = _rayHitP.x; _cratePt.y = _rayHitP.y; _cratePt.z = _rayHitP.z;
                hit.crate.applyImpulseAtPoint(_crateImp, _cratePt, true);
              }
              // v0.2.124 — resolve the per-shot diagnostic as a geometry miss.
              _finalizeShot(b, hit.crate ? 'crate' : 'wall', false, null, hit.toi);
            }
            // Move bullet to impact point so the visual tracer ends there.
            b.mesh.position.copy(_rayHitP);
            remove = true;
          }
        }
      }

      // ── BOT bullets — Rapier swept ray (v0.2.103) ─────────────────────────
      if (!remove && !b.isPlayer) {
        // 1. Player hit — keep the cheap distance test (the player capsule is
        //    excluded from the static raycast, so the ray can't resolve it).
        if (_onPlayerHit && b.mesh.position.distanceToSquared(playerPos) < 0.5) {
          _onPlayerHit(BOT_DAMAGE);
          remove = true;
        }

        // 2. Wall / crate / obstacle / dynamic crate — Rapier swept ray that
        //    ignores bots (a bot bullet never sparks on another bot). Excludes
        //    the player collider so the ray passes through to the wall behind.
        if (!remove) {
          _rayDirN.copy(b.vel);
          const segLen = _rayDirN.length() * dt;
          if (segLen > 1e-5) {
            _rayDirN.multiplyScalar(1 / (segLen / dt)); // normalize
            const hit = castRayStatic(
              b.prev.x, b.prev.y, b.prev.z,
              _rayDirN.x, _rayDirN.y, _rayDirN.z,
              segLen,
              _getPlayerCollider() || null
            );
            if (hit) {
              _rayHitP.set(hit.point.x, hit.point.y, hit.point.z);
              _impactNrm.set(hit.normal.x, hit.normal.y, hit.normal.z);
              spawnSpark(_rayHitP, _impactNrm);
              const dot = b.vel.dot(_impactNrm);
              _reflDir.copy(b.vel).addScaledVector(_impactNrm, -2 * dot).normalize();
              spawnRicochet(_rayHitP, _reflDir);
              b.mesh.position.copy(_rayHitP);
              remove = true;
            }
          }
        }
      }
    }

    // Safety net for out-of-bounds bullets
    if (!remove && (Math.abs(b.mesh.position.x) > ARENA_HALF + 2 ||
                    Math.abs(b.mesh.position.z) > ARENA_HALF + 2 ||
                    b.mesh.position.y > WALL_H + 4)) {
      remove = true;
    }

    if (remove) {
      // v0.2.124 — a player bullet removed without ever resolving a hit (life
      // expiry, dropped below ground, out of bounds) is a clean miss; finalise
      // its diagnostic so ToriiDebug.combat.lastMiss explains it.
      if (b.isPlayer && b._diag && !b._diag.resolved) _finalizeShot(b, 'none', false, null, Infinity);
      b._diag = null;
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

// Returns barrel tip in world space (used to spawn bullets from the gun barrel).
// Delegates to the pure muzzle module (v0.2.129): the offset basis is built from
// the camera's WORLD quaternion so the +right barrel offset tracks player yaw and
// the muzzle/tracer stays on the visible right-hand gun. Direction down the barrel
// (toward the crosshair) is unchanged — only the origin side is corrected.
export function getGunBarrelWorld(mainCamera) {
  return barrelWorldFromCamera(mainCamera, _barrelWorld);
}

function _tickGun(dt) {
  const mesh = _gunMesh || _gunPlaceholder;
  if (!mesh) return;

  // Recoil — short z-kick toward the camera on each shot.
  let z = FP_REST_Z;
  if (_recoilTimer > 0) {
    _recoilTimer = Math.max(0, _recoilTimer - dt);
    z = FP_REST_Z + (_recoilTimer / 0.08) * 0.05;
  }
  mesh.position.z = z;

  // v0.2.111: visible reload feedback. The 3rd-person model plays a reload clip
  // (mirror-only), but the FP viewmodel showed nothing, so reload "looked broken".
  // v0.2.127: feel reworked to "click down, clack snap back" — the symmetric
  // sin hump was replaced by a quick drop, brief hold, then a fast snap-back
  // with a slight overshoot (pure curve in engine/weapons/reloadPose.js). Still
  // purely a dt/state-driven viewmodel pose, no timers. progress 0→1 across
  // RELOAD_TIME (unchanged, so audio sync is preserved). dip: 0 rest, 1 lowered,
  // negative on the snap-back overshoot (gun kicks slightly above rest).
  if (state.reloading) {
    const progress = 1 - Math.max(0, Math.min(1, state.reloadTimer / RELOAD_TIME));
    const dip = reloadDip(progress);
    mesh.position.y = FP_REST_Y - 0.22 * dip;
    mesh.position.z = z - 0.10 * dip;
    mesh.rotation.z = -0.6 * dip;
  } else if (mesh.rotation.z !== 0 || mesh.position.y !== FP_REST_Y) {
    mesh.position.y = FP_REST_Y;
    mesh.rotation.z = 0;
  }
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
  // GLB-local frame for gun-steampunk (corrected after upside-down result):
  //   barrel direction = +X (FP view-model yaws by -π/2 to point it down -Z)
  //   grip direction   = +Y (handle points UP in GLB space — mirror-test
  //                          revealed grip-up was actually +Y, not -Y)
  //   gun's right side = +Z
  //
  // We need a rotation that maps:
  //   GLB +X (barrel) →  bone +Y  (down fingers)
  //   GLB +Y (grip)   →  bone -Z  (into palm)
  //
  // Working through Three.js XYZ Euler (M = Rx · Ry · Rz):
  //   (0, -π/2,  π/2): +X → (0,1,0)=+Y ✓  and  +Y → (0,0,-1)=-Z ✓
  //
  // Attempt log:
  //   (0,  π/2, -π/2) v0.2.54 — side of gun on palm
  //   (0, -π/2, -π/2) v0.2.55 — still side-on
  //   (0,  π/2,  π/2) v0.2.56 — correct rotation axis but upside-down
  //                                   (proves grip is +Y, not -Y in GLB)
  //   (0, -π/2,  π/2) v0.2.58 — right grip orientation, but barrel pointing
  //                                   BACK at the player in the mirror
  //   (π, -π/2,  π/2) v0.2.60 — add π around X (horizontal axis) so the
  //                                   barrel flips 180° from bone +Y to bone -Y,
  //                                   now pointing AWAY from the player
  //
  // Position: slide further along the fingers (Y bone-up) to seat the handle
  // deeper in the curl of the palm.
  _worldGun.scale.setScalar(0.22);
  _worldGun.position.set(0.0, 0.16, -0.03); // grip in palm, slid further down hand
  _worldGun.rotation.set(Math.PI, -Math.PI / 2, Math.PI / 2);
  // v0.2.111: the gun reappeared upside-down in the mirror (handle pointing up).
  // Roll 180° about the gun's OWN length (local barrel axis) so the handle drops
  // back down without disturbing the barrel's aim direction. rotateX spins about
  // the object-local X, which is the GLB barrel axis after the Euler above.
  _worldGun.rotateX(Math.PI);
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
