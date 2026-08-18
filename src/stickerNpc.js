// stickerNpc.js — FTFF sticker projectile system.
// Stickers fire from the gun and stick to any mesh surface in the scene
// (NPC, trees, crates, terrain, bots, torii gate, etc.) using a Three.js
// Raycaster against collected Mesh objects only (avoids Sprite crash).
import * as THREE from 'three';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';

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
const _bonePos = new THREE.Vector3();
const _worldQuatInv = new THREE.Quaternion();

// Scratch matrices for per-frame bone tracking (constraint [4])
const _m4a = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();
const _m4c = new THREE.Matrix4();
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _v3c = new THREE.Vector3();

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

// Find the nearest mesh surface hit by a ray from origin in direction dir.
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

// Find the bone that controls the hit vertex using skinIndex/skinWeight.
// This is the correct way: the skinIndex attribute tells exactly which
// bone(s) influence each vertex. We pick the highest-weighted bone across
// the hit triangle's 3 vertices.
function _findInfluencingBone(skinnedMesh, face) {
  if (!skinnedMesh.isSkinnedMesh || !skinnedMesh.skeleton || !face) return null;

  const geometry = skinnedMesh.geometry;
  const skinIndexAttr = geometry.getAttribute('skinIndex');
  const skinWeightAttr = geometry.getAttribute('skinWeight');
  if (!skinIndexAttr || !skinWeightAttr) return null;

  // Accumulate bone weights across the 3 vertices of the hit face
  const boneWeights = new Map();
  const verts = [face.a, face.b, face.c];

  for (const vi of verts) {
    for (let j = 0; j < 4; j++) {
      const boneIdx = skinIndexAttr.getComponent(vi, j);
      const weight = skinWeightAttr.getComponent(vi, j);
      if (weight > 0) {
        boneWeights.set(boneIdx, (boneWeights.get(boneIdx) || 0) + weight);
      }
    }
  }

  // Pick the bone with the highest total weight
  let bestBone = -1;
  let bestWeight = 0;
  for (const [idx, weight] of boneWeights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestBone = idx;
    }
  }

  if (bestBone >= 0 && skinnedMesh.skeleton.bones[bestBone]) {
    return skinnedMesh.skeleton.bones[bestBone];
  }
  return null;
}

