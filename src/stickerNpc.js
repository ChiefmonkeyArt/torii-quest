// stickerNpc.js — FTFF sticker projectile system.
// Stickers fire from the gun and stick to any surface in the scene.
// For characters (NAP NPC, peers): an exact hit on the DRAWN skin
// (engine/character/stickerSkin.js, the Game Zone hitbox) — the sticker lands
// where the crosshair meets the skin and rides that spot through every pose
// via a triangle + barycentric anchor (ADR-0135).
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
import { raycastSkin, anchorPose, skinRig } from './engine/character/stickerSkin.js';

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

// ADR-0132 feel hooks. onFire runs synchronously in the click's input event,
// onLand when the flight ends. info = { target: 'npc'|'peer'|'surface',
// point, dist }; onFire(null) means the ray hit nothing. Hooks are feedback
// only: a throwing hook must never break sticker placement.
let _feelHooks = null;
export function setStickerFeelHooks(hooks) { _feelHooks = hooks || null; }
function _feel(name, info) {
  const f = _feelHooks && _feelHooks[name];
  if (!f) return;
  try { f(info); } catch (e) { console.warn('[sticker] feel hook failed:', e); }
}

// One SpriteMaterial shared by every flying sticker (was a new material per
// shot, disposed on landing). It switches from the pink fallback to the FTFF
// texture once that loads.
let _flyMat = null;
function _flyMaterial() {
  if (!_flyMat) {
    _flyMat = new THREE.SpriteMaterial({
      map: _texture || null,
      color: _texture ? 0xffffff : 0xff00ff,
      transparent: true,
      depthTest: true,
      depthWrite: false,
    });
  } else if (_texture && _flyMat.map !== _texture) {
    _flyMat.map = _texture;
    _flyMat.color.setHex(0xffffff);
    _flyMat.needsUpdate = true;
  }
  return _flyMat;
}

// NPC gesture on landing: resolve the lazy napNpc import once, not per sticker.
let _gestureFn = null, _gestureLoading = false;
function _triggerGesture() {
  if (_gestureFn) { _gestureFn(); return; }
  if (_gestureLoading) return;
  _gestureLoading = true;
  import('./napNpc.js').then(({ triggerNpcGesture }) => {
    _gestureLoading = false;
    if (typeof triggerNpcGesture === 'function') { _gestureFn = triggerNpcGesture; _gestureFn(); }
  }, () => { _gestureLoading = false; });
}

