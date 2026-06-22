// atmosphere.js — Torii Quest atmospheric layer.
// Mountains, instanced tree billboards, drifting ground mist, birds.
// All pure geometry — zero textures, zero extra file downloads.
// Exported: initAtmosphere(), tickAtmosphere(dt)
import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA_HALF } from './config.js';

// ── Scratch / shared ──────────────────────────────────────────────────────────
const _dummy = new THREE.Object3D();

// ── 1. Distant mountain range ─────────────────────────────────────────────────
// Low-poly silhouette: two rings of peaks behind each wall.
// Uses BufferGeometry triangle fan — one draw call, no texture, vertex colours.
function _buildMountains() {
  const RANGES = [
    { axis: 'z', sign:  1, baseX:  0, baseZ:  80, spread: 180 }, // north
    { axis: 'z', sign: -1, baseX:  0, baseZ: -80, spread: 180 }, // south
    { axis: 'x', sign:  1, baseX:  80, baseZ:  0, spread: 180 }, // east (behind torii)
    { axis: 'x', sign: -1, baseX: -80, baseZ:  0, spread: 180 }, // west
  ];

  const colFar  = new THREE.Color(0x7ab8d4); // hazy blue-grey distant
  const colMid  = new THREE.Color(0x5a9e88); // forested mid-green
  const colSnow = new THREE.Color(0xeef5f7); // snow cap

  RANGES.forEach(({ baseX, baseZ, spread }) => {
    const PEAKS = 9;
    const verts = [];
    const colors = [];

    for (let i = 0; i < PEAKS; i++) {
      const t = (i / (PEAKS - 1)) - 0.5; // -0.5 to 0.5
      const px = baseX + (baseZ === 0 ? 0 : t * spread);
      const pz = baseZ + (baseX === 0 ? 0 : t * spread);
      // vary height and depth slightly per peak
      const h  = 35 + Math.sin(i * 2.3) * 18 + Math.cos(i * 1.1) * 10;
      const nudgeX = baseZ !== 0 ? (Math.sin(i * 1.7) * 12) : 0;
      const nudgeZ = baseX !== 0 ? (Math.sin(i * 1.7) * 12) : 0;
      const bx = px + nudgeX;
      const bz = pz + nudgeZ;

      // Each peak: base-left, apex, base-right triangle
      const halfW = 24 + Math.cos(i * 0.9) * 8;

      if (i > 0) {
        // share base verts with neighbours for connected silhouette
        const prevPx = baseX + (baseZ === 0 ? 0 : ((i-1)/(PEAKS-1)-0.5) * spread);
        const prevPz = baseZ + (baseX === 0 ? 0 : ((i-1)/(PEAKS-1)-0.5) * spread);
        const ph = 35 + Math.sin((i-1)*2.3)*18 + Math.cos((i-1)*1.1)*10;
        // fill valley between peaks
        verts.push(
          prevPx, 0, prevPz,
          bx,     0, bz,
          prevPx, ph*0.4, prevPz,
          bx,     0, bz,
          bx,     ph*0.4, bz,
          prevPx, ph*0.4, prevPz,
        );
        for (let v = 0; v < 6; v++) {
          colors.push(colMid.r, colMid.g, colMid.b);
        }
      }

      // Main peak triangle
      verts.push(
        bx - halfW, 0,   bz,
        bx,         h,   bz,
        bx + halfW, 0,   bz,
      );
      colors.push(colFar.r, colFar.g, colFar.b);
      colors.push(colFar.r, colFar.g, colFar.b);
      colors.push(colFar.r, colFar.g, colFar.b);

      // Snow cap (top 25% of peak)
      const snowY = h * 0.72;
      const snowW = halfW * 0.28;
      verts.push(
        bx - snowW, snowY, bz,
        bx,         h,     bz,
        bx + snowW, snowY, bz,
      );
      colors.push(colSnow.r, colSnow.g, colSnow.b);
      colors.push(colSnow.r, colSnow.g, colSnow.b);
      colors.push(colSnow.r, colSnow.g, colSnow.b);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts,  3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      fog: true,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
  });
}

// ── 2. Instanced tree billboards ──────────────────────────────────────────────
// Each tree = 2 crossed PlaneGeometry quads. Single InstancedMesh, one draw call.
// Placed in a ring just outside the arena walls and in clusters inside.
const _TREE_COUNT = 60;
let _treeMesh = null;

function _buildTrees() {
  // Billboard geometry: 2 crossed planes
  const W = 2.8, H = 5.0;
  const geo = new THREE.BufferGeometry();
  const verts = new Float32Array([
    // Plane 1 (X-axis)
    -W/2, 0,  0,
     W/2, 0,  0,
     W/2, H,  0,
    -W/2, H,  0,
    // Plane 2 (Z-axis)
     0, 0, -W/2,
     0, 0,  W/2,
     0, H,  W/2,
     0, H, -W/2,
  ]);
  const uvs = new Float32Array([
    0,0, 1,0, 1,1, 0,1,
    0,0, 1,0, 1,1, 0,1,
  ]);
  const idx = [0,1,2, 0,2,3, 4,5,6, 4,6,7];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('uv',       new THREE.Float32BufferAttribute(uvs,   2));
  geo.setIndex(idx);

  // Vertex-colour the canopy with procedural greens
  const colCount = verts.length / 3;
  const cols = new Float32Array(colCount * 3);
  const palette = [
    [0.15, 0.45, 0.20], // deep forest green
    [0.20, 0.55, 0.25], // mid green
    [0.30, 0.60, 0.18], // bright spring
    [0.10, 0.38, 0.15], // dark pine
  ];
  for (let v = 0; v < colCount; v++) {
    const p = palette[v % palette.length];
    // trunk: bottom 2 verts darker
    const isTrunk = (v % 4) < 2;
    const factor  = isTrunk ? 0.35 : 1.0;
    cols[v*3]   = p[0] * factor;
    cols[v*3+1] = p[1] * factor;
    cols[v*3+2] = p[2] * factor;
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));

  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    alphaTest: 0.1,
    fog: true,
  });

  _treeMesh = new THREE.InstancedMesh(geo, mat, _TREE_COUNT);
  _treeMesh.frustumCulled = false;

  // Place trees: ring OUTSIDE arena walls only — never inside the playfield
  const WALL_CLEAR = ARENA_HALF + 3; // minimum distance from centre (beyond walls)

  for (let i = 0; i < _TREE_COUNT; i++) {
    const angle = Math.random() * Math.PI * 2;
    const r = WALL_CLEAR + Math.random() * 28; // 3–31u outside the wall
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;

    const scale = 0.7 + Math.random() * 0.8;
    _dummy.position.set(x, 0, z);
    _dummy.scale.set(scale, scale + Math.random() * 0.4, scale);
    _dummy.rotation.y = Math.random() * Math.PI * 2;
    _dummy.updateMatrix();
    _treeMesh.setMatrixAt(i, _dummy.matrix);
  }
  _treeMesh.instanceMatrix.needsUpdate = true;
  scene.add(_treeMesh);
}

