// engine/debug/flyCamera.js — dev/debug free-fly camera (v0.2.343).
//
// Detaches the shared `camera` from the player body and drives it directly:
// WASD on the camera's horizontal plane, Space to ascend, C/Ctrl to descend,
// Shift to boost. Mouse look reuses the EXISTING pointer-lock yaw/pitch from
// input.js (no second pointer lock). While enabled, player.js skips its per-frame
// camera write (gated on ToriiDebug.fly.enabled) so fly controls win; disabling
// re-parents the camera to the player and the next player tick snaps it back to
// the eye.
//
// Surfaced through ToriiDebug.fly (see toriiDebug.js). Allocation-free update:
// all temp vectors are module-scoped scratch, never allocated in the hot path.
import * as THREE from 'three';
import { keys, getYaw, getPitch, setYaw, setPitch } from '../../input.js';
import { state, isPlaying } from '../../state.js';

const SPEED       = 18;   // units/sec, normal
const BOOST_SPEED = 60;   // units/sec, Shift held
const PITCH_LIMIT = Math.PI / 2 - 0.02; // ±~89°

// F1 (v2): entering with fly ON drops the eye into the sky above the arena
// centre, looking down at it — never a ground-level spawn that then rises.
const SKY_EYE_Y   = 12;   // ≥10m above the arena, per spec
const SKY_PITCH   = -Math.PI / 2.1; // steep look-down toward (0,0,0)

// Scratch — never allocate in the per-frame update.
const _fwd  = new THREE.Vector3();
const _move = new THREE.Vector3();

let _camera   = null;
let _scene    = null;
let _playerObj = null;
let _enabled  = false;
let _onToggle = null; // optional (enabled:boolean) => void, for HUD/label sync
let _prevOrder = 'XYZ';

// init — wire the live scene graph handles once from arenaRuntime.
export function initFlyCamera({ camera, scene, playerObj, onToggle } = {}) {
  _camera = camera || null;
  _scene = scene || null;
  _playerObj = playerObj || null;
  _onToggle = typeof onToggle === 'function' ? onToggle : null;
}

export function isFlyEnabled() { return _enabled; }

// Current fly-camera eye position in world space. During fly the camera is a
// direct child of the scene, so its local position IS its world position.
// Exposed so player.js can keep the hit-capsule under the eye and bots can read
// the flying player's altitude (F4). Writes into `out` (no allocation).
export function getFlyEye(out) {
  if (_camera) out.copy(_camera.position);
  return out;
}
export function getFlyEyeY() { return _camera ? _camera.position.y : 0; }

// enableFly({ atSky }) — detach the shared camera and drive it free.
//   • default: preserve the current world transform (used mid-air / at a jump
//     apex so the view doesn't jump on enable).
//   • atSky:true (F1): drop the eye to (0, SKY_EYE_Y, 0) looking down at the
//     arena centre. Starts already high — never a ground spawn that then rises.
export function enableFly(opts = {}) {
  if (_enabled || !_camera || !_scene) return;
  _enabled = true;
  // Detach from the player body, preserving the current world transform so the
  // view doesn't jump on enable. scene.attach keeps world position/orientation.
  _scene.attach(_camera);
  // FPS-style look needs yaw-then-pitch order to avoid roll/gimbal artefacts.
  _prevOrder = _camera.rotation.order;
  _camera.rotation.order = 'YXZ';
  if (opts.atSky) {
    _camera.position.set(0, SKY_EYE_Y, 0);
    // Drive the shared pointer-lock look so tickFly (which rewrites rotation from
    // getYaw/getPitch every frame) holds the downward-at-centre orientation.
    setYaw(0);
    setPitch(SKY_PITCH);
    _camera.rotation.set(SKY_PITCH, 0, 0);
  }
  if (_onToggle) _onToggle(true);
}

export function disableFly() {
  if (!_enabled) return;
  _enabled = false;
  _camera.rotation.order = _prevOrder;
  if (_playerObj && _camera) {
    // Re-parent to the player; reset the local transform the player tick doesn't
    // fully rewrite (it sets rotation.x + position.y/z only), so the next tick
    // snaps the camera cleanly back to the eye.
    _playerObj.add(_camera);
    _camera.position.x = 0;
    _camera.rotation.y = 0;
    _camera.rotation.z = 0;
  }
  if (_onToggle) _onToggle(false);
}

export function toggleFly() {
  if (_enabled) disableFly(); else enableFly();
  return _enabled;
}

// update(dt) — per-frame free-fly integration. No-op unless enabled, playing, and
// pointer-locked (so it never fights the title screen or a paused/unlocked view).
export function tickFly(dt) {
  if (!_enabled || !_camera) return;
  if (!isPlaying() || !state.pointerLocked) return;

  // Mouse look: reuse the pointer-lock yaw/pitch input already accumulates.
  const yaw = getYaw();
  const pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, getPitch()));
  _camera.rotation.set(pitch, yaw, 0);

  // Horizontal heading from yaw (matches player forward/right basis).
  const sinY = Math.sin(yaw), cosY = Math.cos(yaw);
  _move.set(0, 0, 0);
  // forward = (-sinY, 0, -cosY); right = (cosY, 0, -sinY)
  if (keys['KeyW'] || keys['ArrowUp'])    { _move.x += -sinY; _move.z += -cosY; }
  if (keys['KeyS'] || keys['ArrowDown'])  { _move.x +=  sinY; _move.z +=  cosY; }
  if (keys['KeyA'] || keys['ArrowLeft'])  { _move.x += -cosY; _move.z +=  sinY; }
  if (keys['KeyD'] || keys['ArrowRight']) { _move.x +=  cosY; _move.z += -sinY; }
  if (_move.lengthSq() > 0) _move.normalize();

  // Vertical: Space up, C / Ctrl down.
  let vy = 0;
  if (keys['Space']) vy += 1;
  if (keys['KeyC'] || keys['ControlLeft'] || keys['ControlRight']) vy -= 1;

  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? BOOST_SPEED : SPEED;
  const step = speed * dt;
  _fwd.set(_move.x, vy, _move.z);
  if (_fwd.lengthSq() > 0) _camera.position.addScaledVector(_fwd, step);
}
