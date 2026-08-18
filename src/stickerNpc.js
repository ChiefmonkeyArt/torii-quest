// stickerNpc.js — FTFF sticker projectile system.
// Stickers fire from the gun and stick to any surface in the scene.
// For the NPC: uses two Rapier raycasts — one for per-bone ball sensors
// (hits individual arms, legs, torso, head) and one for the broad capsule
// (fallback). When a bone is hit, the sticker is parented to that bone via
// Object3D.attach() — it follows the bone's animation automatically.
// For static objects (trees, crates): uses Three.js raycaster against meshes.
import * as THREE from 'three';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';
import { castRay, colliderToBone } from './physics.js';

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

// Mesh cache — refreshed periodically to pick up newly loaded objects
const _meshCache = [];
let _meshCacheTime = 0;
const MESH_CACHE_TTL = 2000; // refresh every 2s

// Names to exclude from sticker raycasting
const EXCLUDE_NAMES = new Set([
  'sea', 'world-gun-normalizer', 'coastline-wall', 'coastline-neon',
  'portal-mesh-group', 'PORTAL_MESH_GROUP', 'grass-instanced',
]);

const FLY_SIZE = 0.6;
const ATTACHED_SIZE = 0.08;
const ATTACHED_RATIO = 0.6;
const FLIGHT_DURATION = 0.22;
const MAX_ATTACHED = 120;
const ATTACHED_LIFETIME = 180;

// Bone ball radius is 0.20 (generous for easy hit detection), but the mesh surface
// is closer to the bone center.  When a bone collider is hit, the sticker must be
// placed near the mesh surface, not on the sphere surface.  We offset the sticker
// inward from the hit point by this amount.  Tuned empirically.
const BONE_HIT_INWARD_OFFSET = 0.0;

// Preload the texture.
function _preloadTexture() {
  if (_texture || _textureLoading) return;
  _textureLoading = true;
  console.log('[sticker] preloading texture');
  const loader = new THREE.TextureLoader();
  loader.load(assetUrl('/ftff-sticker.png'), tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    _texture = tex;
    _textureLoading = false;
    console.log('[sticker] texture loaded', tex.image.width + 'x' + tex.image.height);
  }, undefined, err => {
    console.warn('[sticker] texture load FAILED:', err);
    _textureLoading = false;
  });
}

// Check if a mesh/object should be excluded from sticker placement.
function _isExcluded(obj) {
  let o = obj;
  while (o) {
    if (o.name && EXCLUDE_NAMES.has(o.name)) return true;
    if (o.name === 'fps-body' || o.name === 'player-model') return true;
    // Skip NPC + bot meshes — handled by Rapier colliders, not Three.js raycaster
    if (_npcRoot && o === _npcRoot) return true;
    if (o.userData?.isBotMesh) return true;
    o = o.parent;
  }
  return false;
}

// Collect all Mesh objects in the scene (not Sprites, Lights, Cameras).
// Refreshed every MESH_CACHE_TTL ms to pick up dynamically loaded objects.
function _getMeshes() {
  const now = performance.now();
  if (now - _meshCacheTime > MESH_CACHE_TTL) {
    _meshCache.length = 0;
    scene.traverse(obj => {
      if (obj.isMesh && !obj.userData.isSticker && !_isExcluded(obj)) {
        const mat = obj.material;
        if (mat && mat.visible === false) return;
        _meshCache.push(obj);
      }
    });
    _meshCacheTime = now;
  }
  return _meshCache;
}

// Three.js raycast for static meshes (trees, crates, terrain).
function _raycastScene(origin, dir) {
  _rayOrigin.copy(origin);
  _rayDir.copy(dir).normalize();
  _raycaster.set(_rayOrigin, _rayDir);
  _raycaster.far = 200;

  const meshes = _getMeshes();
  const hits = _raycaster.intersectObjects(meshes, false);
  for (const hit of hits) {
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
    };
  }
  return null;
}

