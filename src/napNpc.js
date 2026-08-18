// napNpc.js — peaceful Chiefmonkey NPC in the NAP zone (v0.2.519).
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
import { createNpcCollider, setNpcColliderPos, NPC_CAPSULE_CENTRE_Y,
         createNpcBoneColliders, syncNpcBoneColliders } from './physics.js';

let _root   = null;
let _mixer  = null;
let _minY   = 0;             // geometry feet offset
let _npcColliderBody = null;  // Rapier kinematic body for sticker raycasting
let _boneColliders = [];      // Per-bone sensor colliders (v0.2.574)
let _skinnedMesh = null;      // NPC SkinnedMesh reference for bone collider setup
let _gestureClips = [];     // clips from chiefmonkey-npc-animations.glb
let _walkClip = null;       // walk clip from the model GLB
let _idleClip = null;       // idle clip from the model GLB

const NPC_START_X = -4;
const NPC_START_Z = 22;

const WALK_SPEED = 1.2;
const PICK_TOLERANCE = 1.0;
const GESTURE_MIN_DELAY = 5;
const GESTURE_MAX_DELAY = 10;
const NAP_MARGIN = 2.0;

let _state = 'idle';        // 'walk' | 'gesture' | 'idle'
let _target = null;
let _nextGestureAt = 0;
let _clock = 0;

function _pickWalkTarget() {
  for (let i = 0; i < 30; i++) {
    const x = NAP_BBOX.minX + NAP_MARGIN + Math.random() * (NAP_BBOX.maxX - NAP_BBOX.minX - 2 * NAP_MARGIN);
    const z = NAP_BBOX.minZ + NAP_MARGIN + Math.random() * (NAP_BBOX.maxZ - NAP_BBOX.minZ - 2 * NAP_MARGIN);
    if (isNapLand(x, z)) return { x, z };
  }
  return { x: 0.83, z: 18.05 };
}

function _playWalk() {
  if (!_mixer) return;
  const clip = _walkClip || _idleClip;
  if (!clip) return;
  // Fade out any current action, fade in walk
  if (_currentAction) _currentAction.fadeOut(0.2);
  _currentAction = _mixer.clipAction(clip);
  _currentAction.setLoop(THREE.LoopRepeat, Infinity);
  _currentAction.reset();
  _currentAction.setEffectiveTimeScale(1);
  _currentAction.setEffectiveWeight(1);
  _currentAction.fadeIn(0.2);
  _currentAction.play();
  _state = 'walk';
}

function _playGesture() {
  if (!_mixer || _gestureClips.length === 0) return;
  const clip = _gestureClips[Math.floor(Math.random() * _gestureClips.length)];
  if (_currentAction) _currentAction.fadeOut(0.15);
  _currentAction = _mixer.clipAction(clip);
  _currentAction.setLoop(THREE.LoopOnce, 1);
  _currentAction.clampWhenFinished = true;
  _currentAction.reset();
  _currentAction.setEffectiveTimeScale(1);
  _currentAction.setEffectiveWeight(1);
  _currentAction.play();
  _state = 'gesture';
}

// v0.2.548: External trigger — called when the player fires an FTFF sticker
// at the NPC. Interrupts any current action to play a random gesture.
export function triggerNpcGesture() {
  if (!_mixer || _gestureClips.length === 0) return;
  _playGesture();
  // Reset the gesture timer so the NPC doesn't immediately gesture again
  _nextGestureAt = _clock + GESTURE_MIN_DELAY + Math.random() * (GESTURE_MAX_DELAY - GESTURE_MIN_DELAY);
}

function _onGestureFinished() {
  _target = _pickWalkTarget();
  _playWalk();
}

let _currentAction = null;

// v0.2.548: Expose NPC root for the sticker interaction system.
export function getNpcRoot() { return _root; }

