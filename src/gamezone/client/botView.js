// src/gamezone/client/botView.js — how one bot looks (ADR-0130).
//
// A view is pure presentation: it draws whatever pose/animation/lifecycle the
// authority's snapshot says, and it answers "did this ray hit what is on
// screen?" from the rendered skeleton (hitbox.js). It never decides damage.
//
// Lifecycle (driven by the snapshot `st`): alive → dying (death clip once,
// nameplate hidden, not hittable) → dead (hidden) → alive (respawn: snaps to the
// new spawn, never slides). dispose() removes EVERYTHING it added — scene nodes,
// nameplate texture, cloned materials, mixer — so a view can never linger.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { assetUrl } from '../../assetUrl.js';
import { BOT_TEMPLATES } from './botTemplates.js';
import { fitHitboxParts, createHitboxRig, stripRootMotion } from './hitbox.js';
import { ANIMS, BOT_KINDS, HEADSHOT_DIE_SPEED } from '../core/constants.js';
import { flinchEnvelope, flinchPeak, leanFromShot } from './feel.js';
import { rayVsBody } from '../core/body.js';
import { raySegmentClosest } from '../core/geom.js';

const _near = { dist: 0, t: 0, s: 0, px: 0, py: 0, pz: 0 };
const _lean = { x: 0, z: 0 };

const FADE = 0.15;
const FLASH_S = 0.14;
const _templates = new Map();
let _draco = null;

function _opaque(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m) continue;
      m.transparent = false; m.alphaTest = 0; m.depthWrite = true; m.side = THREE.FrontSide; m.needsUpdate = true;
    }
  });
}

/** Load (once) and prepare a bot template: clips without root motion, scale, hitbox parts. */
export function loadBotTemplate(kind, loader = null) {
  const key = BOT_TEMPLATES[kind] ? kind : 'regular';
  if (_templates.has(key)) return _templates.get(key).promise;
  const cfg = BOT_TEMPLATES[key];
  const entry = { ready: false, promise: null, scene: null, clips: [], parts: null, scale: 1, lift: 0 };
  entry.promise = new Promise((resolve, reject) => {
    let gl = loader;
    if (!gl) {
      if (!_draco) { _draco = new DRACOLoader(); _draco.setDecoderPath(assetUrl('/draco/')); }
      gl = new GLTFLoader();
      gl.setDRACOLoader(_draco);
    }
    gl.load(assetUrl(cfg.url), (gltf) => {
      try {
        _opaque(gltf.scene);
        let skinned = null;
        gltf.scene.traverse((o) => { if (o.isSkinnedMesh && !skinned) skinned = o; });
        stripRootMotion(gltf.animations);
        if (skinned) {
          skinned.geometry.computeBoundingBox();
          const bb = skinned.geometry.boundingBox;
          if (cfg.target) {
            entry.scale = cfg.target / ((bb.max.y - bb.min.y) || 1);
            entry.lift = -bb.min.y * entry.scale;
          }
          entry.parts = fitHitboxParts(skinned, { neckY: cfg.neckY });
        }
        entry.scene = gltf.scene;
        entry.clips = gltf.animations;
        entry.ready = true;
        resolve(entry);
      } catch (e) { reject(e); }
    }, undefined, reject);
  });
  _templates.set(key, entry);
  return entry.promise;
}
export function templateReady(kind) { const t = _templates.get(kind); return !!(t && t.ready); }

// ── nameplate ────────────────────────────────────────────────────────────────
function _drawPlate(ctx, w, h, text, ratio) {
  ctx.clearRect(0, 0, w, h);
  ctx.font = 'bold 34px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.9)'; ctx.strokeText(text, w / 2, 22);
  ctx.fillStyle = '#ffcf33'; ctx.fillText(text, w / 2, 22);
  const x = 40, y = 42, bw = 176, bh = 12, r = Math.max(0, Math.min(1, ratio));
  ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 2, y - 2, bw + 4, bh + 4);
  ctx.fillStyle = `rgb(${Math.round(255 * (1 - r))},${Math.round(200 * r)},40)`;
  ctx.fillRect(x, y, bw * r, bh);
}
function _makePlate(text) {
  try {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx) return null;
    canvas.width = 256; canvas.height = 64;
    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2.4, 0.6, 1);
    sprite.renderOrder = 999;
    sprite.raycast = () => {};
    sprite.userData.gzPlate = { canvas, ctx, tex, text, ratio: -1 };
    return sprite;
  } catch { return null; }
}

const _placeholderGeo = { regular: null, boss: null };
function _placeholder(kind) {
  const spec = BOT_KINDS[kind];
  if (!_placeholderGeo[kind]) _placeholderGeo[kind] = new THREE.CapsuleGeometry(spec.radius, spec.height - spec.radius * 2, 4, 8);
  const m = new THREE.Mesh(_placeholderGeo[kind], new THREE.MeshStandardMaterial({ color: kind === 'boss' ? 0x7a2a2a : 0x2a2f3a, roughness: 0.8 }));
  m.position.y = spec.height / 2;
  m.castShadow = true;
  return m;
}

