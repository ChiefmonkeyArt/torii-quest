// playerModel.js — GLB loader, AnimationMixer, animation state machine.
// Supports multiple selectable characters. Call setCharacter() before loadPlayerModel().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';
import { keys } from './input.js';
import { setRightHandBone } from './weapons.js';
import { assetUrl } from './assetUrl.js';
import { GAME_STATE_TO_CLIP } from './engine/animationLibrary.js';

// ── Character definitions ─────────────────────────────────────────────────────
// Each entry maps logical animation slots → actual clip names in that GLB.
// 'null' = no clip available, fall back to IDLE or skip.
const CHARACTERS = {
  chiefmonkey: {
    file: '/models/animation-library.glb',
    anims: {
      IDLE:       'Idle_02',
      WALK:       'Stylish_Walk_inplace',
      WALK_BACK:  'Walk_Backward',
      WALK_LEFT:  'Run_Forward_Firing',
      RUN:        'Running',
      RUN_SHOOT:  'Run_Forward_Firing',
      JUMP:       'Jump_Over_Obstacle_2',
      RELOAD:     'Reload_Hand_Gun',
      HIT:        'Hit_Reaction_to_Waist',
      DEATH:      'Knock_Down',
      DANCE:      'FunnyDancing_02',
      VICTORY:    'Victory_Cheer',
      MELEE:      'Melee_Left_Hand',
      LAND:       'Fall_from_Bar',
      FALL:       'Fall2',
    },
  },
  // nostrich runs the SAME master clip table as chiefmonkey. nostrich-master.glb
  // is the dense nostrich mesh with all 18 animation-library.glb clips baked onto
  // its rig via offline world-delta retargeting (tools/glb_retarget.py), so every
  // GAME_STATE_TO_CLIP name resolves directly. Unlike chiefmonkey's Z-up library
  // GLB, this file is natively Y-up, so the isZUp quaternion fix stays OFF.
  nostrich: {
    file: '/models/nostrich-master.glb',
    anims: {
      IDLE:       'Idle_02',
      WALK:       'Stylish_Walk_inplace',
      WALK_BACK:  'Walk_Backward',
      WALK_LEFT:  'Run_Forward_Firing',
      RUN:        'Running',
      RUN_SHOOT:  'Run_Forward_Firing',
      JUMP:       'Jump_Over_Obstacle_2',
      RELOAD:     'Reload_Hand_Gun',
      HIT:        'Hit_Reaction_to_Waist',
      DEATH:      'Knock_Down',
      DANCE:      'FunnyDancing_02',
      VICTORY:    'Victory_Cheer',
      MELEE:      'Melee_Left_Hand',
      LAND:       'Fall_from_Bar',
      FALL:       'Fall2',
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

// ── Custom mesh (Character Forge, v0.2.721) ────────────────────────────────────
// When the player has a signed kind-35100 character event, its mesh hash resolves
// to a Blossom URL (see engine/character/characterMesh.js) and is set here so
// loadPlayerModel() fetches THAT mesh instead of the built-in default. A null/
// empty value falls back to the built-in CHARACTERS[_charKey].file.
let _customMeshUrl = null;

export function setCustomMeshUrl(url) {
  _customMeshUrl = (typeof url === 'string' && url.trim()) ? url.trim() : null;
}
export function getCustomMeshUrl() { return _customMeshUrl; }

// The player's own mesh HASH (64-hex, from the kind-35100 manifest). Broadcast
// through the MP `character` field so peers can resolve + load the same mesh.
let _customMeshHash = null;

export function setCustomMeshHash(hash) {
  _customMeshHash = (typeof hash === 'string' && /^[0-9a-f]{64}$/.test(hash)) ? hash : null;
}
export function getCustomMeshHash() { return _customMeshHash; }

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
export async function loadPlayerModel(parentObj) {
  // Remove previous model if switching characters mid-session
  if (_root) { parentObj.remove(_root); _root = null; _loaded = false; }

  const char = CHARACTERS[_charKey];

  const _draco = new DRACOLoader();
  _draco.setDecoderPath(assetUrl('/draco/'));
  const _loader = new GLTFLoader();
  _loader.setDRACOLoader(_draco);
  try {
    const meshSrc = _customMeshUrl || assetUrl(char.file);
    const gltf = await _loader.loadAsync(meshSrc);
    _root = gltf.scene;

    // Compute geometry bounding box across both Y and Z axes.
    // Some GLBs (e.g. animation-library.glb) are Z-up — the character lies
    // along the Z axis instead of Y.  We detect this and apply a +90° X
    // rotation to stand the character upright.
    let gMinY = Infinity, gMaxY = -Infinity;
    let gMinZ = Infinity, gMaxZ = -Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) {
          gMinY = Math.min(gMinY, b.min.y); gMaxY = Math.max(gMaxY, b.max.y);
          gMinZ = Math.min(gMinZ, b.min.z); gMaxZ = Math.max(gMaxZ, b.max.z);
        }
      }
    });
    // Z-up detection: Z range significantly exceeds Y range.
    const isZUp = (gMaxZ - gMinZ) > (gMaxY - gMinY) * 1.2;
    if (isZUp) {
      // After +90 deg X rotation the old Z range becomes the new Y range (negated).
      gMinY = -gMaxZ;
    }
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

    // Face -Z (camera forward direction).
    // When the Z-up fix is active we MUST use quaternions, not Euler angles,
    // because Euler XYZ applies the Y rotation in the local (post-X) frame,
    // which rotates around the wrong axis and flips the character back down.
    if (isZUp) {
      const standUp  = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI/2);
      const turnAround = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), Math.PI);
      _root.quaternion.copy(turnAround).multiply(standUp);
    } else {
      _root.rotation.y = Math.PI;
    }

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

    // Use character's own clips (no separate library load — chiefmonkey
    // already uses animation-library.glb as its mesh file, so its clips
    // are in the correct coordinate system).
    _mixer = new THREE.AnimationMixer(_root);
    _clips = {};
    _actions = {};
    const availableClips = new Map();
    gltf.animations.forEach(clip => {
      // Strip scale tracks — Meshy.ai GLBs include scale on every bone,
      // which causes visual blips during animation transitions and at
      // loop boundaries (scale values interpolate through collapse states).
      const stripped = clip.clone();
      stripped.tracks = stripped.tracks.filter(t => t.name.endsWith('.scale') === false);
      availableClips.set(stripped.name, stripped);
    });
    availableClips.forEach((clip, name) => {
      _clips[name] = clip;
      const a = _mixer.clipAction(clip);
      a.clampWhenFinished = true;
      _actions[name] = a;
    });
    // Resolve _anims: for chiefmonkey AND nostrich, GAME_STATE_TO_CLIP provides
    // the canonical mapping (both GLBs carry the master clip names). Any future
    // character baked onto the master template joins this branch.
    _anims = {};
    if (_charKey === 'chiefmonkey' || _charKey === 'nostrich') {
      for (const stateName of new Set([
        ...Object.keys(char.anims),
        ...Object.keys(GAME_STATE_TO_CLIP),
      ])) {
        const libName = GAME_STATE_TO_CLIP[stateName];
        _anims[stateName] = (libName && availableClips.has(libName))
          ? libName
          : char.anims[stateName] || null;
      }
      _anims.WALK_LEFT = GAME_STATE_TO_CLIP.STRAFE_LEFT || char.anims.WALK_LEFT;
    } else {
      for (const [stateName, clipName] of Object.entries(char.anims)) {
        _anims[stateName] = (clipName && availableClips.has(clipName)) ? clipName : null;
      }
    }

    _current = null;
    _play(_anims.IDLE, true);
    _loaded = true;

    console.log(`[playerModel] loaded "${_charKey}". clips:`, Object.keys(_clips));
  } catch (err) {
    console.warn('[playerModel] load failed:', err);
    throw err;
  }
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

  // Keyboard state is read FIRST so one-shots can never block locomotion:
  // the animation must run in time with the keyboard, not play out its full
  // duration while the player has already moved on to doing something else.
  const fwd   = keys['KeyW'] || keys['ArrowUp'];
  const back  = keys['KeyS'] || keys['ArrowDown'];
  const left  = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const run   = keys['ShiftLeft'] || keys['ShiftRight'];
  const moving = fwd || back || left || right;

  // One-shot timer — dt-accumulator, no setTimeout. Death always plays out
  // fully; hit/reload are cancelled the instant the player moves or jumps.
  if (_oneshotTimer > 0) {
    if (_current !== _anims.DEATH && (moving || isJumping)) {
      _oneshotTimer = 0;
      _oneshotFade  = '';
      // fall through — _play() below fades the interrupted one-shot out
    } else {
      _oneshotTimer -= dt;
      if (_oneshotTimer <= 0 && _oneshotFade) { _play(_oneshotFade, true); _oneshotFade = ''; }
      return; // don't interrupt one-shot
    }
  }

  if (isJumping) { _play(_anims.JUMP, false); return; }

  _setMirror(right && !fwd && !back); // mirror strafe-left clip for right strafe

  // Standing fire: peers already read as 'firing in place' because their shoot
  // one-shot (Run_Forward_Firing, in-place since the root-motion strip)
  // overrides idle. Play the SAME clip here so your own mirror reflection shows
  // you firing when stationary, instead of plain IDLE. Precedes the !moving
  // early-return so it wins over idle but stays below the moving branch.
  if (isShooting && !moving)            { _play(_anims.RUN_SHOOT, true); return; }
  if (!moving)                          { _play(_anims.IDLE, true);      return; }
  // RUN_SHOOT only for forward/run movement — mirrors the MP anim-hint
  // priority so remote peers see the same clip the local player sees.
  // Backpedal/strafe keep their own clips (shooting reads via recoil there).
  if (isShooting && (fwd || run))       { _play(_anims.RUN_SHOOT, true); return; }
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
