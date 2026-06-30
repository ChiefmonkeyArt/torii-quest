// grass-lab.js — isolated showcase of the v0.2.267 grass blade.
// Same geometry + shader as src/arena-foliage.js::_buildGrass, but standing
// alone (no arena deps) so the blade shape + colour pipeline can be inspected
// before integration. PlaneGeometry + CPU piecewise taper (threejsdemos.com demo)
// + organic multi-octave gust wind (retained from v0.2.266). Auto-orbiting low
// camera + dense field + nice lighting.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Blade constants (mirror arena-foliage.js _buildGrass) ─────────────────────
const BLADE_SEGS = 8;    // v0.2.267: demo default (8 height divisions, 9 rows)
const BLADE_H    = 0.30; // shorter + more upright
const BLADE_W    = 0.055;// v0.2.273: wider blade + flared base (hides floor)
const FIELD      = 14;          // field is FIELD × FIELD units
const BLADES     = 500000;       // v0.2.273: fill the gaps

// ── Renderer / scene / camera ────────────────────────────────────────────────
const canvas = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc4e8);
scene.fog = new THREE.Fog(0x9fc4e8, 22, 52);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(6.5, 1.35, 6.5);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0.35, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.2;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.495; // never go under the ground

// ── Lighting ──────────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(0xcfe5ff, 0x2a3a1a, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
sun.position.set(8, 14, 6);
scene.add(sun);

