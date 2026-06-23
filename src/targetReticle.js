// targetReticle.js — live aim preview (v0.2.113). Each frame casts a ray from
// the CAMERA along CAMERA forward (the exact path a player bullet takes) and
// classifies what the player is pointing at, then drives the crosshair colour
// via hud.setReticleState:
//   'headshot' → green + 👌  (a head shot would land — uses the SAME
//                 classifyHeadshot() the bullet path uses, so preview == outcome)
//   'on'       → green        (a body shot would land)
//   'close'    → orange       (a bot is near the line of fire but not on it)
//   'none'     → white        (nothing aimed at / disarmed)
//
// Read-only: this never spawns bullets or mutates game state. It is gated off
// while paused, reloading, or in the NAP zone (weapon disabled past the gate).
import * as THREE from 'three';
import { camera } from './scene.js';
import { BOT_BODY_CENTRE_Y_OFFSET } from './physics.js';
import { raycastService } from './engine/physics/raycastService.js';
import { classifyHeadshot } from './weapons.js';
import { setReticleState } from './hud.js';
import { state, isPlaying } from './state.js';
import { NAP_X } from './config.js';

const RANGE          = 60;   // m — matches effective bullet reach
const CLOSE_RADIUS   = 0.6;  // m — perpendicular slack that counts as "close"
const CLOSE_RADIUS_SQ = CLOSE_RADIUS * CLOSE_RADIUS;

let _bots = null;
let _playerObj = null;
let _getPlayerCollider = () => null;

// Module-scope scratch (allocated ONCE) — no per-frame allocation.
const _camPos = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _v      = new THREE.Vector3();

export function initTargetReticle({ bots, playerObj, getPlayerCollider }) {
  _bots = bots;
  _playerObj = playerObj;
  if (getPlayerCollider) _getPlayerCollider = getPlayerCollider;
}

export function tickTargetReticle() {
  // Only meaningful while actively playing AND armed.
  if (!_bots || !isPlaying() || state.reloading ||
      (_playerObj && _playerObj.position.x > NAP_X)) {
    setReticleState('none');
    return;
  }

  camera.getWorldPosition(_camPos);
  _camDir.set(0, 0, -1).applyQuaternion(camera.quaternion).normalize();

  // Direct hit — what would the shot actually score? Read-only reticle preview,
  // routed through the RaycastService facade — behaviour-identical to castRay
  // (the default service wraps the same raycast.js layer).
  const hit = raycastService.ray(
    _camPos.x, _camPos.y, _camPos.z,
    _camDir.x, _camDir.y, _camDir.z,
    RANGE,
    _getPlayerCollider() || null,
  );
  if (hit && hit.bot && hit.bot.alive) {
    const head = classifyHeadshot(hit.point.x, hit.point.y, hit.point.z, hit.bodyPart, hit.bot);
    setReticleState(head ? 'headshot' : 'on');
    return;
  }

  // No direct bot hit — is a living bot CLOSE to the line of fire? Perpendicular
  // distance from the bot torso centre to the aim ray, capped at the first
  // obstacle's distance (a bot behind a struck wall doesn't count).
  const maxT = hit ? hit.toi : RANGE;
  let close = false;
  for (let i = 0; i < _bots.length; i++) {
    const b = _bots[i];
    if (!b.alive || !b.pos) continue;
    _v.set(
      b.pos.x - _camPos.x,
      (b.pos.y + BOT_BODY_CENTRE_Y_OFFSET) - _camPos.y,
      b.pos.z - _camPos.z,
    );
    const t = _v.dot(_camDir);           // projection along the aim ray
    if (t <= 0 || t > maxT) continue;    // behind camera or past first obstacle
    const perpSq = _v.lengthSq() - t * t; // perpendicular distance squared
    if (perpSq <= CLOSE_RADIUS_SQ) { close = true; break; }
  }
  setReticleState(close ? 'close' : 'none');
}
