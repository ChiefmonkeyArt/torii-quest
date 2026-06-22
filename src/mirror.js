// mirror.js — Live Reflector mirror on the arena west wall.
// Uses Three.js Reflector (real scene reflection via off-screen render target).
// Player GLB is on layer 1 — mirror camera enables layer 1 so you see yourself.
import * as THREE from 'three';
import { Reflector }  from 'three/addons/objects/Reflector.js';
import { scene, renderer } from './scene.js';
import { ARENA_HALF, WALL_H } from './config.js';

const MW = ARENA_HALF * 0.7;   // mirror width  (~14 units)
// Mirror is now FULL wall height + a touch more on top so it reaches past the
// orange wall cap. At WALL_H = 2.6 this gives a 2.8m mirror — enough to frame
// the entire player including the gun in their hand, which was getting cropped
// out at the previous 0.75× multiplier (= 1.95m mirror, ~0.5m short).
const MH = WALL_H + 0.2;       // mirror height: wall + 20cm cap clearance
const MX = -ARENA_HALF + 0.36; // just proud of west wall interior face
const MY = MH / 2 + 0.05;      // just above floor
const MZ = 0;                   // centred on wall

// Throttle mirror texture refresh to 20 Hz by suppressing onBeforeRender.
// The mesh stays visible every frame — only the RT update is gated.
// This avoids the flicker caused by toggling mesh.visible on/off.
let _mirrorTimer = 0;
const _MIRROR_HZ = 1 / 20;
let   _mirrorRef  = null; // set in buildMirror

export function tickMirror(dt) {
  _mirrorTimer += dt;
  if (!_mirrorRef) return;
  // Gate: suppress the expensive off-screen render on skipped frames
  // by temporarily replacing onBeforeRender with a no-op.
  if (_mirrorTimer >= _MIRROR_HZ) {
    _mirrorTimer = 0;
    _mirrorRef.onBeforeRender = _mirrorRef._patchedOnBefore; // restore
  } else {
    _mirrorRef.onBeforeRender = _noop;
  }
}

function _noop() {}
export function shouldUpdateMirror() { return true; } // kept for compat — mesh always visible

export function buildMirror() {
  try {
    // ── Reflector surface ─────────────────────────────────────────────────────
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); // cap at 1.5 — saves ~44% pixels on retina
    const mW  = Math.round(window.innerWidth  * dpr);
    const mH  = Math.round(window.innerHeight * dpr);

    const mirror = new Reflector(new THREE.PlaneGeometry(MW, MH), {
      clipBias:      0.003,
      textureWidth:  mW,
      textureHeight: mH,
      color:         0xaacccc,  // cool silver tint
      multisample:   1,         // MSAA off — extra FB resolve not worth it
    });

    mirror.rotation.y = Math.PI / 2;  // normal faces +X (eastward, into arena)
    mirror.position.set(MX, MY, MZ);
    scene.add(mirror);
    window._mirrorMesh = mirror; // expose for throttle in renderFrame

    // Enable layer 1 on the reflection camera so the player's own GLB shows.
    // Three.js r168+ uses a WeakMap of reflection cameras (no more mirror.camera).
    // Patch via onBeforeRender one-shot — reflection camera exists by then.
    const _origOnBefore = mirror.onBeforeRender.bind(mirror);
    let _layerPatched = false;
    const _patchedFn = function(renderer, scene, camera) {
      _origOnBefore(renderer, scene, camera);
      if (!_layerPatched) {
        const rc = mirror._reflectionCameras?.get(camera);
        if (rc) { rc.layers.enable(1); _layerPatched = true; }
      }
    };
    mirror.onBeforeRender = _patchedFn;
    mirror._patchedOnBefore = _patchedFn; // stored for throttle restore
    _mirrorRef = mirror; // expose to tickMirror

    // Pre-warm: let the first real onBeforeRender handle it — mirror.camera no longer
    // exists in Three.js r168+. Attempting renderer.render with undefined camera crashes
    // the render loop. Warm-up is handled naturally on first arena render frame.

    // ── Dark metal frame ──────────────────────────────────────────────────────
    const FT  = 0.22;   // bar thickness
    const FD  = 0.18;   // bar depth (X extent)
    const fMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, metalness: 0.95, roughness: 0.15,
    });
    const _bar = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fMat);
      m.position.set(x, y, z);
      scene.add(m);
    };
    const fx = MX - FD * 0.5 + 0.01;
    _bar(FD, FT,        MW + FT*2, fx, MY + MH*0.5 + FT*0.5, MZ);  // top
    _bar(FD, FT,        MW + FT*2, fx, MY - MH*0.5 - FT*0.5, MZ);  // bottom
    _bar(FD, MH+FT*2,  FT,        fx, MY, MZ - MW*0.5 - FT*0.5);   // left
    _bar(FD, MH+FT*2,  FT,        fx, MY, MZ + MW*0.5 + FT*0.5);   // right

    // ── Soft cool fill light in front of mirror ───────────────────────────────
    const mLight = new THREE.PointLight(0xc8e8ff, 1.2, 18);
    mLight.position.set(MX + 5, MY + 1, MZ);
    scene.add(mLight);

    // ── "MIRROR" label above frame ────────────────────────────────────────────
    // Simple canvas texture — no font loading needed
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'transparent';
    ctx.font = 'bold 36px monospace';
    ctx.fillStyle = '#c8e8ff';
    ctx.textAlign = 'center';
    ctx.fillText('[ MIRROR ]', 256, 44);
    const labelTex = new THREE.CanvasTexture(cv);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(MW * 0.5, 0.4),
      new THREE.MeshBasicMaterial({ map: labelTex, transparent: true, depthWrite: false, fog: false })
    );
    label.rotation.y = Math.PI / 2;
    label.position.set(MX + 0.05, MY + MH * 0.5 + FT + 0.35, MZ);
    scene.add(label);

  } catch (e) {
    console.warn('[mirror] non-fatal build error:', e);
  }
}
