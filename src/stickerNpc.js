// stickerNpc.js — FTFF sticker projectile system for the NAP zone NPC.
// When the player fires at the Chiefmonkey NPC in the NAP zone, a sticker
// sprite flies from the gun muzzle to the NPC. On impact, the sticker
// attaches to the NPC and the NPC plays a random gesture animation.
import * as THREE from 'three';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';

let _texture = null;
let _stickers = [];      // active flying stickers { sprite, from, to, t, duration, target }
let _attached = [];      // stickers stuck to NPC { mesh, parent, offset, life, maxLife }

let _npcRoot = null;     // ref to NPC root (polled from napNpc.js)

const STICKER_SIZE = 0.6;     // world units
const FLIGHT_DURATION = 0.25;  // seconds
const ATTACHED_LIFETIME = 4.0; // seconds before fade

function _ensureTexture() {
  if (_texture) return _texture;
  const loader = new THREE.TextureLoader();
  _texture = loader.load(assetUrl('/ftff-sticker.png'));
  _texture.colorSpace = THREE.SRGBColorSpace;
  _texture.needsUpdate = true;
  return _texture;
}

// Check if the aim ray hits the NPC. Returns hit point or null.
function _raycastNpc(origin, dir) {
  if (!_npcRoot) return null;
  // Use a bounding sphere around the NPC for a simple, forgiving hit test.
  const center = _npcRoot.position;
  const radius = 1.2; // generous hit sphere

  // Ray-sphere intersection
  const ox = origin.x - center.x;
  const oy = origin.y - center.y;
  const oz = origin.z - center.z;
  const dx = dir.x, dy = dir.y, dz = dir.z;

  const b = ox * dx + oy * dy + oz * dz;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;

  if (c > 0 && b > 0) return null; // ray points away from sphere

  const disc = b * b - c;
  if (disc < 0) return null; // no intersection

  const t = -b - Math.sqrt(disc);
  const tt = t < 0 ? 0 : t; // clamp to origin if inside sphere

  return new THREE.Vector3(
    origin.x + dx * tt,
    origin.y + dy * tt,
    origin.z + dz * tt
  );
}

// Spawn a sticker projectile from `origin` toward the NPC hit point `target`.
export function fireStickerAtNpc(origin, dir) {
  const hitPoint = _raycastNpc(origin, dir);
  if (!hitPoint) return false;

  const tex = _ensureTexture();
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(STICKER_SIZE, STICKER_SIZE * 0.6, 1);
  sprite.position.copy(origin);
  scene.add(sprite);

  _stickers.push({
    sprite,
    from: origin.clone(),
    to: hitPoint.clone(),
    t: 0,
    duration: FLIGHT_DURATION,
  });

  return true;
}

let _npcRootChecked = false;
let _getNpcRootFn = null;

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
    if (r) _npcRoot = r;
  }
  // Update flying stickers
  for (let i = _stickers.length - 1; i >= 0; i--) {
    const s = _stickers[i];
    s.t += dt;
    const p = Math.min(1, s.t / s.duration);
    // Ease-out for a snappy "thwip" feel
    const e = 1 - (1 - p) * (1 - p);
    s.sprite.position.lerpVectors(s.from, s.to, e);

    if (p >= 1) {
      // Sticker arrived — attach to NPC
      scene.remove(s.sprite);
      _stickers.splice(i, 1);

      // Create attached sticker as child of NPC root
      const tex = _ensureTexture();
      const mat = new THREE.SpriteMaterial({
        map: tex,
        transparent: true,
        depthTest: true,
        depthWrite: false,
      });
      const attached = new THREE.Sprite(mat);
      attached.scale.set(STICKER_SIZE, STICKER_SIZE * 0.6, 1);

      // Convert hit point to NPC-local space
      const localPos = s.to.clone();
      if (_npcRoot) {
        _npcRoot.worldToLocal(localPos);
        // Offset slightly so the sticker sits in front of the model
        localPos.z += 0.15;
        _npcRoot.add(attached);
      } else {
        attached.position.copy(s.to);
        scene.add(attached);
      }
      attached.position.copy(localPos);

      _attached.push({
        mesh: attached,
        life: ATTACHED_LIFETIME,
        maxLife: ATTACHED_LIFETIME,
      });

      // Trigger the NPC gesture via the global event bus
      // We import lazily to avoid circular deps
      import('./napNpc.js').then(({ triggerNpcGesture }) => {
        if (triggerNpcGesture) triggerNpcGesture();
      });
    }
  }

  // Update attached stickers (fade out + remove)
  for (let i = _attached.length - 1; i >= 0; i--) {
    const a = _attached[i];
    a.life -= dt;
    if (a.life <= 0) {
      if (a.mesh.parent) a.mesh.parent.remove(a.mesh);
      if (a.mesh.material) a.mesh.material.dispose();
      _attached.splice(i, 1);
    } else {
      // Fade in last 1 second
      const fadeStart = 1.0;
      if (a.life < fadeStart) {
        a.mesh.material.opacity = a.life / fadeStart;
      }
    }
  }
}

export function isStickerNpcActive() {
  return _npcRoot !== null;
}
