// stickerNpc.js — FTFF sticker projectile system for the NAP zone.
// Stickers fire from the gun and stick to any mesh surface in the scene
// (NPC, trees, crates, terrain, bots, torii gate, etc.) using a Three.js
// Raycaster for precise surface hit detection. Excludes sea, player weapon,
// and portal/gateway screens.
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
const _up = new THREE.Vector3(0, 1, 0);
const _planeGeo = null; // built per-sticker (cheap, small)

// Names to exclude from sticker raycasting (UI/screens/non-stickable)
const EXCLUDE_NAMES = new Set([
  'sea', 'world-gun-normalizer', 'coastline-wall', 'coastline-neon',
  'portal-mesh-group', 'PORTAL_MESH_GROUP',
]);

// Flying sticker starts large (0.6) and shrinks during flight
const FLY_SIZE = 0.6;
const ATTACHED_SIZE = 0.08;     // world units when stuck
const ATTACHED_RATIO = 0.6;     // height/width ratio (matches image aspect)
const FLIGHT_DURATION = 0.22;
const MAX_ATTACHED = 120;
const ATTACHED_LIFETIME = 180;  // 3 minutes

// Preload the texture.
function _preloadTexture() {
  if (_texture || _textureLoading) return;
  _textureLoading = true;
  const loader = new THREE.TextureLoader();
  loader.load(assetUrl('/ftff-sticker.png'), tex => {
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    _texture = tex;
    _textureLoading = false;
  });
}

// Check if a mesh/object should be excluded from sticker placement.
function _isExcluded(obj) {
  let o = obj;
  while (o) {
    if (o.name && EXCLUDE_NAMES.has(o.name)) return true;
    // Skip the player's own model/weapon (first-person body)
    if (o.name === 'fps-body' || o.name === 'player-model') return true;
    o = o.parent;
  }
  return false;
}

// Find the nearest mesh surface hit by a ray from origin in direction dir.
// Returns { point, normal, object } or null.
function _raycastScene(origin, dir) {
  _rayOrigin.copy(origin);
  _rayDir.copy(dir).normalize();
  _raycaster.set(_rayOrigin, _rayDir);
  _raycaster.far = 200; // generous range — can fire across zones

  const hits = _raycaster.intersectObjects(scene.children, true);
  for (const hit of hits) {
    if (!hit.object.isMesh) continue;
    if (_isExcluded(hit.object)) continue;
    // Skip transparent/non-rendered meshes
    const mat = hit.object.material;
    if (mat && mat.visible === false) continue;

    // Get the face normal in world space
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
  if (!hit) return false;

  const mat = new THREE.SpriteMaterial({
    map: _texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: _texture ? 1.0 : 0.0,
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
  // Also check if NPC root became available since last poll
  if (!_npcRoot && _getNpcRootFn) {
    const r = _getNpcRootFn();
    if (r) _npcRoot = r;
  }

  // Update flying stickers
  for (let i = _stickers.length - 1; i >= 0; i--) {
    const s = _stickers[i];
    s.t += dt;
    const p = Math.min(1, s.t / s.duration);
    const e = 1 - (1 - p) * (1 - p); // ease-out
    s.sprite.position.lerpVectors(s.from, s.to, e);

    // Shrink during flight
    const size = FLY_SIZE + (ATTACHED_SIZE - FLY_SIZE) * e;
    s.sprite.scale.set(size, size * ATTACHED_RATIO, 1);

    if (p >= 1) {
      // Sticker arrived — create a flat mesh on the surface
      scene.remove(s.sprite);
      if (s.sprite.material) s.sprite.material.dispose();
      _stickers.splice(i, 1);

      if (!_texture) continue;

      // Build a small plane mesh oriented to the surface normal
      const geo = new THREE.PlaneGeometry(ATTACHED_SIZE, ATTACHED_SIZE * ATTACHED_RATIO);
      const mat = new THREE.MeshBasicMaterial({
        map: _texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const sticker = new THREE.Mesh(geo, mat);

      // Position at hit point, slightly offset along normal to avoid z-fighting
      sticker.position.copy(s.to);
      sticker.position.x += s.normal.x * 0.01;
      sticker.position.y += s.normal.y * 0.01;
      sticker.position.z += s.normal.z * 0.01;

      // Orient: the plane's default normal is +Z. Rotate so +Z aligns
      // with the surface normal.
      _quat.setFromUnitVectors(new THREE.Vector3(0, 0, 1), s.normal);
      sticker.quaternion.copy(_quat);

      // Try to parent to the hit object so the sticker moves with it
      // (NPC, bots, crates). If the object has no parent or is the scene,
      // keep it in world space.
      let parented = false;
      if (s.targetObject && s.targetObject.parent && s.targetObject.parent !== scene) {
        try {
          // Convert position to target's parent local space
          const localPos = s.to.clone();
          s.targetObject.parent.worldToLocal(localPos);
          sticker.position.copy(localPos);
          // Adjust quaternion for parent's world rotation
          const parentQuatInverse = s.targetObject.parent.quaternion.clone().invert();
          sticker.quaternion.multiplyQuaternions(parentQuatInverse, _quat);
          s.targetObject.parent.add(sticker);
          parented = true;
        } catch (e) {
          // Parenting failed — keep in world space
        }
      }

      if (!parented) {
        scene.add(sticker);
      }

      _attached.push({
        mesh: sticker,
        life: ATTACHED_LIFETIME,
        maxLife: ATTACHED_LIFETIME,
      });

      // Enforce max sticker count
      while (_attached.length > MAX_ATTACHED) {
        const old = _attached.shift();
        if (old.mesh.parent) old.mesh.parent.remove(old.mesh);
        if (old.mesh.geometry) old.mesh.geometry.dispose();
        if (old.mesh.material) old.mesh.material.dispose();
      }

      // Trigger NPC gesture if the hit object is the NPC (or a child of it)
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

// Poll for NPC root from napNpc.js (async import, then check each tick)
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
