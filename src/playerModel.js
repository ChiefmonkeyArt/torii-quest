// playerModel.js — GLB loader, AnimationMixer, animation state machine.
// Supports multiple selectable characters. Call setCharacter() before loadPlayerModel().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { scene, renderer } from './scene.js';
import { keys } from './input.js';
import { setRightHandBone } from './weapons.js';

// Enable per-material clipping planes globally (needed for the FP legs clone).
// Cheap when no material defines clippingPlanes; only the FP body clone uses it.
renderer.localClippingEnabled = true;

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

// FP body clone state — see loadPlayerModel for setup.
let _fpBody          = null;
let _fpClipPlaneY    = null;   // horizontal plane (clips above chin / under-eye)
let _fpClipLocalY    = 0.70;
let _fpClipFrontOffs = 0.10;

const _BOX  = new THREE.Box3();
const _SIZE = new THREE.Vector3();
const TARGET_HEIGHT = 1.8;
const FADE = 0.15;

// ── Load ──────────────────────────────────────────────────────────────────────
export function loadPlayerModel(parentObj) {
  // Remove previous model if switching characters mid-session
  if (_root) { parentObj.remove(_root); _root = null; _loaded = false; }
  if (_fpBody) {
    parentObj.remove(_fpBody);
    _fpBody = null; _fpClipPlaneY = null;
  }

  const char = CHARACTERS[_charKey];
  _anims = char.anims;

  new GLTFLoader().load(char.file, gltf => {
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
    const s = TARGET_HEIGHT / geoH;
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
        if (o.material) {
          // Material may be an array — normalise to array and patch each.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = false;
            m.depthWrite  = true;
            m.alphaTest   = 0;
            m.needsUpdate = true;
          }
        }
      }
    });

    parentObj.add(_root);

    // ── FP body clone: legs-only mesh visible in the first-person camera ─────
    // The mirror reflection shows the full player (layer 1). The FP camera (layer 0)
    // shows ONLY this clone, with TWO clipping planes that hide everything
    // above the knees AND everything in front of the spine. The clone shares the
    // original skeleton, so one AnimationMixer drives both. Cost: one extra
    // skinned draw call per frame for legs/feet.
    //
    // SINGLE horizontal clip plane: normal (0,-1,0), constant = world-space y
    // above which to clip. Set at chin level (~1.55m above foot) so the head
    // and neck stub never intersect the camera, but everything below — torso,
    // arms, legs, feet — renders. v0.2.63 had an extra vertical forward plane
    // that hid the feet when looking down. Dropped in v0.2.64 in favour of a
    // much bigger backward body shift (the body now sits 0.40m behind the
    // eye in local Z, so no chest geometry sits near the camera).
    const CLIP_LOCAL_Y    = 1.55;        // metres above feet — just below chin
    const fpClipPlaneY    = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
    _fpClipPlaneY   = fpClipPlaneY;

    const fpBody = _root.clone(true);   // deep clone preserving hierarchy
    // Shift the FP body BACKWARD on local Z so the spine, chest and shoulders
    // sit well behind the camera. Combined with the chin-level horizontal clip,
    // this means: looking straight down → see legs/feet receding behind you;
    // looking forward → see arms in lower periphery; chest never pokes into
    // view because it's geometrically behind the eye. Model faces local -Z,
    // so positive local Z = behind the camera.
    fpBody.position.z = (_root.position.z || 0) + 0.40;
    // Re-bind every SkinnedMesh in the clone to the ORIGINAL skeleton so the
    // mixer animates both renders from one bone hierarchy.
    const origSkinned = [];
    _root.traverse(o => { if (o.isSkinnedMesh) origSkinned.push(o); });
    let skinnedIdx = 0;
    fpBody.traverse(o => {
      if (o.isSkinnedMesh) {
        const orig = origSkinned[skinnedIdx++];
        if (orig) {
          o.skeleton = orig.skeleton;
          o.bindMatrix.copy(orig.bindMatrix);
          o.bindMatrixInverse.copy(orig.bindMatrixInverse);
          o.bind(orig.skeleton, orig.bindMatrix);
        }
      }
      if (o.isMesh) {
        o.castShadow = false;          // shadows come from the mirror model
        o.receiveShadow = false;
        o.layers.set(0);               // FP-visible, mirror-INvisible
        o.frustumCulled = false;
        if (o.material) {
          // Clone materials so adding clippingPlanes doesn't affect the mirror copy.
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          const cloned = mats.map(m => {
            const c = m.clone();
            c.transparent     = false;
            c.depthWrite      = true;
            c.alphaTest       = 0;
            c.clippingPlanes  = [fpClipPlaneY];
            c.clipShadows     = false;
            c.needsUpdate     = true;
            return c;
          });
          o.material = Array.isArray(o.material) ? cloned : cloned[0];
        }
      }
    });
    parentObj.add(fpBody);
    _fpBody = fpBody;
    _fpClipLocalY = CLIP_LOCAL_Y;

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

// ── Tick ──────────────────────────────────────────────────────────────────────
let _mirrored = false;

export function tickPlayerModel(dt, isShooting, isReloading, isJumping) {
  if (!_loaded || !_mixer) return;
  _mixer.update(dt);

  // Update the FP horizontal clip plane each frame so it tracks player y
  // (jumping/falling). Plane normal is (0,-1,0), so plane equation:
  //   -y + constant = 0  →  y = constant  → clips everything with y > constant.
  // We want to clip everything above (footY + CLIP_LOCAL_Y), so constant =
  // footY + CLIP_LOCAL_Y.
  if (_fpClipPlaneY && _root && _root.parent) {
    const footY = _root.parent.position.y - 1.7;
    _fpClipPlaneY.constant = footY + _fpClipLocalY;
  }

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