export function buildNapNpc() {
  if (_root) return;

  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('/draco/'));
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);

  loader.load(assetUrl('/chiefmonkey6.glb'), gltf => {
    _root = gltf.scene;

    // Compute minY for feet placement
    _minY = Infinity;
    _root.traverse(o => {
      if (o.isMesh && o.geometry) {
        o.geometry.computeBoundingBox();
        const b = o.geometry.boundingBox;
        if (b) _minY = Math.min(_minY, b.min.y);
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
    if (!Number.isFinite(_minY)) _minY = 0;

    _root.scale.setScalar(1.0);
    _root.position.set(NPC_START_X, -_minY + sampleNapHeight(NPC_START_X, NPC_START_Z), NPC_START_Z);
    _root.rotation.y = 0;
    scene.add(_root);

    // Create Rapier sensor collider for sticker raycasting
    _npcColliderBody = createNpcCollider(_root,
      _root.position.x, _root.position.y + NPC_CAPSULE_CENTRE_Y, _root.position.z);

    // Find the SkinnedMesh and create per-bone colliders (v0.2.574)
    _root.traverse(o => {
      if (o.isSkinnedMesh && !_skinnedMesh) _skinnedMesh = o;
    });
    if (_skinnedMesh) {
      _root.updateMatrixWorld(true);
      _boneColliders = createNpcBoneColliders(_root, _skinnedMesh);
      console.log('[napNpc] bone names:', _skinnedMesh.skeleton.bones.map(b => b.name));
    } else {
      console.warn('[napNpc] no SkinnedMesh found — per-bone colliders skipped');
    }

    _mixer = new THREE.AnimationMixer(_root);

    // Extract clips from model
    const byName = {};
    gltf.animations.forEach(c => { byName[c.name] = c; });
    _walkClip = byName['Stylish_Walk_inplace'] || byName['Walk'] || byName['walk'] || null;
    _idleClip = byName['Idle_03'] || byName['Idle_11'] || byName['Idle'] || gltf.animations[0] || null;
    console.log('[napNpc] model clips:', gltf.animations.map(c => c.name), '| walk:', _walkClip?.name, '| idle:', _idleClip?.name);

    // Load gesture animations from separate GLB (use a FRESH loader to avoid Draco conflicts)
    const draco2 = new DRACOLoader();
    draco2.setDecoderPath(assetUrl('/draco/'));
    const loader2 = new GLTFLoader();
    loader2.setDRACOLoader(draco2);
    loader2.load(assetUrl('/chiefmonkey-npc-animations.glb'), animGltf => {
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
    console.log('[napNpc] started, state:', _state, 'target:', _target);
  }, undefined, err => {
    console.warn('[napNpc] model load failed:', err);
  });
}

export function tickNapNpc(dt) {
  if (!_mixer || !_root) return;
  _clock += dt;
  _mixer.update(dt);

  if (_state === 'walk' && _target) {
    const pos = _root.position;
    const dx = _target.x - pos.x;
    const dz = _target.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < PICK_TOLERANCE) {
      // Arrived — gesture or new target
      if (_clock >= _nextGestureAt && _gestureClips.length > 0) {
        _playGesture();
        _nextGestureAt = _clock + GESTURE_MIN_DELAY + Math.random() * (GESTURE_MAX_DELAY - GESTURE_MIN_DELAY);
      } else {
        _target = _pickWalkTarget();
      }
    } else {
      // Walk toward target
      const step = WALK_SPEED * dt;
      pos.x += (dx / dist) * step;
      pos.z += (dz / dist) * step;

      // Face walking direction
      const targetYaw = Math.atan2(dx, dz);
      let dyaw = targetYaw - _root.rotation.y;
      while (dyaw > Math.PI) dyaw -= 2 * Math.PI;
      while (dyaw < -Math.PI) dyaw += 2 * Math.PI;
      _root.rotation.y += dyaw * Math.min(1, dt * 5);

      // Follow terrain height — use stored _minY for feet placement
      pos.y = -_minY + sampleNapHeight(pos.x, pos.z);
    }

    // Trigger gesture mid-walk
    if (_state === 'walk' && _clock >= _nextGestureAt && _gestureClips.length > 0) {
      _playGesture();
      _nextGestureAt = _clock + GESTURE_MIN_DELAY + Math.random() * (GESTURE_MAX_DELAY - GESTURE_MIN_DELAY);
    }
  }

  // Sync Rapier colliders AFTER all position/rotation/animation updates so
  // bone.matrixWorld reflects the current frame's final pose (v0.2.574).
  if (_npcColliderBody) {
    setNpcColliderPos(_npcColliderBody.body,
      _root.position.x, _root.position.y + NPC_CAPSULE_CENTRE_Y, _root.position.z);
  }
  if (_boneColliders.length > 0) {
    _root.updateMatrixWorld(true);
    syncNpcBoneColliders(_boneColliders);
  }
}
