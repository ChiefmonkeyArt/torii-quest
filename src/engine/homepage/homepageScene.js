// engine/homepage/homepageScene.js — the 3D landing scene behind the home surface.
//
// v0.2.609 golden-sunrise redesign: a misty mountain range, a low warm sun, the
// Torii GATEWAY EXPERIENCE gate on the RIGHT, + Chiefmonkey in a rested-idle
// animation on the LEFT. Mouse movement pans the camera with parallax so the
// scene, gate, + character shift with perspective.
//
// Self-contained Three.js scene. Display + rAF ONLY — no fetch, no sign, no
// relay, no navigation, no DOM event routing beyond resize + mousemove. Every
// action still lives in the DOM cards the stub already owns.
//
import { assetUrl } from '../../assetUrl.js';

// Loading: `three` + the GLB loaders are imported LAZILY inside mount()
// (dynamic `import()`). homepageStub.js never imports three at module-eval
// time, so the homepage layer stays three-free + node-testable (mirrors the
// arena's ENTER ARENA bootstrap). three is already in the production bundle
// (the arena uses it), so this adds no new dependency — only reuses it on the
// home surface.
//
// The two GLB meshes (gate + character) load from /public via assetUrl() so
// they resolve correctly under the /quest/ Suite path prefix. Both are optional
// + fail-safe: a failed load leaves the procedural scene (mountains, sun, fog)
// intact — the home surface still works.
//
// Lifecycle: mountHomepageScene(container) → Promise<{unmount}|null>. The scene
// creates its own <canvas> inside `container`, sizes it to the container, + runs
// a single rAF loop. unmount() cancels the rAF, removes the mousemove listener,
// disposes every geometry / material / texture / mixer / renderer, disconnects
// the ResizeObserver, + removes the canvas — no orphaned GL context, no leaked
// listeners. Fail-safe: a missing `three`, a missing WebGL context, or any throw
// → returns null so the caller falls back to the existing DOM gradient.
//
// Regression-guard: rAF is the ONLY scheduling primitive (no setInterval /
// setTimeout), + it is always cancelled on unmount. No new hot-path allocs in
// the loop — geometries/materials/mixers are built once at mount; per-frame work
// is matrix/scalar writes on existing objects + a single mixer.update(dt).

let _Three = null;

// _loadThree() → the three namespace (cached) or null. Lazy + fail-safe.
async function _loadThree() {
  if (_Three) return _Three;
  try {
    const mod = await import('three');
    _Three = mod.default ?? mod;
    return _Three;
  } catch {
    return null;
  }
}

// _loadGltfLoader() → a GLTFLoader class (cached) or null. Lazy + fail-safe.
// v0.2.611: BOTH homepage GLBs are DRACO-compressed (the "uncompressed" claim
// here was wrong — GLTFLoader threw "No DRACOLoader instance provided" on both,
// which is why the gate + character silently never appeared). The Draco decoder
// is vendored at /draco/ (same-origin, already used by the arena), so wiring it
// adds no third-party fetch.
let _GltfLoader = null;
async function _loadGltfLoader() {
  if (_GltfLoader) return _GltfLoader;
  try {
    const mod = await import('three/addons/loaders/GLTFLoader.js');
    _GltfLoader = mod.GLTFLoader ?? null;
    return _GltfLoader;
  } catch {
    return null;
  }
}

let _DracoLoader = null;
async function _loadDracoLoader() {
  if (_DracoLoader) return _DracoLoader;
  try {
    const mod = await import('three/addons/loaders/DRACOLoader.js');
    _DracoLoader = mod.DRACOLoader ?? null;
    return _DracoLoader;
  } catch {
    return null;
  }
}

// _assetPath(rel) → a URL for a /public asset, honouring the Vite base. Kept
// local (no module-eval import of assetUrl.js) so this file stays side-effect
// free in node tests; mirrors src/assetUrl.js logic for the build base.
function _assetPath(rel) {
  const r = String(rel).replace(/^\/+/, '');
  const base = (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.BASE_URL) || '/';
  const nb = base.endsWith('/') ? base : `${base}/`;
  return `${nb}${r}`;
}