// ── Ground ────────────────────────────────────────────────────────────────────
const ground = new THREE.Mesh(
  new THREE.CircleGeometry(FIELD * 1.4, 64),
  new THREE.MeshStandardMaterial({ color: 0x96A78A, roughness: 1.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);

// ── Blade geometry: PlaneGeometry + CPU piecewise taper (v0.2.267, demo) ──────
// 2 columns × 9 rows. Translate so the base sits at y=0. Then a CPU pass applies
// the demo's piecewise taper (wide base → gradual middle → sharp tip) + a tiny
// forward curl, giving a natural blade silhouette instead of a flat rectangle.
const geo = new THREE.PlaneGeometry(BLADE_W, BLADE_H, 1, BLADE_SEGS);
geo.translate(0, BLADE_H / 2, 0);
{
  const posAttr = geo.attributes.position;
  const arr = posAttr.array;
  const vCount = arr.length / 3;
  for (let i = 0; i < vCount; i++) {
    const ix = i * 3;
    const x = arr[ix];
    const y = arr[ix + 1];
    const hr = y / BLADE_H;
    let taper;
    if (hr < 0.15)     taper = 5.6 - (hr / 0.15) * 4.6;   // v0.2.274: flared base 4×
    else if (hr < 0.3) taper = 1.0;
    else if (hr < 0.7) taper = 1.0 - (hr - 0.3) * 1.5;
    else               taper = 0.4 - (hr - 0.7) * 1.3;
    taper = Math.max(0.05, taper);
    arr[ix] = x * taper;
    arr[ix + 2] += hr * hr * 0.22;   // v0.2.272: stronger forward lean (hides floor)
  }
  posAttr.needsUpdate = true;
}
geo.computeVertexNormals();

// ── Shader: organic gust wind + demo colour pipeline (identical to arena) ─────
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:    { value: 0.0 },
    uWindDir: { value: { x: 0.707, y: 0.707 } },
  },
  vertexShader: /* glsl */`
    varying float vT;
    varying float vBright;
    varying float vHue;
    varying vec3  vWn;
    uniform float uTime;
    uniform vec2  uWindDir;
    void main() {
      float h = ${BLADE_H.toFixed(4)};
      float t = clamp(position.y / h, 0.0, 1.0);
      vT = t;
      vBright = instanceColor.g;
      vHue = instanceColor.b;

      vec3 p = position;

      vec3 wpos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float ph = instanceColor.r * 6.2832;

      // ORGANIC WIND (v0.2.266): multi-octave gust envelope, per-blade phase-shifted,
      // so neighbouring blades desync and patches rise independently.
      float g1 = sin(wpos.x * 0.21 + uTime * 0.70 + ph);
      float g2 = sin(wpos.z * 0.17 - uTime * 0.50 + ph * 1.7);
      float g3 = sin((wpos.x + wpos.z) * 0.11 + uTime * 0.30 + ph * 0.6);
      float gust = (g1 * 0.5 + g2 * 0.3 + g3 * 0.2) * 0.5 + 0.5;
      gust = smoothstep(0.25, 0.95, gust);
      float flut = sin(wpos.x * 1.30 + wpos.z * 0.70 + uTime * 2.20 + ph * 3.1)
                 + cos(wpos.z * 1.10 - wpos.x * 0.50 + uTime * 1.70 - ph * 2.3);

      float heightPower = t * t;
      float amp = 0.6 + vBright * 0.4;
      // v0.2.272: gustier — heavy gust coefficient; wind-bend also flops blades over.
      float wind = 0.030 + gust * 0.34 + flut * 0.016;
      float sway = wind * heightPower * amp;

      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      wp.xyz += vec3(uWindDir.x * sway, 0.0, uWindDir.y * sway);
      wp.x += (-uWindDir.y) * flut * 0.016 * t;
      wp.z += ( uWindDir.x) * flut * 0.016 * t;

      // vertical compression on bend (demo physics)
      float totalBend = abs(sway) + abs(flut * 0.016 * t);
      wp.y *= (1.0 - totalBend * 0.1 * heightPower);

      vWn = mat3(modelMatrix * instanceMatrix) * normal;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    varying float vT;
    varying float vBright;
    varying float vHue;
    varying vec3  vWn;

    vec3 hsv2rgb(vec3 c) {
      vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
      vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
      return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }
    vec3 rgb2hsv(vec3 c) {
      vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
      vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
      vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
      float d = q.x - min(q.w, q.y);
      float e = 1.0e-10;
      return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
    }

    void main() {
      // 4-stage colour gradient (demo): dark root -> base -> mid -> tip.
      vec3 rootCol = vec3(0.08, 0.22, 0.06);
      vec3 baseCol = vec3(0.12, 0.35, 0.08);
      vec3 midCol  = vec3(0.18, 0.55, 0.12);
      vec3 tipCol  = vec3(0.25, 0.65, 0.15);

      float bright = 0.8 + vBright * 0.4;
      rootCol *= bright; baseCol *= bright; midCol *= bright; tipCol *= bright;

      vec3 col;
      if (vT < 0.2)      col = mix(rootCol, baseCol, vT * 5.0);
      else if (vT < 0.7) col = mix(baseCol, midCol,  (vT - 0.2) * 2.0);
      else               col = mix(midCol,  tipCol,  (vT - 0.7) * 3.33);

      vec3 hsv = rgb2hsv(col);
      hsv.x += (vHue - 0.5) * 0.1;
      hsv.x = fract(hsv.x);
      hsv.y *= (0.85 + vBright * 0.3);
      col = hsv2rgb(hsv);

      vec3 wn = normalize(vWn);
      if (!gl_FrontFacing) wn = -wn;
      vec3 L = normalize(vec3(1.0, 1.0, 0.5));
      float NdotL = dot(wn, L);
      float light = NdotL * 0.6 + 0.4;
      light += max(0.0, -NdotL) * 0.3;
      col *= light;

      float noise = fract(sin(gl_FragCoord.x * 12.9898 + gl_FragCoord.y * 78.233) * 43758.5453);
      col *= (0.95 + noise * 0.1);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
  side: THREE.DoubleSide,
});

// ── Instanced field ───────────────────────────────────────────────────────────
const mesh = new THREE.InstancedMesh(geo, mat, BLADES);
mesh.instanceColor = new THREE.BufferAttribute(new Float32Array(BLADES * 3), 3);

const _pos = new THREE.Vector3(), _quat = new THREE.Quaternion(), _scl = new THREE.Vector3(), _m4 = new THREE.Matrix4();
const _up = new THREE.Vector3(0, 1, 0);
const HALF = FIELD / 2;
// v0.2.272: grid spacing derived from the exact blade count so the field fills
// evenly at BLADES blades over FIELD×FIELD (then the loop stops at BLADES).
const LAB_SPACING = Math.sqrt((FIELD * FIELD) / BLADES);
let i = 0;
// uniform grid + jitter scaled to spacing — even ground coverage, no clumps.
// instanceColor = (phase, brightness, hueShift) — read by the shaders.
for (let x = -HALF; x <= HALF; x += LAB_SPACING) {
  for (let z = -HALF; z <= HALF; z += LAB_SPACING) {
    if (i >= BLADES) break;
    const jx = x + (Math.random() - 0.5) * LAB_SPACING * 0.7;
    const jz = z + (Math.random() - 0.5) * LAB_SPACING * 0.7;
    _pos.set(jx, 0, jz);
    _quat.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
    _scl.setScalar(0.85 + Math.random() * 0.35);
    _m4.compose(_pos, _quat, _scl);
    mesh.setMatrixAt(i, _m4);
    mesh.instanceColor.setXYZ(i, Math.random(), Math.random(), Math.random());
    i++;
  }
}
mesh.instanceMatrix.needsUpdate = true;
mesh.instanceColor.needsUpdate = true;
mesh.computeBoundingSphere();
scene.add(mesh);

// ── Resize ────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ── Auto-orbit + render loop ──────────────────────────────────────────────────
let auto = true;
canvas.addEventListener('pointerdown', () => { auto = false; });

const clock = new THREE.Clock();
function tick() {
  const dt = clock.getDelta();
  mat.uniforms.uTime.value += dt;
  if (auto) {
    const t = clock.elapsedTime * 0.18;
    const r = 8.5;
    camera.position.x = Math.cos(t) * r;
    camera.position.z = Math.sin(t) * r;
    camera.position.y = 1.25 + Math.sin(t * 0.7) * 0.25;
    controls.target.set(0, 0.35, 0);
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// Debug exposure for headless inspection / screenshot angles.
window.__lab = { THREE, renderer, scene, camera, controls, mesh, mat, setAuto: (v)=>{auto=v;} };
