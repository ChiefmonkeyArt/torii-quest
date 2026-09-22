// engine/world/portalMirror.js — the browser-only THREE adapter for the portal LIVE
// MIRROR (ADR-0118). It owns a SECOND offscreen scene (the DESTINATION world) + a
// WebGLRenderTarget, renders that scene every frame, and hands the target texture to
// portalSurface.bindPortalTexture() so the gate aperture reveals the LIVE world-B —
// not a flat sky. The read-only spectator stream (spectatorClient.js) drives simple
// avatar markers (bots + peers) so the mirror shows the destination's actual motion.
//
// Two tiers on the seam the host orchestrates via worldMirror.openMirror:
//   peek — the destination world is built + rendered through the gate (no socket)
//   live — bindPortalTexture is fed AND a spectator stream moves the avatars
//
// Allocation-disciplined: the mirror scene, target and avatar pool are created ONCE
// and reused; the per-frame path only mutates positions/visibility. dispose() tears it
// all down so the next mirror (a different destination) builds fresh.
//
// Not imported by any node-safe leaf: THREE + WebGL only, reached from arenaRuntime
// (the lazy ENTER ARENA chunk). `node --check`-ed for syntax only.

import * as THREE from 'three';
import { buildMinimalWorld } from './worldRenderer.js';
import { buildTerrainVisual } from './terrainVisual.js';
import { resolveSkyColor } from './skyColor.js';
import { gateTransform } from './gateTransform.js';
import { resolveArrivalCamera } from './arrivalCamera.js';
import { liftTransformToTerrain, groundFloorFor } from './terrainSample.js';

const MAX_AVATARS = 96; // generous: bots (<=64) + peers

