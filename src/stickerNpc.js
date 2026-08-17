// stickerNpc.js — FTFF sticker projectile system for the NAP zone NPC.
// When the player fires at the Chiefmonkey NPC in the NAP zone, a sticker
// sprite flies from the gun muzzle to the NPC. On impact, the sticker
// attaches to the NPC surface and the NPC plays a random gesture animation.
import * as THREE from 'three';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';

let _texture = null;
let _textureLoading = false;
let _stickers = [];      // active flying stickers
let _attached = [];      // stickers stuck to NPC

let _npcRoot = null;     // ref to NPC root (polled from napNpc.js)
let _npcRootChecked = false;
let _getNpcRootFn = null;

// Flying sticker starts large (0.6) and shrinks during flight to ATTACHED_SIZE
const FLY_SIZE = 0.6;          // world units at launch
const ATTACHED_SIZE = 0.06;    // world units when stuck on NPC (10x smaller)
const FLIGHT_DURATION = 0.25;  // seconds
const MAX_ATTACHED = 80;       // max stickers on NPC before oldest removed
const ATTACHED_LIFETIME = 120; // seconds before fade (2 min — generous)

// Preload the texture immediately so the first shot appears instantly.
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

// Ray-sphere hit test against the NPC. Returns { point, normal } or null.
// normal is the outward direction from NPC center to hit point (for offset).
function _raycastNpc(origin, dir) {
  if (!_npcRoot) return null;
  const center = _npcRoot.position;
  const radius = 1.2;

  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;

  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;

  if (c > 0 && b > 0) return null;

  const disc = b * b - c;
  if (disc < 0) return null;

  const t = -b - Math.sqrt(disc);
  const tt = t < 0 ? 0 : t;

  const px = origin.x + dx * tt;
  const py = origin.y + dy * tt;
  const pz = origin.z + dz * tt;

  // Outward normal from NPC center to hit point
  let nx = px - center.x, ny = py - center.y, nz = pz - center.z;
  const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;

  return { point: new THREE.Vector3(px, py, pz), normal: { x: nx, y: ny, z: nz } };
}

// Spawn a sticker projectile from `origin` toward the NPC hit point.
export function fireStickerAtNpc(origin, dir) {
  // Ensure texture is loading (first call triggers preload)
  _preloadTexture();

  const hit = _raycastNpc(origin, dir);
  if (!hit) return false;

  // If texture isn't loaded yet, still register the hit so the gesture
  // triggers — the sticker will appear once the texture loads on subsequent shots.
  const mat = new THREE.SpriteMaterial({
    map: _texture,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    opacity: _texture ? 1.0 : 0.0, // invisible until texture ready
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(FLY_SIZE, FLY_SIZE * 0.6, 1);
  sprite.position.copy(origin);
  scene.add(sprite);

  _stickers.push({
    sprite,
    from: origin.clone(),
    to: hit.point.clone(),
    normal: hit.normal,
    t: 0,
    duration: FLIGHT_DURATION,
  });

  return true;
}

// Called every frame to update flying + attached stickers.
export function tickStickerNpc(dt) {
  // Poll for NPC root — it's loaded async after first frame
  if (!_npcRoot && !_npcRootChecked) {
    _npcRootChecked = true;
    import('./napNpc.js').then(({ getNpcRoot }) => {
      _getNpcRootFn = getNpcRoot;
    });
  }
  if (!_npcRoot && _getNpcRootFn) {
    const r = _getNpcRootFn();
    if (r) {
      _npcRoot = r;
      _preloadTexture(); // start texture load once NPC exists
    }
  }

  // Update flying stickers
  for (let i = _stickers.length - 1; i >= 0; i--) {
    const s = _stickers[i];
    s.t += dt;
    const p = Math.min(1, s.t / s.duration);
    // Ease-out for a snappy "thwip" feel
    const e = 1 - (1 - p) * (1 - p);
    s.sprite.position.lerpVectors(s.from, s.to, e);

    // Shrink during flight: FLY_SIZE → ATTACHED_SIZE
    const size = FLY_SIZE + (ATTACHED_SIZE - FLY_SIZE) * e;
    s.sprite.scale.set(size, size * 0.6, 1);

    if (p >= 1) {
      // Sticker arrived — attach to NPC surface
      scene.remove(s.sprite);
      if (s.sprite.material) s.sprite.material.dispose();
      _stickers.splice(i, 1);

      if (!_texture) continue; // skip if texture not loaded yet

      // Create attached sticker as child of NPC root
      const mat = new THREE.SpriteMaterial({
        map: _texture,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      const attached = new THREE.Sprite(mat);
      attached.scale.set(ATTACHED_SIZE, ATTACHED_SIZE * 0.6, 1);

      // Convert hit point to NPC-local space, then push outward along
      // the hit normal so the sticker sits ON the surface, not inside.
      const localPos = s.to.clone();
      if (_npcRoot) {
        // Push outward along normal in world space first
        localPos.x += s.normal.x * 0.08;
        localPos.y += s.normal.y * 0.08;
        localPos.z += s.normal.z * 0.08;
        _npcRoot.worldToLocal(localPos);
        _npcRoot.add(attached);
      } else {
        attached.position.copy(localPos);
        scene.add(attached);
      }
      attached.position.copy(localPos);

      _attached.push({
        mesh: attached,
        life: ATTACHED_LIFETIME,
        maxLife: ATTACHED_LIFETIME,
      });

      // Enforce max sticker count — remove oldest
      while (_attached.length > MAX_ATTACHED) {
        const old = _attached.shift();
        if (old.mesh.parent) old.mesh.parent.remove(old.mesh);
        if (old.mesh.material) old.mesh.material.dispose();
      }

      // Trigger the NPC gesture
      import('./napNpc.js').then(({ triggerNpcGesture }) => {
        if (triggerNpcGesture) triggerNpcGesture();
      });
    }
  }

  // Update attached stickers (fade out in last 2 seconds)
  for (let i = _attached.length - 1; i >= 0; i--) {
    const a = _attached[i];
    a.life -= dt;
    if (a.life <= 0) {
      if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
      if (a.mesh.material) a.mesh.material.dispose();
      _attached.splice(i, 1);
    } else if (a.life < 2.0) {
      a.mesh.material.opacity = a.life / 2.0;
    }
  }
}

export function isStickerNpcActive() {
  return _npcRoot !== null;
}
