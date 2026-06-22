// arena.js — floor, walls, crates, torii. Max 300 lines. Foliage in arena-foliage.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';
import { ARENA_HALF, WALL_H, CRATES, EAST_GAP_HALF } from './config.js';
import { buildFoliage } from './arena-foliage.js';

// ── Colours ───────────────────────────────────────────────────────────────────
const C_FLOOR  = 0x1a3210;
const C_WALL   = 0x1e3020;
const C_CRATE  = 0x4a4458;
const C_ORANGE = 0xf7931a;
const C_PURPLE = 0x8b5cf6;

// perf: shared fallback materials (overwritten by texture load for walls)
const _wallFallback = new THREE.MeshBasicMaterial({ color: C_WALL });
const crateMat      = new THREE.MeshStandardMaterial({ color: C_CRATE, roughness: 0.7 });
const floorMat      = new THREE.MeshStandardMaterial({ color: C_FLOOR, roughness: 0.95 });

export const wallMeshes = [];

// Wall span lookup — needed for texture tiling
const _wallSpans = [];

// module-level scratch for instanced loops — never allocate inside
const _up   = new THREE.Vector3(0, 1, 0);
const _pos  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl  = new THREE.Vector3();
const _m4   = new THREE.Matrix4();

export function buildArena() {
  _buildFloor();
  _buildGrid();
  _buildWalls();
  _buildCrates();
  _buildToriiGate();
  buildFoliage();      // grass + wildflowers — arena-foliage.js
  _loadWallTexture();  // async, deferred 1 rAF
}

// ── Floor ─────────────────────────────────────────────────────────────────────
function _buildFloor() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    floorMat
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Orange perimeter trim
  const trim = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(ARENA_HALF*2, 0.08, ARENA_HALF*2)),
    new THREE.LineBasicMaterial({ color: C_ORANGE })
  );
  trim.position.y = 0.04;
  scene.add(trim);
}

// ── Neon grid ─────────────────────────────────────────────────────────────────
function _buildGrid() {
  const grid = new THREE.GridHelper(ARENA_HALF * 2, 20, C_PURPLE, 0x1a1a2e);
  grid.position.y = 0.01;
  scene.add(grid);
}

// ── Walls ─────────────────────────────────────────────────────────────────────
function _buildWalls() {
  // [w, h, d, x, y, z, span]  — span = textured face width for UV tiling
  const A = ARENA_HALF * 2 + 0.5;
  // East wall is split in two so the torii gate can sit in a true opening.
  // Each segment runs from a corner to the gap edge along Z.
  const eastSegLen = ARENA_HALF - EAST_GAP_HALF + 0.25; // extends past corner
  const eastSegZ   = (EAST_GAP_HALF + ARENA_HALF) / 2;   // midpoint of segment
  const wallDefs = [
    [A,    WALL_H, 0.5,  0,          WALL_H/2, -ARENA_HALF, A],            // north
    [A,    WALL_H, 0.5,  0,          WALL_H/2,  ARENA_HALF, A],            // south
    [0.5,  WALL_H, A,   -ARENA_HALF, WALL_H/2,  0,          A],            // west
    [0.5,  WALL_H, eastSegLen,  ARENA_HALF, WALL_H/2, -eastSegZ, eastSegLen], // east-north
    [0.5,  WALL_H, eastSegLen,  ARENA_HALF, WALL_H/2,  eastSegZ, eastSegLen], // east-south
  ];

  const capMat    = new THREE.MeshBasicMaterial({ color: C_ORANGE });
  const pillarMat = new THREE.MeshStandardMaterial({
    color: C_PURPLE, emissive: 0x4a1d96, emissiveIntensity: 0.4
  });

  wallDefs.forEach(([w, h, d, x, y, z, span]) => {
    // Use array material so faces can be individually textured later
    const mats = Array(6).fill(_wallFallback);
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    wallMeshes.push(m);
    _wallSpans.push(span);

    // Orange cap
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w, 0.22, d + 0.1), capMat);
    cap.position.set(x, WALL_H + 0.11, z);
    scene.add(cap);
  });

  // Purple corner pillars
  [[-ARENA_HALF,-ARENA_HALF],[ARENA_HALF,-ARENA_HALF],
   [-ARENA_HALF, ARENA_HALF],[ARENA_HALF,  ARENA_HALF]]
  .forEach(([px, pz]) => {
    const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, WALL_H + 0.5, 0.8), pillarMat);
    p.position.set(px, (WALL_H + 0.5) / 2, pz);
    scene.add(p);
  });
}

