// scene.js — renderer, camera, lights, aurora sky dome (single warm shader sun).
import * as THREE from 'three';
// Post-processing (v0.2.400): UnrealBloom stays on the deferred ARENA path only.
// scene.js is imported solely via arenaRuntime.js (the lazy ENTER ARENA chunk),
// so these addons never ride into the shell / first-paint bundle.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { bloomPlanForTier } from './engine/bloomPlan.js';

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
renderer.toneMappingExposure = 1.2;
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
scene.fog = new THREE.FogExp2(0x9fb8d0, 0.0035); // v0.2.473: cool dawn blue, matches sky gradient

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
sun.position.set(40, 13, -21);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
sun.shadow.camera.right = sun.shadow.camera.top = 25;
scene.add(sun);
const fill = new THREE.PointLight(0xffa060, 0.7, 60); // warm fill
fill.position.set(-10, 8, 10);
scene.add(fill);

// ── Aurora dome ───────────────────────────────────────────────────────────────
// Ported from v1 main.js — BackSide sphere with animated GLSL aurora bands +
// star field + sun disc. Animated via uTime uniform in tickAurora().
const _auroraMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  fog: false,
  uniforms: {
    uTime: { value: 0.0 },
  },
  vertexShader: /* glsl */`
    varying vec3 vWorldPos;
    void main() {
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform float uTime;
    varying vec3 vWorldPos;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }
    float noise(vec2 p) {
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1,0)), f.x),
        mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y
      );
    }
    float fbm(vec2 p) {
      float v = 0.0, a = 0.5;
      for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.1; a *= 0.5; }
      return v;
    }

    void main() {
      vec3 dir = normalize(vWorldPos);
      float up      = clamp(dir.y, 0.0, 1.0);
      float horizon = 1.0 - up;
      float t       = uTime;

      if (dir.y < -0.05) {
        gl_FragColor = vec4(0.55, 0.72, 0.60, 1.0); // below horizon: meadow haze
        return;
      }

      // v0.2.473 — CLEAN WIPE. All previous sky layers (horizon glow, lilac
      // band, golden band, shimmer, sun disc, Japanese rays) removed. Sky is
      // now a two-axis gradient:
      //   • vertical: darker at zenith, lighter at horizon (natural sky)
      //   • azimuthal: deep blue on the far side (away from sun), lighter
      //     blue toward the sun's compass direction (0.85, -, -0.45)
      // Stars remain (rendered below).
      vec3  sunDirH    = normalize(vec3(0.85, 0.0, -0.45));
      vec3  dirH       = normalize(vec3(dir.x, 0.0, dir.z));
      float toSun      = dot(dirH, sunDirH);              // -1 opposite, +1 toward sun
      float sunSide    = 0.5 + 0.5 * toSun;               // 0 far, 1 near
      // Two anchor palettes: far side deep blue, sun side lighter blue.
      vec3 farZenith   = vec3(0.06, 0.14, 0.34);          // deep navy at zenith opposite sun
      vec3 farHorizon  = vec3(0.28, 0.42, 0.62);          // muted blue horizon opposite sun
      vec3 nearZenith  = vec3(0.24, 0.42, 0.68);          // brighter blue at zenith toward sun
      vec3 nearHorizon = vec3(0.62, 0.78, 0.92);          // pale sky blue horizon toward sun
      vec3 farCol      = mix(farHorizon,  farZenith,  smoothstep(0.0, 0.9, up));
      vec3 nearCol     = mix(nearHorizon, nearZenith, smoothstep(0.0, 0.9, up));
      vec3 base = mix(farCol, nearCol, sunSide);

      // Stars — seam-free horizontal projection
      vec3 starCol = vec3(0.0);
      for (int layer = 0; layer < 2; layer++) {
        float scale  = layer == 0 ? 18.0 : 28.0;
        float bright = layer == 0 ? 1.8  : 1.1;
        float safeY  = max(dir.y, 0.08);
        vec2 starUV  = vec2(dir.x, dir.z) / safeY * scale
                       + vec2(float(layer) * 37.3, float(layer) * 19.7);
        vec2 cell    = floor(starUV);
        vec2 frac    = fract(starUV);
        vec2 starPos = vec2(hash(cell), hash(cell + vec2(31.4, 71.9))) * 0.7 + 0.15;
        float dist   = length(frac - starPos);
        float thresh = hash(cell + vec2(53.1, 97.3));
        float vis    = step(0.85, thresh);
        float disc   = 1.0 - smoothstep(0.0, 0.05, dist);
        float phase  = hash(cell + vec2(11.7, 43.1)) * 6.28;
        float twinkle = 0.7 + 0.3 * sin(t * (1.5 + thresh) + phase);
        float hue    = hash(cell + vec2(73.1, 17.3));
        vec3 sColor  = hue > 0.85 ? vec3(1.0, 0.85, 0.6)
                     : hue > 0.70 ? vec3(0.85, 0.9, 1.0)
                     :              vec3(0.95, 0.97, 1.0);
        float starFade = smoothstep(0.22, 0.48, dir.y);
        starCol += sColor * disc * vis * twinkle * bright * starFade;
      }
      base += starCol * 0.55;

      // v0.2.473 — sun disc, corona, and Japanese rays REMOVED. The horizon
      // gradient toward the sun's azimuth is the only cue of where the sun is.

      base = clamp(base, 0.0, 1.0);
      gl_FragColor = vec4(base, 1.0);
    }
  `,
});

const _auroraDome = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), _auroraMat);
_auroraDome.renderOrder = -1;
_auroraDome.frustumCulled = false; // camera is inside — Three.js culls incorrectly without this
scene.add(_auroraDome);

// ── Bitcoin ₿ sun sprite — RETIRED (v0.2.466) ─────────────────────────────────
// The additive canvas-corona sprite (scale 38) + NormalBlending PNG ₿ overlay
// (scale 55) at (0.85, 0.18, -0.45)*420 stacked on the shader sun disc and
// bloomed (strength 0.72 / threshold 0.86) into a massive white glare on the
// right side of the sky. The shader sun above is now the only sun — bigger,
// warmer, and bloom-safe. The brand ₿ overlay was noise for a sunrise scene.

// ── Aurora tick — call once per frame ────────────────────────────────────────
export function tickAurora(dt) {
  _auroraMat.uniforms.uTime.value += dt;
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
