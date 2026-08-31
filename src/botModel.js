// botModel.js — Banker bot GLB loader + AnimationMixer pool.
// Each bot gets its own cloned scene + mixer. Shared geometry via clone().
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { scene } from './scene.js';
import { assetUrl } from './assetUrl.js';
import { BOSS_TARGET_HEIGHT, BOSS_NAME } from './config.js';
import { renameBonesToMixamo } from './engine/assets/boneRename.js';

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
      renameBonesToMixamo(gltf);
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
const TARGET_HEIGHT = 1.85;

const FADE = 0.12;

// ── BotModel class — one instance per bot ────────────────────────────────────
export class BotModel {
  // `label` (ADR-0013, v0.2.623): optional display name floated over the bot's
  // head as a world-space sprite. If omitted, regulars get no nameplate
  // (backward-compatible with pre-v0.2.623 callers); the boss uses BOSS_NAME.
  constructor(kind = 'regular', label = null) {
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
    this._label = label;
    this.skinnedMesh = null; // SkinnedMesh ref for per-bone colliders
    // ADR-0042: visible bot hit feedback. _materials collected at init for the
    // red emissive flash; _hitFlash is the remaining flash seconds (decays in
    // tick); _npCanvas/_npCtx/_npTex let updateNameplate redraw the HP chip.
    this._materials = null;
    this._hitFlash = 0;
    this._npCanvas = null;
    this._npCtx = null;
    this._npTex = null;
  }

