// firstPersonBody.js — headless first-person body visible in the FP camera
// (v0.2.108). Replaces the old clip-plane clone in playerModel.js. A dedicated
// GLB with the head removed at authoring time renders on layer 2 (seen by the
// main camera, hidden from the mirror reflection camera), parented to the
// player so it tracks the eye. Its own mixer plays a small idle/walk/run set.
// Each supported character has its own authored headless GLB (see FP_BODIES);
// custom/Create-with-AI meshes have none yet, so the FP body is hidden for them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { keys } from './input.js';
import { camera } from './scene.js';
import { getMirror } from './mirror.js';
import { assetUrl } from './assetUrl.js';
import { getCharacter, getCustomHeadlessUrl } from './playerModel.js';

let _root  = null;
let _mixer = null;
let _actions = {};
let _current = null;
let _cfg = null; // FP_BODIES entry for the loaded character

// Per-character headless first-person body: asset path + the idle/walk/run clip
// names inside that GLB. chiefmonkey keeps its own reduced set (Idle_11 /
// Walking / Running); guest and nostrich play the master-library clips (Idle_02
// / Stylish_Walk_inplace / Running) baked into their headless variants, which
// tools/headless-glb.mjs authors from the full master GLBs (head removed, three
// clips kept). Custom/Create-with-AI meshes are absent here → FP body hidden.
const FP_BODIES = {
  chiefmonkey: { file: '/chiefmonkey-headless.glb', idle: 'Idle_11', walk: 'Walking',           run: 'Running' },
  guest:       { file: '/guest-headless.glb',       idle: 'Idle_02', walk: 'Stylish_Walk_inplace', run: 'Running' },
  nostrich:    { file: '/nostrich-headless.glb',    idle: 'Idle_02', walk: 'Stylish_Walk_inplace', run: 'Running' },
};

const EYE = 1.7;
const FADE = 0.15;

// v0.2.772-alpha (Bug E): per-character POV eye height. Some characters are
// authored shorter than the canonical 1.7 m eye (poo poo head is teenage-sized;
// he was intentionally shoulder-height to full-grown chars to give guests the
// experience of looking UP at players). We compute the character's own eye Y
// from the loaded headless GLB (mesh bounds — maxY is the head cap of the
// headless body ~= where the eye would be, which is fine since the head is
// removed at authoring time) and expose the DELTA against the canonical EYE.
// Physics `EYE` (engine/entities/player.js) is UNCHANGED so bots keep aiming at
// the true eye, spawn / body / respawn geometry keep their invariants, and
// peers still see the character at the height its GLB was authored at. Only
// the local camera Y is nudged down by the delta, and only for characters
// SHORTER than default (never taller — clamped at 0 so tall custom meshes don't
// float the POV above the head).
let _characterEyeOffset = 0;
// Minimum POV height above the foot — a safety floor so a malformed / tiny
// custom mesh can't drop the POV below the knees.
const MIN_CHARACTER_EYE = 1.10;
// Small drop below the head cap so the POV sits between the eyes rather than
// on top of the crown.
const EYE_FROM_HEAD_CAP = 0.10;
export function getCharacterEyeOffset() { return _characterEyeOffset; }

// Horizontal plane (normal points DOWN) that clips everything above it. We keep
// it just below the eye each frame so the neck stump never enters the FP view —
// looking down now reveals chest → feet instead of the inside of the headless
// body.
//
// v0.2.112 tracked CAMERA world Y so the slice followed the look-down eye drop,
// but that had the side effect of RAISING the slice when the camera pitched DOWN
// (the camera dips a few cm on look-down via lookDownEyeY): with the slice up at
// eye-minus-drop, the feet were then above the plane and got clipped away —
// hence "no feet visible" in v0.2.771 (Bug D). v0.2.772-alpha (Bug D) pins the
// slice to the PARENT rig world Y (playerObj) so it stays anchored at true
// chest height regardless of camera pitch; feet are always below the slice and
// always visible. The stump-when-looking-up case is still handled because the
// stump lives ABOVE that same fixed chest line only when the camera itself is
// physically above the neck, which the parent-anchored slice already excludes.
const NECK_CLIP_DROP = 0.32; // metres below the eye where the body is sliced
const _clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), EYE - NECK_CLIP_DROP);
const _wp = new THREE.Vector3();
// v0.2.772-alpha (Bug D): scratch vec3 reused each frame for the parent-Y read.
// The Neck clip constant is `parent.y + (EYE − NECK_CLIP_DROP)` so the slice
// follows the rig on ground/jump/crouch but does NOT follow the camera pitch.
const _pp = new THREE.Vector3();