// Reusable raycaster + scratch vectors (constraint [4]: no new in hot paths)
const _raycaster = new THREE.Raycaster();
const _rayOrigin = new THREE.Vector3();
const _rayDir = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _zAxis = new THREE.Vector3(0, 0, 1);
const _worldQuatInv = new THREE.Quaternion();
const _worldTarget = new THREE.Vector3();
const _worldNormal = new THREE.Vector3();

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
// path (characters via the exact skin test, ADR-0135; instanced grass
// handled separately as its own bucket) plus the gun viewmodel.
function _isExcluded(obj) {
  let o = obj;
  while (o) {
    if (o.name && EXCLUDE_NAMES.has(o.name)) return true;
    // Skip the NPC + bot meshes — characters use the exact skin path (ADR-0135)
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

// ADR-0135: exact hit on the DRAWN skin (Game Zone hitbox, no Rapier sensors,
// no guessed "graze" points). Returns { point, normal, object, anchor } or null.
function _raycastSkinnedMesh(skinnedMesh, origin, dir) {
  if (!skinnedMesh) return null;
  const h = raycastSkin(skinnedMesh, origin, dir, 200);
  return h ? { point: h.point, normal: h.normal, object: skinnedMesh, anchor: h.anchor, assisted: h.assisted } : null;
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

// Peers are only skin-tested when the aim line passes within this distance of
// their root (cheap reject before the first-time hitbox fit / exact test).
const PEER_NEAR_M = 2.5;
const _peerPos = new THREE.Vector3();
function _nearAimLine(root, origin, dirN) {
  root.getWorldPosition(_peerPos).sub(origin);
  const t = _peerPos.dot(dirN);
  if (t < -PEER_NEAR_M) return false;
  return _peerPos.addScaledVector(dirN, -t).lengthSq() < PEER_NEAR_M * PEER_NEAR_M;
}

// Spawn a sticker projectile from `spawnOrigin` (the gun muzzle) toward the
// nearest surface hit resolved along the aim ray (`origin`/`dir`). The aim ray
// drives TARGETING (what the crosshair points at), while `spawnOrigin` drives
// where the sticker visibly leaves the weapon — they are the camera and the gun
// respectively, so the sticker must not spawn from the player's face.
export function fireStickerAtNpc(origin, dir, spawnOrigin) {
  _preloadTexture();
  const _t0 = performance.now();

  const dirN = dir.clone().normalize();

  // ── Characters: the drawn skin is the only truth (ADR-0135) ──
  if (!_npcRoot && _getNpcRootFn) { const r = _getNpcRootFn(); if (r) { if (_npcRoot !== r) _npcSkinnedMesh = null; _npcRoot = r; } }
  let hitPoint, hitNormal;
  let npcRoot = null, meshObj = null, skin = null, anchor = null, peerRoot = null;
  let bestDist = Infinity, _assisted = 0;

  const npcSkinnedMesh = _npcRoot ? _getNpcSkinnedMesh() : null;
  const npcSurface = npcSkinnedMesh ? _raycastSkinnedMesh(npcSkinnedMesh, origin, dirN) : null;
  if (npcSurface) {
    bestDist = npcSurface.point.distanceTo(origin);
    hitPoint = npcSurface.point;
    hitNormal = npcSurface.normal;
    skin = npcSkinnedMesh; anchor = npcSurface.anchor; _assisted = npcSurface.assisted;
    npcRoot = _npcRoot;
  }

  // ── Static meshes (trees, crates, terrain, grass) ──
  const meshHit = _raycastScene(origin, dirN);

  // ── Peer avatars (multiplayer remote players) — same exact skin test ──
  const peers = _collectPeerRoots();
  for (let i = 0; i < peers.length; i++) {
    if (!_nearAimLine(peers[i], origin, dirN)) continue;
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
      skin = sm; anchor = peerSurface.anchor; _assisted = peerSurface.assisted;
      npcRoot = null;
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
      skin = null; anchor = null; _assisted = 0;
      peerRoot = null;
    }
  }

  _aim.shots++;
  _aim.lastMs = performance.now() - _t0;
  if (_aim.lastMs > _aim.maxMs) _aim.maxMs = _aim.lastMs;
  if (!hitPoint) { _aim.last = null; _feel('onFire', null); return false; } // no hit at all
  _aim.last = { target: npcRoot ? 'npc' : peerRoot ? 'peer' : 'surface', assisted: _assisted, dist: Math.round(bestDist * 1000) / 1000 };
  if (_assisted) _aim.assisted++;

  // Flying sticker: always visible (texture or pink fallback), shared material.
  const sprite = new THREE.Sprite(_flyMaterial());
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
  const target = npcRoot ? 'npc' : peerRoot ? 'peer' : 'surface';

  _stickers.push({
    sprite,
    from: spawnPoint.clone(),
    to: hitPoint.clone(),
    normal: hitNormal.clone(),
    npcRoot,
    meshObj,
    peerRoot,
    // ADR-0135: a character hit is an anchor on the drawn skin (triangle +
    // barycentrics), re-skinned every frame — in flight and once stuck.
    skin,
    anchor,
    renderMode,
    hitFace: meshHitAccepted?.face || null,
    hitInstanceId: meshHitAccepted?.instanceId ?? null,
    t: 0,
    duration: FLIGHT_DURATION,
    target,
  });
  _feel('onFire', { target, point: hitPoint, dist: bestDist });

  return true;
}

// Place a stuck plane on the skin: lifted 0.012 m along the normal (clears
// curved limbs) and facing out of the surface.
function _poseSkinSticker(mesh, p, n) {
  mesh.position.copy(p).addScaledVector(n, 0.012);
  mesh.quaternion.setFromUnitVectors(_zAxis, n);
}
function _inScene(o) {
  for (let p = o; p; p = p.parent) if (p === scene) return true;
  return false;
}

// ADR-0135 debug: targeting cost + assist use + stickers riding a skin.
const _aim = { shots: 0, assisted: 0, lastMs: 0, maxMs: 0, last: null };
export function getStickerAimStats() {
  let onSkin = 0;
  for (const a of _attached) if (a.skin) onSkin++;
  return { ..._aim, lastMs: Math.round(_aim.lastMs * 100) / 100, maxMs: Math.round(_aim.maxMs * 100) / 100, attached: _attached.length, onSkin };
}

// Called every frame to update flying + attached stickers.
export function tickStickerNpc(dt) {
  // Preload the FTFF texture on the FIRST tick (arena entry), not the first
  // fire — otherwise the opening shots show the pink `0xff00ff` fallback while
  // the image is still streaming. The guard makes this idempotent + free.
  _preloadTexture();
  if (_flyMat && _texture && _flyMat.map !== _texture) _flyMaterial(); // swap in-flight pink → texture
  // Poll for NPC root (for gesture trigger detection)
  if (!_npcRoot) _pollNpcRoot();
  if (!_npcRoot && _getNpcRootFn) {
    const r = _getNpcRootFn();
    if (r) {
      if (_npcRoot !== r) _npcSkinnedMesh = null;
      _npcRoot = r;
    }
  }
  // Fit the NPC's skin hitbox off the fire path: once per geometry, on the
  // first frame after the NPC loads (~50 ms one-time, never on a click).
  if (_npcSkinnedMesh && _npcRigWarmed !== _npcSkinnedMesh) {
    _npcRigWarmed = _npcSkinnedMesh;
    try { skinRig(_npcSkinnedMesh); } catch { /* fitted lazily on fire */ }
  }
  if (!_npcSkinnedMesh && _getNpcSkinnedMeshFn) {
    _npcSkinnedMesh = _getNpcSkinnedMeshFn();
  }

  // Update flying stickers
  for (let i = _stickers.length - 1; i >= 0; i--) {
    const s = _stickers[i];
    s.t += dt;
    // Skin-anchored stickers track the drawn surface during flight so the
    // landing is seamless (the NPC walks ~0.3m during the 0.22s flight).
    if (s.skin && s.anchor) anchorPose(s.skin, s.anchor, s.to, s.normal);
    const p = Math.min(1, s.t / s.duration);
    const e = 1 - (1 - p) * (1 - p);
    s.sprite.position.lerpVectors(s.from, s.to, e);

    const size = FLY_SIZE + (ATTACHED_SIZE - FLY_SIZE) * e;
    s.sprite.scale.set(size, size * ATTACHED_RATIO, 1);

    if (p >= 1) {
      scene.remove(s.sprite); // shared flying material: never disposed here
      _stickers.splice(i, 1);
      _feel('onLand', { target: s.target, point: s.to });

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
          const decalMat = createBakedDecalMaterial(_texture);
          const decal = new THREE.Mesh(decalGeo, decalMat);
          decal.userData.isSticker = true;
          // DecalGeometry is authored in WORLD space. To parent it to `target`
          // (so it inherits position, rotation, AND scale — crates move, trees
          // sway), bake the geometry DOWN into the target's LOCAL space and add
          // it with an identity transform. The old quaternion-inverse +
          // local-position counteraction only cancelled rotation/translation (not
          // scale) and left static-mesh decals double-transformed out of view —
          // baked stickers therefore appeared to "not stick" at all.
          const invMatrix = new THREE.Matrix4().copy(target.matrixWorld).invert();
          decalGeo.applyMatrix4(invMatrix); // positions + normals → local space
          decal.position.set(0, 0, 0);
          decal.quaternion.identity();
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

      // ── SKIN (NPC / peer): ride the drawn surface (ADR-0135) ──
      // World-space plane re-posed every frame from its skin anchor, so it
      // stays exactly on the skin through every clip — blended joints included
      // (a single-bone parent slid off shoulders, hips and elbows).
      let skinRef = null;
      if (s.skin && s.anchor && anchorPose(s.skin, s.anchor, _worldTarget, _worldNormal)) {
        _poseSkinSticker(sticker, _worldTarget, _worldNormal);
        scene.add(sticker);
        skinRef = { skin: s.skin, anchor: s.anchor };
        parented = true;
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

      _attached.push({ mesh: sticker, life: ATTACHED_LIFETIME, maxLife: ATTACHED_LIFETIME,
        skin: skinRef ? skinRef.skin : null, anchor: skinRef ? skinRef.anchor : null });

      while (_attached.length > MAX_ATTACHED) {
        const old = _attached.shift();
        if (old.mesh.parent) old.mesh.parent.remove(old.mesh);
        if (old.mesh.geometry) old.mesh.geometry.dispose();
        if (old.mesh.material) old.mesh.material.dispose();
      }

      // Trigger NPC gesture if hit the NPC
      if (s.npcRoot) {
        _triggerGesture();
      }
    }
  }

  // Update attached stickers (fade out in last 2 seconds)
  for (let i = _attached.length - 1; i >= 0; i--) {
    const a = _attached[i];
    a.life -= dt;
    // Skin stickers follow the drawn surface; a character that left the scene
    // (peer gone, NPC rebuilt) takes its stickers with it.
    if (a.skin && a.life > 0) {
      if (!_inScene(a.skin) || !anchorPose(a.skin, a.anchor, _worldTarget, _worldNormal)) a.life = 0;
      else _poseSkinSticker(a.mesh, _worldTarget, _worldNormal);
    }
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
let _npcRigWarmed = null;
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
