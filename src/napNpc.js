// napNpc.js — peaceful Chiefmonkey NPC in the NAP zone (v0.2.518).
// Wanders freely across the NAP island, performs random gesture animations
// from chiefmonkey-npc-animations.glb every 5-10 seconds.
// NPC-ONLY: does NOT touch playable character or MP peer animation systems.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';
import { sampleNapHeight } from './terrain/heightmap.js';
import { isNapLand, NAP_BBOX } from './terrain/tomoeShape.js';
import { assetUrl } from './assetUrl.js';

let _root  = null;
let _mixer = null;
let _gestureClips = [];  // clips loaded from chiefmonkey-npc-animations.glb
let _walkClip = null;     // walk clip from the model GLB

// NPC starts near the NAP centroid
const NPC_START_X = -4;
const NPC_START_Z = 22;

// Wandering state
const WALK_SPEED = 1.2;       // m/s — gentle stroll
const PICK_TOLERANCE = 1.0;   // accept target when within this distance
const GESTURE_MIN_DELAY = 5;  // seconds between gestures
const GESTURE_MAX_DELAY = 10;
const NAP_MARGIN = 2.0;       // stay this far inside the polygon edge

let _state = 'idle';          // 'walk' | 'gesture' | 'idle'
let _target = null;           // { x, z } walk target
let _nextGestureAt = 0;       // timestamp to next trigger a gesture
let _currentAction = null;    // active mixer action
let _clock = 0;               // accumulated dt

function _pickWalkTarget() {
  // Pick a random point inside the NAP polygon, margin inset
  for (let i = 0; i < 30; i++) {
    const x = NAP_BBOX.minX + NAP_MARGIN + Math.random() * (NAP_BBOX.maxX - NAP_BBOX.minX - 2 * NAP_MARGIN);
    const z = NAP_BBOX.minZ + NAP_MARGIN + Math.random() * (NAP_BBOX.maxZ - NAP_BBOX.minZ - 2 * NAP_MARGIN);
    if (isNapLand(x, z)) return { x, z };
  }
  // Fallback: NAP centroid
  return { x: 0.83, z: 18.05 };
}

function _playWalk() {
  if (!_mixer || !_walkClip) return;
  _currentAction = _mixer.clipAction(_walkClip);
  _currentAction.setLoop(THREE.LoopRepeat, Infinity);
  _currentAction.reset();
  _currentAction.setEffectiveTimeScale(1);
  _currentAction.setEffectiveWeight(1);
  _currentAction.play();
  _state = 'walk';
}

function _playGesture() {
  if (!_mixer || _gestureClips.length === 0) return;
  const clip = _gestureClips[Math.floor(Math.random() * _gestureClips.length)];
  _currentAction = _mixer.clipAction(clip);
  _currentAction.setLoop(THREE.LoopOnce, 1);
  _currentAction.clampWhenFinished = true;
  _currentAction.reset();
  _currentAction.setEffectiveTimeScale(1);
  _currentAction.setEffectiveWeight(1);
  _currentAction.play();
  _state = 'gesture';
}

function _onGestureFinished() {
  // Resume walking after gesture clip ends
  _target = _pickWalkTarget();
  _playWalk();
}

export function buildNapNpc() {
  if (_root) return;

  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('/draco/'));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  // Load the NPC model
  loader.load(assetUrl('/chiefmonkey6.glb'), gltf => {
    _root = gltf.scene;

    let minY = Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) minY = Math.min(minY, b.min.y);
        o.castShadow = true;
        o.frustumCulled = false;
        if (o.material) {
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
    if (!Number.isFinite(minY)) minY = 0;

    _root.scale.setScalar(1.0);
    _root.position.set(NPC_START_X, -minY + sampleNapHeight(NPC_START_X, NPC_START_Z), NPC_START_Z);
    _root.rotation.y = 0;
    scene.add(_root);

    _mixer = new THREE.AnimationMixer(_root);

    // Extract walk clip from the model
    const byName = {};
    gltf.animations.forEach(c => { byName[c.name] = c; });
    _walkClip = byName['Stylish_Walk_inplace'] || byName['Walk'] || byName['Idle_03'] || gltf.animations[0];

    // Load gesture animations from the separate GLB
    loader.load(assetUrl('/chiefmonkey-npc-animations.glb'), animGltf => {
      _gestureClips = animGltf.animations || [];
      console.log('[napNpc] loaded', _gestureClips.length, 'gesture clips:', _gestureClips.map(c => c.name));
    }, undefined, err => {
      console.warn('[napNpc] gesture GLB load failed:', err);
    });

    // Listen for gesture clip completion
    _mixer.addEventListener('finished', (e) => {
      if (_state === 'gesture') _onGestureFinished();
    });

    // Start walking
    _target = _pickWalkTarget();
    _playWalk();
    _nextGestureAt = GESTURE_MIN_DELAY + Math.random() * (GESTURE_MAX_DELAY - GESTURE_MIN_DELAY);

  }, undefined, err => {
    console.warn('[napNpc] model load failed:', err);
  });
}

export function tickNapNpc(dt) {
  if (!_mixer || !_root) return;
  _clock += dt;
  _mixer.update(dt);

  if (_state === 'walk' && _target) {
    // Move toward target
    const pos = _root.position;
    const dx = _target.x - pos.x;
    const dz = _target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < PICK_TOLERANCE) {
      // Arrived — pick new target or gesture
      if (_clock >= _nextGestureAt && _gestureClips.length > 0) {
        _playGesture();
        _nextGestureAt = _clock + GESTURE_MIN_DELAY + Math.random() * (GESTURE_MAX_DELAY - GESTURE_MIN_DELAY);
      } else {
        _target = _pickWalkTarget();
      }
    } else {
      // Walk toward target
      const step = WALK_SPEED * dt;
      const ux = dx / dist;
      const uz = dz / dist;
      pos.x += ux * step;
      pos.z += uz * step;

      // Face walking direction
      const targetYaw = Math.atan2(ux, uz);
      // Smooth rotation
      let dyaw = targetYaw - _root.rotation.y;
      while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      _root.rotation.y += dyaw * Math.min(1, dt * 5);

      // Follow terrain height
      pos.y = -(_root.userData.minY || 0) + sampleNapHeight(pos.x, pos.z);
    }
  } else if (_state === 'walk' && _clock >= _nextGestureAt && _gestureClips.length > 0) {
    // Trigger gesture mid-walk
    _playGesture();
    _nextGestureAt = _clock + GESTURE_MIN_DELAY + Math.random() * (GESTURE_MAX_DELAY - GESTURE_MIN_DELAY);
  }
}
