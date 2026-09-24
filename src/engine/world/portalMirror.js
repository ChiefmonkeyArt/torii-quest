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
import { buildArena } from '../../arena.js';
import { buildFoliage } from '../../arena-foliage.js';
import { scene as defaultScene } from '../../scene.js';
import { TRAVEL_GATE_X, TRAVEL_GATE_Z } from '../../config.js';
import { sampleNapHeight } from '../../terrain/heightmap.js';
import { computePortalCamera } from './portalCamera.js';

const MAX_AVATARS = 96; // generous: bots (<=64) + peers

export function createPortalMirror({ THREE: T = THREE, targetWidth = 1024, targetHeight = 1024 } = {}) {
  let _scene = null;
  let _sun = null;
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

  /** Build the destination world into the mirror scene (peek tier). Idempotent.
   *  ADR-0124: the destination is a copy of the HOME world, so it is built with the
   *  FULL legacy arena builder (buildArena + buildFoliage) — the recognisable world
   *  with sea, terrain, crates, bridge, torii gates, NAP zone and grass — NOT the
   *  minimal cloud-platform reconstruction. */
  function build(world, { assetUrl, loadGltf } = {}) {
    if (!_scene) {
      _scene = new T.Scene();
      // Match the HOME arena's lighting (scene.js) so the destination renders with the
      // same warm sunrise look. The arena's MeshStandardMaterial terrain/crates/glass/neon
      // need the ambient + directional pair — a lone directional leaves unlit faces black.
      _scene.add(new T.AmbientLight(0xffc080, 0.55));
      _sun = new T.DirectionalLight(0xffa830, 1.15);
      _sun.position.set(40.66, 12.78, -26.14); // normalize(0.70,0.22,-0.45) * 50 (scene.js _sunDir)
      _scene.add(_sun);
      const _fill = new T.PointLight(0xffa060, 0.7, 60);
      _fill.position.set(-10, 8, 10);
      _scene.add(_fill);
      _camera = new T.PerspectiveCamera(60, targetWidth / targetHeight, 0.1, 1000);
      _target = new T.WebGLRenderTarget(targetWidth, targetHeight);
    }
    // Rebuild-safe: clear any prior build from the scene before re-adding.
    _disposeSceneContents();

    // The FULL arena (floor, crates, bridge, torii gates, NAP zone, sea, coastline).
    try { buildArena(_scene); } catch (e) { console.warn('[mirror] buildArena failed:', e && e.message ? e.message : e); }
    // Grass (async, best-effort — pops in like the home world's own grass).
    try { buildFoliage(undefined, _scene).catch(() => {}); } catch (e) { console.warn('[mirror] foliage failed:', e && e.message ? e.message : e); }

    // Sky: the arena's clear-day blue (the mirror scene has no Sky.js, so an unpainted
    // background would read black).
    try { _scene.background = new T.Color(0xcfe3f7); } catch { /* noop */ }

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

    // Portal transforms: source gate == destination gate (identical worlds), so the
    // through-gate parallax mapping is identity — the destination gate carries the SAME
    // transform as the source gate (arenaRuntime feeds portalFrom with identity yaw), so
    // M_to · M_from⁻¹ = I and the mirror camera = the viewer's own pose in the identical
    // destination world. A non-identity yaw here would rotate the view 90° and split it.
    _portalTo = { position: { x: TRAVEL_GATE_X, y: gwY, z: TRAVEL_GATE_Z }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

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
    _disposeSceneContents();
    if (_botMat) { try { _botMat.dispose(); } catch { /* noop */ } _botMat = null; }
    if (_peerMat) { try { _peerMat.dispose(); } catch { /* noop */ } _peerMat = null; }
    if (_avatars.length) {
      for (const a of _avatars) { try { if (a.mesh.geometry) a.mesh.geometry.dispose(); } catch { /* noop */ } }
      _avatars.length = 0;
    }
    _freeRiders.length = 0;
    if (_target) { try { _target.dispose(); } catch { /* noop */ } _target = null; }
    _scene = null; _sun = null; _camera = null;
    _built = false;
    _portalFrom = null; _portalTo = null; _viewer = null;
  }

  // _disposeSceneContents() — tear down the full-arena build (ADR-0124): traverse the
  // mirror scene and dispose every geometry + material, then clear it. The arena builder
  // adds meshes directly (no returned handle), so this is the teardown path. Materials
  // shared with the HOME scene (module-level in arena.js: crateMat/_glassMat/_neonMat)
  // are skipped — they are still live in the home world and must not be disposed.
  function _disposeSceneContents() {
    if (!_scene) return;
    const shared = new Set();
    if (defaultScene) {
      defaultScene.traverse((o) => {
        if (o && o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) if (m) shared.add(m);
        }
      });
    }
    _scene.traverse((o) => {
      if (o && o.geometry) { try { o.geometry.dispose(); } catch { /* noop */ } }
      if (o && o.material) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m || shared.has(m)) continue;
          try { m.dispose && m.dispose(); } catch { /* noop */ }
        }
      }
    });
    // Detach every direct child (lights, meshes, groups) so the next build starts clean.
    while (_scene.children.length) { _scene.remove(_scene.children[0]); }
  }

  return { build, setRoster, render, texture, target, isBuilt, setPortalFrom, setViewer, portalTo, dispose };
}