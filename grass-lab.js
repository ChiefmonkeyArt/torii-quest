// grass-lab.js — isolated showcase of the v0.2.265 grass blade.
// Same geometry + shader as src/arena-foliage.js::_buildGrass, but standing
// alone (no arena deps) so the blade curve/thinning can be inspected before
// integration. Auto-orbiting low camera + dense field + nice lighting.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// ── Blade constants (mirror arena-foliage.js _buildGrass) ─────────────────────
const BLADE_SEGS = 8;
const BLADE_H    = 0.46;
const BLADE_W    = 0.014;
const KEEL       = 0.008;
const FIELD      = 14;          // field is FIELD × FIELD units
const DENSITY    = 60;          // blades per unit²  → ~11.7k blades (dense mass, not discrete triangles)
const BLADES     = Math.floor(FIELD * FIELD * DENSITY);

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
  new THREE.MeshStandardMaterial({ color: 0x2c3a1c, roughness: 1.0 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -0.01;
scene.add(ground);

// ── Blade geometry: V-channel cross-section ──────────────────────────────────
// 3 verts per row (left, keel, right) + one tip vertex. Rows use t = row/SEGS
// (never reaching 1) so the top row keeps a non-zero width — this avoids the
// degenerate zero-area triangles that produced NaN normals / black tip speckles.
const VERTS_PER_BLADE = BLADE_SEGS * 3 + 1;
const positions = [], uvs = [], indices = [];
{
  const base = 0;
  for (let row = 0; row < BLADE_SEGS; row++) {
    const t = row / BLADE_SEGS;          // 0 .. (SEGS-1)/SEGS
    const y = t * BLADE_H;
    const hw   = BLADE_W * Math.pow(1.0 - t, 1.8);
    const keel = KEEL   * Math.pow(1.0 - t, 1.4);
    positions.push(-hw, y, 0,   0, y, keel,   hw, y, 0);
    uvs.push(0, t,  0.5, t,  1, t);
  }
  positions.push(0, BLADE_H, 0);          // tip vertex (sharp point)
  uvs.push(0.5, 1.0);
  for (let row = 0; row < BLADE_SEGS - 1; row++) {
    const l0 = base + row * 3, k0 = l0 + 1, r0 = l0 + 2;
    const l1 = l0 + 3, k1 = l0 + 4, r1 = l0 + 5;
    indices.push(l0, k0, k1,  l0, k1, l1);   // left face
    indices.push(k0, r0, r1,  k0, r1, k1);   // right face
  }
  // tip cap — two tris from the last row to the tip point
  const lr = base + (BLADE_SEGS - 1) * 3;
  const kr = lr + 1, rr = lr + 2;
  const tip = base + BLADE_SEGS * 3;
  indices.push(lr, kr, tip);
  indices.push(kr, rr, tip);
}
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2));
geo.setIndex(indices);
geo.computeVertexNormals();

// ── Shader: Bezier spine + twist + curl-noise patch wind (identical to arena) ─
const mat = new THREE.ShaderMaterial({
  uniforms: {
    uTime:    { value: 0.0 },
    uWindDir: { value: { x: 0.707, y: 0.707 } },
  },
  vertexShader: /* glsl */`
    varying float vT;
    varying float vTint;
    varying float vDiff;
    uniform float uTime;
    uniform vec2  uWindDir;
    void main() {
      float h = ${BLADE_H.toFixed(4)};
      float t = clamp(position.y / h, 0.0, 1.0);
      vT = t;
      vTint = instanceColor.b;

      vec3 p = position;

      // quadratic Bezier spine — forward curl along the keel (+Z). Stronger curl
      // base so blades visibly arch over rather than standing flat.
      float curl = 0.18 + instanceColor.g * 0.22;
      float bz   = 2.0 * (1.0 - t) * t * (curl * 0.55) + t * t * curl;
      p.z += bz;
      // graceful droop: tip falls slightly so the arch reads as a curve
      p.y -= 0.06 * t * t;

      // per-blade twist around the spine (Y)
      float twist = (fract(instanceColor.r * 7.31) - 0.5) * 1.3;
      float ang   = twist * t;
      float ca = cos(ang), sa = sin(ang);
      p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
      vec3 nrm = vec3(ca * normal.x - sa * normal.z, normal.y, sa * normal.x + ca * normal.z);

      // world-space patch-coherent wind
      vec3 wpos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
      float along = dot(wpos, vec3(uWindDir.x, 0.0, uWindDir.y));
      float front = sin(along * 0.30 - uTime * 1.6);
      float gust  = smoothstep(-0.15, 0.85, front);
      float cn = ( sin(wpos.x * 0.70 + uTime * 0.80 + instanceColor.r * 6.2832)
                + cos(wpos.z * 0.60 + uTime * 0.60 - instanceColor.r * 6.2832)
                + sin((wpos.x + wpos.z) * 0.35 + uTime * 1.10) ) / 3.0;
      float wind = 0.04 + gust * 0.22 + cn * 0.05;
      float sway = wind * t * t;

      vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
      wp.xyz += vec3(uWindDir.x * sway, 0.0, uWindDir.y * sway);
      wp.x  += cn * 0.03 * t;

      vec3 L = normalize(vec3(0.40, 0.85, 0.40));
      vDiff = 0.40 + 0.60 * max(0.0, dot(normalize(nrm), L));
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: /* glsl */`
    varying float vT;
    varying float vTint;
    varying float vDiff;
    void main() {
      vec3 rootCol = vec3(0.01, 0.14, 0.02);
      vec3 midCool = vec3(0.09, 0.48, 0.07);
      vec3 midWarm = vec3(0.22, 0.52, 0.05);
      vec3 tipCool = vec3(0.32, 0.92, 0.20);
      vec3 tipWarm = vec3(0.52, 0.88, 0.12);
      vec3 midCol  = mix(midCool, midWarm, vTint);
      vec3 tipCol  = mix(tipCool, tipWarm, vTint);
      vec3 col = vT < 0.5
        ? mix(rootCol, midCol, vT * 2.0)
        : mix(midCol,  tipCol, (vT - 0.5) * 2.0);
      float ao = smoothstep(0.0, 0.15, vT);
      gl_FragColor = vec4(col * (0.6 + 0.4 * ao) * vDiff, 1.0);
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
for (let i = 0; i < BLADES; i++) {
  // poisson-ish jitter on a grid for even but natural coverage
  const gx = (i % 128) / 128, gz = Math.floor(i / 128) / 128;
  const x = (gx - 0.5) * FIELD + (Math.random() - 0.5) * 0.45;
  const z = (gz - 0.5) * FIELD + (Math.random() - 0.5) * 0.45;
  _pos.set(x, 0, z);
  _quat.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
  _scl.setScalar(0.8 + Math.random() * 0.55);
  _m4.compose(_pos, _quat, _scl);
  mesh.setMatrixAt(i, _m4);
  mesh.instanceColor.setXYZ(i, Math.random(), Math.random(), Math.random());
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
