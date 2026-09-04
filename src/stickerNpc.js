// stickerNpc.js — FTFF sticker projectile system.
// Stickers fire from the gun and stick to any surface in the scene.
// For the NPC: uses two Rapier raycasts — one for per-bone ball sensors
// (hits individual arms, legs, torso, head) and one for the broad capsule
// (fallback). When a bone is hit, the sticker is parented to that bone via
// Object3D.attach() — it follows the bone's animation automatically.
// For static objects (trees, crates): uses Three.js raycaster against meshes.
import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';
import { STICKER_LIBRARY } from './engine/character/stickerPlacement.js';
import { stickerImageUrl } from './engine/character/stickerLibrary.js';
import {
  STICKER_RENDER_MODE, createStickerRenderState,
  chooseStickerRenderMode, setForcePlaneMode,
} from './engine/character/stickerRenderMode.js';
import { castRay, colliderToBone } from './physics.js';

// A/B render-mode state (ADR-0090 slice 2). Baked-vs-plane decal choice per
// fire; the operator can force plane-mode globally via ToriiDebug.stickers.
const _renderState = createStickerRenderState();
export function setStickerForcePlaneMode(on) { return setForcePlaneMode(_renderState, on); }
export function getStickerRenderState() {
  return { forcePlaneMode: _renderState.forcePlaneMode };
}

let _texture = null;
let _textureLoading = false;
let _stickers = [];      // active flying stickers
let _attached = [];      // stickers stuck on surfaces

// Reusable raycaster + scratch vectors (constraint [4]: no new in hot paths)
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _worldQuatInv = new THREE.Quaternion();
const _boneWorldInv = new THREE.Matrix4();
const _worldTarget = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();
const MAX_SKIN_BONES = 256;
const _faceBoneTotals = new Float32Array(MAX_SKIN_BONES);
const _faceBoneUsed = new Uint16Array(12);

// Mesh cache — refreshed periodically to pick up newly loaded objects
const _meshCache = [];
let _meshCacheTime = 0;
const MESH_CACHE_TTL = 2000; // refresh every 2s

// Meshes we've already warned about for missing a `position` attribute — logged
// once each so the console names the offender without spamming every cache refill.
const _warnedPositionless = new Set();
function _meshWarnKey(obj) {
  let parent = '';
  const p = obj.parent;
  if (p) parent = (p.name ? p.name : p.type) || p.type;
  return `${obj.type}:${obj.name || '(unnamed)'}<${parent}>`;
}

// Meshes to exclude from sticker raycasting.
// ADR-0090 slice 2 removed the curated subset — EVERY world mesh becomes
// sticker-able. The only remaining exclusion is the gun viewmodel: firing a
// sticker at 0m distance from the barrel would wallpaper the screen.
const EXCLUDE_NAMES = new Set([
  'world-gun-normalizer',
]);

const FLY_SIZE = 0.6;
const ATTACHED_SIZE = 0.08;
const ATTACHED_RATIO = 0.6;
const FLIGHT_DURATION = 0.22;
const MAX_ATTACHED = 120;
const ATTACHED_LIFETIME = 180;

// Peer avatar roots (multiplayer remote players) — wrapper Groups stamped
// with userData.peerId by arenaRuntime._createPeerAvatar. Collected lazily
// on each fire (click-rate, not per-frame) so joins/leaves are picked up
// without a registration seam.
const _peerRoots = [];
function _collectPeerRoots() {
  _peerRoots.length = 0;
  scene.traverse(o => {
    if (o.userData && o.userData.peerId && o.parent === scene) _peerRoots.push(o);
  });
  return _peerRoots;
}

// Resolve the image URL for a sticker hash. The seed entry still ships its PNG
// bundled (its blob is not yet on Blossom — verified 404), so it loads locally;
// every other hash is content-addressed to Blossom via stickerImageUrl.
function _stickerUrl(hash) {
  const seed = STICKER_LIBRARY[0];
  if (seed && seed.hash === hash) return assetUrl('/ftff-sticker.png');
  return stickerImageUrl(hash); // null for a malformed / non-sha256 hash
}

// Preload the sticker texture, resolved content-addressed from the seed hash.
function _preloadTexture() {
  if (_texture || _textureLoading) return;
  const seed = STICKER_LIBRARY[0];
  if (!seed) return;
  const url = _stickerUrl(seed.hash);
  if (!url) return;
  _textureLoading = true;
  const loader = new THREE.TextureLoader();
  loader.load(url, tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    _texture = tex;
    _textureLoading = false;
  }, undefined, err => {
    console.warn('[sticker] texture load FAILED:', err);
    _textureLoading = false;
  });
}

/** Build the material for a BAKED (DecalGeometry) sticker. Exported for unit
 *  coverage: the DoubleSide side is load-bearing — DecalGeometry is clipped in
 *  world space and parented to the hit mesh with a pre-inverted quaternion, so
 *  its winding isn't guaranteed to face the camera. FrontSide culling silently
 *  hid every baked decal (they rendered, but back-facing). DoubleSide keeps them
 *  visible regardless of winding. */
