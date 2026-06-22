// arena.js — floor, walls, crates, torii. Max 300 lines. Foliage in arena-foliage.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';
import { ARENA_HALF, WALL_H, CRATES, EAST_GAP_HALF, NAP_X, NAP_FAR_X } from './config.js';
import { buildFoliage } from './arena-foliage.js';

// ── Colours ───────────────────────────────────────────────────────────────────
const C_FLOOR  = 0x0a1f23; // deep teal-black, underlit by floor light
const C_FLOOR_EMI = 0x1ad6c4; // turquoise emissive
const C_WALL   = 0x1e3020;
const C_CRATE  = 0x4a4458;
const C_ORANGE = 0xf7931a;
const C_PURPLE = 0x8b5cf6;
const C_TURQ   = 0x1ad6c4;

// perf: shared fallback materials (overwritten by texture load for walls)
const _wallFallback = new THREE.MeshBasicMaterial({ color: C_WALL });
const crateMat      = new THREE.MeshStandardMaterial({ color: C_CRATE, roughness: 0.7 });
// Arena floor — turquoise emissive, faintly underlit. Reads as cool, otherworldly.
const floorMat      = new THREE.MeshStandardMaterial({
  color: C_FLOOR, emissive: C_FLOOR_EMI, emissiveIntensity: 0.35,
  roughness: 0.6, metalness: 0.1,
});

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
  _buildWalls();
  _buildCrates();
  _buildToriiGate();
  _buildNapZone();     // floor extension + tree past the torii gate
  buildFoliage();      // grass + wildflowers — arena-foliage.js (NAP zone only)
  _loadWallTexture();  // async, deferred 1 rAF
}

// ── Floor ─────────────────────────────────────────────────────────────────────
// Turquoise emissive solid floor with two underlights pushing teal glow up
// through the surface. No grass, no grid — mist swirls (atmosphere.js) sit
// just above the floor for the underlit-fog look.
function _buildFloor() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2),
    floorMat
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  scene.add(mesh);

  // Orange perimeter trim — keeps the arena edge readable against the teal floor
  const trim = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(ARENA_HALF*2, 0.08, ARENA_HALF*2)),
    new THREE.LineBasicMaterial({ color: C_ORANGE })
  );
  trim.position.y = 0.04;
  scene.add(trim);

  // Underlight rig — two point lights mounted just below the floor plane,
  // shining up. With the emissive material this fakes a glowing translucent
  // floor (no real subsurface scattering, just a vibe). Range tuned so the
  // light pool stays inside the arena and doesn't bleed across walls.
  const l1 = new THREE.PointLight(C_TURQ, 4.0, ARENA_HALF * 1.4);
  l1.position.set(-8, -0.6, -8); scene.add(l1);
  const l2 = new THREE.PointLight(C_TURQ, 4.0, ARENA_HALF * 1.4);
  l2.position.set( 8, -0.6,  8); scene.add(l2);
  // Single overhead accent so crates and bots still get a top-down read
  const top = new THREE.PointLight(C_TURQ, 1.2, ARENA_HALF * 2.4);
  top.position.set(0, WALL_H + 4, 0); scene.add(top);
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
    // Spin 180° from the previous 0-rad orientation — user request, makes the
    // "front" face of the torii (and its plaque/markings) read from inside the
    // arena rather than from the NAP zone side.
    gate.rotation.y = Math.PI;

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
        // BOTH faces render the texture in its native left-to-right orientation
        // when viewed from the interior of the arena — no UV flipping. Previously
        // we negated repsX on side===1 which left south + east-segment interiors
        // reading right-to-left (back-to-front).
        faceGroups[i].forEach((fi) => {
          const t = tex.clone();
          t.wrapS = t.wrapT = THREE.RepeatWrapping;
          t.repeat.set(repsX, 1.0);
          t.offset.set(0, 0);
          t.needsUpdate = true;
          mesh.material[fi] = new THREE.MeshBasicMaterial({ map: t });
          mesh.material[fi].needsUpdate = true;
        });
      });
    });
  });
}

