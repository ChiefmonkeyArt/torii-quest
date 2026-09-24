// engine/world/portalMirror.js — the browser-only THREE adapter for the portal LIVE
// MIRROR (ADR-0118). It renders the HOME scene into an offscreen WebGLRenderTarget and
// hands the target texture to portalSurface.bindPortalTexture() so the gate aperture
// reveals the destination world — not a flat sky.
//
// ADR-0124/0125: the destination is a COPY of the home world (same arena, sea, grass,
// sky — minus the NPC and the viewer's own body). So instead of rebuilding a second
// arena (slow, and it never matched the home scene's Sky.js atmosphere or animated
// sea/grass), the mirror renders the HOME scene itself from a portal camera on the far
// side of the gate. The NPC and first-person body are hidden for the duration of the
// pass so the destination reads as "home, empty of you and the NPC".
//
// Two tiers on the seam the host orchestrates via worldMirror.openMirror:
//   peek — the home scene is rendered through the gate (no socket)
//   live — same render, plus a read-only spectator stream (avatars are a future pass)
//
// Allocation-disciplined: the camera and target are created ONCE and reused; the
// per-frame path only mutates the camera pose and visibility. dispose() tears it down.
//
// Not imported by any node-safe leaf: THREE + WebGL only, reached from arenaRuntime
// (the lazy ENTER ARENA chunk). `node --check`-ed for syntax only.

import * as THREE from 'three';
import { scene as defaultScene } from '../../scene.js';
import { TRAVEL_GATE_X, TRAVEL_GATE_Z } from '../../config.js';
import { sampleNapHeight } from '../../terrain/heightmap.js';
import { quatFromYaw } from './gateTransform.js';
import { computePortalCamera } from './portalCamera.js';
import { setNapNpcVisible } from '../../napNpc.js';
import { setPortalMirrorHidden } from '../../firstPersonBody.js';
import { setAllNameplatesVisible } from '../../bots.js';

