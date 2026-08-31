// stickerSelfView.js — the in-world SELF-VIEW sticker placement input binding
// (ADR-0088 follow-up). Press KeyP while playing to enter: the camera detaches
// from the player and orbits around the player's OWN character (the same mesh
// the NAP-zone mirror shows — layer 1), so the player sees themselves and
// places a sticker with a real 3D raycast. Pointer-lock mouse orbits + aims,
// left-click confirms, Esc cancels.
//
// Pure decisions live in engine/character/stickerPlacementMode.js +
// stickerRaycast.js; the SkinnedMesh raycast lives in stickerStudio.js. This
// module is the runtime input binding that drives them. It never signs or
// publishes — onConfirm hands the {hash, zoneId, u, v, rot} placement to the
// host (main.js), which folds it through addSticker + the kind-35100 republish.

import * as THREE from 'three';
import { camera, scene } from './scene.js';
import { state, isPlaying } from './state.js';
import { getYaw, getPitch, onKeyDown, onShoot } from './input.js';
import { getPlayerModelRoot } from './playerModel.js';
import { raycastOwnCharacterMesh, hasOwnCharacterMesh } from './stickerStudio.js';
import { enterPlacementMode, aimPlacement, confirmPlacement, PLACEMENT_PHASE } from './engine/character/stickerPlacementMode.js';
import { STICKER_LIBRARY, getStickerZone } from './engine/character/stickerPlacement.js';
import { showFlyNotice } from './hud.js';

// Orbit + aim tuning. Pitch maps BOTH the camera elevation and (through the
// look-at-centre ray) which height the crosshair strikes — raise the camera to
// aim at the head/shoulders, lower it to aim at the hips/legs.
const ORBIT_RADIUS      = 2.7;
const ORBIT_PITCH_MIN   = -1.3;  // rad — low camera (aim lower body)
const ORBIT_PITCH_MAX   = 1.3;   // rad — high camera (aim head/shoulders)
const ORBIT_PITCH_ENTER = 0.22;  // initial elevation — a little above eye level
const PREVIEW_RADIUS    = 0.07;

// Module state (never allocated per-frame; scratch below).
let _camera   = null;
let _scene    = null;
let _playerObj = null;
let _onConfirm = null;
let _active   = false;

// Pure placement-mode state (engine/character/stickerPlacementMode.js).
let _mode = enterPlacementMode();

// Scratch vectors.
const _center  = new THREE.Vector3();
const _camPos  = new THREE.Vector3();
const _fwd     = new THREE.Vector3();
const _hit     = new THREE.Vector3();

// Preview marker + HUD.
let _marker    = null;
let _markerMat = null;
let _hudEl     = null;

export function initStickerSelfView({ camera: cam, scene: scn, playerObj, onConfirm } = {}) {
  _camera    = cam || null;
  _scene     = scn || null;
  _playerObj = playerObj || null;
  _onConfirm = typeof onConfirm === 'function' ? onConfirm : null;
}

export function isStickerPlacementActive() { return _active; }

// _characterCenter(out) — the world centre of the player's own character mesh
// (SkinnedMesh origin + half the geometry height). Fallback is a fixed 0.9m lift.
function _characterCenter(out) {
  const root = getPlayerModelRoot();
  if (!root) return out.set(0, 1, 0);
  let mesh = null;
  root.traverse((o) => { if (o.isSkinnedMesh && !mesh) mesh = o; });
  if (mesh) {
    mesh.getWorldPosition(out);
    const bb = mesh.geometry && mesh.geometry.boundingBox;
    out.y += bb ? (bb.max.y - bb.min.y) * 0.5 : 0.9;
  } else {
    root.getWorldPosition(out);
    out.y += 0.9;
  }
  return out;
}

function _ensureMarker() {
  if (_marker || !_scene) return;
  _markerMat = new THREE.MeshBasicMaterial({
    color: 0x2effb0, transparent: true, opacity: 0.9, depthTest: false,
  });
  _marker = new THREE.Mesh(new THREE.SphereGeometry(PREVIEW_RADIUS, 16, 12), _markerMat);
  _marker.layers.set(1); // self-view only — invisible to the normal FPS camera (layer 2/0)
  _marker.visible = false;
  _scene.add(_marker);
}

function _hudDom() {
  if (_hudEl) return _hudEl;
  _hudEl = document.createElement('div');
  _hudEl.id = 'sticker-place-hud';
  Object.assign(_hudEl.style, {
    position: 'fixed', top: '14px', left: '50%', transform: 'translateX(-50%)',
    padding: '10px 22px', background: 'rgba(0,0,0,0.55)',
    border: '1.5px solid rgba(220,242,255,0.9)', borderRadius: '999px',
    color: '#fff', fontFamily: 'monospace', fontSize: '15px', letterSpacing: '1px',
    fontWeight: 'bold', textShadow: '0 1px 2px rgba(0,0,0,0.7)',
    pointerEvents: 'none', zIndex: '61', display: 'none',
  });
  document.body.appendChild(_hudEl);
  return _hudEl;
}