// _canUseWebGL(doc) → true if a WebGL context is available. Probes with a
// THROWAWAY canvas — never the real render canvas — so we never hand Three a
// canvas whose context was already lost. Loses the probe context immediately.
function _canUseWebGL(doc) {
  try {
    const probe = doc.createElement('canvas');
    // v0.2.611: NO failIfMajorPerformanceCaveat — that flag excludes every
    // software renderer (SwiftShader / llvmpipe / VMs / some Linux stacks), so
    // the home scene silently never mounted on exactly the machines that need
    // it to degrade gracefully. The scene is light; a slow paint beats an
    // invisible one. The arena itself never used this flag either.
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose && typeof lose.loseContext === 'function') lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

// ── Palettes (golden sunrise) ────────────────────────────────────────────────
const SUN_CORE = 0xffe3b0;   // pale gold sun disc
const SUN_HALO = 0xffa03c;   // orange halo
const SUN_GLOW = 0xff8c1f;   // deep orange glow
// v0.2.611 contrast fix: the sky/fog is now a BRIGHTER warm bronze and the
// ridges are DARKER silhouettes against it — the old palette (fog 0x2a1a0c vs
// ridges 0x241709–0x4a3320) was tonally identical, so the mountains vanished
// into the haze.
// v0.2.613 sky fix: the old uniform bronze fog read as an empty brown void —
// the user reported "sky and mountains are not loaded". Now a real gradient
// SKY DOME (dusky violet zenith → molten gold horizon) sits behind everything,
// the fog tints toward the horizon colour so the ridges melt into it, and the
// ridge silhouettes stay dark for contrast.
const FOG_COL  = 0x9a5522;   // warm haze — blends ridges into the horizon glow
const AMBIENT  = 0x8a6a4a;   // warm ambient lift
const KEY_COL  = 0xffb95c;   // golden key light
const RIDGE_COLS = [0x1a0d05, 0x2a1709, 0x3c2410]; // near → far mountain silhouettes
const SKY_TOP = 0x2a1030;    // dusky violet zenith
const SKY_HORIZON = 0xe8822e; // molten gold horizon
// v0.2.616 landscape palette: a teal sea band + a green grass field so the
// home surface reads as a full landscape (sky → sun → mountains → sea → grass),
// not flat colour bands. Sea sits behind the gate; grass fills the foreground
// under the gate + chiefmonkey.
const SEA_COL_A = 0x14556e;   // deep teal water
const SEA_COL_B = 0x3aa0b8;   // lighter teal crest
const GRASS_COL = 0x3f7d3a;   // grass field green

// _buildSun(THREE) → a layered sun low on the horizon: an emissive core disc +
// two larger transparent halo discs for a soft glow. Flat (double-sided) so it
// always faces the camera. Per-frame the loop gently breathes the halo opacity.
function _buildSun(THREE) {
  const g = new THREE.Group();
  const mk = (r, color, opacity) => {
    const geo = new THREE.CircleGeometry(r, 48);
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, side: THREE.DoubleSide,
      fog: false, depthWrite: false,
    });
    const m = new THREE.Mesh(geo, mat);
    m.userData.geo = geo; m.userData.mat = mat;
    return m;
  };
  const glow = mk(10.0, SUN_GLOW, 0.15);
  const halo = mk(6.5, SUN_HALO, 0.34);
  const core = mk(3.6, SUN_CORE, 1.0);
  g.add(glow, halo, core);
  g.userData.halo = halo; g.userData.glow = glow;
  return g;
}

// _buildSky(THREE) → a huge inward-facing sphere with a vertical gradient
// shader (horizon gold → zenith violet). Unaffected by fog, never depth-writes,
// renders behind the ridges. Cheap: 1 draw call, 2 uniforms, no textures.
function _buildSky(THREE) {
  const geo = new THREE.SphereGeometry(180, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color(SKY_TOP) },
      bottom: { value: new THREE.Color(SKY_HORIZON) },
    },
    vertexShader:
      'varying vec3 vP;\n' +
      'void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 bottom; varying vec3 vP;\n' +
      'void main(){ float h = normalize(vP).y * 0.5 + 0.5;\n' +
      '  vec3 c = mix(bottom, top, smoothstep(0.03, 0.55, h));\n' +
      '  gl_FragColor = vec4(c, 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.geo = geo; m.userData.mat = mat;
  m.renderOrder = -1;
  return m;
}

