// scene.js — renderer, camera, lights, Preetham sky (Three.js Sky.js addon).
import * as THREE from 'three';
// Post-processing (v0.2.400): UnrealBloom stays on the deferred ARENA path only.
// scene.js is imported solely via arenaRuntime.js (the lazy ENTER ARENA chunk),
// so these addons never ride into the shell / first-paint bundle.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bloomPlanForTier } from './engine/bloomPlan.js';
import { Sky } from 'three/addons/objects/Sky.js';

const DEFAULT_DPR = Math.min(globalThis.devicePixelRatio || 1, 1.5);
const BLOOM_PLAN = bloomPlanForTier('HIGH');

export let composer = null;
export let bloomPass = null;

export const renderer = new THREE.WebGLRenderer({ antialias: true });
// v0.2.379-alpha: main renderer DPR cap lowered 2 → 1.5 (HIGH tier max). The
// adaptive quality tier (engine/render/qualityTier.js) calls setPixelRatio()
// dynamically at/below this. 1.5 matches the existing mirror cap (mirror.js:51).
renderer.setPixelRatio(DEFAULT_DPR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // PCFSoftShadowMap deprecated in r168+
// v0.2.464: 1.8 blew the dawn disc + Bitcoin sprite into white glare.
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5; // v0.2.476: Sky.js HDR output needs ACES + low exposure
renderer.autoClear = false;
// Local clipping lets firstPersonBody.js slice the neck stump off just below the
// camera so looking down never reveals the inside of the headless body.
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

export const scene  = new THREE.Scene();
// v0.2.472: fog cooled + thinned so it no longer bloom-clamps in the sun
// direction. Peach at density 0.008 was lit by the amber sun and pushed past
// bloom threshold (0.86) at the horizon, producing a huge white blob to the
// right of the actual sun.
scene.fog = new THREE.FogExp2(0xc8a878, 0.002); // v0.2.476: very light warm haze, Sky.js handles atmosphere

export const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 600);
// Layer 2 = the first-person headless body (firstPersonBody.js). Main camera
// sees world (layer 0) + FP body (layer 2). The mirror reflection camera shows
// the full 3rd-person model on layer 1 and DISABLES layer 2 so the headless FP
// body never appears in the mirror.
camera.layers.enable(2);

// Gun viewmodel — separate scene so it's always on top
export const gunScene  = new THREE.Scene();
export const gunCamera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 0.01, 10);
gunScene.add(new THREE.AmbientLight(0xffffff, 1.4));

function currentRendererDpr() {
  return typeof renderer.getPixelRatio === 'function' ? renderer.getPixelRatio() : DEFAULT_DPR;
}

function syncComposerViewportSize() {
  if (!composer) return;
  const dpr = currentRendererDpr();
  if (typeof composer.setPixelRatio === 'function') composer.setPixelRatio(dpr);
  if (typeof composer.setSize === 'function') composer.setSize(innerWidth, innerHeight);
}

function initBloomComposer() {
  try {
    const nextComposer = new EffectComposer(renderer);
    nextComposer.addPass(new RenderPass(scene, camera));
    const nextBloomPass = new UnrealBloomPass(
      new THREE.Vector2(innerWidth, innerHeight),
      BLOOM_PLAN.strength,
      BLOOM_PLAN.radius,
      BLOOM_PLAN.threshold,
    );
    nextBloomPass.enabled = BLOOM_PLAN.enabled;
    nextComposer.addPass(nextBloomPass);
    nextComposer.addPass(new OutputPass());
    composer = nextComposer;
    bloomPass = nextBloomPass;
    syncComposerViewportSize();
  } catch (err) {
    composer = null;
    bloomPass = null;
    console.warn('[render] bloom composer init failed; using direct renderer fallback', err);
  }
}

function renderArenaScene() {
  if (composer && typeof composer.render === 'function') {
    try {
      composer.render();
      return;
    } catch (err) {
      console.warn('[render] bloom composer render failed; falling back to direct renderer', err);
      composer = null;
      bloomPass = null;
    }
  }
  renderer.render(scene, camera);
}

initBloomComposer();