function _setHud(zoneLabel) {
  const el = _hudDom();
  el.style.display = 'block';
  el.textContent = zoneLabel
    ? `STICKER — ${zoneLabel} · click to place · Esc to cancel`
    : 'STICKER — aim at yourself · click to place · Esc to cancel';
}

function _hideHud() { if (_hudEl) _hudEl.style.display = 'none'; }

// enterStickerSelfView() — detach + settle the camera into the self-view orbit,
// swap the layer mask so the player's own character is visible, and prime the
// pure placement mode. No-op when already active, not playing, or no mesh.
export function enterStickerSelfView() {
  if (_active || !_camera || !_scene) return;
  if (!isPlaying() || !hasOwnCharacterMesh()) {
    showFlyNotice(hasOwnCharacterMesh() ? 'Sticker placement — enter the arena first' : 'Sticker placement — no character loaded');
    return;
  }
  _active = true;
  state.stickerPlacementActive = true;
  _mode = enterPlacementMode();

  // Detach the shared camera (preserve world transform), like flyCamera.
  _scene.attach(_camera);

  // Show the full character (layer 1), hide the headless FP body (layer 2).
  _camera.layers.enable(1);
  _camera.layers.disable(2);

  // Initial orbit: keep the player's facing, start a little above eye level.
  _characterCenter(_center);
  _setOrbitCam(getYaw(), ORBIT_PITCH_ENTER);
  _ensureMarker();
  _setHud(null);
}

// exitStickerSelfView() — restore the camera to the player and the layer mask.
export function exitStickerSelfView() {
  if (!_active) return;
  _active = false;
  state.stickerPlacementActive = false;
  if (_marker) { _marker.visible = false; }
  _hideHud();
  if (_camera) {
    // Restore the layer mask (normal: layer 2 on, layer 1 off — see scene.js).
    _camera.layers.disable(1);
    _camera.layers.enable(2);
  }
  if (_playerObj && _camera) {
    _playerObj.add(_camera);
    // player.js overwrites rotation.x + position.y/z each tick; zero the rest.
    _camera.position.x = 0;
    _camera.rotation.y = 0;
    _camera.rotation.z = 0;
  }
}

export function toggleStickerSelfView() {
  if (_active) exitStickerSelfView();
  else enterStickerSelfView();
}

// _setOrbitCam(yaw, pitch) — place the camera on the orbit sphere around the
// character centre and aim it at that centre (allocation-free scratch).
function _setOrbitCam(yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  _camPos.set(
    _center.x + ORBIT_RADIUS * cp * Math.sin(yaw),
    _center.y + ORBIT_RADIUS * sp,
    _center.z + ORBIT_RADIUS * cp * Math.cos(yaw),
  );
  _camera.position.copy(_camPos);
  _camera.lookAt(_center);
}

// tickStickerSelfView() — per-frame orbit + crosshair raycast + preview. No-op
// unless active.
export function tickStickerSelfView() {
  if (!_active || !_camera) return;

  // Mouse orbit: yaw → azimuth, pitch → elevation (clamped).
  const yaw = getYaw();
  const pitch = Math.max(ORBIT_PITCH_MIN, Math.min(ORBIT_PITCH_MAX, getPitch()));
  _characterCenter(_center);
  _setOrbitCam(yaw, pitch);

  // Crosshair ray → own character.
  _camera.getWorldDirection(_fwd);
  const hit = raycastOwnCharacterMesh(_camera.position, _fwd);

  if (hit) {
    _hit.set(hit.point.x, hit.point.y, hit.point.z);
    _mode = aimPlacement(_mode, hit, STICKER_LIBRARY[0].hash);
  } else {
    _mode = enterPlacementMode();
  }

  const draft = (_mode.phase === PLACEMENT_PHASE.PLACING && _mode.draft) ? _mode.draft : null;
  if (draft) {
    _ensureMarker();
    _marker.position.copy(_hit);
    _marker.visible = true;
    const zone = getStickerZone(draft.zoneId);
    _setHud(zone ? zone.label : draft.zoneId);
  } else {
    if (_marker) _marker.visible = false;
    _setHud(null);
  }
}

// _confirmPlacement() — fold the current aim into a confirmed placement and hand
// it to the host, then exit.
function _confirmPlacement() {
  if (!_active) return;
  if (_mode.phase !== PLACEMENT_PHASE.PLACING || !_mode.draft) return;
  _mode = confirmPlacement(_mode);
  const placement = _mode.draft;
  exitStickerSelfView();
  if (_onConfirm && placement) _onConfirm(placement);
}

// ── Input wiring (registered once; each callback gates on _active) ────────────
(function _wire() {
  if (typeof window === 'undefined') return;
  onKeyDown((code) => {
    if (code === 'KeyP' && isPlaying()) toggleStickerSelfView();
  });
  onShoot(() => {
    if (_active) _confirmPlacement();
  });
})();