// _buildMountainRidge(THREE, {width, height, peaks, color, seed}) → a jagged
// silhouette ridge (a flat shape) in a given colour. Peaks are deterministic
// (seeded) so the skyline is stable across reloads. The shape's base sits at
// y=0; it rises to `height` at its tallest peak.
function _ridgeHeight(seed, n) {
  // Deterministic pseudo-random in [0,1) from a seed integer.
  let s = (seed * 9301 + 49297) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const hs = [];
  for (let i = 0; i <= n; i++) hs.push(0.35 + rnd() * 0.65);
  // Smooth so the ridge reads as rolling peaks, not spikes.
  for (let p = 0; p < 2; p++) {
    for (let i = 1; i < n; i++) hs[i] = (hs[i - 1] + hs[i] * 2 + hs[i + 1]) / 4;
  }
  return hs;
}
function _buildMountainRidge(THREE, opts) {
  const { width = 120, height = 14, peaks = 9, color = 0x352415, seed = 7 } = opts || {};
  const hs = _ridgeHeight(seed, peaks);
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  for (let i = 0; i <= peaks; i++) {
    const x = -width / 2 + (width * i) / peaks;
    shape.lineTo(x, hs[i] * height);
  }
  shape.lineTo(width / 2, 0);
  shape.lineTo(-width / 2, 0);
  const geo = new THREE.ShapeGeometry(shape);
  const mat = new THREE.MeshBasicMaterial({ color, fog: true, side: THREE.DoubleSide });
  const m = new THREE.Mesh(geo, mat);
  m.userData.geo = geo; m.userData.mat = mat;
  return m;
}

// _buildSea(THREE) → an animated water band (a wide plane with a gentle sine
// swell in the vertex shader). Cheap: 1 draw call, 2 colour uniforms, 1 time
// uniform ticked per-frame. No physics, no reflection — a landing-scene sea.
function _buildSea(THREE) {
  const geo = new THREE.PlaneGeometry(220, 46, 48, 10);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      uTime: { value: 0 },
      colorA: { value: new THREE.Color(SEA_COL_A) },
      colorB: { value: new THREE.Color(SEA_COL_B) },
    },
    vertexShader:
      'uniform float uTime; varying float vWave;\n' +
      'void main(){ vec3 p = position;\n' +
      '  float w = sin(p.x * 0.22 + uTime * 1.1) * 0.16 + sin(p.z * 0.4 + uTime * 0.8) * 0.12;\n' +
      '  p.y += w; vWave = w;\n' +
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0); }',
    fragmentShader:
      'uniform vec3 colorA; uniform vec3 colorB; varying float vWave;\n' +
      'void main(){ float t = clamp(vWave * 2.4 + 0.5, 0.0, 1.0);\n' +
      '  gl_FragColor = vec4(mix(colorA, colorB, t), 1.0); }',
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.geo = geo; m.userData.mat = mat;
  return m;
}

