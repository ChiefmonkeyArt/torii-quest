// engine/world/portalWindow.js — the browser-only THREE adapter for the WORLD-SPACE
// portal WINDOW (ADR-0124). Replaces the ADR-0118 fullscreen iris: instead of a circle
// expanding over the player's face, a flat rectangle stands INSIDE the travel gate and
// samples the destination world's live-mirror render target — open the gate and see into
// another dimension, the way the wardrobe opens into Narnia.
//
// The window is a single PlaneGeometry (MeshBasicMaterial) added to the ARENA scene, so
// it renders WITH the frame at correct depth and is framed by the gate's posts/crossbeam.
// It is built ONCE and reused; per-frame work is only visibility + texture re-bind (no
// allocation). The mirror camera already renders the destination with parallax, so the
// window needs no camera math — it just shows the frame. A null texture hides the window
// (the gate then reads as an empty doorway).
//
// Not imported by any node-safe leaf: THREE + WebGL only, reached from arenaRuntime.

import * as THREE from 'three';

let _built = false;
let _scene = null;
let _mesh = null;
let _geo = null;
let _mat = null;

/** Build the window once (idempotent) and add it to the arena scene, hidden. */
export function initPortalWindow(scene) {
  if (_built || !scene) return;
  _geo = new THREE.PlaneGeometry(1, 1);
  _mat = new THREE.MeshBasicMaterial({
    map: null,
    toneMapped: false, // the mirror RT is already tone-mapped + linear; show it as-is
    side: THREE.DoubleSide,
  });
  _mesh = new THREE.Mesh(_geo, _mat);
  _mesh.visible = false;
  _mesh.frustumCulled = false;
  _scene = scene;
  _scene.add(_mesh);
  _built = true;
}

/**
 * Place + size the window in world space from the pure spec, and bind the mirror texture.
 * A missing position/texture hides the window.
 */
export function setPortalWindow({ position, width, height, rotationY, texture } = {}) {
  initPortalWindow(_scene);
  if (!position || !texture) {
    hidePortalWindow();
    return;
  }
  _mesh.position.set(position.x, position.y, position.z);
  _mesh.rotation.y = Number.isFinite(rotationY) ? rotationY : Math.PI;
  _mesh.scale.set(width || 1, height || 1, 1);
  _mat.map = texture;
  _mat.needsUpdate = true;
  _mat.opacity = 1;
  _mesh.visible = true;
}

/** Hide the window (the gate reads as an empty doorway). */
export function hidePortalWindow() {
  if (_mesh) _mesh.visible = false;
}

export function isPortalWindowVisible() { return !!(_built && _mesh && _mesh.visible); }

export function disposePortalWindow() {
  if (!_built) return;
  if (_scene && _mesh) _scene.remove(_mesh);
  if (_geo) _geo.dispose();
  if (_mat) _mat.dispose();
  _scene = null; _mesh = null; _geo = null; _mat = null;
  _built = false;
}