// botModel.js — Banker bot GLB loader + AnimationMixer pool.
// Each bot gets its own cloned scene + mixer. Shared geometry via clone().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';
import { BOSS_TARGET_HEIGHT, BOSS_NAME } from './config.js';

// ── Clip name map — regular (banker) bot ─────────────────────────────────────
const ANIM = {
  WALK:    'Walking',
  RUN:     'Running',
  SHOOT:   'Run_and_Shoot',
  HIT:     'Hit_Reaction_to_Waist',
  HIT_ALT: 'Hit_Reaction_1',
  DEATH:   'Shot_and_Blown_Back',
  STRAFE:  'Walk_Left_with_Gun_inplace',
};

// ── Clip name map — Augustink BOSS (augustink4.glb clips: Dead / Knock_Down /
// Running / Walking). No dedicated shoot/strafe clips → reuse Running for the
// shoot pose and Knock_Down for the hit/down reaction (v0.2.381).
const BOSS_ANIM = {
  WALK:    'Walking',
  RUN:     'Running',
  SHOOT:   'Running',
  HIT:     'Knock_Down',
  HIT_ALT: 'Knock_Down',
  DEATH:   'Dead',
  STRAFE:  'Walking',
};

// ── Template registry — one lazy GLB per bot KIND, cloned per instance ────────
// The boss GLB (augustink4.glb, 7.6MB) is LAZY-LOADED cache-on-use via the SW's
// cacheFirst handler — it is deliberately NOT in PRECACHE_ASSETS (v0.6.124 rule).
const TEMPLATES = {
  regular: { url: '/banker-rigged.glb', target: null,               anim: ANIM,
             scene: null, clips: [], promise: null },
  boss:    { url: '/augustink4.glb',    target: BOSS_TARGET_HEIGHT,  anim: BOSS_ANIM,
             scene: null, clips: [], promise: null },
};

function _loadTemplate(kind = 'regular') {
  const tpl = TEMPLATES[kind] || TEMPLATES.regular;
  if (tpl.promise) return tpl.promise;
  tpl.promise = new Promise((resolve, reject) => {
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('/draco/'));
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load(assetUrl(tpl.url), gltf => {
      tpl.scene = gltf.scene;
      tpl.clips = gltf.animations;
      // GLB exported with alphaMode=BLEND — makes mesh translucent and causes
      // z-sort splits. Force fully opaque on all materials.
      tpl.scene.traverse(o => {
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
  return tpl.promise;
}

// ── Scale helper ──────────────────────────────────────────────────────────────
const _BOX  = new THREE.Box3();
const _SIZE = new THREE.Vector3();
const TARGET_HEIGHT = 1.85;

const FADE = 0.12;

// ── BotModel class — one instance per bot ────────────────────────────────────
export class BotModel {
  constructor(kind = 'regular') {
    this.kind    = TEMPLATES[kind] ? kind : 'regular';
    this.isBoss  = this.kind === 'boss';
    this._anim   = TEMPLATES[this.kind].anim;
    this.root    = null;
    this.mixer   = null;
    this._clips  = {};
    this._actions = {};
    this._current = null;
    this.loaded  = false;
    this._oneshotTimer = 0;
    this._oneshotFade  = '';
    this._footY  = 0; // vertical offset to keep feet at y=0
    this._nameplate = null;
  }

  // Call once after _loadTemplate(kind) resolves
  init(position) {
    const tpl = TEMPLATES[this.kind];
    // SkeletonUtils.clone — correct bone binding per instance, no shared matrices
    this.root = skeletonClone(tpl.scene);

    if (tpl.target) {
      // Boss: augustink4 root scale is 0.01 (Blender cm export). Measure the real
      // world-space height (setFromObject walks the full transform hierarchy so
      // the baked 0.01 is included), then scale uniformly to the boss target
      // height and lift so the feet sit at y=0.
      this.root.updateWorldMatrix(true, true);
      _BOX.setFromObject(this.root);
      _BOX.getSize(_SIZE);
      const naturalH = _SIZE.y || 1;
      const s = tpl.target / naturalH;
      this.root.scale.multiplyScalar(s);
      this.root.updateWorldMatrix(true, true);
      _BOX.setFromObject(this.root);
      this._footY = -_BOX.min.y;
    } else {
      // Banker GLB is metre-scale (min Y≈0, max Y≈1.70) — no scaling needed.
      this.root.scale.setScalar(1.0);
      this._footY = 0;
    }
    this.root.position.set(position.x, this._footY + position.y, position.z);

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

    // Boss gets a floating "Augustink" nameplate sprite tracked in world space.
    if (this.isBoss) this._nameplate = _makeNameplate(BOSS_NAME);
    if (this._nameplate) scene.add(this._nameplate);

    // Mixer + actions from shared clips
    this.mixer = new THREE.AnimationMixer(this.root);
    tpl.clips.forEach(clip => {
      const action = this.mixer.clipAction(clip, this.root);
      action.clampWhenFinished = true;
      this._clips[clip.name]   = clip;
      this._actions[clip.name] = action;
    });

    this.play(this._anim.WALK, true);
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
    const name = this._anim.DEATH;
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
    if (this._nameplate) {
      // Float the label a little above the boss's head.
      const top = this._footY + y + (TEMPLATES[this.kind].target || TARGET_HEIGHT) + 0.7;
      this._nameplate.position.set(x, top, z);
    }
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
    const A = this._anim;
    if (isDead)    { if (this._current !== A.DEATH) this.playDeath(); return; }
    if (isHit)     { this.playOnce(Math.random() > 0.5 ? A.HIT : A.HIT_ALT, A.WALK); return; }
    if (isShooting){ this.play(A.SHOOT, true); return; }
    if (dist < 8)  { this.play(A.RUN, true); return; }
    this.play(A.WALK, true);
  }

  show() {
    if (this.root) this.root.visible = true;
    if (this._nameplate) this._nameplate.visible = true;
  }
  hide() {
    if (this.root) this.root.visible = false;
    if (this._nameplate) this._nameplate.visible = false;
  }

  dispose() {
    if (this.root) { scene.remove(this.root); this.root = null; }
    if (this._nameplate) {
      scene.remove(this._nameplate);
      this._nameplate.material?.map?.dispose?.();
      this._nameplate.material?.dispose?.();
      this._nameplate = null;
    }
    this.mixer = null; this.loaded = false;
  }
}

// ── Nameplate sprite — a small canvas-textured label floated over the boss. ───
// Guarded so a headless/canvas-less environment (tests) degrades gracefully.
function _makeNameplate(text) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = 256; canvas.height = 64;
    ctx.font = 'bold 40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 6;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, 128, 32);
    ctx.fillStyle = '#ffcf33';
    ctx.fillText(text, 128, 32);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.renderOrder = 999;
    return sprite;
  } catch {
    return null;
  }
}

// ── Pre-load templates ────────────────────────────────────────────────────────
export function preloadBotModel()  { return _loadTemplate('regular'); }
// Boss GLB is big (lazy) — call this only when a boss is about to render, NOT at
// startup, so we never block or precache the 7.6MB asset.
export function preloadBossModel() { return _loadTemplate('boss'); }
export { ANIM as BOT_ANIM, BOSS_ANIM };
