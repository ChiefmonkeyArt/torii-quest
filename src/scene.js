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
renderer.toneMappingExposure = 0.5;
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

// v0.2.497: Sun direction lowered so it rises from behind the mountain range.
// y lowered from 0.42 → 0.22 so the sun sits at the ridgeline, not high in the sky.
// Japanese rising sun aesthetic — dramatic, emerging from behind peaks.
const _sunDir = new THREE.Vector3(0.70, 0.22, -0.45).normalize();

// ── Lights ────────────────────────────────────────────────────────────────────
scene.add(new THREE.AmbientLight(0xffc080, 0.55)); // v0.2.484: warmer ambient, dimmer so directional dominates
export const sun = new THREE.DirectionalLight(0xffa830, 1.15); // v0.2.484: golden bronze, brighter
// v0.2.497: Matches _sunDir (0.70, 0.22, -0.45) — low rising sun behind mountains
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
// _sunDir is declared above (before lights) so both lights and sky share it.
_sky.material.uniforms.sunPosition.value.copy(_sunDir);
// Show the sun disc — we want a visible sunrise sun, not just a gradient.
_sky.material.uniforms.showSunDisc.value = 0; // v0.2.479: built-in disc too bright for bloom, using custom sprite
// Clouds off for now — we'll add them back as a separate layer if wanted.
_sky.material.uniforms.cloudCoverage.value = 0;
_sky.frustumCulled = false;
// v0.2.482: Patch the Sky.js fragment shader to cap scattering brightness
// near the sun. The original shader produces HDR values (hundreds) near
// the sun at low elevation which bloom to white. We cap texColor luma
// to 0.75 BEFORE tone mapping so the warm glow is visible but never
// blooms to white. The cap is applied before the #include <tonemapping_fragment>
// so ACES still runs on the capped value.
const _skyFrag = _sky.material.fragmentShader;
_sky.material.fragmentShader = _skyFrag.replace(
  'gl_FragColor = vec4( texColor, 1.0 );',
  'float _luma = dot(texColor, vec3(0.299, 0.587, 0.114)); if (_luma > 0.75) texColor *= 0.75 / _luma; gl_FragColor = vec4( texColor, 1.0 );'
);
_sky.material.needsUpdate = true;
scene.add(_sky);

// ── Bitcoin ₿ sun sprite — RETIRED (v0.2.466) ─────────────────────────────────// ── Star field (v0.2.477) — real 3D points, not painted on dome ──────────
// Stars are now a THREE.Points mesh with actual (x,y,z) positions on a sphere
// shell at radius 550 (inside camera.far=600, in front of Sky.js box). Each
// star has per-vertex brightness, color, and twinkle phase. This fixes the
// "painted on" problem — stars are real geometry that responds to camera
// rotation with proper perspective. Uses additive blending for natural glow.
// Reference: https://github.com/pmndrs/threejs-journey (Galaxy Generator)
const STAR_COUNT = 3000;
const STAR_RADIUS = 550;
const _starGeo = new THREE.BufferGeometry();
const _starPositions = new Float32Array(STAR_COUNT * 3);
const _starColors = new Float32Array(STAR_COUNT * 3);
const _starSizes = new Float32Array(STAR_COUNT);
const _starPhases = new Float32Array(STAR_COUNT);
// Deterministic PRNG so stars are stable across reloads (no texture needed).
let _starSeed = 42;
function _starRand() {
  _starSeed = (_starSeed * 16807) % 2147483647;
  return _starSeed / 2147483647;
}
for (let i = 0; i < STAR_COUNT; i++) {
  // Uniform distribution on a sphere (no pole clustering).
  const u = _starRand();
  const v = _starRand();
  const theta = 2 * Math.PI * u;          // azimuth 0..2pi
  const phi = Math.acos(2 * v - 1);       // polar 0..pi (uniform)
  const r = STAR_RADIUS;
  const x = r * Math.sin(phi) * Math.cos(theta);
  const y = r * Math.cos(phi);
  const z = r * Math.sin(phi) * Math.sin(theta);
  _starPositions[i * 3]     = x;
  _starPositions[i * 3 + 1] = y;
  _starPositions[i * 3 + 2] = z;
  // Star color: mostly white-blue, some warm yellow, a few red giants.
  const hue = _starRand();
  if (hue > 0.92) {                      // ~8% red giants
    _starColors[i * 3]     = 1.0;
    _starColors[i * 3 + 1] = 0.6;
    _starColors[i * 3 + 2] = 0.4;
  } else if (hue > 0.75) {               // ~17% warm yellow
    _starColors[i * 3]     = 1.0;
    _starColors[i * 3 + 1] = 0.85;
    _starColors[i * 3 + 2] = 0.6;
  } else if (hue > 0.55) {                // ~20% blue-white
    _starColors[i * 3]     = 0.85;
    _starColors[i * 3 + 1] = 0.9;
    _starColors[i * 3 + 2] = 1.0;
  } else {                               // ~55% pure white
    _starColors[i * 3]     = 0.95;
    _starColors[i * 3 + 1] = 0.97;
    _starColors[i * 3 + 2] = 1.0;
  }
  // Size: most stars small, a few bright ones bigger.
  const sizeRoll = _starRand();
  _starSizes[i] = sizeRoll > 0.97 ? 3.0 : sizeRoll > 0.85 ? 2.0 : 1.0;
  // Twinkle phase: random 0..2pi
  _starPhases[i] = _starRand() * Math.PI * 2;
}
_starGeo.setAttribute('position', new THREE.BufferAttribute(_starPositions, 3));
_starGeo.setAttribute('aColor', new THREE.BufferAttribute(_starColors, 3));
_starGeo.setAttribute('aSize', new THREE.BufferAttribute(_starSizes, 1));
_starGeo.setAttribute('aPhase', new THREE.BufferAttribute(_starPhases, 1));