// Spawn a sticker projectile from `origin` toward the nearest surface hit.
export function fireStickerAtNpc(origin, dir) {
  _preloadTexture();

  const hit = _raycastScene(origin, dir);
  if (!hit) {
  
    return false;
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
  sprite.position.copy(origin);
  scene.add(sprite);

  _stickers.push({
    sprite,
    from: origin.clone(),
    to: hit.point.clone(),
    normal: hit.normal,
    targetObject: hit.object,
    face: hit.face,
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

      // Create attached sticker — use texture if available, else pink fallback
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
      sticker.userData.isSticker = true; // exclude from raycast cache

      // Compute final world position: hit point + small offset along normal
      const worldPos = s.to.clone();
      worldPos.x += s.normal.x * 0.01;
      worldPos.y += s.normal.y * 0.01;
      worldPos.z += s.normal.z * 0.01;

      // Orient plane to surface normal
      _quat.setFromUnitVectors(_zAxis, s.normal);

      // ── Per-frame bone-matrix tracking for SkinnedMesh (NPC, bots, players) ──
      // The vertex shader computes: bindMatrixInverse * boneMatrices[i] * bindMatrix * vertex
      // We replicate this each frame so stickers track the deforming mesh surface.
      let parented = false;
      if (s.targetObject.isSkinnedMesh && s.face) {
        const bone = _findInfluencingBone(s.targetObject, s.face);
        if (bone) {
          const skinnedMesh = s.targetObject;
          const boneIndex = skinnedMesh.skeleton.bones.indexOf(bone);
          if (boneIndex >= 0) {
            try {
              // Simplified approach: the raycaster hits the bind-pose mesh.
              // vertex = meshInverse * hitPoint (bind-pose geometry vertex)
              // Each frame: sticker.position = boneMat * vertex (replicates shader)
              // This works when bindMatrix = identity (common for GLTF-loaded meshes).
              skinnedMesh.updateMatrixWorld(true);
              skinnedMesh.skeleton.update();

              const meshInverse = _m4a.copy(skinnedMesh.matrixWorld).invert();
              const vertex = _v3a.copy(worldPos).applyMatrix4(meshInverse);

              // Debug: log key values to diagnose
              const boneMat0 = _m4b.fromArray(skinnedMesh.skeleton.boneMatrices, boneIndex * 16);
              const testPos = vertex.clone().applyMatrix4(boneMat0);
              const testWorld = testPos.clone().applyMatrix4(skinnedMesh.matrixWorld);
              console.log('[sticker] boneTrack setup:',
                'bone:', bone.name, 'idx:', boneIndex,
                'hitWorld:', worldPos.x.toFixed(2), worldPos.y.toFixed(2), worldPos.z.toFixed(2),
                'vertex:', vertex.x.toFixed(2), vertex.y.toFixed(2), vertex.z.toFixed(2),
                'testWorld:', testWorld.x.toFixed(2), testWorld.y.toFixed(2), testWorld.z.toFixed(2),
                'bindMatIsI:', skinnedMesh.bindMatrix.elements[0] === 1 && skinnedMesh.bindMatrix.elements[5] === 1 && skinnedMesh.bindMatrix.elements[10] === 1 && skinnedMesh.bindMatrix.elements[12] === 0 && skinnedMesh.bindMatrix.elements[13] === 0 && skinnedMesh.bindMatrix.elements[14] === 0);

              // Store vertex for per-frame updates
              sticker.userData.stickerBoneTrack = {
                skinnedMesh,
                boneIndex,
                vertex: vertex.clone(),
                bindNormal: s.normal.clone().transformDirection(meshInverse),
              };

              // Set initial position: boneMat * vertex
              _m4a.copy(boneMat0);
              sticker.position.copy(vertex).applyMatrix4(_m4a);

              // Set initial orientation
              const currentNormal = _v3c.copy(bindNormal).transformDirection(_m4a);
              _quat.setFromUnitVectors(_zAxis, currentNormal);
              sticker.quaternion.copy(_quat);

              // Scale: compensate for SkinnedMesh world scale (0.01 from NPC root)
              const meshScale = new THREE.Vector3();
              skinnedMesh.getWorldScale(meshScale);
              if (meshScale.x > 0.001 && meshScale.y > 0.001 && meshScale.z > 0.001) {
                sticker.scale.set(1 / meshScale.x, 1 / meshScale.y, 1 / meshScale.z);
              }

              skinnedMesh.add(sticker);
              parented = true;
            } catch (e) {
              console.warn('[sticker] bone tracking setup failed:', e);
            }
          }
        }
      }

      // ── Direct mesh parenting for static/rotating objects (trees, SATS, crates) ──
      if (!parented && s.targetObject.parent) {
        try {
          const target = s.targetObject;
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

      // Trigger NPC gesture if hit object is the NPC
      if (s.targetObject) {
        let isNpc = false;
        let o = s.targetObject;
        while (o) {
          if (o === _npcRoot) { isNpc = true; break; }
          o = o.parent;
        }
        if (isNpc) {

          import('./napNpc.js').then(({ triggerNpcGesture }) => {
            if (triggerNpcGesture) triggerNpcGesture();
          });
        }
      }
    }
  }

  // Update attached stickers (fade out in last 2 seconds + per-frame bone tracking)
  for (let i = _attached.length - 1; i >= 0; i--) {
    const a = _attached[i];
    a.life -= dt;
    if (a.life <= 0) {
      if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
      if (a.mesh.geometry) a.mesh.geometry.dispose();
      if (a.mesh.material) a.mesh.material.dispose();
      _attached.splice(i, 1);
    } else {
      // Per-frame bone-matrix tracking for skinned-mesh stickers
      const track = a.mesh.userData.stickerBoneTrack;
      if (track) {
        const sm = track.skinnedMesh;
        if (sm.skeleton && sm.skeleton.boneMatrices) {
          // Read current bone matrix from the skeleton
          _m4b.fromArray(sm.skeleton.boneMatrices, track.boneIndex * 16);
          // Simple: sticker.position = boneMat * vertex
          a.mesh.position.copy(track.vertex).applyMatrix4(_m4b);
          // Update orientation
          _v3c.copy(track.bindNormal).transformDirection(_m4b);
          _quat.setFromUnitVectors(_zAxis, _v3c);
          a.mesh.quaternion.copy(_quat);
        }
      }
      if (a.life < 2.0) {
        a.mesh.material.opacity = a.life / 2.0;
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
