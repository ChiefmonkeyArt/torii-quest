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
  console.log('[sticker] preloading texture from', assetUrl('/ftff-sticker.png'));
  const loader = new THREE.TextureLoader();
  loader.load(assetUrl('/ftff-sticker.png'), tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    _texture = tex;
    _textureLoading = false;
    console.log('[sticker] texture loaded OK, size:', tex.image.width + 'x' + tex.image.height);
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
      if (obj.isMesh && !_isExcluded(obj)) {
        const mat = obj.material;
        if (mat && mat.visible === false) return;
        _meshCache.push(obj);
      }
    });
    _meshCacheTime = now;
    console.log('[sticker] mesh cache refreshed:', _meshCache.length, 'meshes');
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
    };
  }
  return null;
}

// Spawn a sticker projectile from `origin` toward the nearest surface hit.
export function fireStickerAtNpc(origin, dir) {
  _preloadTexture();

  const hit = _raycastScene(origin, dir);
  if (!hit) {
    console.log('[sticker] no surface hit — ray missed everything');
    return false;
  }
  console.log('[sticker] hit:', hit.object.name || hit.object.type, 'at dist', origin.distanceTo(hit.point).toFixed(1));

  // Flying sticker: always visible (texture or pink fallback)
  const mat = new THREE.SpriteMaterial({
    map: _texture || null,
    color: _texture ? 0xffffff : 0xff00ff,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(FLY_SIZE, FLY_SIZE * ATTACHED_RATIO, 1);
  sprite.position.copy(origin);
  scene.add(sprite);

  _stickers.push({
    sprite,
    from: origin.clone(),
    to: hit.point.clone(),
    normal: hit.normal,
    targetObject: hit.object,
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
      });
      const geo = new THREE.PlaneGeometry(ATTACHED_SIZE, ATTACHED_SIZE * ATTACHED_RATIO);
      const sticker = new THREE.Mesh(geo, mat);

      // Position at hit point + offset along normal
      sticker.position.copy(s.to);
      sticker.position.x += s.normal.x * 0.01;
      sticker.position.y += s.normal.y * 0.01;
      sticker.position.z += s.normal.z * 0.01;

      // Orient plane to surface normal
      _quat.setFromUnitVectors(_zAxis, s.normal);
      sticker.quaternion.copy(_quat);

      // Parent to hit object so sticker moves with it
      let parented = false;
      if (s.targetObject && s.targetObject.parent && s.targetObject.parent !== scene) {
        try {
          const localPos = s.to.clone();
          s.targetObject.parent.worldToLocal(localPos);
          sticker.position.copy(localPos);
          const parentQuatInverse = s.targetObject.parent.quaternion.clone().invert();
          sticker.quaternion.multiplyQuaternions(parentQuatInverse, _quat);
          s.targetObject.parent.add(sticker);
          parented = true;
        } catch (e) { /* keep in world space */ }
      }
      if (!parented) scene.add(sticker);

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

  // Update attached stickers (fade out in last 2 seconds)
  for (let i = _attached.length - 1; i >= 0; i--) {
    const a = _attached[i];
    a.life -= dt;
    if (a.life <= 0) {
      if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
      if (a.mesh.geometry) a.mesh.geometry.dispose();
      if (a.mesh.material) a.mesh.material.dispose();
      _attached.splice(i, 1);
    } else if (a.life < 2.0) {
      a.mesh.material.opacity = a.life / 2.0;
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
