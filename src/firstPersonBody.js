// firstPersonBody.js — headless Chiefmonkey body visible in the FP camera
// (v0.2.108). Replaces the old clip-plane clone in playerModel.js. A dedicated
// GLB with the head removed at authoring time renders on layer 2 (seen by the
// main camera, hidden from the mirror reflection camera), parented to the
// player so it tracks the eye. Its own mixer plays a small idle/walk/run set.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { keys } from './input.js';
import { camera } from './scene.js';

let _root  = null;
let _mixer = null;
let _actions = {};
let _current = null;

const EYE = 1.7;
const FADE = 0.15;

// Horizontal plane (normal points DOWN) that clips everything above it. We keep
// it just below the eye each frame so the neck stump never enters the FP view —
// looking down now reveals chest → feet instead of the inside of the headless
// body. v0.2.112: the constant tracks the live CAMERA world Y (not the parent),
// so the slice follows the lowered base eye AND the look-down arc — the user
// could still see a little inside the neck when the slice was pinned to the
// parent eye, which didn't move as the camera tipped/lowered.
const NECK_CLIP_DROP = 0.32; // metres below the eye where the body is sliced
const _clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), EYE - NECK_CLIP_DROP);
const _wp = new THREE.Vector3();

export function loadFirstPersonBody(parentObj) {
  if (_root) { parentObj.remove(_root); _root = null; _mixer = null; _actions = {}; _current = null; }

  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load('/chiefmonkey-headless.glb', gltf => {
    _root = gltf.scene;

    let minY = Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) minY = Math.min(minY, b.min.y);
      }
    });
    if (!Number.isFinite(minY)) minY = 0;

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
        if (o.material) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) {
            m.transparent = false;
            m.depthWrite  = true;
            m.alphaTest   = 0;
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
    _play('Idle_11');
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

// Hide the FP body while the debug free-fly camera is active (it renders on
// layer 2, which the fly camera sees). Stores the prior visibility on enable and
// restores exactly that on disable — so a body already hidden (death/spawn) is
// not force-shown when fly turns off.
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

export function tickFirstPersonBody(dt) {
  if (!_mixer) return;
  _mixer.update(dt);

  // Keep the neck clip just below the live eye height (CAMERA world Y, which
  // includes the look-down arc + lowered base eye) so the slice tracks jumps,
  // crouches and the pitch-coupled eye drop without re-reading per-vertex bounds.
  camera.getWorldPosition(_wp);
  _clipPlane.constant = _wp.y - NECK_CLIP_DROP;

  const fwd   = keys['KeyW'] || keys['ArrowUp'];
  const back  = keys['KeyS'] || keys['ArrowDown'];
  const left  = keys['KeyA'] || keys['ArrowLeft'];
  const right = keys['KeyD'] || keys['ArrowRight'];
  const run   = keys['ShiftLeft'] || keys['ShiftRight'];
  const moving = fwd || back || left || right;

  if (!moving)            _play('Idle_11');
  else if (run && moving) _play('Running');
  else                    _play('Walking');
}