// ── NAP Zone — peaceful area past the torii gate ─────────────────────────
function _buildNapZone() {
  // Floor extension past the east wall. Slightly cooler tint than the main
  // arena floor so it reads as a distinct space.
  const NAP_W = NAP_FAR_X - NAP_X;
  const napFloorMat = new THREE.MeshStandardMaterial({
    color: 0x162a1c, roughness: 0.9,
  });
  const napFloor = new THREE.Mesh(
    new THREE.PlaneGeometry(NAP_W, ARENA_HALF * 2),
    napFloorMat,
  );
  napFloor.rotation.x = -Math.PI / 2;
  napFloor.position.set(NAP_X + NAP_W / 2, 0, 0);
  napFloor.receiveShadow = true;
  scene.add(napFloor);

  // Soft teal accent light to mark the peace zone
  const napLight = new THREE.PointLight(0x6ad9d0, 2.0, 22);
  napLight.position.set(NAP_X + NAP_W * 0.55, 5, 0);
  scene.add(napLight);

  _buildNapTree(NAP_X + 6, 0); // ~x=26 just past the gate, centred on z=0
}

// Bonsai-style oak. Chunky brown trunk + curving branches reaching out to
// flattened cloud-like leaf clusters in layered greens. Each cluster is a
// group of squashed icospheres so it reads as a soft puff rather than a hard
// blob. Trunk is intentionally short and gnarled, branches splay outward
// asymmetrically for the bonsai silhouette.
function _buildNapTree(x, z) {
  const group = new THREE.Group();

  // Wood material - dark warm brown, shared by trunk + branches
  const woodMat = new THREE.MeshStandardMaterial({
    color: 0x4a2818, roughness: 0.88, flatShading: true,
  });

  // Trunk - short, thick, tapered. Slight lean for a wind-blown bonsai feel.
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.55, 2.4, 10),
    woodMat,
  );
  trunk.position.y = 1.2;
  trunk.rotation.z = 0.08; // ~4.5deg lean
  trunk.castShadow = trunk.receiveShadow = true;
  group.add(trunk);

  // Branches splay out from the top-shoulder of the trunk. Each entry is
  //   [tipX, tipY, tipZ, branchRadius, leafSize, leafTint]
  // The branch is a cylinder oriented from (0, TRUNK_TOP_Y, 0) to (tx,ty,tz);
  // a cloud-leaf cluster is parented at the same tip.
  const branchDefs = [
    [ 1.9, 2.8,  0.3, 0.16, 1.25, 0x3a8a4a],
    [-1.7, 3.0,  0.4, 0.14, 1.05, 0x2d6a3a],
    [ 0.6, 3.4, -1.4, 0.13, 0.95, 0x4a9a55],
    [-0.4, 2.6,  1.5, 0.12, 0.85, 0x256b35],
  ];
  const TRUNK_TOP_Y = 2.2;
  for (const [tx, ty, tz, br, ls, lc] of branchDefs) {
    const dx = tx - 0;
    const dy = ty - TRUNK_TOP_Y;
    const dz = tz - 0;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(br * 0.65, br, len, 6),
      woodMat,
    );
    // Cylinder default axis = +Y. Position midpoint, then orient via
    // quaternion that maps +Y onto the branch direction.
    branch.position.set(dx * 0.5, TRUNK_TOP_Y + dy * 0.5, dz * 0.5);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    branch.castShadow = branch.receiveShadow = true;
    group.add(branch);

    // Cloud-like leaf cluster - 4 overlapping flattened icospheres. Y-squash
    // gives each puff the thin-cloud silhouette the user asked for; tint per
    // cluster keeps the four canopies from reading identical.
    const leafMat = new THREE.MeshStandardMaterial({
      color: lc,
      emissive: 0x0a2614, emissiveIntensity: 0.45,
      roughness: 0.85, flatShading: true,
    });
    const puffs = [
      { r: ls,        ox:  0.0,         oy:  0.0,          oz:  0.0 },
      { r: ls * 0.78, ox:  ls * 0.55,   oy:  ls * 0.18,    oz:  ls * 0.20 },
      { r: ls * 0.70, ox: -ls * 0.50,   oy: -ls * 0.10,    oz: -ls * 0.25 },
      { r: ls * 0.62, ox:  ls * 0.10,   oy:  ls * 0.35,    oz:  ls * 0.40 },
    ];
    const cluster = new THREE.Group();
    cluster.position.set(tx, ty, tz);
    for (const p of puffs) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(p.r, 1),
        leafMat,
      );
      m.position.set(p.ox, p.oy, p.oz);
      // Squash on Y so each puff reads as a flat disc-cloud
      m.scale.set(1.0, 0.55, 1.0);
      m.castShadow = m.receiveShadow = true;
      cluster.add(m);
    }
    cluster.rotation.y = (tx * 0.7 + tz * 1.3) % (Math.PI * 2);
    group.add(cluster);
  }

  group.position.set(x, 0, z);
  // Subtle yaw - just enough to break machine-placed symmetry
  group.rotation.y = 0.35;
  scene.add(group);
}

export function getArenaBounds() { return ARENA_HALF; }
