// playerModel.js — GLB loader, AnimationMixer, animation state machine.
// Supports multiple selectable characters. Call setCharacter() before loadPlayerModel().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';
import { keys } from './input.js';
import { setRightHandBone } from './weapons.js';

// ── Character definitions ─────────────────────────────────────────────────────
// Each entry maps logical animation slots → actual clip names in that GLB.
// 'null' = no clip available, fall back to IDLE or skip.
const CHARACTERS = {
  chiefmonkey: {
    file: '/chiefmonkey6.glb',
    anims: {
      IDLE:       'Idle_03',
      WALK:       'Walking',
      WALK_BACK:  'Walk_Backward_inplace',
      WALK_LEFT:  'Walk_Left_with_Gun_inplace',
      RUN:        'Running',
      RUN_SHOOT:  'Run_and_Shoot',
      JUMP:       'Jump_Over_Obstacle_1',
      RELOAD:     'Running_Reload_inplace',
      HIT:        'Hit_Reaction_to_Waist',
      DEATH:      'Knock_Down',
      DANCE:      'FunnyDancing_02',
      STYLISH:    'Stylish_Walk_inplace',
    },
  },
  nostrich: {
    file: '/nostrich3.glb',
    anims: {
      IDLE:       'Stylish_Walk_inplace',      // best available idle substitute
      WALK:       'Walking',
      WALK_BACK:  'Walking',                   // no dedicated clip — reuse walk
      WALK_LEFT:  'Crouch_Walk_Left_with_Gun_inplace',
      RUN:        'Running',
      RUN_SHOOT:  'Run_and_Shoot',
      JUMP:       'Jump_Over_Obstacle_1',
      RELOAD:     null,                        // no reload clip
      HIT:        'Shot_and_Blown_Back',       // best available hit sub
      DEATH:      'Knock_Down',
      DANCE:      'idle_to_push_up',           // fun idle animation
      STYLISH:    'Stylish_Walk_inplace',
    },
  },
};

// ── Active character ──────────────────────────────────────────────────────────
let _charKey = 'chiefmonkey'; // default

export function setCharacter(key) {
  if (CHARACTERS[key]) _charKey = key;
}
export function getCharacter() { return _charKey; }
export function getCharacterList() { return Object.keys(CHARACTERS); }

// ── Module state ──────────────────────────────────────────────────────────────
let _root    = null;
let _mixer   = null;
let _clips   = {};
let _actions = {};
let _current = null;
let _loaded  = false;
let _anims   = {};   // resolved anim map for current character
let _oneshotTimer  = 0;   // dt-accumulator: counts down clip duration
let _oneshotFade   = '';  // clip to fade back to when timer expires

const _BOX  = new THREE.Box3();
const _SIZE = new THREE.Vector3();
const TARGET_HEIGHT = 1.8;
const FADE = 0.15;

// ── Load ──────────────────────────────────────────────────────────────────────
export function loadPlayerModel(parentObj) {
  // Remove previous model if switching characters mid-session
  if (_root) { parentObj.remove(_root); _root = null; _loaded = false; }

  const char = CHARACTERS[_charKey];
  _anims = char.anims;

  const _draco = new DRACOLoader();
  _draco.setDecoderPath('/draco/');
  const _loader = new GLTFLoader();
  _loader.setDRACOLoader(_draco);
  _loader.load(char.file, gltf => {
    _root = gltf.scene;

    // Scale to TARGET_HEIGHT using geometry-only bounds (Box3.setFromObject includes
    // bone hierarchy which gives wildly wrong measurements on SkinnedMesh).
    let gMinY = Infinity, gMaxY = -Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) { gMinY = Math.min(gMinY, b.min.y); gMaxY = Math.max(gMaxY, b.max.y); }
      }
    });
    const geoH = (gMinY < gMaxY) ? (gMaxY - gMinY) : 1;
    // v0.2.100: the chiefmonkey GLB is already authored at metre scale (like the
    // bot model, which renders correctly at 1.0). Auto-scaling to TARGET_HEIGHT
    // shrank/grew the reflection wrongly — force 1.0 so the mirror shows the
    // player at true size.
    const s = 1.0;
    _root.scale.setScalar(s);

    // Offset feet to world y=0. parentObj (playerObj) sits at eye-height 1.7,
    // so subtract 1.7 here to put model feet at the ground in the reflection.
    const EYE_OFFSET = 1.7;
    _root.position.y = (-gMinY * s) - EYE_OFFSET;

    // Face -Z (camera forward direction)
    _root.rotation.y = Math.PI;

    // Layer 1 — hidden from player's own FPS camera, visible in mirror.
    // Also force transparent=false, depthWrite=true, frustumCulled=false on every
    // mesh: GLB exports with alphaMode:BLEND otherwise split apart in the mirror,
    // and bind-pose frustum-cull boxes clip skinned meshes mid-animation.
    _root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.layers.set(1);
        o.frustumCulled = false;
        // M4-V4a: defensive normals cleanup — recompute ONLY when the geometry
        // has no normal attribute at all (missing normals shade as hard facets).
        // Guarded so we never overwrite good authored normals (no shading change
        // on well-formed meshes). Runs once at load, not per-frame.
        if (o.geometry && !o.geometry.getAttribute('normal')) {
          o.geometry.computeVertexNormals();
        }
        if (o.material) {
          // Material may be an array — normalise to array and patch each.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = false;
            m.depthWrite  = true;
            m.alphaTest   = 0;
            // Force smooth shading — a flatShading material renders per-face
            // normals, which reads as jagged on low-poly collar/neck geometry.
            if (m.flatShading) m.flatShading = false;
            m.needsUpdate = true;
          }
        }
      }
    });

    parentObj.add(_root);

    // Find RightHand bone for world-gun attachment (mirror visibility).
    // Mixamo-rigged GLBs use names like 'mixamorigRightHand' or 'RightHand'.
    let _rh = null;
    _root.traverse(o => {
      if (_rh || !o.isBone) return;
      const n = (o.name || '').toLowerCase();
      if (n.endsWith('righthand') || n.endsWith('right_hand') || n === 'righthand') _rh = o;
    });
    if (_rh) setRightHandBone(_rh);
    else console.warn('[playerModel] RightHand bone not found — world gun will not attach');

    _mixer = new THREE.AnimationMixer(_root);
    _clips = {};
    _actions = {};
    gltf.animations.forEach(clip => {
      _clips[clip.name] = clip;
      const a = _mixer.clipAction(clip);
      a.clampWhenFinished = true;
      _actions[clip.name] = a;
    });

    _current = null;
    _play(_anims.IDLE, true);
    _loaded = true;

    console.log(`[playerModel] loaded "${_charKey}". clips:`, Object.keys(_clips));
  }, undefined, err => {
    console.warn('[playerModel] load failed:', err);
  });
}

