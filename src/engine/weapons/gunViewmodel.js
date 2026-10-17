// src/engine/weapons/gunViewmodel.js — first-person gun viewmodel + mirror gun.
//
// Extracted VERBATIM from the retired src/weapons.js when the arena combat layer
// was rebuilt (ADR-0130, Game Zone v2). Nothing here decides combat: it builds
// the FP gun (gunScene), plays recoil + the reload dip, exposes the barrel tip
// for tracers/stickers, and parents a world-space gun to the player's RightHand
// bone for the mirror. Shared by player.js, playerModel.js and the arena runtime.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { gunScene } from '../../scene.js';
import { state, isReloading } from '../../state.js';
import { RELOAD_TIME } from '../../config.js';
import { assetUrl } from '../../assetUrl.js';
import { barrelWorldFromCamera } from './muzzle.js';
import { reloadDip } from './reloadPose.js';
import { recoilPose } from '../../gamezone/client/feel.js';

// ── FP gun viewmodel (gunScene — always rendered on top) ─────────────────────
const _barrelWorld = new THREE.Vector3();
let _gunMesh   = null;
let _gunPlaceholder = null;
let _recoilTimer = 0;
let _arenaRecoilMs = -1;          // ADR-0131: arena recoil (kick + muzzle climb)
let _recoilScale = 1;             // ADR-0132: 1 = arena, STICKER_RECOIL_SCALE = NAP sticker gun
const _rp = { back: 0, climb: 0 };

// FP gun rest position — brought further into player's view in v0.2.48.
// Closer to camera (less negative Z) and pushed up so more body is visible.
const FP_REST_X = 0.22;
const FP_REST_Y = -0.10;
const FP_REST_Z = -0.24;

let _built = false;
/** Build the FP gun viewmodel + world gun (idempotent). */
export function buildGunViewmodel() {
  if (_built) return;
  _built = true;
  _gunPlaceholder = new THREE.Mesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.22),
    new THREE.MeshStandardMaterial({ color: 0x222233, roughness: 0.4, metalness: 0.8 })
  );
  _gunPlaceholder.position.set(FP_REST_X, FP_REST_Y, FP_REST_Z);
  gunScene.add(_gunPlaceholder);

  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('/draco/'));
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
  loader.load(assetUrl('/gun-steampunk.glb'), gltf => {
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

/** NAP sticker gun: the arena curve at a gentler strength (ADR-0132). */
export const STICKER_RECOIL_SCALE = 0.45;

/**
 * Gun kick on a shot, started on the click's frame.
 *  - `true` / 'arena': the Game Zone recoil (ADR-0131), a z-kick plus muzzle
 *    climb with an eased settle.
 *  - 'sticker': the same curve at STICKER_RECOIL_SCALE (NAP, ADR-0132).
 *  - no argument: the legacy short z-kick.
 */
export function triggerRecoil(mode = false) {
  if (mode === true || mode === 'arena' || mode === 'sticker') {
    _recoilScale = mode === 'sticker' ? STICKER_RECOIL_SCALE : 1;
    _arenaRecoilMs = 0; _recoilTimer = 0; return;
  }
  _recoilTimer = 0.08;
}

// Returns barrel tip in world space (used to spawn bullets from the gun barrel).
// Delegates to the pure muzzle module (v0.2.129): the offset basis is built from
// the camera's WORLD quaternion so the +right barrel offset tracks player yaw and
// the muzzle/tracer stays on the visible right-hand gun. Direction down the barrel
// (toward the crosshair) is unchanged — only the origin side is corrected.
export function getGunBarrelWorld(mainCamera) {
  return barrelWorldFromCamera(mainCamera, _barrelWorld);
}

/** Per-frame recoil + reload pose for the FP gun. */
export function tickGunViewmodel(dt) {
  const mesh = _gunMesh || _gunPlaceholder;
  if (!mesh) return;

  // Recoil — short z-kick toward the camera on each shot.
  let z = FP_REST_Z;
  if (_recoilTimer > 0) {
    _recoilTimer = Math.max(0, _recoilTimer - dt);
    z = FP_REST_Z + (_recoilTimer / 0.08) * 0.05;
  }
  let climb = 0;
  if (_arenaRecoilMs >= 0) {
    recoilPose(_arenaRecoilMs, _rp, _recoilScale);
    _arenaRecoilMs += dt * 1000;
    if (_rp.back === 0 && _rp.climb === 0 && _arenaRecoilMs > 0) _arenaRecoilMs = -1;
    z += _rp.back; climb = _rp.climb;
  }
  mesh.position.z = z;
  if (mesh.rotation.x !== climb) mesh.rotation.x = climb;

  // v0.2.111: visible reload feedback. The 3rd-person model plays a reload clip
  // (mirror-only), but the FP viewmodel showed nothing, so reload "looked broken".
  // v0.2.127: feel reworked to "click down, clack snap back" — the symmetric
  // sin hump was replaced by a quick drop, brief hold, then a fast snap-back
  // with a slight overshoot (pure curve in engine/weapons/reloadPose.js). Still
  // purely a dt/state-driven viewmodel pose, no timers. progress 0→1 across
  // RELOAD_TIME (unchanged, so audio sync is preserved). dip: 0 rest, 1 lowered,
  // negative on the snap-back overshoot (gun kicks slightly above rest).
  if (isReloading()) {
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
  // v0.2.801-alpha: a NEW bone means the player body was reloaded (login /
  // character swap). The old world gun (if any) is still parented to the
  // REMOVED body, so detach it and re-attach to the new body's bone — otherwise
  // the mirror shows no gun after a character reload. Idempotent for the same
  // bone.
  if (bone && bone === _rightHandBone && _worldGun) return;
  if (_worldGun) {
    const wrap = _worldGun.parent;
    if (wrap && wrap.parent) wrap.parent.remove(wrap);
    _worldGun = null;
  }
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
  console.log('[gun] world gun attached via normalizer (boneScale=', _wsScale.x.toFixed(4), 'inv=', inv.toFixed(2), ')');
}