export function createBakedDecalMaterial(texture) {
  return new THREE.MeshBasicMaterial({
    map: texture || null,
    color: 0xffffff,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

// Check if a mesh/object should be excluded from sticker placement.
// ADR-0090 slice 2: this used to carry a curated subset of "non-sticker-able"
// world meshes; now it only guards mesh types that need a DIFFERENT targeting
// path (skinned via Rapier bone colliders + surface raycast; instanced grass
// handled separately as its own bucket) plus the gun viewmodel.
function _isExcluded(obj) {
  let o = obj;
  while (o) {
    if (o.name && EXCLUDE_NAMES.has(o.name)) return true;
    // Skip NPC + bot meshes — handled by Rapier colliders, not Three.js raycaster
    if (_npcRoot && o === _npcRoot) return true;
    if (o.userData?.isBotMesh) return true;
    // Skip peer avatars — SkinnedMesh needs the surface-authoritative path
    // (_raycastSkinnedMesh with skeleton update), not the static-mesh raycast.
    if (o.userData?.peerId) return true;
    o = o.parent;
  }
  return false;
}

// Collect all Mesh objects in the scene (not Sprites, Lights, Cameras).
// InstancedMesh (grass) is bucketed separately — the standard
// intersectObjects() path returns a face-less hit for InstancedMesh, but the
// SEPARATE call in _raycastScene resolves the exact instanceId so grass can be
// stickered per-blade with a plane decal.
// Refreshed every MESH_CACHE_TTL ms to pick up dynamically loaded objects.
const _instancedCache = [];
function _getMeshes() {
  const now = performance.now();
  if (now - _meshCacheTime > MESH_CACHE_TTL) {
    _meshCache.length = 0;
    _instancedCache.length = 0;
    scene.traverse(obj => {
      if (!obj.isMesh || obj.userData.isSticker || _isExcluded(obj)) return;
      const mat = obj.material;
      if (mat && mat.visible === false) return;
      // Guard: a Mesh whose geometry has no `position` attribute makes Three's
      // raycast throw "Cannot read properties of undefined (reading 'getX')"
      // inside getVertexPosition() → fromBufferAttribute(). That exception aborts
      // the whole sticker fire and spams the console on every shot. Skip it and
      // warn ONCE so the offender is named for a root-cause follow-up.
      const geo = obj.geometry;
      if (!geo || !geo.attributes || !geo.attributes.position) {
        const key = _meshWarnKey(obj);
        if (!_warnedPositionless.has(key)) {
          _warnedPositionless.add(key);
          console.warn(
            '[sticker] skipping raycast of mesh without a position attribute:',
            key, 'geometry=', geo ? (geo.type || 'unknown') : 'none'
          );
        }
        return;
      }
      if (obj.isInstancedMesh) _instancedCache.push(obj);
      else _meshCache.push(obj);
    });
    _meshCacheTime = now;
  }
  return _meshCache;
}
function _getInstancedMeshes() {
  // _getMeshes populates both caches together; ensure it's warm.
  _getMeshes();
  return _instancedCache;
}

// Three.js raycast for static meshes (trees, crates, terrain, InstancedMesh
// grass). InstancedMesh hits carry an `instanceId`; treat them as plane-decal
// candidates — the classifier (isBakedEligible) rejects them so grass gets a
// per-blade quad rather than a bake against shared instance geometry.
function _raycastScene(origin, dir) {
  _rayOrigin.copy(origin);
  _rayDir.copy(dir).normalize();
  _raycaster.set(_rayOrigin, _rayDir);
  _raycaster.far = 200;

  let best = null;
  let bestDist = Infinity;

  const meshes = _getMeshes();
  // Belt-and-suspenders: even after the _getMeshes() position guard, a mesh can
  // have its geometry disposed/rebuilt between cache refills (every 2s), leaving
  // a stale entry that still throws mid-raycast. Never let one broken mesh sink
  // an entire fire — drop it and keep going.
  let staticHits = [];
  try {
    staticHits = _raycaster.intersectObjects(meshes, false);
  } catch (err) {
    console.warn('[sticker] static mesh raycast failed (skipping):', err);
  }
  if (staticHits.length > 0) {
    const hit = staticHits[0];
    if (hit.distance < bestDist) { best = hit; bestDist = hit.distance; }
  }

  const instanced = _getInstancedMeshes();
  if (instanced.length > 0) {
    // Per-object query so we can accept the closest instance hit; the shared
    // raycaster reuses its internal ray, so this is cheap.
    let instHits = [];
    try {
      instHits = _raycaster.intersectObjects(instanced, false);
    } catch (err) {
      console.warn('[sticker] instanced mesh raycast failed (skipping):', err);
    }
    if (instHits.length > 0) {
      const hit = instHits[0];
      if (hit.distance < bestDist) { best = hit; bestDist = hit.distance; }
    }
  }

  if (!best) return null;
  if (best.face) {
    _normal.copy(best.face.normal);
    _normal.transformDirection(best.object.matrixWorld);
  } else {
    _normal.set(0, 0, 1);
  }
  return {
    point: best.point.clone(),
    normal: _normal.clone(),
    object: best.object,
    face: best.face || null,
    instanceId: (typeof best.instanceId === 'number') ? best.instanceId : null,
  };
}

// Raycast against a specific SkinnedMesh to find the real animated-mesh surface
// point.  Three.js r184's checkGeometryIntersection calls getVertexPosition()
// which applies bone transforms — so this returns the posed hit point, not
// the bind-pose hit point.
//
// CRITICAL: The bounding sphere is cached from bind pose and may not fit the
// animated mesh, especially when the SkinnedMesh has a scale (e.g. 0.01 from
// an Armature node).  We recompute it each call to ensure the ray actually
// passes the sphere check.
// See: https://discourse.threejs.org/t/raycasters-not-working-with-blender-glb/22449
function _raycastSkinnedMesh(skinnedMesh, origin, dir) {
  if (!skinnedMesh) return null;
  // Update bone world matrices FIRST, then compute bounding sphere.
  skinnedMesh.updateMatrixWorld(true);
  if (skinnedMesh.skeleton) skinnedMesh.skeleton.update();
  skinnedMesh.computeBoundingSphere();
  _rayOrigin.copy(origin);
  _rayDir.copy(dir).normalize();
  _raycaster.set(_rayOrigin, _rayDir);
  _raycaster.far = 200;
  const hits = _raycaster.intersectObject(skinnedMesh, false);
  if (hits.length > 0) {
    const hit = hits[0];
    if (hit.face) {
      _normal.copy(hit.face.normal);
      _normal.transformDirection(hit.object.matrixWorld);
    } else {
      _normal.set(0, 0, 1);
    }
    return {
      point: hit.point.clone(),
      normal: _normal.clone(),
      object: hit.object,
      face: hit.face,
      faceIndex: hit.faceIndex,
    };
  }
  return null;
}

function _findSkinnedMesh(root) {
  if (!root) return null;
  let skinnedMesh = null;
  root.traverse(o => {
    if (o.isSkinnedMesh && !skinnedMesh) skinnedMesh = o;
  });
  return skinnedMesh;
}

function _getNpcSkinnedMesh() {
  if (_npcSkinnedMesh) return _npcSkinnedMesh;
  if (_getNpcSkinnedMeshFn) {
    _npcSkinnedMesh = _getNpcSkinnedMeshFn();
    if (_npcSkinnedMesh) return _npcSkinnedMesh;
  }
  _npcSkinnedMesh = _findSkinnedMesh(_npcRoot);
  return _npcSkinnedMesh;
}

function _getAttributeComponent(attribute, index, component) {
  if (component === 0) return attribute.getX(index);
  if (component === 1) return attribute.getY(index);
  if (component === 2) return attribute.getZ(index);
  return attribute.getW(index);
}

// Derive the attachment bone from the three hit-face vertices. This is only used
// when the broad bone-ball query missed, so surface placement never depends on it.
function _getSurfaceHitBone(surfaceHit) {
  const object = surfaceHit?.object;
  const face = surfaceHit?.face;
  const skeleton = object?.skeleton;
  const geometry = object?.geometry;
  const skinIndex = geometry?.getAttribute('skinIndex');
  const skinWeight = geometry?.getAttribute('skinWeight');
  if (!face || !skeleton || !skinIndex || !skinWeight) return null;

  let usedCount = 0;
  for (let vertex = 0; vertex < 3; vertex++) {
    const vertexIndex = vertex === 0 ? face.a : (vertex === 1 ? face.b : face.c);
    for (let component = 0; component < 4; component++) {
      const boneIndex = _getAttributeComponent(skinIndex, vertexIndex, component);
      const weight = _getAttributeComponent(skinWeight, vertexIndex, component);
      if (weight <= 0 || boneIndex < 0 || boneIndex >= skeleton.bones.length || boneIndex >= MAX_SKIN_BONES) continue;
      if (_faceBoneTotals[boneIndex] === 0) _faceBoneUsed[usedCount++] = boneIndex;
      _faceBoneTotals[boneIndex] += weight;
    }
  }

  let bestIndex = -1;
  let bestWeight = -1;
  for (let i = 0; i < usedCount; i++) {
    const boneIndex = _faceBoneUsed[i];
    const weight = _faceBoneTotals[boneIndex];
    if (weight > bestWeight) {
      bestWeight = weight;
      bestIndex = boneIndex;
    }
    _faceBoneTotals[boneIndex] = 0;
  }
  return bestIndex >= 0 ? skeleton.bones[bestIndex] || null : null;
}

// Approximate skin radius per bone (world units / meters). Used by the graze
// fallback to place a sticker on the bone's surface when the generous bone
// ball sensor is hit but the precise SkinnedMesh raycast misses (thin limbs).
const _SKIN_RADIUS = {
  Head: 0.13, headfront: 0.12, head_end: 0.10, neck: 0.08,
  Hips: 0.15, Spine: 0.14, Spine01: 0.15, Spine02: 0.15,
  LeftShoulder: 0.07, RightShoulder: 0.07,
  LeftArm: 0.06, RightArm: 0.06,
  LeftForeArm: 0.055, RightForeArm: 0.055,
  LeftHand: 0.05, RightHand: 0.05,
  LeftUpLeg: 0.09, RightUpLeg: 0.09,
  LeftLeg: 0.07, RightLeg: 0.07,
  LeftFoot: 0.06, RightFoot: 0.06,
  LeftToeBase: 0.045, RightToeBase: 0.045,
};
const _SKIN_RADIUS_DEFAULT = 0.08;
const _grazeBonePos = new THREE.Vector3();
const _grazeToBone = new THREE.Vector3();
const _grazeClosest = new THREE.Vector3();
const _grazeSide = new THREE.Vector3();

// Synthesize a surface hit when the bone-ball sensor was hit but the precise
// mesh raycast missed. Places the point at the bone's approximate skin
// radius on the side facing the ray, so the sticker hugs the limb.
function _boneGrazeFallback(bone, origin, dirN) {
  bone.getWorldPosition(_grazeBonePos);
  _grazeToBone.subVectors(_grazeBonePos, origin);
  const t = _grazeToBone.dot(dirN);
  if (t < 0) return null; // bone is behind the ray origin
  _grazeClosest.copy(dirN).multiplyScalar(t).add(origin);
  _grazeSide.subVectors(_grazeClosest, _grazeBonePos);
  const dist = _grazeSide.length();
  if (dist > 1e-5) {
    _grazeSide.multiplyScalar(1 / dist); // unit: bone center → ray side
  } else {
    _grazeSide.copy(dirN).multiplyScalar(-1); // dead-center: face the camera
  }
  // 0.85: radii are estimates; bias slightly inward so the sticker hugs the
  // skin rather than floating proud of it.
  const skinR = (_SKIN_RADIUS[bone.name] || _SKIN_RADIUS_DEFAULT) * 0.85;
  const point = new THREE.Vector3().copy(_grazeBonePos).addScaledVector(_grazeSide, skinR);
  const normal = new THREE.Vector3().copy(_grazeSide);
  return { point, normal, bone };
}

// Spawn a sticker projectile from `spawnOrigin` (the gun muzzle) toward the
// nearest surface hit resolved along the aim ray (`origin`/`dir`). The aim ray
// drives TARGETING (what the crosshair points at), while `spawnOrigin` drives
// where the sticker visibly leaves the weapon — they are the camera and the gun
// respectively, so the sticker must not spawn from the player's face.
export function fireStickerAtNpc(origin, dir, spawnOrigin) {
  _preloadTexture();

  const dirN = dir.clone().normalize();

  // ── Step 1a: Rapier raycast for NPC BONE colliders only (v0.2.574) ──
  // Small ball sensors on each bone.  Must be a separate raycast because the
  // broad NPC capsule would shadow them (it's closer to the ray origin).
  // Copy point/normal IMMEDIATELY — castRay reuses internal scratch objects.
  const rawBoneHit = castRay(
    origin.x, origin.y, origin.z,
    dirN.x, dirN.y, dirN.z,
    200, null, c => colliderToBone.has(c.handle)
  );

  const boneInfo = rawBoneHit?.bone || null;
  if (boneInfo?.npcRoot) {
    _npcRoot = boneInfo.npcRoot;
    if (boneInfo.skinnedMesh) _npcSkinnedMesh = boneInfo.skinnedMesh;
  }
  const npcSkinnedMesh = _getNpcSkinnedMesh();
  // The surface ray is authoritative and runs on every fire, even if the
  // generous per-bone ball query misses.
  const npcSurface = _raycastSkinnedMesh(npcSkinnedMesh, origin, dirN);

  // Bot bone sensors still need a surface point, but never fall back to their
  // collider point. NPC sensors reuse the independently resolved NPC surface.
  const boneSurface = boneInfo?.skinnedMesh === npcSkinnedMesh
    ? npcSurface
    : _raycastSkinnedMesh(boneInfo?.skinnedMesh, origin, dirN);

  // ── Step 1b: Rapier raycast for broad NPC capsule + bots + crates ──
  // Excludes bone colliders so we get the broad capsule hit independently.
  const rapierHit = castRay(
    origin.x, origin.y, origin.z,
    dirN.x, dirN.y, dirN.z,
    200, null, c => !colliderToBone.has(c.handle)
  );

  // ── Step 2: Three.js raycast for static meshes (trees, crates, terrain) ──
  const meshHit = _raycastScene(origin, dirN);

  // ── Step 3: Pick the closest hit ──
  // Surface hits only: collider hits identify an entity/bone but never supply
  // a placement point. A closer static mesh can still win over an NPC surface.
  let hitPoint, hitNormal;
  let npcRoot = null, meshObj = null, bone = null, bot = null;
  let bestDist = Infinity;

  // Graze fallback: bone sensor hit but the precise mesh raycast missed
  // (thin limbs). Synthesize a surface point on the hit bone so the sticker
  // still lands on the character instead of flying through to the floor.
  let npcSurfaceEff = npcSurface;
  if (!npcSurfaceEff && boneInfo?.npcRoot && boneInfo.npcRoot === _npcRoot && boneInfo.bone) {
    npcSurfaceEff = _boneGrazeFallback(boneInfo.bone, origin, dirN);
  }

  if (npcSurfaceEff && _npcRoot) {
    const d = npcSurfaceEff.point.distanceTo(origin);
    bestDist = d;
    hitPoint = npcSurfaceEff.point;
    hitNormal = npcSurfaceEff.normal;
    // Real mesh hit: attach to the bone that drives the skin at the hit face
    // (max skin weight). The grazed collider bone can be a neighbour that
    // moves differently, leaving the sticker floating. Graze fallback: use it.
    const surfaceBone = npcSurfaceEff !== npcSurface ? null : _getSurfaceHitBone(npcSurfaceEff);
    bone = surfaceBone || (boneInfo?.npcRoot === _npcRoot ? boneInfo.bone : null);
    npcRoot = _npcRoot;
  }

  let boneSurfaceEff = boneSurface;
  if (!boneSurfaceEff && boneInfo?.bot && boneInfo.bone) {
    boneSurfaceEff = _boneGrazeFallback(boneInfo.bone, origin, dirN);
  }

  if (boneInfo?.bot && boneSurfaceEff) {
    const d = boneSurfaceEff.point.distanceTo(origin);
    if (d < bestDist) {
      bestDist = d;
      hitPoint = boneSurfaceEff.point;
      hitNormal = boneSurfaceEff.normal;
      const surfaceBone = boneSurfaceEff !== boneSurface ? null : _getSurfaceHitBone(boneSurfaceEff);
      bone = surfaceBone || boneInfo.bone || null;
      npcRoot = null;
      bot = boneInfo.bot;
    }
  }

  // Broad capsule hit — it may identify a bot or an NPC that was not yet
  // cached, but it only counts when the real skinned surface also intersects.
  if (rapierHit && (rapierHit.npc || rapierHit.bot)) {
    let broadSkinnedMesh = null;
    let broadSurface = null;
    if (rapierHit.bot?.model?.skinnedMesh) {
      broadSkinnedMesh = rapierHit.bot.model.skinnedMesh;
    } else if (rapierHit.npc) {
      broadSkinnedMesh = rapierHit.npc === _npcRoot
        ? npcSkinnedMesh
        : _findSkinnedMesh(rapierHit.npc);
    }
    if (broadSkinnedMesh) {
      broadSurface = broadSkinnedMesh === npcSkinnedMesh
        ? npcSurface
        : _raycastSkinnedMesh(broadSkinnedMesh, origin, dirN);
    }
    if (broadSurface) {
      const d = broadSurface.point.distanceTo(origin);
      if (d < bestDist) {
        bestDist = d;
        hitPoint = broadSurface.point;
        hitNormal = broadSurface.normal;
        npcRoot = rapierHit.npc || null;
        bot = rapierHit.bot || null;
        bone = boneInfo?.bone &&
          (boneInfo.npcRoot === rapierHit.npc || boneInfo.bot === rapierHit.bot)
          ? boneInfo.bone
          : _getSurfaceHitBone(broadSurface);
      }
    }
  }

  // ── Step 2b: Peer avatars (multiplayer remote players) — surface-authoritative
  // SkinnedMesh raycast, same as the NPC path. Peers have no Rapier colliders,
  // so the Three.js surface ray is the ONLY targeting channel. The peer wrapper
  // Group is a moving target (remoteAvatars.tick sets its position every frame),
  // so the bone-local bake at fire time + flight tracking handle the motion.
  let peerRoot = null;
  const peers = _collectPeerRoots();
  for (let i = 0; i < peers.length; i++) {
    const sm = _findSkinnedMesh(peers[i]);
    if (!sm) continue;
    const peerSurface = _raycastSkinnedMesh(sm, origin, dirN);
    if (!peerSurface) continue;
    const d = peerSurface.point.distanceTo(origin);
    if (d < bestDist) {
      bestDist = d;
      hitPoint = peerSurface.point;
      hitNormal = peerSurface.normal;
      peerRoot = peers[i];
      bone = _getSurfaceHitBone(peerSurface);
      npcRoot = null;
      bot = null;
      meshObj = null;
    }
  }

  let meshHitAccepted = null;
  if (meshHit) {
    const d = meshHit.point.distanceTo(origin);
    if (d < bestDist) {
      bestDist = d;
      hitPoint = meshHit.point;
      hitNormal = meshHit.normal;
      meshObj = meshHit.object;
      meshHitAccepted = meshHit;
      npcRoot = null;
      bot = null;
      bone = null;
      peerRoot = null;
    }
  }

  if (!hitPoint) return false; // no hit at all

  // Bake the hit into the bone's LOCAL space at fire time. The NPC walks
  // ~0.3m during the 0.22s flight; storing a bone-local offset lets the
  // landing code place the sticker at the bone's CURRENT transform of that
  // offset, so it rides the skin instead of trailing behind in mid-air.
  let boneLocalOffset = null;
  let boneLocalNormal = null;
  if (bone) {
    bone.updateWorldMatrix(true, false);
    _boneWorldInv.copy(bone.matrixWorld).invert();
    boneLocalOffset = hitPoint.clone().applyMatrix4(_boneWorldInv);
    boneLocalNormal = hitNormal.clone().transformDirection(_boneWorldInv);
  }

  // Flying sticker: always visible (texture or pink fallback)
  const mat = new THREE.SpriteMaterial({
    map: _texture || null,
    color: _texture ? 0xffffff : 0xff00ff,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.isSticker = true;
  sprite.scale.set(FLY_SIZE, FLY_SIZE * ATTACHED_RATIO, 1);
  // Spawn at the gun muzzle, not the ray origin (camera aim). Like a bullet, the
  // sticker leaves the end of the gun, then flies to the crosshair's hit point.
  const spawnPoint = spawnOrigin || origin;
  sprite.position.copy(spawnPoint);
  scene.add(sprite);

  // Render-mode decision captured at fire time so a mid-flight A/B flip does
  // not change how this specific sticker lands. Only static, non-instanced
  // Mesh hits with a face qualify for baked; everything else falls back to
  // the existing plane path (skinned, instanced grass, no-face fallbacks).
  const renderMode = chooseStickerRenderMode(meshHitAccepted, _renderState);

  _stickers.push({
    sprite,
    from: spawnPoint.clone(),
    to: hitPoint.clone(),
    normal: hitNormal.clone(),
    npcRoot,
    meshObj,
    bone,
    bot,
    peerRoot,
    boneLocalOffset,
    boneLocalNormal,
    renderMode,
    hitFace: meshHitAccepted?.face || null,
    hitInstanceId: meshHitAccepted?.instanceId ?? null,
    t: 0,
    duration: FLIGHT_DURATION,
  });

  return true;
}

// Called every frame to update flying + attached stickers.
export function tickStickerNpc(dt) {
  // Preload the FTFF texture on the FIRST tick (arena entry), not the first
  // fire — otherwise the opening shots show the pink `0xff00ff` fallback while
  // the image is still streaming. The guard makes this idempotent + free.
  _preloadTexture();
  // Poll for NPC root (for gesture trigger detection)
  if (!_npcRoot) _pollNpcRoot();
  if (!_npcRoot && _getNpcRootFn) {
    const r = _getNpcRootFn();
    if (r) {
      if (_npcRoot !== r) _npcSkinnedMesh = null;
      _npcRoot = r;
    }
  }
  if (!_npcSkinnedMesh && _getNpcSkinnedMeshFn) {
    _npcSkinnedMesh = _getNpcSkinnedMeshFn();
  }

  // Update flying stickers
  for (let i = _stickers.length - 1; i >= 0; i--) {
    const s = _stickers[i];
    s.t += dt;
    // Bone-bound stickers track the moving bone during flight so the landing
    // is seamless (the NPC walks ~0.3m during the 0.22s flight).
    if (s.bone && s.boneLocalOffset) {
      s.bone.updateWorldMatrix(true, false);
      _worldTarget.copy(s.boneLocalOffset).applyMatrix4(s.bone.matrixWorld);
      s.to.copy(_worldTarget);
    }
    const p = Math.min(1, s.t / s.duration);
    const e = 1 - (1 - p) * (1 - p);
    s.sprite.position.lerpVectors(s.from, s.to, e);

    const size = FLY_SIZE + (ATTACHED_SIZE - FLY_SIZE) * e;
    s.sprite.scale.set(size, size * ATTACHED_RATIO, 1);

    if (p >= 1) {
      scene.remove(s.sprite);
      if (s.sprite.material) s.sprite.material.dispose();
      _stickers.splice(i, 1);

      // ADR-0090 slice 2 — BAKED decal branch. When the fire hit a static,
      // non-instanced Mesh with a face and `forcePlaneMode` was OFF, project a
      // DecalGeometry onto the target mesh so the sticker wraps the actual
      // surface (rather than a flat plane above it). Parented to the target so
      // it inherits any world transform of that mesh (crates move, trees sway).
      if (s.renderMode === STICKER_RENDER_MODE.BAKED && s.meshObj && _texture) {
        try {
          const target = s.meshObj;
          target.updateMatrixWorld(true);
          const worldPos = s.to.clone();
          // Decal orientation: Euler pointing along the surface normal. Three's
          // DecalGeometry helper reads the projector's rotation to build the
          // cutting frustum, so we align its z-axis with the hit normal.
          const projector = new THREE.Object3D();
          projector.position.copy(worldPos);
          projector.up.set(0, 1, 0);
          const look = new THREE.Vector3().copy(worldPos).add(s.normal);
          projector.lookAt(look);
          // Decal box size (world units). Match the plane path's on-surface
          // footprint; depth is the projection thickness through the mesh.
          const size = new THREE.Vector3(
            ATTACHED_SIZE, ATTACHED_SIZE * ATTACHED_RATIO, ATTACHED_SIZE
          );
          const decalGeo = new DecalGeometry(target, projector.position, projector.rotation, size);
          // Diagnostic: baked decals were landing invisibly in playtest. Log the
          // vertex count + target so a success-but-invisible vs throw can be told
          // apart in the console (the throw path already warns + falls back).
          console.debug('[sticker] baked decal built:', {
            verts: decalGeo && decalGeo.attributes && decalGeo.attributes.position
              ? decalGeo.attributes.position.count : 0,
            target: (target.name || target.type),
          });
          const decalMat = createBakedDecalMaterial(_texture);
          const decal = new THREE.Mesh(decalGeo, decalMat);
          decal.userData.isSticker = true;
          // DecalGeometry is authored in WORLD space against the target mesh.
          // Parenting to `target` inherits its world transform, so we must
          // pre-invert to counteract that inheritance and keep the decal put.
          target.getWorldQuaternion(_worldQuatInv).invert();
          decal.quaternion.copy(_worldQuatInv);
          const localPos = worldPos.clone();
          target.worldToLocal(localPos);
          decal.position.copy(localPos);
          target.add(decal);
          _attached.push({ mesh: decal, life: ATTACHED_LIFETIME, maxLife: ATTACHED_LIFETIME });
          while (_attached.length > MAX_ATTACHED) {
            const old = _attached.shift();
            if (old.mesh.parent) old.mesh.parent.remove(old.mesh);
            if (old.mesh.geometry) old.mesh.geometry.dispose();
            if (old.mesh.material) old.mesh.material.dispose();
          }
          continue; // baked path took over; skip the plane-attach block
        } catch (e) {
          // A DecalGeometry failure (degenerate face, non-BufferGeometry, etc.)
          // is not fatal — fall through to the plane path so the sticker still
          // lands somewhere the player can see.
          console.warn('[sticker] baked decal failed, falling back to plane:', e);
        }
      }

      // Create attached sticker
      const mat = new THREE.MeshBasicMaterial({
        map: _texture || null,
        color: _texture ? 0xffffff : 0xff00ff,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      });
      const geo = new THREE.PlaneGeometry(ATTACHED_SIZE, ATTACHED_SIZE * ATTACHED_RATIO);
      const sticker = new THREE.Mesh(geo, mat);
      sticker.userData.isSticker = true;

      // Compute final world position: hit point + small z-fight offset.
      // For SkinnedMesh hits, hitPoint is already on the mesh surface.
      // 0.012 lifts the flat plane clear of curved skin (was 0.006 — the
      // corners of the 8cm plane clipped into rounded limbs at that depth).
      const worldPos = s.to.clone();
      worldPos.x += s.normal.x * 0.012;
      worldPos.y += s.normal.y * 0.012;
      worldPos.z += s.normal.z * 0.012;

      // Orient plane to surface normal
      _quat.setFromUnitVectors(_zAxis, s.normal);

      let parented = false;

      // ── BONE: parent to specific bone via Object3D.attach() (v0.2.574) ──
      if (s.bone) {
        try {
          if (s.boneLocalOffset) {
            // Place at the bone's CURRENT world transform of the fire-time
            // local offset — the NPC moved during flight, so the raw hit point
            // is stale. This glues the sticker to the skin with zero lag.
            s.bone.updateWorldMatrix(true, false);
            _worldTarget.copy(s.boneLocalOffset).applyMatrix4(s.bone.matrixWorld);
            _worldNormal.copy(s.boneLocalNormal).transformDirection(s.bone.matrixWorld);
            sticker.position.copy(_worldTarget);
            sticker.position.x += _worldNormal.x * 0.012;
            sticker.position.y += _worldNormal.y * 0.012;
            sticker.position.z += _worldNormal.z * 0.012;
            _quat.setFromUnitVectors(_zAxis, _worldNormal);
            sticker.quaternion.copy(_quat);
          } else {
            sticker.position.copy(worldPos);
            sticker.quaternion.copy(_quat);
          }
          sticker.scale.setScalar(1.0);
          scene.add(sticker);
          sticker.updateMatrixWorld(true);
          s.bone.attach(sticker);
          parented = true;
        } catch (e) {
          console.warn('[sticker] bone.attach failed:', e);
        }
      }

      // ── NPC: parent to NPC root (broad capsule hit, no specific bone) ──
      if (!parented && s.npcRoot) {
        try {
          s.npcRoot.updateMatrixWorld(true);
          const localPos = worldPos.clone();
          s.npcRoot.worldToLocal(localPos);
          sticker.position.copy(localPos);
          sticker.quaternion.copy(_quat);
          // Adjust orientation to match NPC root rotation
          s.npcRoot.getWorldQuaternion(_worldQuatInv).invert();
          sticker.quaternion.premultiply(_worldQuatInv);
          sticker.scale.setScalar(1.0);
          s.npcRoot.add(sticker);
          parented = true;
        } catch (e) {
          console.warn('[sticker] NPC root parenting failed:', e);
        }
      }

      // ── BOT: parent to bot root (broad capsule/head hit, no specific bone) ──
      // v0.2.575: same pattern as NPC root — convert world to bot-root-local.
      if (!parented && s.bot && s.bot.model?.root) {
        try {
          const botRoot = s.bot.model.root;
          botRoot.updateMatrixWorld(true);
          const localPos = worldPos.clone();
          botRoot.worldToLocal(localPos);
          sticker.position.copy(localPos);
          sticker.quaternion.copy(_quat);
          botRoot.getWorldQuaternion(_worldQuatInv).invert();
          sticker.quaternion.premultiply(_worldQuatInv);
          sticker.scale.setScalar(1.0);
          botRoot.add(sticker);
          parented = true;
        } catch (e) {
          console.warn('[sticker] bot root parenting failed:', e);
        }
      }

      // ── PEER: parent to peer avatar root (fallback when no bone was found) ──
      // Same pattern as NPC root: convert world → peer-local, then add.
      // The peer wrapper Group moves every frame via remoteAvatars.tick, so
      // the sticker rides the peer's transform automatically.
      if (!parented && s.peerRoot) {
        try {
          s.peerRoot.updateMatrixWorld(true);
          const localPos = worldPos.clone();
          s.peerRoot.worldToLocal(localPos);
          sticker.position.copy(localPos);
          sticker.quaternion.copy(_quat);
          s.peerRoot.getWorldQuaternion(_worldQuatInv).invert();
          sticker.quaternion.premultiply(_worldQuatInv);
          sticker.scale.setScalar(1.0);
          s.peerRoot.add(sticker);
          parented = true;
        } catch (e) {
          console.warn('[sticker] peer root parenting failed:', e);
        }
      }

      // ── Static mesh parenting (trees, crates, etc.) ──
      if (!parented && s.meshObj && s.meshObj.parent) {
        try {
          const target = s.meshObj;
          target.updateMatrixWorld(true);
          const localPos = worldPos.clone();
          target.worldToLocal(localPos);
          sticker.position.copy(localPos);
          target.getWorldQuaternion(_worldQuatInv).invert();
          sticker.quaternion.multiplyQuaternions(_worldQuatInv, _quat);
          target.add(sticker);
          parented = true;
        } catch (e) { /* fall through to world space */ }
      }

      if (!parented) {
        sticker.position.copy(worldPos);
        sticker.quaternion.copy(_quat);
        scene.add(sticker);
      }

      _attached.push({ mesh: sticker, life: ATTACHED_LIFETIME, maxLife: ATTACHED_LIFETIME });

      while (_attached.length > MAX_ATTACHED) {
        const old = _attached.shift();
        if (old.mesh.parent) old.mesh.parent.remove(old.mesh);
        if (old.mesh.geometry) old.mesh.geometry.dispose();
        if (old.mesh.material) old.mesh.material.dispose();
      }

      // Trigger NPC gesture if hit the NPC
      if (s.npcRoot) {
        import('./napNpc.js').then(({ triggerNpcGesture }) => {
          if (triggerNpcGesture) triggerNpcGesture();
        });
      }
    }
  }

  // Update attached stickers (fade out in last 2 seconds)
  for (let i = _attached.length - 1; i >= 0; i--) {
    const a = _attached[i];
    a.life -= dt;
    if (a.life <= 0) {
      if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
      if (a.mesh.geometry) a.mesh.geometry.dispose();
      if (a.mesh.material) a.mesh.material.dispose();
      _attached.splice(i, 1);
    } else {
      if (a.life < 2.0) {
        a.mesh.material.opacity = a.life / 2.0;
      }
    }
  }
}

// NPC root ref (for gesture trigger detection)
let _npcRoot = null;
let _npcSkinnedMesh = null;
let _getNpcRootFn = null;
let _getNpcSkinnedMeshFn = null;
let _npcImportStarted = false;

export function setNpcRoot(root) {
  if (_npcRoot !== root) _npcSkinnedMesh = null;
  _npcRoot = root;
}

function _pollNpcRoot() {
  if (_npcImportStarted) return;
  _npcImportStarted = true;
  import('./napNpc.js').then(({ getNpcRoot, getNpcSkinnedMesh }) => {
    _getNpcRootFn = getNpcRoot;
    _getNpcSkinnedMeshFn = getNpcSkinnedMesh;
  });
}

export function isStickerNpcActive() {
  return _npcRoot !== null;
}