// _buildGrass(THREE) → an instanced grass field (thin blades scattered over the
// foreground). One InstancedMesh = 1 draw call. Blades are deterministic (seeded)
// so the field is stable across reloads. A subtle per-blade height/lean variation
// reads as grass rather than a flat green plane.
function _buildGrass(THREE, count = 500) {
  const bladeGeo = new THREE.ConeGeometry(0.06, 0.7, 4);
  const mat = new THREE.MeshStandardMaterial({ color: GRASS_COL, roughness: 1, metalness: 0 });
  const mesh = new THREE.InstancedMesh(bladeGeo, mat, count);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  let seed = 20260821;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  for (let i = 0; i < count; i++) {
    // Scatter over the foreground + mid ground (z -14 .. 22), avoiding the
    // character's immediate standing spot so he isn't buried in blades.
    const x = (rnd() - 0.5) * 44;
    const z = -14 + rnd() * 36;
    if (Math.abs(x - (-0.55)) < 1.2 && z > 20) { i--; continue; }
    const h = 0.5 + rnd() * 0.5;
    p.set(x, 0, z);
    e.set((rnd() - 0.5) * 0.35, rnd() * Math.PI, (rnd() - 0.5) * 0.35);
    q.setFromEuler(e);
    s.set(1, h, 1);
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.userData.geo = bladeGeo; mesh.userData.mat = mat;
  return mesh;
}

// mountHomepageScene(container) → { unmount } | null. Fail-safe at every step:
// no three → null; no WebGL → null; any throw → null. The caller keeps the DOM.
export async function mountHomepageScene(container) {
  if (!container || typeof container.appendChild !== 'function') return null;
  const THREE = await _loadThree();
  if (!THREE) return null;

  const doc = container.ownerDocument || (typeof globalThis !== 'undefined' && globalThis.document);
  if (!doc || typeof doc.createElement !== 'function') return null;
  if (!_canUseWebGL(doc)) return null;

  const canvas = doc.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  Object.assign(canvas.style, {
    position: 'absolute', inset: '0', width: '100%', height: '100%',
    display: 'block', zIndex: '0', pointerEvents: 'none',
  });
  container.appendChild(canvas);

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: 'high-performance' });
  } catch {
    try { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch { /* best-effort */ }
    return null;
  }
  renderer.setClearColor(FOG_COL, 1);
  renderer.setPixelRatio(Math.min((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), 2));

  const scene = new THREE.Scene();
  // v0.2.611: fog density 0.016 → 0.010 so the far ridge keeps silhouette
  // contrast instead of fogging out to the exact sky colour.
  scene.fog = new THREE.FogExp2(FOG_COL, 0.009);
  // v0.2.613: the flat background colour is replaced by the gradient sky dome
  // (added below, once `disposables` exists); the clear colour stays as a
  // fallback behind any sphere seam.
  // v0.2.614: the sky SPHERE renders on real GPUs; but software/rasterising
  // fallbacks (SwiftShader, throttled GPUs) can z-fight or drop BackSide
  // spheres — the operator saw a black sky after a mid-SW-transition load.
  // A solid horizon-coloured background sits UNDER the sphere so the frame
  // is never pure black even if the shader never draws.
  scene.background = new THREE.Color(SKY_HORIZON);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  // v0.2.615: camera stays at standing eye height; the character is ~1.1m
  // from the lens so his head/shoulders fill the frame and his lower body
  // falls off the BOTTOM of the viewport (no cut-off-at-the-ground trick).
  const BASE_CAM = new THREE.Vector3(0, 1.6, 26);
  const BASE_LOOK = new THREE.Vector3(0, 2.2, 0);
  const CHAR_BASE_X = -0.55; // greeter rests left-of-centre; parallax nudges from here
  camera.position.copy(BASE_CAM);
  camera.lookAt(BASE_LOOK);

  // Lights: a warm ambient lift + a golden key from the sun's direction + a
  // soft fill so the gate/character read against the bright horizon.
  // v0.2.611: the GLBs arrive nearly black (no texture; MeshStandardMaterial
  // with weak default UVs) — raise ambient + fill + key and push an emissive
  // lift onto the loaded meshes so the gate/character actually read.
  scene.add(new THREE.AmbientLight(AMBIENT, 1.7));
  const key = new THREE.DirectionalLight(KEY_COL, 1.8); key.position.set(4, 8, -6); scene.add(key);
  // v0.2.613: stronger frontal fill so the gate's vermillion skin + the
  // character read against the bright horizon (they were near-silhouette).
  const fill = new THREE.PointLight(0xffc9a0, 170, 110, 1.5); fill.position.set(0, 6, 14); scene.add(fill);
  // v0.2.614: a soft warm key right at the lens so the close-up character's
  // face/torso read — the gate fill is 10m behind him now and he was a dark
  // silhouette.
  const charKey = new THREE.PointLight(0xffd9b0, 26, 12, 1.4); charKey.position.set(-1.5, 2.2, 27.5); scene.add(charKey);
  const rim = new THREE.PointLight(0xff9a4a, 50, 70, 1.7); rim.position.set(-6, 5, -8); scene.add(rim);

  // _fixGlb(root) — v0.2.613 texture fix: these GLBs export alphaMode:BLEND,
  // which makes every material TRANSLUCENT (the "skin not loaded" clay look —
  // z-sort washing drowns the albedo texture). Force fully opaque, the same
  // fix botModel.js/playerModel.js already apply in-game. The warm emissive
  // lift now applies ONLY to materials with NO texture map, so a real albedo
  // texture is no longer drowned in orange.
  const _fixGlb = (root) => {
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        try {
          m.transparent = false;
          m.alphaTest = 0;
          m.depthWrite = true;
          if (!m.map && m.emissive && typeof m.emissive.setHex === 'function') {
            m.emissive.setHex(0x6a4526);
            m.emissiveIntensity = 1.0;
          }
          m.needsUpdate = true;
        } catch { /* best-effort */ }
      }
    });
  };

  // Sun low on the horizon on the RIGHT, just behind/above the gate — clear of
  // the centre console card (the old x=3.5 projected directly behind it, so the
  // one bright focal point was hidden by the UI).
  // v0.2.615: sun lifted above the far ridge line (at y 8.5 the 16-high ridge
  // at z -34 occluded it entirely — operator: "no graphics of the sun").
  const sun = _buildSun(THREE); sun.position.set(14, 22, -50); scene.add(sun);

  // Mountain ridges layered near → far for depth + fog falloff.
  const disposables = [];
  const ridges = []; // each entry keeps its base x=0; parallax shifts per-layer
  const ridgeDefs = [
    { width: 150, height: 16, peaks: 8,  color: RIDGE_COLS[2], seed: 11, z: -34, y: 0 },
    { width: 130, height: 12, peaks: 7,  color: RIDGE_COLS[1], seed: 29, z: -22, y: 0 },
    { width: 120, height: 8,  peaks: 6,  color: RIDGE_COLS[0], seed: 47, z: -11, y: 0 },
  ];
  for (const d of ridgeDefs) {
    const r = _buildMountainRidge(THREE, d);
    r.position.set(0, d.y, d.z);
    scene.add(r); ridges.push(r);
    disposables.push(r.userData.geo, r.userData.mat);
  }

  // Gradient sky dome behind the ridges (v0.2.613 — the "sky not loaded" fix).
  const sky = _buildSky(THREE);
  scene.add(sky);
  disposables.push(sky.userData.geo, sky.userData.mat);

  // Grass field ground (v0.2.616) — the foreground reads as green grass instead
  // of a flat brown band. Sits under the gate + chiefmonkey.
  const groundGeo = new THREE.CircleGeometry(120, 48);
  const groundMat = new THREE.MeshStandardMaterial({ color: GRASS_COL, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);
  disposables.push(groundGeo, groundMat);

  // Sea band (v0.2.616) — a teal water plane behind the gate, between the
  // mountains and the grass field, so the horizon reads sky → sun → mountains →
  // sea → grass. Slightly below the grass so the shoreline is clean.
  const sea = _buildSea(THREE);
  sea.position.set(0, -0.35, -16);
  scene.add(sea);
  disposables.push(sea.userData.geo, sea.userData.mat);

  // Instanced grass blades (v0.2.616) — texture on the foreground field.
  const grass = _buildGrass(THREE, 500);
  grass.position.set(0, -0.02, 0);
  scene.add(grass);
  disposables.push(grass.userData.geo, grass.userData.mat);

  // Track sun halo meshes for the breathing pulse + disposal.
  disposables.push(sun.userData.halo.userData.geo, sun.userData.halo.userData.mat,
                   sun.userData.glow.userData.geo, sun.userData.glow.userData.mat);

  // ── Gate + character (GLB, fail-safe) ──────────────────────────────────────
  let mixer = null;             // Chiefmonkey AnimationMixer (if loaded)
  let gateObj = null;
  let charObj = null;
  let alive = true;             // set false on unmount so late loads no-op

  // v0.2.611: GLB loading is NON-BLOCKING. The loader chunk import + both GLB
  // fetches run fire-and-forget AFTER the rAF loop starts below — previously
  // `await _loadGltfLoader()` sat between renderer creation and the first
  // rAF, so a slow/flaky chunk fetch left a mounted canvas that never rendered
  // (the "3D homescreen not loading" report). Now the procedural scene paints
  // immediately and the gate/character pop in whenever they arrive.
  // v0.2.613: "summoning the world…" loading badge — the user reported "no
  // details/graphics loading..." because the gate + character pop in silently.
  // A small bottom-left badge shows while GLBs are in flight, then fades.
  let loadingEl = null;
  let _loadingFade = -1; // frames left in the fade-out (-1 = not fading)
  let _assetsPending = 2; // gate + character
  try {
    loadingEl = doc.createElement('div');
    loadingEl.id = 'home-scene-loading';
    loadingEl.textContent = '⛩  SUMMONING THE WORLD…';
    Object.assign(loadingEl.style, {
      position: 'absolute', left: '18px', bottom: '16px', zIndex: '2',
      fontFamily: 'monospace', fontSize: '10px', letterSpacing: '2.5px',
      color: '#ffd9a8', textShadow: '0 0 10px rgba(255,150,60,0.55)',
      pointerEvents: 'none', opacity: '0.92', transition: 'opacity 0.9s ease',
    });
    container.appendChild(loadingEl);
  } catch { loadingEl = null; }
  const _assetReady = () => {
    _assetsPending -= 1;
    if (_assetsPending > 0) return;
    if (loadingEl) { loadingEl.style.opacity = '0'; _loadingFade = 60; }
  };

  let draco = null; // disposed on unmount
  const _loadGlbs = async () => {
    const GltfLoader = await _loadGltfLoader();
    if (!GltfLoader || !alive) { _assetReady(); _assetReady(); return; }
    const loader = new GltfLoader();
    const DracoLoader = await _loadDracoLoader();
    if (!alive) return;
    if (DracoLoader) {
      draco = new DracoLoader();
      draco.setDecoderPath(assetUrl('/draco/')); // v0.2.369 pattern: base-aware vendored decoder
      loader.setDRACOLoader(draco);
    }

    // Torii GATEWAY EXPERIENCE gate — RIGHT side.
    loader.load(_assetPath('/torii-gateway-experience.glb'), gltf => {
      if (!alive) return;
      gateObj = gltf.scene;
      // Normalise scale to ~7 units tall, feet on the ground.
      const box = new THREE.Box3().setFromObject(gateObj);
      const size = new THREE.Vector3(); box.getSize(size);
      const s = size.y > 0 ? 7 / size.y : 1;
      gateObj.scale.setScalar(s);
      const box2 = new THREE.Box3().setFromObject(gateObj);
      gateObj.position.set(9.0, -box2.min.y, 2.0);
      gateObj.userData.baseX = 9.0; // parallax anchor (v0.2.616)
      // v0.2.615: operator measured the gate standing ~110° off-square on the
      // live build (it read edge-on). Square it to the camera: -0.35 + 1.92
      // ≈ +1.57 rad (90°) — the walk-through plane now faces the lens.
      gateObj.rotation.y = 1.57;
      gateObj.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
      _fixGlb(gateObj);
      scene.add(gateObj);
      _assetReady('gate');
    }, undefined, (e) => { console.warn('[home-scene] gate load failed:', e && e.message || e); _assetReady('gate'); });

    // Chiefmonkey greeter — LEFT, CLOSE to the camera (v0.2.613). The user
    // asked for the Idle_02 animation, which lives in the PLAYER model file
    // (models/animation-library.glb — the chiefmonkey mesh with the 18 library
    // clips baked on), NOT in chiefmonkey6.glb (its only numbered idle is the
    // arms-out weapon stance Idle_03). This file is already title-screen
    // preloaded (main.js PRELOAD_ASSETS), so it pops in fast. Scale 1.0 like
    // the arena (metre-scale rig); framed waist-up by the camera, so the legs
    // crop below the frame — no special culling needed.
    loader.load(_assetPath('/models/animation-library.glb'), gltf => {
      if (!alive) return;
      charObj = gltf.scene;
      // v0.2.614: closer to the camera so he FILLS the frame — feet stay ON
      // the ground (no sinking); the legs scroll off the bottom of the
      // viewport naturally because he's big + near (operator feedback: "I did
      // not mean cut them off — bring him up close so the bottom half is off
      // screen").
      const CHAR_SCALE = 1.0;
      charObj.scale.setScalar(CHAR_SCALE);
      charObj.userData.baseX = CHAR_BASE_X;

      // Z-up fix (mirrors playerModel.js): the library GLB is authored Z-up —
      // detect by axis span and stand the rig up with quaternions (Euler XYZ
      // would rotate around the wrong axis and flip him back down).
      let gMinY = Infinity, gMaxY = -Infinity, gMinZ = Infinity, gMaxZ = -Infinity;
      charObj.traverse(o => {
        if (o.isMesh && o.geometry) {
          o.geometry.computeBoundingBox();
          const b = o.geometry.boundingBox;
          if (b) {
            gMinY = Math.min(gMinY, b.min.y); gMaxY = Math.max(gMaxY, b.max.y);
            gMinZ = Math.min(gMinZ, b.min.z); gMaxZ = Math.max(gMaxZ, b.max.z);
          }
        }
      });
      const isZUp = (gMaxZ - gMinZ) > (gMaxY - gMinY) * 1.2;
      if (isZUp) gMinY = -gMaxZ; // after +90° X the old +Z span becomes -Y
      const footLift = Number.isFinite(gMinY) ? -gMinY : 0;

      // v0.2.616: LOWER in the frame + a little CLOSER to the lens (operator:
      // "lower chiefmonkey a bit more and bring him a little closer"). The lift
      // is reduced (+0.75 → +0.3) so he sits lower, and z moves 24.5 → 25.3
      // (~0.7m from the eye-height camera) so he fills the frame waist-up.
      charObj.position.set(CHAR_BASE_X, footLift * CHAR_SCALE + 0.3, 25.3);
      if (isZUp) {
        const standUp = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
        // π+0.35 faced him AWAY (operator screenshot); ~0 faces the lens.
        const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.10);
        charObj.quaternion.copy(face).multiply(standUp);
      } else {
        charObj.rotation.y = 0.10; // face the camera
      }
      charObj.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
      _fixGlb(charObj);
      scene.add(charObj);

      // Idle_02 — the player's own idle clip (calm standing breathe).
      const clips = gltf.animations || [];
      const byName = {};
      clips.forEach(c => { byName[c.name] = c; });
      const idle = byName['Idle_02'] || byName['Idle_03'] || byName['Idle']
        || clips.find(c => /idle/i.test(c.name || '')) || null;
      if (idle) {
        mixer = new THREE.AnimationMixer(charObj);
        const action = mixer.clipAction(idle);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
        // Tick once so the first painted frame is already out of bind pose.
        mixer.update(0.016);
      }
      _assetReady('character');
    }, undefined, (e) => { console.warn('[home-scene] chiefmonkey load failed:', e && e.message || e); _assetReady('character'); });
  };

  // Size to the container now (ResizeObserver fires once on observe too, but
  // set an explicit baseline so the first frame isn't 300x150).
  _resize(renderer, camera, container);
  const ro = new ResizeObserver(() => _resize(renderer, camera, container));
  ro.observe(container);

  // ── Mouse parallax ─────────────────────────────────────────────────────────
  // Track the pointer in [-1,1]; ease the camera toward a small offset each
  // frame so the scene, gate, + character shift with perspective. Registered on
  // the document (the title content sits above the canvas) + removed on unmount.
  const mouse = { x: 0, y: 0 };
  const onMove = (e) => {
    const w = (typeof innerWidth === 'number' && innerWidth) || 1;
    const h = (typeof innerHeight === 'number' && innerHeight) || 1;
    mouse.x = ((e.clientX ?? 0) / w) * 2 - 1;
    mouse.y = -(((e.clientY ?? 0) / h) * 2 - 1);
  };
  try { doc.addEventListener('mousemove', onMove, { passive: true }); } catch { /* best-effort */ }

  let raf = 0;
  const nowFn = (typeof performance !== 'undefined' && performance.now)
    ? () => performance.now()
    : () => Date.now();
  let t0 = nowFn();

  const loop = () => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const t = nowFn();
    const dt = Math.min(0.05, (t - t0) / 1000); t0 = t;
    const a = t / 1000;

    // v0.2.616 parallax rework (operator: "too strong", "pivot between the gate
    // and chiefmonkey"): the camera drifts GENTLY, chiefmonkey nudges a LITTLE
    // (clamped so he never leaves the frame), the gate moves a touch (shifting
    // the apparent pivot forward between gate + character), and the background
    // (ridges + sun + sky) moves a little MORE. The sun travels side-to-side but
    // is clamped so it never leaves the screen.
    const k = Math.min(1, dt * 4);
    camera.position.x += (BASE_CAM.x + mouse.x * 0.6 - camera.position.x) * k;
    camera.position.y += (BASE_CAM.y + mouse.y * 0.35 - camera.position.y) * k;
    camera.lookAt(BASE_LOOK);
    if (charObj) {
      charObj.position.x = Math.max(-1.3, Math.min(0.2, charObj.userData.baseX + mouse.x * 0.1));
    }
    if (gateObj) gateObj.position.x = gateObj.userData.baseX + mouse.x * 0.18;
    for (let i = 0; i < ridges.length; i++) ridges[i].position.x = mouse.x * (i + 1) * 0.4;
    sun.position.x = Math.max(6, Math.min(22, 14 + mouse.x * 7));
    sky.rotation.y = mouse.x * 0.02;

    // Gentle sun halo breathing.
    const pulse = 0.5 + Math.sin(a * 0.7) * 0.5;
    if (sun.userData.halo) sun.userData.halo.userData.mat.opacity = 0.22 + pulse * 0.12;
    if (sun.userData.glow) sun.userData.glow.userData.mat.opacity = 0.10 + pulse * 0.08;

    // Animate the sea swell (v0.2.616) — a single time uniform, no timers.
    if (sea.userData.mat && sea.userData.mat.uniforms) sea.userData.mat.uniforms.uTime.value = a;

    // Debug handle: lets headless probes + the operator verify scene state
    // (character position, camera, clip) from the console without touching
    // the game. Read-only; tiny.
    if (!window.__toriiHomeScene) {
      window.__toriiHomeScene = { camera, charRef: () => charObj, gateRef: () => gateObj, scene };
    }

    // Fade-out + removal of the loading badge, counted in rAF frames (no
    // timers — the regression-gate bans setTimeout here).
    if (_loadingFade > 0) {
      _loadingFade -= 1;
      if (_loadingFade === 0 && loadingEl) {
        try { if (loadingEl.parentNode === container) container.removeChild(loadingEl); } catch { /* best-effort */ }
        loadingEl = null;
      }
    }

    // Advance Chiefmonkey's idle animation.
    if (mixer) mixer.update(dt);

    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  // Kick the GLB loads now that the loop is running (never awaited).
  _loadGlbs();

  return {
    unmount() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      try { doc.removeEventListener('mousemove', onMove); } catch { /* best-effort */ }
      try { ro.disconnect(); } catch { /* best-effort */ }
      try { if (mixer) { mixer.stopAllAction(); mixer = null; } } catch { /* best-effort */ }
      try { if (draco) { draco.dispose(); draco = null; } } catch { /* best-effort */ }
      try { if (loadingEl && loadingEl.parentNode === container) container.removeChild(loadingEl); } catch { /* best-effort */ }
      loadingEl = null;
      // Dispose GLB geometries/materials.
      for (const root of [gateObj, charObj]) {
        if (!root) continue;
        try {
          root.traverse(o => {
            if (o.isMesh) {
              try { if (o.geometry) o.geometry.dispose(); } catch { /* best-effort */ }
              const mats = Array.isArray(o.material) ? o.material : [o.material];
              for (const m of mats) {
                if (!m) continue;
                try { if (m.map) m.map.dispose(); } catch { /* best-effort */ }
                try { m.dispose(); } catch { /* best-effort */ }
              }
            }
          });
        } catch { /* best-effort */ }
      }
      try { renderer.dispose(); } catch { /* best-effort */ }
      for (const d of disposables) {
        try { if (d && typeof d.dispose === 'function') d.dispose(); } catch { /* best-effort */ }
      }
      try { if (canvas.parentNode === container) container.removeChild(canvas); } catch { /* best-effort */ }
    },
  };
}

// _resize(renderer, camera, container) — size the renderer + camera to the
// container's client box. Never throws (a 0-size box just keeps the prior size).
function _resize(renderer, camera, container) {
  const w = container.clientWidth || 1;
  const h = container.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
