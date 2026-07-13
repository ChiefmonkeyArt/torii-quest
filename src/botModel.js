// botModel.js — Banker bot GLB loader + AnimationMixer pool.
// Each bot gets its own cloned scene + mixer. Shared geometry via clone().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';

// ── Clip name map ─────────────────────────────────────────────────────────────
const ANIM = {
  WALK:    'Walking',
  RUN:     'Running',
  SHOOT:   'Run_and_Shoot',
  HIT:     'Hit_Reaction_to_Waist',
  HIT_ALT: 'Hit_Reaction_1',
  DEATH:   'Shot_and_Blown_Back',
  STRAFE:  'Walk_Left_with_Gun_inplace',
};

// ── Shared GLB cache — loaded once, cloned per bot ───────────────────────────
let _templateScene = null;
let _templateClips = [];
let _loadPromise   = null;

function _loadTemplate() {
  if (_loadPromise) return _loadPromise;
  _loadPromise = new Promise((resolve, reject) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('/draco/'));
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(assetUrl('/banker-rigged.glb'), gltf => {
      _templateScene = gltf.scene;
      _templateClips = gltf.animations;
      // GLB exported with alphaMode=BLEND — makes mesh translucent and causes
      // z-sort splits. Force fully opaque on all materials.
      _templateScene.traverse(o => {
        if (!o.isMesh) return;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m => {
          m.transparent = false;
          m.alphaTest   = 0;
          m.depthWrite  = true;
          m.side        = THREE.FrontSide;
          m.needsUpdate = true;
        });
      });
      resolve();
    }, undefined, reject);
  });
  return _loadPromise;
}

// ── Scale helper ──────────────────────────────────────────────────────────────
const _BOX  = new THREE.Box3();
const _SIZE = new THREE.Vector3();
const TARGET_HEIGHT = 1.85;

const FADE = 0.12;

// ── BotModel class — one instance per bot ────────────────────────────────────
export class BotModel {
  constructor() {
    this.root    = null;
    this.mixer   = null;
    this._clips  = {};
    this._actions = {};
    this._current = null;
    this.loaded  = false;
    this._oneshotTimer = 0;
    this._oneshotFade  = '';
    this._footY  = 0; // vertical offset to keep feet at y=0
  }

  // Call once after _loadTemplate() resolves
  init(position) {
    // SkeletonUtils.clone — correct bone binding per instance, no shared matrices
    this.root = skeletonClone(_templateScene);

    // Banker GLB is metre-scale (min Y≈0, max Y≈1.70) — no scaling needed.
    // geometry.boundingBox in bind-pose inflates maxY due to hat verts, so
    // we do NOT use it for scale. footY=0 since feet are already at origin.
    this.root.scale.setScalar(1.0);
    this._footY = 0;
    this.root.position.set(position.x, position.y, position.z);

    // Shadows + disable frustum culling on SkinnedMesh.
    // Bind-pose bounding box doesn't match animated pose — culling splits the mesh.
    this.root.traverse(o => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false; // critical for SkinnedMesh
      }
    });

    scene.add(this.root);

    // Mixer + actions from shared clips
    this.mixer = new THREE.AnimationMixer(this.root);
    _templateClips.forEach(clip => {
      const action = this.mixer.clipAction(clip, this.root);
      action.clampWhenFinished = true;
      this._clips[clip.name]   = clip;
      this._actions[clip.name] = action;
    });

    this.play(ANIM.WALK, true);
    // Force mixer to tick once so skeleton leaves bind-pose immediately.
    // Prevents hat/accessory verts snapping on first visible frame.
    this.mixer.update(0.016);
    this.loaded = true;
  }

  play(name, loop = true) {
    if (!name || !this._actions[name]) return;
    if (this._current === name) return;
    const next = this._actions[name];
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    next.reset().fadeIn(FADE).play();
    if (this._current && this._actions[this._current]) {
      this._actions[this._current].fadeOut(FADE);
    }
    this._current = name;
  }

  playOnce(name, fadeTo = ANIM.WALK) {
    if (!name || !this._actions[name]) return;
    const action = this._actions[name];
    action.setLoop(THREE.LoopOnce, 1);
    action.reset().fadeIn(FADE).play();
    if (this._current && this._actions[this._current] && this._current !== name) {
      this._actions[this._current].fadeOut(FADE);
    }
    this._current = name;
    this._oneshotTimer = Math.max((this._clips[name]?.duration ?? 1) - FADE, 0.1);
    this._oneshotFade  = fadeTo;
  }

  // Hard cut — stops ALL actions instantly, plays name with no blend.
  // Use for death so the body hits the ground immediately.
  playDeath() {
    const name = ANIM.DEATH;
    if (!this._actions[name]) return;
    // Stop every action with zero fade
    Object.values(this._actions).forEach(a => { a.stop(); });
    const action = this._actions[name];
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.reset().play();
    this._current = name;
    this._oneshotTimer = 0; // don't auto-transition back
    this._oneshotFade  = '';
  }

  // Update visual position/rotation to match physics body
  syncTo(x, y, z, rotY) {
    if (!this.root) return;
    this.root.position.set(x, this._footY + y, z);
    this.root.rotation.y = rotY;
  }

  tick(dt) {
    if (!this.mixer) return;
    this.mixer.update(dt);
    // One-shot timer — dt-accumulator
    if (this._oneshotTimer > 0) {
      this._oneshotTimer -= dt;
      if (this._oneshotTimer <= 0 && this._oneshotFade) {
        this.play(this._oneshotFade, true);
        this._oneshotFade = '';
      }
    }
  }

  // Drive animation from bot state
  updateAnim(dist, isShooting, isDead, isHit) {
    if (!this.loaded) return;
    if (isDead)    { if (this._current !== ANIM.DEATH) this.playDeath(); return; }
    if (isHit)     { this.playOnce(Math.random() > 0.5 ? ANIM.HIT : ANIM.HIT_ALT); return; }
    if (isShooting){ this.play(ANIM.SHOOT, true); return; }
    if (dist < 8)  { this.play(ANIM.RUN, true); return; }
    this.play(ANIM.WALK, true);
  }

  show() { if (this.root) this.root.visible = true; }
  hide() { if (this.root) this.root.visible = false; }

  dispose() {
    if (this.root) { scene.remove(this.root); this.root = null; }
    this.mixer = null; this.loaded = false;
  }
}

// ── Pre-load template — call once at startup ──────────────────────────────────
export function preloadBotModel() { return _loadTemplate(); }
export { ANIM as BOT_ANIM };
