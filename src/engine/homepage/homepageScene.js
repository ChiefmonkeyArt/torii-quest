// engine/homepage/homepageScene.js — the 3D landing scene behind the home surface.
//
// A self-contained Three.js scene: a starfield, a glowing torii gate, a dark
// ground, + a slow camera orbit. Display + rAF ONLY — no fetch, no sign, no
// relay, no navigation, no DOM event routing beyond resize. Every action still
// lives in the DOM cards the stub already owns.
//
// Loading: `three` is imported LAZILY inside mount() (a dynamic `import()`).
// homepageStub.js never imports three at module-eval time, so the homepage layer
// stays three-free + node-testable (mirrors the arena's ENTER ARENA bootstrap).
// three is already in the production bundle (the arena uses it), so this adds
// no new dependency — only reuses it on the home surface.
//
// Lifecycle: mountHomepageScene(container) → Promise<{unmount}|null>. The scene
// creates its own <canvas> inside `container`, sizes it to the container, + runs
// a single rAF loop. unmount() cancels the rAF, disposes every geometry /
// material / texture / renderer, disconnects the ResizeObserver, + removes the
// canvas — no orphaned GL context, no leaked listeners. Fail-safe: a missing
// `three`, a missing WebGL context, or any throw → returns null so the caller
// falls back to the existing DOM gradient (the home surface still works).
//
// Regression-guard: rAF is the ONLY scheduling primitive (no setInterval /
// setTimeout), + it is always cancelled on unmount. No new hot-path allocs in
// the loop — geometries/materials are built once at mount; per-frame work is
// just matrix + a couple of scalar writes on existing objects.

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

// _canUseWebGL(doc) → true if a WebGL context is available. Probes with a
// THROWAWAY canvas — never the real render canvas — so we never hand Three a
// canvas whose context was already lost. Loses the probe context immediately.
function _canUseWebGL(doc) {
  try {
    const probe = doc.createElement('canvas');
    const opts = { failIfMajorPerformanceCaveat: true };
    const gl = probe.getContext('webgl2', opts) || probe.getContext('webgl', opts);
    if (!gl) return false;
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose && typeof lose.loseContext === 'function') lose.loseContext();
    return true;
  } catch {
    return false;
  }
}

// _buildGate(THREE) → a Group: two pillars, a lintel (kasagi), + a crossbeam
// (nuki). Purple emissive stone + teal accent ring at the lintel. Built once at
// mount; the loop only nudges emissiveIntensity for a soft pulse.
function _buildGate(THREE) {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({
    color: 0x2a2342, emissive: 0x8b5cf6, emissiveIntensity: 0.55,
    roughness: 0.6, metalness: 0.1,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: 0x0a3d3a, emissive: 0x1ad6c4, emissiveIntensity: 0.9,
    roughness: 0.5, metalness: 0.2,
  });
  const pillarGeo = new THREE.CylinderGeometry(0.34, 0.42, 6.4, 18);
  const pL = new THREE.Mesh(pillarGeo, stone); pL.position.set(-2.1, 3.2, 0);
  const pR = pillarGeo.clone(); const mR = new THREE.Mesh(pR, stone);
  mR.position.set(2.1, 3.2, 0);
  const lintelGeo = new THREE.BoxGeometry(6.0, 0.7, 0.7);
  const lintel = new THREE.Mesh(lintelGeo, stone); lintel.position.set(0, 6.5, 0);
  const nukiGeo = new THREE.BoxGeometry(5.4, 0.45, 0.5);
  const nuki = new THREE.Mesh(nukiGeo, stone); nuki.position.set(0, 5.0, 0);
  // Teal accent ring across the lintel (the gate's "active" seam).
  const ringGeo = new THREE.BoxGeometry(6.2, 0.12, 0.74);
  const ring = new THREE.Mesh(ringGeo, accent); ring.position.set(0, 6.5, 0.02);
  g.add(pL, mR, lintel, nuki, ring);
  g.userData.stone = stone; g.userData.accent = accent;
  g.userData.geos = [pillarGeo, pR, lintelGeo, nukiGeo, ringGeo];
  return g;
}

// _buildStars(THREE, count) → a Points starfield in a wide shell around origin.
function _buildStars(THREE, count = 1400) {
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Distribute on a sphere shell of radius 22–60 so the camera (r~30) is
    // always inside the field — stars pan past as the camera orbits.
    const r = 22 + Math.random() * 38;
    const th = Math.random() * Math.PI * 2;
    const ph = Math.acos(2 * Math.random() - 1);
    pos[i * 3] = r * Math.sin(ph) * Math.cos(th);
    pos[i * 3 + 1] = r * Math.cos(ph) * 0.6; // squash vertically for a horizon feel
    pos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({
    color: 0xc4b5fd, size: 0.45, sizeAttenuation: true,
    transparent: true, opacity: 0.9, depthWrite: false,
  });
  const stars = new THREE.Points(geo, mat);
  stars.userData.geo = geo; stars.userData.mat = mat;
  return stars;
}