export { syncComposerViewportSize };

// ── Lights ────────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffd090, 0.70)); // v0.2.472: 0.85 -> 0.70
export const sun = new THREE.DirectionalLight(0xffc878, 0.95); // v0.2.472: 1.15 -> 0.95, less fog-lighting bloom
// Matches the sky-shader sunDir (0.85, 0.18, -0.45) — low eastern dawn, disc behind peaks.
sun.position.copy(_sunDir).multiplyScalar(50); // v0.2.476: exact match to Sky.js sun direction
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
sun.shadow.camera.right = sun.shadow.camera.top = 25;
scene.add(sun);
const fill = new THREE.PointLight(0xffa060, 0.7, 60); // warm fill
fill.position.set(-10, 8, 10);
scene.add(fill);

// ── Sky (v0.2.476) — Three.js Preetham atmospheric scattering ──────────────
// Replaces the hand-rolled aurora dome shader entirely. The Preetham model
// computes sky color from sun position + atmospheric coefficients per-pixel
// using view-direction dot products (Cartesian), not theta/phi UV space —
// so there is no pole singularity, no wedge artifact, no "painted on" look.
// The sun disc is built into the scattering model: one sun, physically
// correct angular diameter, color derived from atmospheric extinction.
// Reference: https://threejs.org/docs/pages/Sky.html
const _sky = new Sky();
_sky.scale.setScalar(450000);
// Sunrise tuning (not dawn — sun is up, sky is clearing, warm light):
//   turbidity 8     — moderate haze, warm horizon (dawn would be 10-20)
//   rayleigh 2.5    — deeper blue sky (dawn would be 0.5-1, noon ~1)
//   mieCoefficient 0.01 — warm scatter at horizon (dawn would be 0.05+)
//   mieDirectionalG 0.85 — forward scatter, sun glow concentrated toward disc
_sky.material.uniforms.turbidity.value = 8;
_sky.material.uniforms.rayleigh.value = 2.5;
_sky.material.uniforms.mieCoefficient.value = 0.01;
_sky.material.uniforms.mieDirectionalG.value = 0.85;
// Sun position matches the existing DirectionalLight direction (0.85, 0.18,
// -0.45) — low eastern sunrise, disc just above the ridgeline.
const _sunDir = new THREE.Vector3(0.85, 0.18, -0.45).normalize();
_sky.material.uniforms.sunPosition.value.copy(_sunDir);
// Show the sun disc — we want a visible sunrise sun, not just a gradient.
_sky.material.uniforms.showSunDisc.value = 1;
// Clouds off for now — we'll add them back as a separate layer if wanted.
_sky.material.uniforms.cloudCoverage.value = 0;
_sky.frustumCulled = false;
scene.add(_sky);

// ── Bitcoin ₿ sun sprite — RETIRED (v0.2.466) ─────────────────────────────────// ── Bitcoin ₿ sun sprite — RETIRED (v0.2.466) ─────────────────────────────────
// The additive canvas-corona sprite (scale 38) + NormalBlending PNG ₿ overlay
// (scale 55) at (0.85, 0.18, -0.45)*420 stacked on the shader sun disc and
// bloomed (strength 0.72 / threshold 0.86) into a massive white glare on the
// right side of the sky. The shader sun above is now the only sun — bigger,
// warmer, and bloom-safe. The brand ₿ overlay was noise for a sunrise scene.

// ── Sky tick — call once per frame (drives cloud animation if enabled) ──────
export function tickAurora(dt) {
  _sky.material.uniforms.time.value += dt;
}

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  const dpr = currentRendererDpr();
  renderer.setPixelRatio(dpr);
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  gunCamera.aspect = innerWidth/innerHeight;
  gunCamera.updateProjectionMatrix();
  syncComposerViewportSize();
});

export function renderFrame(showGun) {
  renderer.clear();
  renderArenaScene();
  // Gun viewmodel draws on top afterwards (separate scene, always-on-top, no
  // bloom) — clear only depth so it composites over the bloomed frame.
  if (showGun) { renderer.clearDepth(); renderer.render(gunScene, gunCamera); }
}