// ── Crates ────────────────────────────────────────────────────────────────────
function _buildCrates() {
  CRATES.forEach(([cx, cz, hw, hd, ch]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, ch, hd * 2), crateMat);
    m.position.set(cx, ch / 2, cz);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    wallMeshes.push(m);
  });
}

// ── Torii gate — GLB model ───────────────────────────────────────────────────
function _buildToriiGate() {
  // Fallback procedural gate shown immediately; GLB replaces it on load
  const mat = new THREE.MeshStandardMaterial({
    color: C_PURPLE, emissive: 0x4a1d96, emissiveIntensity: 0.6, roughness: 0.4
  });
  const fallback = new THREE.Group();
  const lp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), mat);
  lp.position.set(0, 2.5, -3); fallback.add(lp);
  const rp = lp.clone(); rp.position.set(0, 2.5, 3); fallback.add(rp);
  const cb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 6.5), mat);
  cb.position.set(0, 5.2, 0); fallback.add(cb);
  fallback.position.set(ARENA_HALF, 0, 0);
  fallback.rotation.y = Math.PI / 2; // match GLB — crossbar parallel to east wall
  scene.add(fallback);

  // Accent light — stays regardless of GLB
  const gl = new THREE.PointLight(C_PURPLE, 3, 10);
  gl.position.set(ARENA_HALF - 1, 4, 0); scene.add(gl);

  // Load GLB asynchronously — replaces fallback when ready
  const draco = new DRACOLoader();
  draco.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load('/torii-gate.glb', gltf => {
    scene.remove(fallback);
    const gate = gltf.scene;

    // Scale to fit wall height — gate should span WALL_H tall
    const box = new THREE.Box3().setFromObject(gate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = WALL_H * 1.1; // slightly taller than wall
    const s = targetH / (size.y || 1);
    gate.scale.setScalar(s);

    // Centre at east wall gate position, feet on floor.
    // Rotated 90° off the original perpendicular orientation so the gate's
    // crossbar runs north–south, parallel to the east wall — players walk
    // through it along the X axis.
    box.setFromObject(gate);
    gate.position.set(ARENA_HALF - 0.2, -box.min.y, 0);
    gate.rotation.y = 0; // 90° from prior -π/2 — aligned with east wall

    gate.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    scene.add(gate);
    draco.dispose();
  }, undefined, err => {
    console.warn('[arena] torii-gate.glb failed, using fallback:', err);
    draco.dispose();
  });
}

// ── Wall texture — async, deferred 1 rAF ──────────────────────────────────────
// Texture is 1774×887 (2:1 aspect). We tile it so 1 tile = WALL_H tall, WALL_H*2 wide.
// RepeatX = wallSpan / (WALL_H * 2), RepeatY = 1 (full height exactly fills wall).
function _loadWallTexture() {
  requestAnimationFrame(() => {
    new THREE.TextureLoader().load('/wall-texture.webp', tex => {
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.needsUpdate = true;

      // Face indices for BoxGeometry: 0=+X, 1=-X, 2=+Y, 3=-Y, 4=+Z(front), 5=-Z(back)
      // North/South walls (Z-facing) — texture on faces 4 (+Z) and 5 (-Z)
      // East/West walls (X-facing)  — texture on faces 0 (+X) and 1 (-X)
      const faceGroups = [
        [4, 5],  // north wall
        [4, 5],  // south wall
        [0, 1],  // west wall
        [0, 1],  // east-north segment
        [0, 1],  // east-south segment
      ];

      wallMeshes.slice(0, 5).forEach((mesh, i) => {
        const span  = _wallSpans[i];
        // RepeatX: how many tiles wide. Texture aspect is 2:1 so tile width = WALL_H*2
        const repsX = span / (WALL_H * 2);
        // RepeatY = 1.0 — texture fills exact wall height, no squish/stretch
        faceGroups[i].forEach((fi, side) => {
          const t = tex.clone();
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          // Flip UV on back face to avoid mirrored seam
          t.repeat.set(side === 0 ? repsX : -repsX, 1.0);
          t.offset.set(side === 0 ? 0 : repsX, 0);
          t.needsUpdate = true;
          mesh.material[fi] = new THREE.MeshBasicMaterial({ map: t });
          mesh.material[fi].needsUpdate = true;
        });
      });
    });
  });
}

export function getArenaBounds() { return ARENA_HALF; }
