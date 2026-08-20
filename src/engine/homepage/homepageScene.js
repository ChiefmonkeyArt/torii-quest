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
const FOG_COL  = 0x4a2c12;   // warm bronze haze (brightened so silhouettes read)
const AMBIENT  = 0x8a6a4a;   // warm ambient lift
const KEY_COL  = 0xffb95c;   // golden key light
const RIDGE_COLS = [0x160b04, 0x201206, 0x2e1c0b]; // near → far mountain silhouettes

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
  scene.fog = new THREE.FogExp2(FOG_COL, 0.010);
  scene.background = new THREE.Color(FOG_COL);

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const BASE_CAM = new THREE.Vector3(0, 5.4, 26);
  const BASE_LOOK = new THREE.Vector3(0, 3.6, 0);
  camera.position.copy(BASE_CAM);
  camera.lookAt(BASE_LOOK);

  // Lights: a warm ambient lift + a golden key from the sun's direction + a
  // soft fill so the gate/character read against the bright horizon.
  // v0.2.611: the GLBs arrive nearly black (no texture; MeshStandardMaterial
  // with weak default UVs) — raise ambient + fill + key and push an emissive
  // lift onto the loaded meshes so the gate/character actually read.
  scene.add(new THREE.AmbientLight(AMBIENT, 1.4));
  const key = new THREE.DirectionalLight(KEY_COL, 1.5); key.position.set(4, 8, -6); scene.add(key);
  const fill = new THREE.PointLight(0xffc9a0, 90, 90, 1.6); fill.position.set(0, 6, 12); scene.add(fill);
  const rim = new THREE.PointLight(0xff9a4a, 50, 70, 1.7); rim.position.set(-6, 5, -8); scene.add(rim);

  // _liftGlb(root) — emissive lift so untextured/dark GLB materials read against
  // the sunrise. Best-effort, per-material.
  const _liftGlb = (root) => {
    root.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        try {
          if (m.emissive && typeof m.emissive.setHex === 'function') {
            m.emissive.setHex(0x6a4526);
            m.emissiveIntensity = 1.0;
          }
        } catch { /* best-effort */ }
      }
    });
  };

  // Sun low on the horizon on the RIGHT, just behind/above the gate — clear of
  // the centre console card (the old x=3.5 projected directly behind it, so the
  // one bright focal point was hidden by the UI).
  const sun = _buildSun(THREE); sun.position.set(16.5, 8.5, -50); scene.add(sun);

  // Mountain ridges layered near → far for depth + fog falloff.
  const disposables = [];
  const ridges = [];
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

  // Misty warm ground plain so the horizon glows into the fog.
  const groundGeo = new THREE.CircleGeometry(120, 48);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x2a180b, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);
  disposables.push(groundGeo, groundMat);

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
  let draco = null; // disposed on unmount
  const _loadGlbs = async () => {
    const GltfLoader = await _loadGltfLoader();
    if (!GltfLoader || !alive) return;
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
      gateObj.rotation.y = -0.35; // face slightly toward centre/camera
      gateObj.traverse(o => { if (o.isMesh) { o.castShadow = false; } });
      _liftGlb(gateObj);
      scene.add(gateObj);
    }, undefined, (e) => { console.warn('[home-scene] gate load failed:', e && e.message || e); });

    // Chiefmonkey rested idle — LEFT side.
    loader.load(_assetPath('/chiefmonkey6.glb'), gltf => {
      if (!alive) return;
      charObj = gltf.scene;
      // v0.2.611: use the ARENA's scale, not box-normalisation. The GLB carries
      // a 0.01 armature node scale; Box3 measures the ~170-unit bind-pose
      // geometry, so the old `4.6/size.y` scalar multiplied it down to ~4.6 cm
      // — an invisible speck. The arena loads the same file at 1.0 (≈1.7 m).
      // ~2.0× reads as a clear foreground figure without dwarfing the gate.
      charObj.scale.setScalar(2.0);
      charObj.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(charObj);
      charObj.position.set(-7.5, -box2.min.y, 4.0);
      charObj.rotation.y = 0.35; // face the camera/center
      charObj.traverse(o => { if (o.isMesh) { o.frustumCulled = false; } });
      _liftGlb(charObj);
      scene.add(charObj);

      // Rested idle: prefer a calm idle clip, loop it.
      const clips = gltf.animations || [];
      const byName = {};
      clips.forEach(c => { byName[c.name] = c; });
      // v0.2.611: relaxed/standing first — 'idle_to_push_up' is a floor
      // exercise and 'Idle_03' is an arms-out weapon-idle stance, both of
      // which read broken on a greeter. Walking reads as strolling-in-place.
      const idle = byName['Stylish_Walk_inplace'] || byName['Walking']
        || byName['Idle_03'] || byName['Idle_11'] || byName['Idle']
        || clips.find(c => /idle|walk/i.test(c.name || '')) || null;
      if (idle) {
        mixer = new THREE.AnimationMixer(charObj);
        const action = mixer.clipAction(idle);
        action.setLoop(THREE.LoopRepeat, Infinity);
        action.play();
      }
    }, undefined, (e) => { console.warn('[home-scene] chiefmonkey load failed:', e && e.message || e); });
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

    // Parallax: ease the camera toward the pointer offset (lerp ~ smooth).
    const k = Math.min(1, dt * 4);
    camera.position.x += (BASE_CAM.x + mouse.x * 2.6 - camera.position.x) * k;
    camera.position.y += (BASE_CAM.y + mouse.y * 1.4 - camera.position.y) * k;
    camera.lookAt(BASE_LOOK);

    // Gentle sun halo breathing.
    const pulse = 0.5 + Math.sin(a * 0.7) * 0.5;
    if (sun.userData.halo) sun.userData.halo.userData.mat.opacity = 0.22 + pulse * 0.12;
    if (sun.userData.glow) sun.userData.glow.userData.mat.opacity = 0.10 + pulse * 0.08;

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