// ── Playback helpers ──────────────────────────────────────────────────────────
function _play(name, loop = true) {
  if (!name || !_actions[name]) return;
  if (_current === name) return;
  const next = _actions[name];
  next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
  next.reset().fadeIn(FADE).play();
  if (_current && _actions[_current]) _actions[_current].fadeOut(FADE);
  _current = name;
}

function _playOnce(name, fadeTo) {
  if (!name || !_actions[name] || !_loaded) return;
  const fallback = fadeTo || _anims.IDLE;
  const action = _actions[name];
  action.setLoop(THREE.LoopOnce, 1);
  action.reset().fadeIn(FADE).play();
  if (_current && _actions[_current] && _current !== name) _actions[_current].fadeOut(FADE);
  _current = name;
  // dt-accumulator instead of setTimeout
  _oneshotTimer = Math.max((_clips[name]?.duration ?? 1) - FADE, 0.1);
  _oneshotFade  = fallback;
}

// ── Public triggers ───────────────────────────────────────────────────────────
export function triggerHit()    { if (_loaded) _playOnce(_anims.HIT); }
export function triggerDeath()  { if (_loaded) _playOnce(_anims.DEATH, _anims.IDLE); }
export function triggerReload() { if (_loaded && _anims.RELOAD) _playOnce(_anims.RELOAD); }
export function triggerDance()  { if (_loaded) _play(_anims.DANCE, true); }
export function triggerIdle()   { if (_loaded) _play(_anims.IDLE, true); }
export function isModelLoaded() { return _loaded; }

// Hide the full-body avatar while the debug free-fly camera is active. Stores the
// prior visibility on enable and restores exactly that on disable — so a body
// already hidden (death/spawn) is not force-shown when fly turns off.
let _flyPrevVisible = null;
export function setFlyHidden(hidden) {
  if (!_root) return;
  if (hidden) {
    if (_flyPrevVisible === null) _flyPrevVisible = _root.visible;
    _root.visible = false;
  } else if (_flyPrevVisible !== null) {
    _root.visible = _flyPrevVisible;
    _flyPrevVisible = null;
  }
}

// ── Tick ──────────────────────────────────────────────────────────────────────
let _mirrored = false;

export function tickPlayerModel(dt, isShooting, isReloading, isJumping) {
  if (!_loaded || !_mixer) return;
  _mixer.update(dt);

  // One-shot timer — dt-accumulator, no setTimeout
  if (_oneshotTimer > 0) {
    _oneshotTimer -= dt;
    if (_oneshotTimer <= 0 && _oneshotFade) { _play(_oneshotFade, true); _oneshotFade = ''; }
    return; // don't interrupt one-shot
  }

  if (isJumping) { _play(_anims.JUMP, false); return; }

  const fwd   = keys['KeyW'] || keys['ArrowUp'];
  const back  = keys['KeyS'] || keys['ArrowDown'];
  const left  = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const run   = keys['ShiftLeft'] || keys['ShiftRight'];
  const moving = fwd || back || left || right;

  _setMirror(right && !fwd && !back); // mirror strafe-left clip for right strafe

  if (!moving)                          { _play(_anims.IDLE, true);      return; }
  if (isShooting && moving)             { _play(_anims.RUN_SHOOT, true); return; }
  if (back)                             { _play(_anims.WALK_BACK, true); return; }
  if ((left || right) && !fwd && !back) { _play(_anims.WALK_LEFT, true); return; }
  if (run)                              { _play(_anims.RUN, true);       return; }
  _play(_anims.WALK, true);
}

function _setMirror(on) {
  if (!_root || _mirrored === on) return;
  _mirrored = on;
  _root.scale.x = Math.abs(_root.scale.x) * (on ? -1 : 1);
}
