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
const MAX_SKIN_BONES = 256;
const _faceBoneTotals = new Float32Array(MAX_SKIN_BONES);
const _faceBoneUsed = new Uint16Array(12);

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
  console.log('[sticker] skinnedMesh raycast:', hits.length, 'hits |',
    'bindMatrix is identity:', skinnedMesh.bindMatrix.elements[0] === 1 && skinnedMesh.bindMatrix.elements[5] === 1 && skinnedMesh.bindMatrix.elements[10] === 1,
    '| bsphere center:', skinnedMesh.boundingSphere?.center.toArray().map(v=>v.toFixed(2)),
    'radius:', skinnedMesh.boundingSphere?.radius.toFixed(2),
    '| worldScale:', skinnedMesh.matrixWorld.elements[0].toFixed(4));
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

function _addSurfaceDebugMarker(surfaceHit) {
  // DEBUG: red sphere at the real SkinnedMesh surface hit.
  // depthTest:false so it's ALWAYS visible (not hidden inside the mesh).
  console.log('[sticker] surface hit point:', surfaceHit.point.toArray().map(v=>v.toFixed(3)));
  const rGeo = new THREE.SphereGeometry(0.05, 8, 6);
  const rMat = new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, opacity: 0.8, depthTest: false });
  const rDbg = new THREE.Mesh(rGeo, rMat);
  rDbg.position.copy(surfaceHit.point);
  rDbg.renderOrder = 999;
  rDbg.userData.isDebugMarker = true;
  rDbg.userData.life = 5.0;
  scene.add(rDbg);
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

  console.log('[sticker] fire', rawBoneHit?.bone ? 'hit' : 'miss');

  const boneInfo = rawBoneHit?.bone || null;
  if (boneInfo?.npcRoot) {
    _npcRoot = boneInfo.npcRoot;
    if (boneInfo.skinnedMesh) _npcSkinnedMesh = boneInfo.skinnedMesh;
  }
  const npcSkinnedMesh = _getNpcSkinnedMesh();
  // The surface ray is authoritative and runs on every fire, even if the
  // generous per-bone ball query misses.
  const npcSurface = _raycastSkinnedMesh(npcSkinnedMesh, origin, dirN);
  if (npcSurface) _addSurfaceDebugMarker(npcSurface);

  // Bot bone sensors still need a surface point, but never fall back to their
  // collider point. NPC sensors reuse the independently resolved NPC surface.
  const boneSurface = boneInfo?.skinnedMesh === npcSkinnedMesh
    ? npcSurface
    : _raycastSkinnedMesh(boneInfo?.skinnedMesh, origin, dirN);
  if (boneSurface && boneSurface !== npcSurface) _addSurfaceDebugMarker(boneSurface);

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

  if (npcSurface && _npcRoot) {
    const d = npcSurface.point.distanceTo(origin);
    bestDist = d;
    hitPoint = npcSurface.point;
    hitNormal = npcSurface.normal;
    bone = boneInfo?.npcRoot === _npcRoot && boneInfo.bone
      ? boneInfo.bone
      : _getSurfaceHitBone(npcSurface);
    npcRoot = _npcRoot;
  }

  if (boneInfo?.bot && boneSurface) {
    const d = boneSurface.point.distanceTo(origin);
    if (d < bestDist) {
      bestDist = d;
      hitPoint = boneSurface.point;
      hitNormal = boneSurface.normal;
      bone = boneInfo.bone || _getSurfaceHitBone(boneSurface);
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
      if (broadSurface !== npcSurface && broadSurface !== boneSurface) _addSurfaceDebugMarker(broadSurface);
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

      // Compute final world position: hit point + tiny z-fight offset.
      // For SkinnedMesh hits, hitPoint is already on the mesh surface.
      const worldPos = s.to.clone();
      worldPos.x += s.normal.x * 0.006;
      worldPos.y += s.normal.y * 0.006;
      worldPos.z += s.normal.z * 0.006;

      // Orient plane to surface normal
      _quat.setFromUnitVectors(_zAxis, s.normal);

      let parented = false;

      // ── BONE: parent to specific bone via Object3D.attach() (v0.2.574) ──
      console.log('[sticker] land: bone=', s.bone?.name || 'NULL', 'npcRoot=', !!s.npcRoot, 'bot=', !!s.bot, 'meshObj=', !!s.meshObj);
      if (s.bone) {
        try {
          // DEBUG: green sphere at worldPos BEFORE bone.attach()
          const dbgGeo = new THREE.SphereGeometry(0.03, 8, 6);
          const dbgMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, transparent: true, opacity: 0.8, depthTest: false });
          const dbg = new THREE.Mesh(dbgGeo, dbgMat);
          dbg.position.copy(worldPos);
          dbg.userData.isDebugMarker = true;
          dbg.renderOrder = 999;
          dbg.userData.life = 5.0; // seconds
          scene.add(dbg);

          sticker.position.copy(worldPos);
          sticker.quaternion.copy(_quat);
          sticker.scale.setScalar(1.0);
          scene.add(sticker);
          sticker.updateMatrixWorld(true);
          s.bone.attach(sticker);
          parented = true;
          console.log('[sticker] attached to bone:', s.bone.name, 'worldPos after attach:', sticker.getWorldPosition(new THREE.Vector3()).toArray().map(v=>v.toFixed(3)));
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