export function loadFirstPersonBody(parentObj) {
  if (_root) { parentObj.remove(_root); _root = null; _mixer = null; _actions = {}; _current = null; _cfg = null; }
  // v0.2.772-alpha (Bug E): reset the per-character POV offset on hot-swap so
  // switching from a shorter character (poo poo head) back to a full-height one
  // returns to the canonical eye immediately, even before the new GLB streams in.
  _characterEyeOffset = 0;

  // v0.2.767-alpha — for custom / Create-with-AI meshes the server authors a
  // headless variant at publish-time and the client stores that URL via
  // setCustomHeadlessUrl. Prefer it whenever present. Custom meshes always ship
  // with the master clip set (Idle_02 / Stylish_Walk_inplace / Running) baked in
  // by tools/headless-glb.mjs, so we hard-code those clip names here.
  // If the headless variant is absent (legacy manifest, or server authoring
  // failed at publish) we fall back to the built-in FP_BODIES entry, and if that
  // is also absent we hide the FP body — the pre-v0.2.767 behaviour.
  const customUrl = getCustomHeadlessUrl();
  const cfg = customUrl
    ? { file: customUrl, idle: 'Idle_02', walk: 'Stylish_Walk_inplace', run: 'Running', external: true }
    : FP_BODIES[getCharacter()];
  if (!cfg) return;
  _cfg = cfg;

  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('/draco/'));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  // v0.2.767-alpha: `cfg.external === true` means cfg.file is a full URL (a
  // Blossom URL) rather than a repo-relative asset path, so we bypass assetUrl.
  const meshUrl = cfg.external ? cfg.file : assetUrl(cfg.file);
  loader.load(meshUrl, gltf => {
    _root = gltf.scene;

    let minY = Infinity;
    let maxY = -Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) {
          minY = Math.min(minY, b.min.y);
          maxY = Math.max(maxY, b.max.y);
        }
      }
    });
    if (!Number.isFinite(minY)) minY = 0;
    if (!Number.isFinite(maxY)) maxY = EYE;

    // v0.2.772-alpha (Bug E): compute per-character POV eye height. characterEye
    // = character's total mesh height minus a small drop from head cap to eye.
    // Clamped to MIN so we never drop the POV to the knees on a broken mesh,
    // and to ≤ EYE so we never RAISE the POV above the canonical player eye
    // (that would mean bots aim at your chest while you look over their head).
    const meshHeight = Math.max(0, maxY - minY);
    const characterEye = Math.max(MIN_CHARACTER_EYE, Math.min(EYE, meshHeight - EYE_FROM_HEAD_CAP));
    _characterEyeOffset = characterEye - EYE; // <= 0, applied to camera local Y

    _root.scale.setScalar(1.0);
    // Feet at the player's foot: parent eye sits at EYE above foot, so shift the
    // body down by (minY + EYE). Push further forward (+Z local) so the chest
    // sits ahead in the lower view as if the neck is rolled forward; the neck
    // clip plane (below) removes the stump so we read the chest, not its inside.
    // Model faces local -Z; rotate PI to face fwd.
    _root.position.set(0, -minY - EYE, 0.42);
    _root.rotation.y = Math.PI;

    _root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = false;
        o.receiveShadow = false;
        o.frustumCulled = false;
        o.layers.set(2); // main camera sees layer 2; mirror reflection disables it
        // M4-V4a: defensive normals cleanup — recompute ONLY when the geometry
        // has no normal attribute at all. Guarded so authored normals are left
        // untouched (no shading change on well-formed meshes). Once at load.
        if (o.geometry && !o.geometry.getAttribute('normal')) {
          o.geometry.computeVertexNormals();
        }
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = false;
            m.depthWrite  = true;
            m.alphaTest   = 0;
            // Force smooth shading — flatShading reads as jagged on the low-poly
            // neck/collar geometry of the headless body.
            if (m.flatShading) m.flatShading = false;
            m.clippingPlanes = [_clipPlane]; // slice the neck stump below the eye
            m.needsUpdate = true;
          }
        }
      }
    });

    parentObj.add(_root);
    window._fpBody = _root; // smoke-test + live-tuning handle

    _mixer = new THREE.AnimationMixer(_root);
    gltf.animations.forEach(c => {
      const a = _mixer.clipAction(c);
      a.setLoop(THREE.LoopRepeat, Infinity);
      _actions[c.name] = a;
    });
    _play(_cfg.idle);
  }, undefined, err => {
    console.warn('[firstPersonBody] load failed:', err);
  });
}