  // Call once after _loadTemplate(kind) resolves
  init(position) {
    const tpl = TEMPLATES[this.kind];
    // SkeletonUtils.clone — correct bone binding per instance, no shared matrices
    this.root = skeletonClone(tpl.scene);
    this.root.userData.isBotMesh = true; // exclude from sticker Three.js raycaster

    if (tpl.target) {
      // Boss (augustink4.glb): a rigged SkinnedMesh whose Armature root carries a
      // 0.01 (Blender cm-export) scale. Box3.setFromObject measures the SkinnedMesh
      // NODE's static geometry box collapsed into that 0.01 frame (~0.017m), but the
      // mesh actually RENDERS at its LOCAL geometry size (~1.66m) because the
      // inverse-bind matrices cancel the armature scale — the same SkinnedMesh
      // "inflation" the peer-avatar path documents (arenaRuntime.js). Feeding
      // setFromObject's tiny height into target/naturalH yielded s≈120 and a boss
      // ~200m tall ("bigger than the arena"), and changing BOSS_TARGET_HEIGHT had no
      // apparent effect since every value was absurdly huge. Measure geometry-only
      // LOCAL bounds (the true rendered height), scale to the boss target, and lift
      // so the feet sit at y=0 in the scaled frame.
      let gMinY = Infinity, gMaxY = -Infinity;
      this.root.traverse(o => {
        if (o.isMesh && o.geometry) {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          if (b) { gMinY = Math.min(gMinY, b.min.y); gMaxY = Math.max(gMaxY, b.max.y); }
        }
      });
      const naturalH = (Number.isFinite(gMinY) && Number.isFinite(gMaxY)) ? (gMaxY - gMinY) : 0;
      const s = tpl.target / (naturalH || 1);
      this.root.scale.multiplyScalar(s);
      this._footY = -(Number.isFinite(gMinY) ? gMinY : 0) * s;
    } else {
      // Banker GLB is metre-scale (min Y≈0, max Y≈1.70) — no scaling needed.
      this.root.scale.setScalar(1.0);
      this._footY = 0;
    }
    this.root.position.set(position.x, this._footY + position.y, position.z);

    // Shadows + disable frustum culling on SkinnedMesh.
    // Bind-pose bounding box doesn't match animated pose — culling splits the mesh.
    // ADR-0042: collect every mesh material with an `emissive` channel here so
    // flashHit() can tint the whole bot red on a confirmed hit in one pass.
    this._materials = [];
    this.root.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false; // critical for SkinnedMesh
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (m && m.emissive && !this._materials.includes(m)) this._materials.push(m);
      }
      if (o.isSkinnedMesh && !this.skinnedMesh) this.skinnedMesh = o;
    });

    scene.add(this.root);

    // Nameplate sprite — boss uses BOSS_NAME; regulars use the label supplied
    // by the caller (ADR-0013). Regulars with no label render no nameplate
    // (backward-compat with pre-v0.2.623 callers that didn't pass one).
    const nameText = this.isBoss ? BOSS_NAME : this._label;
    if (nameText) this._nameplate = _makeNameplate(nameText);
    if (this._nameplate) {
      // Raycast off — the sprite must never intercept shots (ADR-0013).
      this._nameplate.raycast = () => {};
      // ADR-0042: hoist the canvas/ctx/texture refs so updateNameplate can
      // redraw the HP chip each hit without rebuilding the sprite.
      this._npCanvas = this._nameplate._npCanvas || null;
      this._npCtx    = this._nameplate._npCtx    || null;
      this._npTex    = this._nameplate._npTex    || null;
      scene.add(this._nameplate);
    }

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
    // ADR-0042: decay the red hit-flash emissive back to each material's
    // original colour once the flash window elapses. Runs before the mixer guard
    // so a hit flash still decays even if the animation mixer isn't ready yet.
    if (this._hitFlash > 0 && this._materials) {
      this._hitFlash -= dt;
      if (this._hitFlash <= 0) {
        this._hitFlash = 0;
        for (const m of this._materials) {
          m.emissive.setHex(m.userData._origEmissive ?? 0x000000);
          m.emissiveIntensity = m.userData._origEmissiveIntensity ?? 0;
        }
      }
    }
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

  // ADR-0042: tint every collected material's emissive red for ~0.18s on a
  // confirmed hit, so the owner sees the struck bot flash — the missing piece
  // that made server-confirmed hits feel like "shots aren't landing".
  flashHit(intensity = 1.1) {
    if (!this._materials || this._materials.length === 0) return;
    this._hitFlash = 0.18;
    for (const m of this._materials) {
      if (m.userData._origEmissive === undefined) {
        m.userData._origEmissive = m.emissive.getHex();
        m.userData._origEmissiveIntensity = m.emissiveIntensity ?? 0;
      }
      m.emissive.setHex(0xff3030);
      m.emissiveIntensity = intensity;
    }
  }

  // ADR-0042: redraw the nameplate canvas with the bot's name + an HP bar so
  // the owner sees damage accumulating. No-op when the bot has no nameplate
  // (regulars without a label, or a headless/test context with no canvas).
  updateNameplate(text, hpRatio) {
    if (!this._npCtx || !this._npTex || !this._npCanvas) return;
    _drawNameplate(this._npCtx, this._npCanvas, text, hpRatio);
    this._npTex.needsUpdate = true;
  }

  show() {
    if (this.root) this.root.visible = true;
    if (this._nameplate) this._nameplate.visible = true;
  }
  hide() {
    if (this.root) this.root.visible = false;
    if (this._nameplate) this._nameplate.visible = false;
  }

  // ADR-0016: nameplate visibility is enforced by the caller each frame so it
  // tracks body visibility 1:1 (no ghost labels when the body is LOD-culled or
  // the bot is dead). No-op when the bot has no nameplate.
  setNameplateVisible(v) {
    if (this._nameplate) this._nameplate.visible = !!v;
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

// ── Nameplate sprite — a small canvas-textured label floated over the bot. ───
// Guarded so a headless/canvas-less environment (tests) degrades gracefully.
// ADR-0042: the canvas/ctx/texture are attached to the sprite so BotModel can
// redraw the name + HP bar each hit via updateNameplate() without rebuilding
// the sprite or the texture object.
function _drawNameplate(ctx, canvas, text, hpRatio) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.9)';
  ctx.strokeText(text, W / 2, 22);
  ctx.fillStyle = '#ffcf33';
  ctx.fillText(text, W / 2, 22);
  // HP bar — green (full) → red (empty), drawn under the name.
  const barX = 40, barY = 42, barW = 176, barH = 12;
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fillRect(barX - 2, barY - 2, barW + 4, barH + 4);
  const hp = Math.max(0, Math.min(1, hpRatio));
  const r = Math.round(255 * (1 - hp));
  const g = Math.round(200 * hp);
  ctx.fillStyle = `rgb(${r},${g},40)`;
  ctx.fillRect(barX, barY, barW * hp, barH);
}

function _makeNameplate(text) {
  try {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = 256; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.renderOrder = 999;
    sprite._npCanvas = canvas;
    sprite._npCtx    = ctx;
    sprite._npTex    = tex;
    // Initial render: name + a full HP bar.
    _drawNameplate(ctx, canvas, text, 1);
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