// ── 3. Ground mist planes ─────────────────────────────────────────────────────
// 24 large semi-transparent planes at y≈0, slow drift driven by uTime.
// Plus an arena-only swirl layer of smaller turquoise-tinted planes that
// hug the arena floor for the underlit-fog effect.
const _MIST_COUNT = 24;
const _ARENA_SWIRL_COUNT = 28;
const _mistMeshes = [];
const _arenaSwirls = []; // { mesh, baseX, baseZ, baseY, phase, ampX, ampZ, ... }
let   _mistUTime  = 0;

// Arena swirls — soft turquoise puffs hugging the arena floor. Each spins
// slowly and drifts in a small ellipse around its base position. Additive
// blending so they pile into a glowing low-mist haze where they overlap.
function _buildArenaSwirls() {
  const baseMat = new THREE.MeshBasicMaterial({
    color: 0x6ee9d8,
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    blending: THREE.AdditiveBlending,
  });

  for (let i = 0; i < _ARENA_SWIRL_COUNT; i++) {
    const w = 3.5 + Math.random() * 5.5;
    const d = 3.5 + Math.random() * 5.5;
    const geo = new THREE.PlaneGeometry(w, d);
    const m   = new THREE.Mesh(geo, baseMat.clone());
    m.material.opacity = 0.12 + Math.random() * 0.18;
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI * 2;
    const baseX = (Math.random() - 0.5) * (ARENA_HALF * 2 - 4);
    const baseZ = (Math.random() - 0.5) * (ARENA_HALF * 2 - 4);
    const y     = 0.15 + Math.random() * 0.45;
    m.position.set(baseX, y, baseZ);
    m.renderOrder = 2;
    scene.add(m);
    _arenaSwirls.push({
      mesh: m,
      baseX, baseZ, baseY: y,
      rotSpeed:  (Math.random() < 0.5 ? -1 : 1) * (0.10 + Math.random() * 0.25),
      phase:     Math.random() * Math.PI * 2,
      ampX:      0.6 + Math.random() * 1.2,
      ampZ:      0.6 + Math.random() * 1.2,
      bobAmp:    0.08 + Math.random() * 0.10,
      bobSpeed:  0.5 + Math.random() * 0.6,
    });
  }
}

function _buildMist() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd4eaf5,
    transparent: true,
    opacity: 0.07,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
  });

  for (let i = 0; i < _MIST_COUNT; i++) {
    const w = 18 + Math.random() * 22;
    const d = 10 + Math.random() * 14;
    const geo = new THREE.PlaneGeometry(w, d);
    const m   = new THREE.Mesh(geo, mat.clone());
    m.rotation.x = -Math.PI / 2;
    m.position.set(
      (Math.random() - 0.5) * ARENA_HALF * 2.5,
      0.05 + Math.random() * 0.3,
      (Math.random() - 0.5) * ARENA_HALF * 2.5,
    );
    m.userData.driftX     = (Math.random() - 0.5) * 0.4;
    m.userData.driftZ     = (Math.random() - 0.5) * 0.4;
    m.userData.driftPhase = Math.random() * Math.PI * 2;
    m.userData.driftAmp   = 0.5 + Math.random() * 1.0;
    m.renderOrder = 1;
    scene.add(m);
    _mistMeshes.push(m);
  }
}