function _play(name) {
  if (!name || !_actions[name] || _current === name) return;
  const next = _actions[name];
  next.reset().fadeIn(FADE).play();
  if (_current && _actions[_current]) _actions[_current].fadeOut(FADE);
  _current = name;
}

// ── FP body visibility ────────────────────────────────────────────────────────
// Two independent reasons to hide the FP body: (1) the debug free-fly camera
// is active (it renders layer 2, so the body would be seen floating), and (2)
// v0.2.768-alpha (Bug B) the camera is close to the NAP mirror — standing at
// the mirror and looking in should show the reflection, not the near-field FP
// chest overlapping the mirror frame. `_applyVisibility()` folds both flags
// into `_root.visible` so they compose instead of fighting over the same bit.
let _flyHidden = false;
let _mirrorHidden = false;
function _applyVisibility() {
  if (_root) _root.visible = !_flyHidden && !_mirrorHidden;
}

export function setFlyHidden(hidden) {
  _flyHidden = !!hidden;
  _applyVisibility();
}

// Distance within which the FP body is hidden so it can't bleed into the mirror
// surface when the player is standing right in front of it.
const MIRROR_HIDE_DIST = 3.0; // metres
const _mirrorPos = new THREE.Vector3();
function _updateMirrorProximity() {
  if (!_root) return;
  const m = getMirror();
  if (!m) { _mirrorHidden = false; _applyVisibility(); return; }
  m.getWorldPosition(_mirrorPos);
  camera.getWorldPosition(_wp);
  const near = _wp.distanceTo(_mirrorPos) < MIRROR_HIDE_DIST;
  if (near !== _mirrorHidden) { _mirrorHidden = near; _applyVisibility(); }
}

export function tickFirstPersonBody(dt) {
  if (!_mixer) return;
  _mixer.update(dt);

  // v0.2.772-alpha (Bug D): pin the neck clip to the PARENT rig world Y (the
  // player's true eye anchor at ground level) plus the fixed chest offset. The
  // slice therefore tracks jumps/crouches/terrain but is independent of the
  // look-down camera pitch — feet stay below the plane at every pitch angle.
  // We fall back to CAMERA world Y only when the body is not yet parented (a
  // one-frame transient during hot-swap load), so the constant is never NaN.
  if (_root && _root.parent) {
    _root.parent.getWorldPosition(_pp);
    _clipPlane.constant = _pp.y + (EYE - NECK_CLIP_DROP);
  } else {
    camera.getWorldPosition(_wp);
    _clipPlane.constant = _wp.y - NECK_CLIP_DROP;
  }
  _updateMirrorProximity();

  const fwd   = keys['KeyW'] || keys['ArrowUp'];
  const back  = keys['KeyS'] || keys['ArrowDown'];
  const left  = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const run   = keys['ShiftLeft'] || keys['ShiftRight'];
  const moving = fwd || back || left || right;

  if (!moving)            _play(_cfg.idle);
  else if (run && moving) _play(_cfg.run);
  else                    _play(_cfg.walk);
}
