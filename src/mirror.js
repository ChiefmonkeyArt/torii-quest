// mirror.js — Live Reflector mirror in the arena (v0.2.515: diagonal upper-left).
// Uses Three.js Reflector (real scene reflection via off-screen render target).
// Player GLB is on layer 1 — mirror camera enables layer 1 so you see yourself.
import * as THREE from 'three';
import { Reflector }  from 'three/addons/objects/Reflector.js';
import { scene, renderer } from './scene.js';
import { sampleNapHeight } from './terrain/heightmap.js';
import { ARENA_HALF, WALL_H } from './config.js';

// v0.2.518: Mirror in NAP zone, right of product panel.
// Width shortened 42% from original ~14 to ~8.1 units.
const MW = ARENA_HALF * 0.7 * 0.58;  // mirror width (~8.1 units, -42%)
const MH = WALL_H + 0.2;       // mirror height
const MX = 0.26;                  // v0.2.526: 2m right of product panel edge
const MZ = 31;                   // flush with northern rim

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

// Mirror handle accessor (v0.2.119) — returns the live Reflector mesh (or null
// before buildMirror runs). Replaces internal reads of the `window._mirrorMesh`
// global; ToriiDebug surfaces the mirror through this. The global remains only
// as a deprecated debug alias (regression check 10 forbids internal reads).
export function getMirror() { return _mirrorRef; }

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

    mirror.rotation.y = Math.PI;  // face south toward island center
    mirror.position.set(MX, sampleNapHeight(MX, MZ) + MH / 2 + 0.05, MZ);
    scene.add(mirror);
    _mirrorRef = mirror; // module handle — see getMirror() / tickMirror()
    window._mirrorMesh = mirror; // DEPRECATED debug alias (v0.2.119) — internal code uses getMirror()

    // Enable layer 1 on the reflection camera so the player's own GLB shows.
    // Three.js r168+ uses a WeakMap of reflection cameras (no more mirror.camera).
    // Patch via onBeforeRender one-shot — reflection camera exists by then.
    const _origOnBefore = mirror.onBeforeRender.bind(mirror);
    let _layerPatched = false;
    const _patchedFn = function(renderer, scene, camera) {
      _origOnBefore(renderer, scene, camera);
      if (!_layerPatched) {
        const rc = mirror._reflectionCameras?.get(camera);
        // Enable layer 1 (3rd-person player model) and DISABLE layer 2 (the
        // first-person headless body) so the FP body is never reflected.
        if (rc) { rc.layers.enable(1); rc.layers.disable(2); _layerPatched = true; }
      }
    };
    mirror.onBeforeRender = _patchedFn;
    mirror._patchedOnBefore = _patchedFn; // stored for throttle restore (_mirrorRef set above)

    // Pre-warm: let the first real onBeforeRender handle it — mirror.camera no longer
    // exists in Three.js r168+. Attempting renderer.render with undefined camera crashes
    // the render loop. Warm-up is handled naturally on first arena render frame.

    // ── Dark metal frame (parented to mirror, proper local coords) ───────────
    // PlaneGeometry(MW, MH): local X=width, local Y=height, local Z=normal
    const FT  = 0.22;   // bar thickness
    const FD  = 0.18;   // bar depth (along normal Z)
    const fMat = new THREE.MeshStandardMaterial({
      color: 0x0a0a0a, metalness: 0.95, roughness: 0.15,
    });
    const _bar = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), fMat);
      m.position.set(x, y, z);
      mirror.add(m);
    };
    const fz = FD * 0.5;  // bars sit just in front of the mirror surface
    _bar(MW + FT*2, FT, FD, 0,  MH*0.5 + FT*0.5,  fz);  // top
    _bar(MW + FT*2, FT, FD, 0, -MH*0.5 - FT*0.5,  fz);  // bottom
    _bar(FT, MH + FT*2, FD, -MW*0.5 - FT*0.5, 0,  fz);  // left
    _bar(FT, MH + FT*2, FD,  MW*0.5 + FT*0.5, 0,  fz);  // right

    // ── Soft cool fill light in front of mirror ───────────────────────────────
    const mLight = new THREE.PointLight(0xc8e8ff, 1.2, 18);
    mLight.position.set(MX, sampleNapHeight(MX, MZ) + MH + 1, MZ + 2);
    scene.add(mLight);

    // ── "MIRROR" label above frame (parented to mirror) ───────────────────────
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
    label.position.set(0, MH * 0.5 + FT + 0.35, fz);
    mirror.add(label);

  } catch (e) {
    console.warn('[mirror] non-fatal build error:', e);
  }
}
