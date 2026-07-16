// scene.js — renderer, camera, lights, aurora sky dome, bitcoin sun sprite.
import * as THREE from 'three';
// Post-processing (v0.2.399): UnrealBloom stays on the deferred ARENA path only.
// scene.js is imported solely via arenaRuntime.js (the lazy ENTER ARENA chunk),
// so these addons never ride into the shell / first-paint bundle.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { assetUrl } from './assetUrl.js';
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
renderer.toneMappingExposure = 1.8;
renderer.autoClear = false;
// Local clipping lets firstPersonBody.js slice the neck stump off just below the
// camera so looking down never reveals the inside of the headless body.
renderer.localClippingEnabled = true;
document.body.appendChild(renderer.domElement);

export const scene  = new THREE.Scene();
// Sunrise morning mist fog — warm haze at distance
scene.fog = new THREE.FogExp2(0xc8dde8, 0.008);

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
scene.add(new THREE.AmbientLight(0xffd9a0, 0.9)); // warm morning ambient
const sun = new THREE.DirectionalLight(0xffe5b0, 1.8); // golden sunrise light
sun.position.set(40, 20, -30); // low angle — sunrise from east
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
sun.shadow.camera.left = sun.shadow.camera.bottom = -25;
sun.shadow.camera.right = sun.shadow.camera.top = 25;
scene.add(sun);
const fill = new THREE.PointLight(0xffa060, 1.2, 60); // warm fill
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

      // Base sky gradient — sunrise: deep lilac zenith → peach horizon
      vec3 zenith   = vec3(0.32, 0.42, 0.72); // soft periwinkle blue
      vec3 midCol   = vec3(0.55, 0.62, 0.85); // lavender mid
      vec3 horizCol = mix(vec3(0.98, 0.72, 0.40), vec3(0.98, 0.88, 0.60),
                          0.5 + 0.5 * sin(t * 0.06)); // peach-gold horizon
      vec3 base = mix(mix(zenith, midCol, smoothstep(0.0, 0.5, up)),
                      horizCol, smoothstep(0.35, 0.0, up));

      // Atmospheric band 1 — soft rose/coral clouds near horizon
      float w1a = sin(dir.x * 3.0 + dir.z * 2.0 + t * 0.12) * 0.5 + 0.5;
      float w1b = sin(dir.x * 1.5 - dir.z * 2.8 - t * 0.09) * 0.5 + 0.5;
      float band1  = smoothstep(0.3, 0.6, w1a * w1b);
      float shape1 = exp(-pow((up - 0.12) / 0.18, 2.0)); // low on horizon
      float fbm1   = fbm(vec2(dir.x * 2.5 + t * 0.02, dir.z * 2.5 - t * 0.015));
      vec3  rose   = mix(vec3(0.98, 0.60, 0.45), vec3(0.95, 0.75, 0.55),
                         0.5 + 0.5 * sin(t * 0.08));
      base += rose * band1 * shape1 * fbm1 * 0.9;

      // Atmospheric band 2 — soft lilac/mauve mid-sky
      float w2a = sin(dir.x * 4.0 - dir.z * 1.5 - t * 0.18 + 1.57) * 0.5 + 0.5;
      float w2b = sin(dir.z * 3.5 + dir.x * 1.8 + t * 0.11) * 0.5 + 0.5;
      float band2  = smoothstep(0.25, 0.55, w2a * w2b);
      float shape2 = exp(-pow((up - 0.38) / 0.22, 2.0));
      float fbm2   = fbm(vec2(dir.z * 2.0 - t * 0.025, dir.x * 2.0 + t * 0.018));
      vec3  lilac  = mix(vec3(0.72, 0.58, 0.88), vec3(0.60, 0.50, 0.82),
                          0.5 + 0.5 * sin(t * 0.10 + 1.0));
      base += lilac * band2 * shape2 * fbm2 * 0.55;

      // Atmospheric band 3 — golden light rays near zenith
      float w3a = sin(dir.x * 2.5 + dir.z * 3.5 + t * 0.09 + 3.14) * 0.5 + 0.5;
      float w3b = sin(dir.z * 4.5 - dir.x * 2.0 - t * 0.14) * 0.5 + 0.5;
      float band3  = smoothstep(0.35, 0.65, w3a * w3b);
      float shape3 = exp(-pow((up - 0.65) / 0.28, 2.0));
      float fbm3   = fbm(vec2(dir.x * 1.8 + t * 0.015, dir.z * 1.8 - t * 0.012));
      vec3  golden = mix(vec3(0.98, 0.88, 0.50), vec3(0.95, 0.78, 0.35),
                         0.5 + 0.5 * sin(t * 0.07 + 2.0));
      base += golden * band3 * shape3 * fbm3 * 0.45;

      // Soft shimmer — morning light scatter
      float shimmer = fbm(vec2(dir.x * 5.0 + t * 0.12, dir.z * 5.0 - t * 0.10));
      base += vec3(0.98, 0.92, 0.70) * shimmer * up * 0.15;

      // Neon grid removed (v0.2.344): the fract()-based horizon grid produced two
      // straight great-circle "X" strips visible across the sky in aerial/fly
      // views. Sky already has aurora bands, sun glow, and stars for richness.

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
        float starFade = smoothstep(0.12, 0.28, dir.y);
        starCol += sColor * disc * vis * twinkle * bright * starFade;
      }
      base += starCol * 1.4;

      // Sunrise sun disc — low on eastern horizon, warm gold
      vec3 sunDir    = normalize(vec3(0.85, 0.28, -0.45)); // east, low angle
      float sunAngle = max(0.0, dot(dir, sunDir));
      base += vec3(1.0, 0.92, 0.60) * pow(sunAngle, 80.0) * 6.0;  // bright disc
      base += vec3(1.0, 0.65, 0.25) * pow(sunAngle, 12.0) * 1.2;  // inner corona
      base += vec3(0.98, 0.50, 0.15) * pow(sunAngle,  4.0) * 0.5; // wide glow
      base += vec3(0.95, 0.80, 0.50) * pow(sunAngle,  2.0) * 0.2; // horizon flush

      base = clamp(base, 0.0, 1.0);
      gl_FragColor = vec4(base, 1.0);
    }
  `,
});

const _auroraDome = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 32), _auroraMat);
_auroraDome.renderOrder = -1;
_auroraDome.frustumCulled = false; // camera is inside — Three.js culls incorrectly without this
scene.add(_auroraDome);

// ── Bitcoin ₿ sun sprite ──────────────────────────────────────────────────────
// Two-layer: canvas corona + PNG ₿ overlay, matching v1 positions.
(function _buildBitcoinSun() {
  const size = 512;
  const cv1 = document.createElement('canvas');
  cv1.width = cv1.height = size;
  const c1 = cv1.getContext('2d');
  const cx = size / 2, cy = size / 2, r = size / 2;

  // Corona glow
  const glow = c1.createRadialGradient(cx, cy, r * 0.18, cx, cy, r);
  glow.addColorStop(0.0,  'rgba(255, 230, 120, 1.0)');
  glow.addColorStop(0.25, 'rgba(255, 150,  50, 0.90)');
  glow.addColorStop(0.55, 'rgba(200,  70,  10, 0.45)');
  glow.addColorStop(1.0,  'rgba(0, 0, 0, 0.0)');
  c1.fillStyle = glow;
  c1.fillRect(0, 0, size, size);

  // Inner disc
  const disc = c1.createRadialGradient(cx, cy, 0, cx, cy, r * 0.20);
  disc.addColorStop(0.0, 'rgba(255, 255, 245, 1.0)');
  disc.addColorStop(0.6, 'rgba(255, 230,  90, 1.0)');
  disc.addColorStop(1.0, 'rgba(255, 160,  20, 0.0)');
  c1.beginPath();
  c1.arc(cx, cy, r * 0.20, 0, Math.PI * 2);
  c1.fillStyle = disc;
  c1.fill();

  const tex1 = new THREE.CanvasTexture(cv1);
  const mat1 = new THREE.SpriteMaterial({
    map: tex1, transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, fog: false,
  });
  const sunSprite = new THREE.Sprite(mat1);
  const sd = new THREE.Vector3(0.3, 0.65, -0.8).normalize();
  sunSprite.position.copy(sd.clone().multiplyScalar(420));
  sunSprite.scale.set(90, 90, 1);
  sunSprite.renderOrder = 1;
  scene.add(sunSprite);

  new THREE.TextureLoader().load(assetUrl('/bitcoin-b.png'), tex2 => {
    const mat2 = new THREE.SpriteMaterial({
      map: tex2, transparent: true, opacity: 0.30,
      blending: THREE.NormalBlending,
      depthWrite: false, depthTest: false, fog: false,
    });
    const btcSprite = new THREE.Sprite(mat2);
    btcSprite.position.set(sd.x * 422, sd.y * 422, sd.z * 422);
    btcSprite.scale.set(135, 135, 1);
    btcSprite.renderOrder = 2;
    scene.add(btcSprite);
  });
}());

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