export function createPortalMirror({ THREE: T = THREE, targetWidth = 1024, targetHeight = 1024 } = {}) {
  let _camera = null;
  let _target = null;
  let _built = false;
  let _arrival = null;        // the "stepped out" preview pose (legacy travel-gate arrival)

  // Portal transforms (ADR-0118): the gate in SOURCE space is a fixed offset the host
  // feeds once (the viewer's own gate, which does not move), and the gate in
  // DESTINATION space is read from the destination manifest. With both set, the peek
  // camera is parallax-correct (computePortalCamera); otherwise it stays the fixed
  // 3/4 fallback view.
  let _portalFrom = null; // { position, quaternion } in the SOURCE (viewer) world
  let _portalTo = null;   // { position, quaternion } in the DESTINATION world
  let _viewer = null;     // { position, quaternion } of the viewer camera (per frame)

  /** Prepare the mirror (peek tier). Idempotent. The destination is a copy of home, so
   *  there is no second scene to build — the render pass draws defaultScene itself. */
  function build(world, { assetUrl, loadGltf } = {}) {
    if (!_target) {
      _camera = new T.PerspectiveCamera(60, targetWidth / targetHeight, 0.1, 1000);
      _target = new T.WebGLRenderTarget(targetWidth, targetHeight);
    }

    // Arrival pose: standing just inside the travel gate, eye-height above the NAP
    // terrain, facing INTO the arena (south) — the same view a traveller lands on.
    const gwY = sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z);
    _arrival = {
      position: { x: TRAVEL_GATE_X, y: gwY + 1.6, z: TRAVEL_GATE_Z - 2.6 },
      yaw: Math.PI,
      forward: { x: 0, z: -1 },
    };
    _camera.position.set(_arrival.position.x, _arrival.position.y, _arrival.position.z);
    _camera.lookAt(_arrival.position.x, _arrival.position.y, _arrival.position.z - 10);

    // Portal transforms: the viewer stands SOUTH of the gate looking NORTH at it, but the
    // destination arena lies SOUTH of the destination gate — so "through the gate" must
    // flip the view 180°. The source gate is fed with identity yaw (arenaRuntime), so the
    // destination gate carries yaw π: M_to · M_from⁻¹ rotates the viewer's north-facing
    // look into a south-facing look INTO the arena (the wardrobe: you see the far side).
    _portalTo = { position: { x: TRAVEL_GATE_X, y: gwY, z: TRAVEL_GATE_Z }, quaternion: quatFromYaw(Math.PI) };

    _built = true;
    return true;
  }

  /** Spectator avatars are a future pass — the home scene is already live (animated
   *  sea + grass), so the roster is accepted and ignored for now. */
  function setRoster() { /* noop */ }

  /** Render the HOME scene into the target. No-op before build(). */
  function render(renderer) {
    if (!_built || !renderer || !_target) return;
    // Parallax-correct frame (ADR-0118): with the viewer pose + BOTH gate transforms
    // known, map the viewer's own camera through the portal (M_to · M_from⁻¹ · M_viewer)
    // so the view through the aperture shifts like a real window as the player walks
    // and looks — the destination is another dimension on the far side of the gate.
    if (_viewer && _portalFrom && _portalTo) {
      let cam = null;
      try { cam = computePortalCamera({ viewer: _viewer, portalFrom: _portalFrom, portalTo: _portalTo }); } catch { cam = null; }
      if (cam) {
        _camera.position.set(cam.position.x, cam.position.y, cam.position.z);
        _camera.quaternion.set(cam.quaternion.x, cam.quaternion.y, cam.quaternion.z, cam.quaternion.w);
      }
    } else if (_arrival) {
      // Fallback when the parallax transform is incomplete (no viewer pose fed, or the
      // destination has no gate): the eye stays at the arrival point but pans its head
      // gently left/right so the iris reads as a person turning their head rather than
      // a frozen frame. The pose is a pure function of time (deterministic per frame).
      const t = performance.now() * 0.0004;
      const pan = Math.sin(t) * 0.14; // ±8°
      const yaw = _arrival.yaw + pan;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      _camera.position.set(_arrival.position.x, _arrival.position.y, _arrival.position.z);
      _camera.lookAt(_arrival.position.x + fx, _arrival.position.y, _arrival.position.z + fz);
    }
    // Safety net: never let the mirror camera sit below the NAP surface (the legacy
    // arena's terrain is the procedural heightmap, not a manifest).
    const floor = sampleNapHeight(_camera.position.x, _camera.position.z);
    if (Number.isFinite(floor) && _camera.position.y < floor) {
      _camera.position.y = floor;
    }
    // Draw the HOME scene (the destination is a copy of home). Hide the NPC + the
    // viewer's own first-person body for the pass so the far side reads "home, empty
    // of you and the NPC"; restore them in finally so a render fault can't strand them.
    setNapNpcVisible(false);
    setPortalMirrorHidden(true);
    setAllNameplatesVisible(false);
    try {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(_target);
      // The renderer runs with autoClear=false (scene.js), so clear the RT's color +
      // depth explicitly — otherwise the Sky.js dome (depthWrite=false, drawn at the far
      // plane) reads stale depth and the sun sprite's semi-transparent corona blends into
      // the previous frame, accumulating to a blown-out white horizon.
      renderer.clear();
      renderer.render(defaultScene, _camera);
      renderer.setRenderTarget(prev);
    } finally {
      setNapNpcVisible(true);
      setPortalMirrorHidden(false);
      setAllNameplatesVisible(true);
    }
  }

  /** The destination world render-target texture (feed bindPortalTexture). */
  function texture() { return _target ? _target.texture : null; }

  /** The raw render target (readRenderTargetPixels for an in-panel preview blit). */
  function target() { return _target; }

  function isBuilt() { return _built; }

  /**
   * Feed the SOURCE-side gate transform (the viewer's own gate) once it is known.
   * Null clears it (falls back to the fixed 3/4 view). Idempotent.
   */
  function setPortalFrom(transform) { _portalFrom = transform || null; }

  /**
   * Feed the current viewer camera pose (position + quaternion in SOURCE space),
   * read every frame by the host. Null clears it (the fixed 3/4 view is kept).
   */
  function setViewer(viewer) { _viewer = viewer || null; }

  /** The destination gate transform read from the manifest (null when the world has
   *  no gate — parallax is undefined and the fixed 3/4 view is used). */
  function portalTo() { return _portalTo; }

  function dispose() {
    if (_target) { try { _target.dispose(); } catch { /* noop */ } _target = null; }
    _camera = null;
    _built = false;
    _portalFrom = null; _portalTo = null; _viewer = null;
  }

  return { build, setRoster, render, texture, target, isBuilt, setPortalFrom, setViewer, portalTo, dispose };
}