/**
 * @param {THREE.Object3D} parent  scene to add to
 * @param {{id:number, kind:'regular'|'boss', name:string}} meta
 */
export function createBotView(parent, meta) {
  const kind = BOT_KINDS[meta.kind] ? meta.kind : 'regular';
  const spec = BOT_KINDS[kind];
  const cfg = BOT_TEMPLATES[kind];
  const holder = new THREE.Group();
  holder.name = `gz-bot-${meta.id}`;
  holder.userData.isBotMesh = true;      // stickers' raycaster skips bots
  holder.userData.gzBotId = meta.id;
  parent.add(holder);
  // Flinch pivot (ADR-0131): leans the drawn model about its feet on a hit.
  // The hitbox rig reads the skinned mesh's world matrices, so what you aim at
  // and what you hit stay the same object, lean included.
  const lean = new THREE.Group();
  lean.name = 'gz-lean';
  holder.add(lean);
  let placeholder = _placeholder(kind);
  holder.add(placeholder);
  const plate = _makePlate(meta.name);
  if (plate) parent.add(plate);

  let model = null, mixer = null, rig = null, actions = {}, current = null, currentCode = -1;
  const materials = [];   // emissive-capable (hit flash)
  const owned = [];       // every cloned material (disposed with the view)
  let platesOn = true;
  let life = 0, hp = spec.hp, maxHp = spec.hp, flash = 0, disposed = false, predictedDead = false;
  let flinchMs = -1, flinchX = 0, flinchZ = 0, lastZone = 'body';

  function _buildModel(tpl) {
    if (disposed || model) return;
    model = skeletonClone(tpl.scene);
    model.scale.multiplyScalar(tpl.scale);
    model.position.y = tpl.lift;
    let skinned = null;
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false;
      // Per-instance materials so one bot's hit flash never tints the others.
      if (Array.isArray(o.material)) o.material = o.material.map((m) => m.clone());
      else if (o.material) o.material = o.material.clone();
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) owned.push(m);
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m && m.emissive) materials.push(m);
      if (o.isSkinnedMesh && !skinned) skinned = o;
    });
    lean.add(model);
    if (placeholder) { holder.remove(placeholder); placeholder.material.dispose(); placeholder = null; }
    mixer = new THREE.AnimationMixer(model);
    for (const code of ANIMS) {
      const a = cfg.anims[code];
      const clip = a && tpl.clips.find((c) => c.name === a.clip);
      if (!clip) continue;
      const act = mixer.clipAction(clip);
      if (a.once) { act.setLoop(THREE.LoopOnce, 1); act.clampWhenFinished = true; }
      actions[code] = { act, a, clip };
    }
    if (skinned && tpl.parts) rig = createHitboxRig(skinned, tpl.parts);
    const code = currentCode; currentCode = -1;
    _play(code >= 0 ? code : 1, true);
  }

  function _play(code, snap = false) {
    if (code === currentCode) return;
    currentCode = code;
    if (!mixer) return;
    const name = ANIMS[code] || 'walk';
    const next = actions[name] || actions.walk;
    if (!next) return;
    if (current && current.act === next.act) { next.act.timeScale = next.a.timeScale; current = next; return; }
    if (name === 'die') { flinchMs = -1; lean.rotation.x = 0; lean.rotation.z = 0; }
    next.act.reset();
    next.act.timeScale = next.a.timeScale * (name === 'die' && lastZone === 'head' ? HEADSHOT_DIE_SPEED : 1);
    if (next.a.timeScale < 0) next.act.time = next.clip.duration;
    next.act.enabled = true;
    next.act.setEffectiveWeight(1);
    next.act.play();
    if (current && !snap) next.act.crossFadeFrom(current.act, FADE, false);
    else if (current) current.act.stop();
    current = next;
  }

  const tpl = _templates.get(kind);
  if (tpl && tpl.ready) _buildModel(tpl);
  else loadBotTemplate(kind).then(_buildModel).catch((e) => console.warn('[gz] bot model load failed', kind, e));

  function _redrawPlate() {
    if (!plate) return;
    const d = plate.userData.gzPlate;
    const ratio = maxHp > 0 ? hp / maxHp : 0;
    if (Math.abs(ratio - d.ratio) < 1e-3) return;
    d.ratio = ratio;
    _drawPlate(d.ctx, d.canvas.width, d.canvas.height, d.text, ratio);
    d.tex.needsUpdate = true;
  }
  _redrawPlate();

  const api = {
    id: meta.id, kind, name: meta.name, spec, holder, killedSp: -1,
    get life() { return life; }, get hp() { return hp; }, get maxHp() { return maxHp; },
    get hittable() { return life === 0 && !predictedDead && !disposed && holder.visible; },
    get predictedDead() { return predictedDead; },
    get modelReady() { return !!rig; },

    setPose(x, y, z, yaw) { holder.position.set(x, y, z); holder.rotation.y = yaw; },
    setHp(v, max = maxHp) { hp = v; maxHp = max; _redrawPlate(); },
    setAnim(code) { if (life === 0 && !predictedDead) _play(code); },

    /** Apply the authoritative lifecycle state (0 alive / 1 dying / 2 dead). */
    setLife(st) {
      if (st === life) return;
      const prev = life;
      life = st;
      if (st === 0) {
        predictedDead = false;
        lastZone = 'body'; flinchMs = -1; lean.rotation.x = 0; lean.rotation.z = 0;
        holder.visible = true;
        currentCode = -1;
        _play(1, true);
      } else if (st === 1) {
        if (!predictedDead) _play(ANIMS.indexOf('die'), prev !== 0);
        holder.visible = true;
      } else {
        holder.visible = false;
      }
      if (plate) plate.visible = st === 0;
    },

    /** Zone of the latest hit on this bot (a headshot kill dies faster). */
    noteZone(zone) { lastZone = zone === 'head' ? 'head' : 'body'; },
    get lastZone() { return lastZone; },

    /** Client prediction: the shot we just fired is lethal — fall now, confirm later. */
    predictDeath(zone) {
      if (predictedDead || life !== 0) return;
      if (zone) api.noteZone(zone);
      predictedDead = true;
      _play(ANIMS.indexOf('die'));
      if (plate) plate.visible = false;
    },
    /** Authority disagreed with a predicted kill — stand back up. */
    cancelPredictedDeath() {
      if (!predictedDead) return;
      predictedDead = false;
      if (life === 0) { currentCode = -1; _play(1, true); if (plate) plate.visible = true; }
    },

    flashHit() { flash = FLASH_S; },

    /**
     * Visual hit reaction: lean away along the shot (world dx, dz), stronger on
     * a headshot. Restarts on every hit; never accumulates past flinchPeak().
     */
    flinch(zone, dx, dz) {
      if (life !== 0 || predictedDead || disposed) return;
      api.noteZone(zone);
      const L = Math.hypot(dx, dz);
      if (!(L > 1e-6)) return;
      flinchX = dx / L; flinchZ = dz / L; flinchMs = 0;
    },
    get flinching() { return flinchMs >= 0; },

    /** Global nameplate switch (portal mirror capture hides them). */
    setPlatesVisible(on) { platesOn = !!on; },

    update(dt, frame) {
      if (disposed) return;
      if (mixer && holder.visible) mixer.update(dt);
      if (flinchMs >= 0) {
        flinchMs += dt * 1000;
        const k = flinchEnvelope(flinchMs);
        if (k <= 0 && flinchMs > 0) { flinchMs = -1; lean.rotation.x = 0; lean.rotation.z = 0; }
        else {
          leanFromShot(flinchX, flinchZ, holder.rotation.y, flinchPeak(lastZone) * k, _lean);
          lean.rotation.x = _lean.x; lean.rotation.z = _lean.z;
        }
      }
      if (flash > 0) {
        flash = Math.max(0, flash - dt);
        const k = flash / FLASH_S;
        for (const m of materials) m.emissive.setRGB(0.9 * k, 0.08 * k, 0.04 * k);
      }
      if (plate) plate.material.opacity = platesOn ? 1 : 0;
      if (plate && plate.visible && platesOn) {
        plate.position.set(holder.position.x, holder.position.y + spec.height + 0.35, holder.position.z);
      }
    },

    /**
     * Ray vs what is on screen. Exact skinned triangles once the model is in;
     * the coarse body while it is still loading. Returns {t, zone} or null.
     */
    raycast(ox, oy, oz, dx, dy, dz, maxT, frame) {
      if (!api.hittable) return null;
      // Cheap reject: the ray must pass near the bot's vertical axis.
      const px = holder.position.x, py = holder.position.y, pz = holder.position.z;
      raySegmentClosest(ox, oy, oz, dx, dy, dz, maxT, px, py, pz, px, py + spec.height, pz, _near);
      if (_near.dist > spec.envR + 0.5) return null;
      if (rig) {
        holder.updateMatrixWorld(true);
        rig.update(frame);
        return rig.raycast(ox, oy, oz, dx, dy, dz, maxT);
      }
      const h = rayVsBody(ox, oy, oz, dx, dy, dz, maxT, px, py, pz, spec);
      return h ? { t: h.t, zone: h.zone } : null;
    },

    headWorld(out) {
      return out.set(holder.position.x, holder.position.y + spec.height, holder.position.z);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      if (mixer) { mixer.stopAllAction(); if (model) mixer.uncacheRoot(model); }
      if (holder.parent) holder.parent.remove(holder);
      if (placeholder) placeholder.material.dispose();
      for (const m of owned) m.dispose();
      if (plate) {
        if (plate.parent) plate.parent.remove(plate);
        plate.material.map.dispose();
        plate.material.dispose();
      }
      model = null; mixer = null; rig = null; actions = {};
    },
    get disposed() { return disposed; },
  };
  return api;
}