// ── 4. Birds ──────────────────────────────────────────────────────────────────
// Tiny V-shaped Line objects tracing lazy arcs. Near-zero GPU cost.
const _BIRD_COUNT = 12;
const _birds = [];

function _buildBirds() {
  // Per-bird material so each can share the line but — critically — each bird
  // owns its own BufferGeometry so the wing-tip Y can be mutated independently
  // on the flap tick without disturbing the others.
  const mat = new THREE.LineBasicMaterial({ color: 0x1a1a2e, fog: false });
  for (let i = 0; i < _BIRD_COUNT; i++) {
    const geo = new THREE.BufferGeometry();
    // V shape: left-wing tip, body, right-wing tip. Wing tips will flap on Y.
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.6, 0.12, 0,
       0,   0,    0,
       0.6, 0.12, 0,
    ], 3));
    const line = new THREE.Line(geo, mat);
    const altitude = 18 + Math.random() * 22;
    const radius   = 30 + Math.random() * 50;
    const speed    = 0.10 + Math.random() * 0.15;
    const phase    = Math.random() * Math.PI * 2;
    const tilt     = (Math.random() - 0.5) * 0.15;
    // Brisk visible flap — ~2.2–3.7 Hz (was 0.6–1.2 Hz, barely readable at
    // distance). Independent per-bird phase so the flock doesn't beat in sync.
    const flapSpeed = 2.2 + Math.random() * 1.5;
    const flapPhase = Math.random() * Math.PI * 2;
    line.userData = { altitude, radius, speed, phase, tilt, flapSpeed, flapPhase };
    line.scale.setScalar(1.8 + Math.random() * 1.2);
    scene.add(line);
    _birds.push(line);
  }
}

// ── Tick — call every frame with dt ──────────────────────────────────────────
export function tickAtmosphere(dt) {
  _mistUTime += dt;

  // Drift mist planes
  for (const m of _mistMeshes) {
    const wave = Math.sin(_mistUTime * 0.18 + m.userData.driftPhase) * m.userData.driftAmp;
    m.position.x += m.userData.driftX * dt;
    m.position.z += m.userData.driftZ * dt;
    m.position.y  = 0.05 + wave * 0.08;
    // Wrap when they drift out of arena bounds
    if (Math.abs(m.position.x) > ARENA_HALF * 1.8) m.position.x *= -0.9;
    if (Math.abs(m.position.z) > ARENA_HALF * 1.8) m.position.z *= -0.9;
  }

  // Arena swirls — spin + small elliptical drift around their base position.
  // Stays inside the arena (base is sampled inside ARENA_HALF bounds, drift
  // amplitude is small) so it reads as in-arena underlit fog.
  for (const s of _arenaSwirls) {
    const t = _mistUTime;
    s.mesh.rotation.z += s.rotSpeed * dt;
    s.mesh.position.x = s.baseX + Math.cos(t * 0.4 + s.phase) * s.ampX;
    s.mesh.position.z = s.baseZ + Math.sin(t * 0.4 + s.phase) * s.ampZ;
    s.mesh.position.y = s.baseY + Math.sin(t * s.bobSpeed + s.phase) * s.bobAmp;
  }

  // Animate birds in slow arcs + lazy wing flap
  for (const b of _birds) {
    const { altitude, radius, speed, phase, tilt, flapSpeed, flapPhase } = b.userData;
    const t = _mistUTime * speed + phase;
    b.position.set(
      Math.cos(t) * radius,
      altitude + Math.sin(t * 1.3) * 2.5,
      Math.sin(t) * radius,
    );
    // Face direction of travel
    b.rotation.y = -t + Math.PI / 2;
    b.rotation.z = tilt + Math.sin(t * 2.1) * 0.06; // gentle body-roll

    // Wing flap — mutate the wing-tip Y on both ends of the V. Down-beat dips
    // tips below the body; up-beat raises them well above. Rest position is
    // y=0.12 so we oscillate around that with amplitude 0.6 (was 0.42) so the
    // flap reads even on small distant birds.
    const f      = Math.sin(_mistUTime * flapSpeed + flapPhase);
    const tipY   = 0.12 + f * 0.6;
    const pos    = b.geometry.attributes.position;
    const arr    = pos.array;
    arr[1] = tipY;   // left-wing tip Y  (vertex 0)
    arr[7] = tipY;   // right-wing tip Y (vertex 2)
    pos.needsUpdate = true;
  }
}

// ── Init — call once after scene is ready ─────────────────────────────────────
export function initAtmosphere() {
  _buildMountains();
  // _buildTrees(); // disabled — billboard crosses read as messy clutter, revisit with real GLB later
  _buildMist();
  _buildArenaSwirls(); // turquoise underlit floor swirls inside arena
  _buildBirds();
}