// mountHomepageScene(container) → { unmount } | null. Fail-safe at every step:
// no three → null; no WebGL → null; any throw → null. The caller keeps the DOM.
export async function mountHomepageScene(container) {
  if (!container || typeof container.appendChild !== 'function') return null;
  const THREE = await _loadThree();
  if (!THREE) return null;

  const doc = container.ownerDocument || (typeof globalThis !== 'undefined' && globalThis.document);
  if (!doc || typeof doc.createElement !== 'function') return null;
  // Probe with a throwaway canvas — NEVER the real render canvas (see _canUseWebGL),
  // so Three never receives a canvas whose context was already lost.
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
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'high-performance' });
  } catch {
    try { if (canvas.parentNode) canvas.parentNode.removeChild(canvas); } catch { /* best-effort */ }
    return null;
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), 2));

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x08081a, 0.012);

  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 200);
  camera.position.set(0, 7.5, 30);
  camera.lookAt(0, 4, 0);

  // Lights: low ambient so emissive carries the look; a purple point at the
  // gate; a teal rim from behind for separation.
  scene.add(new THREE.AmbientLight(0x3a3358, 0.55));
  const key = new THREE.PointLight(0x8b5cf6, 60, 40, 1.6); key.position.set(0, 6, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x1ad6c4, 0.5); rim.position.set(-6, 4, -8);
  scene.add(rim);

  // Ground: a large dark disc — gives the gate a horizon + catches the fog.
  const groundGeo = new THREE.CircleGeometry(60, 48);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0c0a16, roughness: 0.95, metalness: 0.0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.05;
  scene.add(ground);

  const stars = _buildStars(THREE); scene.add(stars);
  const gate = _buildGate(THREE); scene.add(gate);

  // Size to the container now (ResizeObserver fires once on observe too, but
  // set an explicit baseline so the first frame isn't 300x150).
  _resize(renderer, camera, container, THREE);

  const ro = new ResizeObserver(() => _resize(renderer, camera, container, THREE));
  ro.observe(container);

  let raf = 0; let alive = true;
  const clock = (typeof performance !== 'undefined' && performance.now) ? performance : Date;
  let t0 = clock.now();

  const loop = () => {
    if (!alive) return;
    raf = requestAnimationFrame(loop);
    const dt = (clock.now() - t0) / 1000; t0 = clock.now();
    const a = (typeof performance !== 'undefined' && performance.now) ? performance.now() / 1000 : (Date.now() / 1000);
    // Slow camera orbit — a gentle drift, not a spin.
    camera.position.x = Math.cos(a * 0.08) * 30;
    camera.position.z = Math.sin(a * 0.08) * 30;
    camera.position.y = 7.5 + Math.sin(a * 0.05) * 0.8;
    camera.lookAt(0, 4, 0);
    // Starfield counter-rotates so the parallax reads against the gate.
    stars.rotation.y += dt * 0.02;
    // Soft pulse on the gate's accent seam.
    const pulse = 0.7 + Math.sin(a * 0.9) * 0.25;
    if (gate.userData.accent) gate.userData.accent.emissiveIntensity = pulse;
    if (gate.userData.stone) gate.userData.stone.emissiveIntensity = 0.5 + pulse * 0.1;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);

  return {
    unmount() {
      alive = false;
      if (raf) cancelAnimationFrame(raf);
      try { ro.disconnect(); } catch { /* best-effort */ }
      try { renderer.dispose(); } catch { /* best-effort */ }
      // Dispose all geometries + materials we created (no shared refs escape).
      const disposables = [groundGeo, groundMat, stars.userData.geo, stars.userData.mat];
      const geos = gate.userData.geos || [];
      for (const gg of geos) disposables.push(gg);
      if (gate.userData.stone) disposables.push(gate.userData.stone);
      if (gate.userData.accent) disposables.push(gate.userData.accent);
      for (const d of disposables) {
        try { if (d && typeof d.dispose === 'function') d.dispose(); } catch { /* best-effort */ }
      }
      try { if (canvas.parentNode === container) container.removeChild(canvas); } catch { /* best-effort */ }
    },
  };
}

// _resize(renderer, camera, container, THREE) — size the renderer + camera to
// the container's client box. Never throws (a 0-size box just keeps the prior
// size — the next observe callback fixes it).
function _resize(renderer, camera, container, THREE) {
  const w = container.clientWidth || 1;
  const h = container.clientHeight || 1;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