// Raycast against a specific SkinnedMesh to find the real animated-mesh surface
// point.  Three.js r184's checkGeometryIntersection calls getVertexPosition()
// which applies bone transforms — so this returns the posed hit point, not
// the bind-pose hit point.
function _raycastSkinnedMesh(skinnedMesh, origin, dir) {
  if (!skinnedMesh) return null;
  _rayOrigin.copy(origin);
  _rayDir.copy(dir).normalize();
  _raycaster.set(_rayOrigin, _rayDir);
  _raycaster.far = 200;
  const hits = _raycaster.intersectObject(skinnedMesh, false);
  for (const hit of hits) {
    if (hit.face) {
      _normal.copy(hit.face.normal);
      _normal.transformDirection(hit.object.matrixWorld);
    } else {
      _normal.set(0, 0, 1);
    }
    return {
      point: hit.point.clone(),
      normal: _normal.clone(),
    };
  }
  return null;
}

// Spawn a sticker projectile from `origin` toward the nearest surface hit.
export function fireStickerAtNpc(origin, dir) {
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

  let bonePoint = null, boneNormal = null, boneInfo = null;
  if (rawBoneHit?.bone) {
    // Bone collider hit — offset inward from sphere surface toward mesh surface.
    bonePoint = new THREE.Vector3(rawBoneHit.point.x, rawBoneHit.point.y, rawBoneHit.point.z);
    boneNormal = new THREE.Vector3(rawBoneHit.normal.x, rawBoneHit.normal.y, rawBoneHit.normal.z);
    bonePoint.addScaledVector(boneNormal, BONE_HIT_INWARD_OFFSET);
    boneInfo = rawBoneHit.bone;
  }

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
  // Bone hit wins over same entity's broad capsule — broad is fallback only
  // when no bone was hit for that entity.  A closer blocker from a DIFFERENT
  // entity (or static mesh) still wins over a farther bone hit.
  let hitPoint, hitNormal;
  let npcRoot = null, meshObj = null, bone = null, bot = null;
  let bestDist = Infinity;

  if (boneInfo) {
    const d = bonePoint.distanceTo(origin);
    bestDist = d;
    hitPoint = bonePoint;
    hitNormal = boneNormal;
    bone = boneInfo.bone;       // the Three.js Bone Object3D
    npcRoot = boneInfo.npcRoot || null; // NPC root for gesture trigger
    bot = boneInfo.bot || null;        // bot ref (v0.2.575)
  }

  // Broad capsule hit — skip if it's the SAME entity as the bone hit.
  if (rapierHit && (rapierHit.npc || rapierHit.bot)) {
    const sameEntity = boneInfo &&
      (boneInfo.npcRoot === rapierHit.npc || boneInfo.bot === rapierHit.bot);
    if (!sameEntity) {
      // Try to find the SkinnedMesh for surface raycasting.
      let broadSkinnedMesh = null;
      if (rapierHit.bot?.model?.skinnedMesh) broadSkinnedMesh = rapierHit.bot.model.skinnedMesh;
      else if (rapierHit.npc) {
        // NPC: traverse for SkinnedMesh (cached after first find).
        rapierHit.npc.traverse(o => { if (o.isSkinnedMesh && !broadSkinnedMesh) broadSkinnedMesh = o; });
      }
      const broadSurface = broadSkinnedMesh ? _raycastSkinnedMesh(broadSkinnedMesh, origin, dirN) : null;
      const rp = broadSurface
        ? broadSurface.point
        : new THREE.Vector3(rapierHit.point.x, rapierHit.point.y, rapierHit.point.z);
      const rn = broadSurface
        ? broadSurface.normal
        : new THREE.Vector3(rapierHit.normal.x, rapierHit.normal.y, rapierHit.normal.z);
      const d = rp.distanceTo(origin);
      if (d < bestDist) {
        bestDist = d;
        hitPoint = rp;
        hitNormal = rn;
        npcRoot = rapierHit.npc || null;
        bot = rapierHit.bot || null;
        bone = null; // broad capsule hit — no specific bone
      }
    }
  }

  if (meshHit) {
    const d = meshHit.point.distanceTo(origin);
    if (d < bestDist) {
      bestDist = d;
      hitPoint = meshHit.point;
      hitNormal = meshHit.normal;
      meshObj = meshHit.object;
      npcRoot = null;
      bot = null;
      bone = null;
    }
  }

  if (!hitPoint) return false; // no hit at all

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
  sprite.position.copy(origin);
  scene.add(sprite);

  _stickers.push({
    sprite,
    from: origin.clone(),
    to: hitPoint.clone(),
    normal: hitNormal.clone(),
    npcRoot,
    meshObj,
    bone,
    bot,
    t: 0,
    duration: FLIGHT_DURATION,
  });

  return true;
}