const _starMat = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0.0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  },
  vertexShader: /* glsl */`
    attribute vec3 aColor;
    attribute float aSize;
    attribute float aPhase;
    uniform float uTime;
    uniform float uPixelRatio;
    varying vec3 vColor;
    varying float vTwinkle;
    void main() {
      vColor = aColor;
      // Twinkle: each star has its own phase and frequency.
      float twinkleFreq = 1.5 + fract(aPhase * 0.7) * 2.0;
      vTwinkle = 0.6 + 0.4 * sin(uTime * twinkleFreq + aPhase);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      // Size attenuates with distance (perspective — this is the key
      // difference from painted-on stars: they shrink as they get
      // farther from camera center).
      gl_PointSize = aSize * uPixelRatio * 2.0 * (300.0 / -mvPosition.z);
      gl_PointSize = clamp(gl_PointSize, 1.0, 6.0);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    varying float vTwinkle;
    void main() {
      // Circular star shape with soft edge (not a hard square).
      vec2 uv = gl_PointCoord - 0.5;
      float dist = length(uv);
      if (dist > 0.5) discard;
      float alpha = 1.0 - smoothstep(0.0, 0.5, dist);
      alpha *= alpha;                     // sharper falloff
      gl_FragColor = vec4(vColor * vTwinkle, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
});

const _starField = new THREE.Points(_starGeo, _starMat);
_starField.renderOrder = -1;
_starField.frustumCulled = false;          // huge sphere, camera is inside
scene.add(_starField);

// ── Second star shell (v0.2.478) — parallax depth cue ──────────────────────
// Inner shell: fewer, brighter, bigger stars at radius 520. Rotates very
// slowly so camera movement creates a subtle parallax between the two shells
// — the "floating in space" feeling that a single dome can't produce.
// This is the same trick Skyrim and BOTW use (separate star layer from sky).
const STAR_COUNT_INNER = 800;
const STAR_RADIUS_INNER = 520;
const _starGeoInner = new THREE.BufferGeometry();
const _starPosInner = new Float32Array(STAR_COUNT_INNER * 3);
const _starColInner = new Float32Array(STAR_COUNT_INNER * 3);
const _starSizeInner = new Float32Array(STAR_COUNT_INNER);
const _starPhaseInner = new Float32Array(STAR_COUNT_INNER);
let _seed2 = 137;
function _starRand2() {
  _seed2 = (_seed2 * 16807) % 2147483647;
  return _seed2 / 2147483647;
}
for (let i = 0; i < STAR_COUNT_INNER; i++) {
  const u = _starRand2();
  const v = _starRand2();
  const theta = 2 * Math.PI * u;
  const phi = Math.acos(2 * v - 1);
  const r = STAR_RADIUS_INNER;
  _starPosInner[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
  _starPosInner[i * 3 + 1] = r * Math.cos(phi);
  _starPosInner[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  // Inner shell: brighter, warmer stars (the "hero" stars)
  const hue = _starRand2();
  if (hue > 0.85) {
    _starColInner[i * 3]     = 1.0;
    _starColInner[i * 3 + 1] = 0.7;
    _starColInner[i * 3 + 2] = 0.5;
  } else if (hue > 0.6) {
    _starColInner[i * 3]     = 1.0;
    _starColInner[i * 3 + 1] = 0.9;
    _starColInner[i * 3 + 2] = 0.7;
  } else {
    _starColInner[i * 3]     = 0.9;
    _starColInner[i * 3 + 1] = 0.95;
    _starColInner[i * 3 + 2] = 1.0;
  }
  _starSizeInner[i] = _starRand2() > 0.9 ? 4.0 : _starRand2() > 0.7 ? 2.5 : 1.5;
  _starPhaseInner[i] = _starRand2() * Math.PI * 2;
}
_starGeoInner.setAttribute('position', new THREE.BufferAttribute(_starPosInner, 3));
_starGeoInner.setAttribute('aColor', new THREE.BufferAttribute(_starColInner, 3));
_starGeoInner.setAttribute('aSize', new THREE.BufferAttribute(_starSizeInner, 1));
_starGeoInner.setAttribute('aPhase', new THREE.BufferAttribute(_starPhaseInner, 1));

// Create inner shell material with same shaders but independent uniforms
// (clone() doesn't reliably clone uniforms in all three.js versions).
const _starMatInner = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0.0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  },
  vertexShader: _starMat.vertexShader,
  fragmentShader: _starMat.fragmentShader,
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  fog: false,
});

const _starFieldInner = new THREE.Points(_starGeoInner, _starMatInner);
_starFieldInner.renderOrder = -1;
_starFieldInner.frustumCulled = false;
scene.add(_starFieldInner);

// ── Custom sun sprite (v0.2.479) — controlled, bloom-safe ────────────────────
// Sky.js built-in disc (760.0 * multiplier) blows out to white through bloom.
// Instead: a small custom disc at the sun's position, with a warm orange color
// that stays below bloom threshold (0.86). The atmospheric scattering from
// Sky.js already produces the warm horizon glow — this just adds the disc.
const _sunSpriteMat = new THREE.ShaderMaterial({
  uniforms: { uTime: { value: 0.0 } },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      vec2 p = vUv - 0.5;
      float dist = length(p);
      // v0.2.497: Larger disc + wider corona for Japanese rising sun effect
      float disc = 1.0 - smoothstep(0.10, 0.18, dist);
      // Multi-layer corona: inner bright glow + outer soft emanation
      float coronaInner = (1.0 - smoothstep(0.18, 0.32, dist)) * 0.55;
      float coronaOuter = (1.0 - smoothstep(0.32, 0.50, dist)) * 0.25;
      float corona = coronaInner + coronaOuter;
      // Golden bronze sun — warm, radiating onto environment
      vec3 sunColor = vec3(0.98, 0.58, 0.20);
      vec3 glowColor = vec3(0.95, 0.50, 0.15);
      vec3 col = sunColor * disc + glowColor * corona;
      // Subtle pulse
      col *= 0.95 + 0.05 * sin(uTime * 0.5);
      float alpha = clamp(disc + corona, 0.0, 1.0);
      gl_FragColor = vec4(col, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
  blending: THREE.NormalBlending,
  fog: false,
});
const _sunSprite = new THREE.Mesh(
  new THREE.PlaneGeometry(140, 140), // v0.2.497: 45 → 140, dramatic Japanese rising sun
  _sunSpriteMat
);
// Position at the sun direction, radius 560 (inside camera far=600)
_sunSprite.position.copy(_sunDir).multiplyScalar(560);
// Always face the camera
_sunSprite.userData.isBillboard = true;
scene.add(_sunSprite);

// ── Bitcoin ₿ sun sprite — RETIRED (v0.2.466) ─────────────────────────────────
// The additive canvas-corona sprite (scale 38) + NormalBlending PNG ₿ overlay
// (scale 55) at (0.85, 0.18, -0.45)*420 stacked on the shader sun disc and
// bloomed (strength 0.72 / threshold 0.86) into a massive white glare on the
// right side of the sky. The shader sun above is now the only sun — bigger,
// warmer, and bloom-safe. The brand ₿ overlay was noise for a sunrise scene.

// ── Sky + stars + sun tick — call once per frame ───────────────────────────────
export function tickAurora(dt) {
  _sky.material.uniforms.time.value += dt;
  _starMat.uniforms.uTime.value += dt;
  _starMatInner.uniforms.uTime.value += dt;
  _sunSpriteMat.uniforms.uTime.value += dt;
  // v0.2.478: inner shell rotates very slowly for parallax depth cue.
  _starFieldInner.rotation.y += dt * 0.005;
  // v0.2.479: billboard the sun sprite to face the camera
  _sunSprite.lookAt(camera.position);
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