export function createPortalMirror({ THREE: T = THREE, targetWidth = 1024, targetHeight = 1024 } = {}) {
  let _scene = null;
  let _sun = null;
  let _world = null;        // buildMinimalWorld result (tick/dispose/spawn/platformY)
  let _camera = null;
  let _target = null;
  let _built = false;
  let _terrainMeshes = [];  // world.terrain visual-only meshes ({mesh,dispose})
  let _manifest = null;       // validated world (for per-frame camera-y ground clamp)
  let _arrival = null;        // resolveArrivalCamera(world) — the "stepped out" preview pose

  // Portal transforms (ADR-0118): the gate in SOURCE space is a fixed offset the host
  // feeds once (the viewer's own gate, which does not move), and the gate in
  // DESTINATION space is read from the destination manifest. With both set, the peek
  // camera is parallax-correct (computePortalCamera); otherwise it stays the fixed
  // 3/4 fallback view.
  let _portalFrom = null; // { position, quaternion } in the SOURCE (viewer) world
  let _portalTo = null;   // { position, quaternion } in the DESTINATION world
  let _viewer = null;     // { position, quaternion } of the viewer camera (per frame)

  // Avatar pool: capsules, split into bot (green) vs peer (cyan) materials.
  const _avatars = [];
  let _botMat = null;
  let _peerMat = null;
  let _freeRiders = []; // avatar slot indices not currently in use (lazy reuse)

  function _ensureAvatarPool() {
    if (_avatars.length) return;
    _botMat = new T.MeshBasicMaterial({ color: 0x4ade80 });
    _peerMat = new T.MeshBasicMaterial({ color: 0x22d3ee });
    const geo = new T.CapsuleGeometry(0.45, 1.4, 4, 8);
    for (let i = 0; i < MAX_AVATARS; i++) {
      const m = new T.Mesh(geo, _botMat);
      m.visible = false;
      _scene.add(m);
      _avatars.push({ mesh: m, kind: null, id: null });
    }
  }

  function _acquireSlot() {
    if (_freeRiders.length) return _freeRiders.pop();
    // fall back to a hidden slot (pool is large enough that this is rarely needed)
    for (let i = 0; i < _avatars.length; i++) if (!_avatars[i].mesh.visible) return i;
    return 0;
  }

  /** Build the destination world into the mirror scene (peek tier). Idempotent. */
  function build(world, { assetUrl, loadGltf } = {}) {
    if (!_scene) {
      _scene = new T.Scene();
      _sun = new T.DirectionalLight(0xffffff, 1.0);
      _sun.position.set(8, 12, 6);
      _scene.add(_sun);
      _camera = new T.PerspectiveCamera(60, targetWidth / targetHeight, 0.1, 1000);
      _target = new T.WebGLRenderTarget(targetWidth, targetHeight);
    }
    // Drop any terrain meshes a prior build added (rebuild is idempotent).
    for (const m of _terrainMeshes) { try { m.dispose && m.dispose(); } catch { /* noop */ } }
    _terrainMeshes.length = 0;
    if (_world) { try { _world.dispose(); } catch { /* noop */ } _world = null; }
    _manifest = world || null;

    _world = buildMinimalWorld(world, {
      scene: _scene, sun: _sun, THREE: T, assetUrl, loadGltf,
    });
    // Aim the mirror camera at the arrival pose (ADR-0122): the traveller standing
    // just inside the destination gate, back to the doorway, eye-height above the
    // terrain, facing INTO the world — the same place travel lands the player, so
    // the peek and the landed view agree. A platform-only manifest (no terrain)
    // resolves eye height to PORTAL_EYE_HEIGHT above the platform baseline.
    _arrival = resolveArrivalCamera(world || null);
    _camera.position.set(_arrival.position.x, _arrival.position.y, _arrival.position.z);
    _camera.lookAt(
      _arrival.position.x + _arrival.forward.x,
      _arrival.position.y,
      _arrival.position.z + _arrival.forward.z,
    );

    // Destination gate: if the manifest has one, remember it as the portal's far side
    // (yaw-only). No gate → keep the fixed 3/4 view (parallax is undefined).
    _portalTo = gateTransform(world);
    // Lift the far-side gate to EYE height above the destination terrain. Manifests
    // (e.g. Bekka's torii-gate objects) carry `y = 0` at world origin; the raw value
    // maps the parallax camera underground, so the iris showed sky instead of the
    // island. Pure no-op when the world has no terrain or no gate.
    _portalTo = liftTransformToTerrain(world, _portalTo);

    // Sky: paint the destination world's colour (the mirror scene has no Sky.js, so
    // an unpainted background reads as a black iris).
    try { _scene.background = new T.Color(resolveSkyColor(world)); } catch { /* noop */ }

    // Terrain: build the destination's REAL island (visual-only) so the peek shows
    // the world the traveller would walk into, not a flat platform. Inline heights
    // build synchronously; add the meshes straight into the mirror scene.
    try {
      const tv = buildTerrainVisual(world, { THREE: T });
      if (tv && tv.ok) {
        for (const m of tv.meshes) { if (m && m.mesh) { _scene.add(m.mesh); _terrainMeshes.push(m); } }
      }
    } catch { /* noop */ }

    _built = true;
    return true;
  }

  /**
   * Reposition the avatar pool from the spectator roster. `bots` and `peers` are the
   * plain arrays returned by spectatorClient.readBots() / readPeers().
   */
  function setRoster(bots = [], peers = []) {
    if (!_built) return;
    _ensureAvatarPool();
    // hide everything, then claim slots by reuse
    for (const a of _avatars) { a.mesh.visible = false; a.kind = null; a.id = null; }
    _freeRiders.length = 0;
    for (let i = 0; i < _avatars.length; i++) _freeRiders.push(i);

    for (const b of bots) {
      if (!b || !b.alive) continue;
      const slot = _acquireSlot();
      const a = _avatars[slot];
      a.mesh.material = _botMat;
      a.mesh.position.set(b.x, 1.0, b.z);
      a.mesh.rotation.y = b.rotY || 0;
      a.mesh.visible = true;
      a.kind = 'bot'; a.id = b.id;
    }
    // Peers sit on top of bots; a peer takes a fresh slot (bots-first means peers win
    // the last slots in the pool when full — fine for a mirror).
    for (const p of peers) {
      if (!p) continue;
      const slot = _acquireSlot();
      const a = _avatars[slot];
      a.mesh.material = _peerMat;
      a.mesh.position.set(p.pos.x, p.pos.y, p.pos.z);
      a.mesh.rotation.y = p.rot && typeof p.rot.yaw === 'number' ? p.rot.yaw : 0;
      a.mesh.visible = true;
      a.kind = 'peer'; a.id = p.id;
    }
  }

  /** Render the mirror scene into the target. No-op before build(). */
  function render(renderer) {
    if (!_built || !renderer || !_target) return;
    // "Looking around": the eye stays at the arrival point but pans its head gently
    // left/right around the arrival forward, so the iris reads as a person turning
    // their head rather than a frozen frame. The pose is a pure function of time, so
    // the preview is deterministic per frame and never drifts below the surface.
    if (_arrival) {
      const t = performance.now() * 0.0004;
      const pan = Math.sin(t) * 0.14; // ±8°
      const yaw = _arrival.yaw + pan;
      const fx = Math.sin(yaw);
      const fz = Math.cos(yaw);
      _camera.position.set(_arrival.position.x, _arrival.position.y, _arrival.position.z);
      _camera.lookAt(_arrival.position.x + fx, _arrival.position.y, _arrival.position.z + fz);
    }
    // Safety net: never let the mirror camera sit below the destination surface.
    // A lifted far-side gate fixes the common case; this clamp also covers a viewer
    // pose that maps through the portal to a low point (parallax is positional — a
    // low source eye could still dip below a raised island). Pure no-op without terrain.
    if (_manifest) {
      const floor = groundFloorFor(_manifest, _camera.position.x, _camera.position.z);
      if (floor != null && _camera.position.y < floor) {
        _camera.position.y = floor;
      }
    }
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(_target);
    renderer.render(_scene, _camera);
    renderer.setRenderTarget(prev);
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
    if (_world) { try { _world.dispose(); } catch { /* noop */ } _world = null; }
    for (const m of _terrainMeshes) { try { m.dispose && m.dispose(); } catch { /* noop */ } }
    _terrainMeshes.length = 0;
    if (_botMat) { try { _botMat.dispose(); } catch { /* noop */ } _botMat = null; }
    if (_peerMat) { try { _peerMat.dispose(); } catch { /* noop */ } _peerMat = null; }
    if (_avatars.length) {
      for (const a of _avatars) { try { if (a.mesh.geometry) a.mesh.geometry.dispose(); } catch { /* noop */ } }
      _avatars.length = 0;
    }
    _freeRiders.length = 0;
    if (_target) { try { _target.dispose(); } catch { /* noop */ } _target = null; }
    _manifest = null;
    _scene = null; _sun = null; _camera = null;
    _built = false;
    _portalFrom = null; _portalTo = null; _viewer = null;
  }

  return { build, setRoster, render, texture, target, isBuilt, setPortalFrom, setViewer, portalTo, dispose };
}