// Called every frame to update flying + attached stickers.
export function tickStickerNpc(dt) {
  // Poll for NPC root (for gesture trigger detection)
  if (!_npcRoot) _pollNpcRoot();
  if (!_npcRoot && _getNpcRootFn) {
    const r = _getNpcRootFn();
    if (r) _npcRoot = r;
  }

  // Update flying stickers
  for (let i = _stickers.length - 1; i >= 0; i--) {
    const s = _stickers[i];
    s.t += dt;
    const p = Math.min(1, s.t / s.duration);
    const e = 1 - (1 - p) * (1 - p);
    s.sprite.position.lerpVectors(s.from, s.to, e);

    const size = FLY_SIZE + (ATTACHED_SIZE - FLY_SIZE) * e;
    s.sprite.scale.set(size, size * ATTACHED_RATIO, 1);

    if (p >= 1) {
      scene.remove(s.sprite);
      if (s.sprite.material) s.sprite.material.dispose();
      _stickers.splice(i, 1);

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

      // Compute final world position: hit point + small offset along normal
      const worldPos = s.to.clone();
      worldPos.x += s.normal.x * 0.02;
      worldPos.y += s.normal.y * 0.02;
      worldPos.z += s.normal.z * 0.02;

      // Orient plane to surface normal
      _quat.setFromUnitVectors(_zAxis, s.normal);

      let parented = false;

      // ── BONE: parent to specific bone via Object3D.attach() (v0.2.574) ──
      if (s.bone) {
        try {
          // DEBUG: green sphere at worldPos BEFORE bone.attach()
          const dbgGeo = new THREE.SphereGeometry(0.03, 8, 6);
          const dbgMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 1 });
          const dbg = new THREE.Mesh(dbgGeo, dbgMat);
          dbg.position.copy(worldPos);
          dbg.userData.isDebugMarker = true;
          dbg.userData.life = 5.0; // seconds
          scene.add(dbg);

          sticker.position.copy(worldPos);
          sticker.quaternion.copy(_quat);
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

  // Clean up debug markers
  for (let i = scene.children.length - 1; i >= 0; i--) {
    const c = scene.children[i];
    if (c.userData.isDebugMarker) {
      c.userData.life -= dt;
      if (c.userData.life <= 0) {
        scene.remove(c);
        if (c.geometry) c.geometry.dispose();
        if (c.material) c.material.dispose();
      }
    }
  }
}

// NPC root ref (for gesture trigger detection)
let _npcRoot = null;
let _getNpcRootFn = null;
let _npcImportStarted = false;

export function setNpcRoot(root) { _npcRoot = root; }

function _pollNpcRoot() {
  if (_npcImportStarted) return;
  _npcImportStarted = true;
  import('./napNpc.js').then(({ getNpcRoot }) => {
    _getNpcRootFn = getNpcRoot;
  });
}

export function isStickerNpcActive() {
  return _npcRoot !== null;
}
