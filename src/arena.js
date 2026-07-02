// arena.js — floor, walls, crates, torii. Max 300 lines. Foliage in arena-foliage.js.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { scene } from './scene.js';
import { ARENA_HALF, WALL_H, CRATES, NAP_X, NAP_FAR_X, TRAVEL_GATE_X, TRAVEL_GATE_Z, TRAVEL_GATE_YAW_DELTA, BRIDGE_DECK_Y } from './config.js';
import { buildFoliage } from './arena-foliage.js';
import { buildProofSurfaceMeshes } from './engine/world/proofSurfaceMeshes.js';
import { buildNapTerrainMesh, buildArenaTerrainMesh } from './terrain/terrainMesh.js';
import { sampleNapHeight, sampleArenaHeight, ISLAND_BASE_Y } from './terrain/heightmap.js';
import { buildSeaMesh } from './terrain/sea.js';
import { buildBridge } from './bridge.js';

// ── Colours ───────────────────────────────────────────────────────────────────
const C_CRATE  = 0x4a4458;
const C_ORANGE = 0xf7931a;
const C_PURPLE = 0x8b5cf6;
const C_TURQ   = 0x1ad6c4;

const crateMat = new THREE.MeshStandardMaterial({ color: C_CRATE, roughness: 0.7 });

// The arena perimeter walls were removed in v0.2.333 — the island is now open to
// the sea on all sides, with the shore slope (terrain) as the visual/physical
// boundary. Crate meshes are still tracked here for potential debug enumeration.
export const crateMeshes = [];

// module-level scratch for instanced loops — never allocate inside
const _up   = new THREE.Vector3(0, 1, 0);
const _pos  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl  = new THREE.Vector3();
const _m4   = new THREE.Matrix4();

export function buildArena() {
  _buildFloor();
  _buildCrates();
  buildBridge();       // Stage 4 — deck across the meandering river at x=20 (bridge.js)
  _buildToriiGate();
  _buildTravelGateway(); // far-side metaverse travel portal model (v0.2.239)
  _buildNapZone();     // floor extension + tree past the torii gate
  buildSeaMesh(scene); // Stage 2 SEA — visual-only ocean around the land (terrain/sea.js)
  buildFoliage();      // grass + wildflowers — arena-foliage.js (NAP zone only)
}

// ── Floor ─────────────────────────────────────────────────────────────────────
// Stage 3 (v0.2.329): the flat turquoise emissive plane is replaced by the ARENA
// ISLAND — an undulating heightmap-displaced ground mesh (terrain/terrainMesh.js)
// raised to ISLAND_BASE_Y, matching the NAP island and rising from the Stage-2
// sea. Grass + physics heightfield read the same sampleArenaHeight(), so all three
// agree exactly. Overhead turquoise accent light kept for the arena's cool read.
function _buildFloor() {
  buildArenaTerrainMesh(scene); // name 'arena-floor'

  // Orange perimeter trim — sits on the raised plateau edge.
  const trim = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(ARENA_HALF*2, 0.08, ARENA_HALF*2)),
    new THREE.LineBasicMaterial({ color: C_ORANGE })
  );
  trim.position.y = ISLAND_BASE_Y + 0.04;
  scene.add(trim);

  // Overhead accent so crates and bots still get a top-down turquoise read.
  const top = new THREE.PointLight(C_TURQ, 1.2, ARENA_HALF * 2.4);
  top.position.set(0, WALL_H + 4 + ISLAND_BASE_Y, 0); scene.add(top);
}

// ── Crates ────────────────────────────────────────────────────────────────────
function _buildCrates() {
  CRATES.forEach(([cx, cz, hw, hd, ch]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(hw * 2, ch, hd * 2), crateMat);
    // Crate sits ON the undulating arena surface: its base is the terrain height
    // sampled at the crate centre, so it rides the hills instead of floating over
    // a dip or sinking into a rise (v0.2.330). Must match the collider in
    // physics.js, which samples the same height.
    m.position.set(cx, ch / 2 + sampleArenaHeight(cx, cz), cz);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    crateMeshes.push(m);
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
  fallback.position.set(ARENA_HALF, BRIDGE_DECK_Y, 0); // gate now stands ON the bridge deck over the channel
  fallback.rotation.y = Math.PI / 2; // match GLB — crossbar parallel to east wall
  // Named for the proof-surface parent binding (v0.2.151), discoverable via
  // scene.getObjectByName('torii-gate'); the GLB below inherits the same name.
  fallback.name = 'torii-gate';
  scene.add(fallback);

  // Accent light — stays regardless of GLB. Raised onto the island plateau.
  const gl = new THREE.PointLight(C_PURPLE, 3, 10);
  gl.position.set(ARENA_HALF - 1, 4 + BRIDGE_DECK_Y, 0); scene.add(gl);

  // Load GLB asynchronously — replaces fallback when ready
  const draco = new DRACOLoader();
  draco.setDecoderPath('/draco/');
  const loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  loader.load('/torii-gate.glb', gltf => {
    scene.remove(fallback);
    const gate = gltf.scene;

    // Scale: torii is a gateway, not a hurdle — it should be impressive and
    // imposing. Target 30% taller than the wall (user request v0.2.59), and
    // because we scale uniformly the crossbar grows proportionally wider too
    // — the GLB's natural aspect ratio is preserved. At WALL_H = 2.6 this
    // makes the gate 3.38m tall (vs the previous 2.86m at ×1.1).
    const box = new THREE.Box3().setFromObject(gate);
    const size = new THREE.Vector3();
    box.getSize(size);
    const targetH = WALL_H * 1.3; // 30% taller than wall — imposing gateway
    const s = targetH / (size.y || 1);
    gate.scale.setScalar(s);

    // Centre at east wall gate position, feet on floor.
    // Rotated 90° off the original perpendicular orientation so the gate's
    // crossbar runs north–south, parallel to the east wall — players walk
    // through it along the X axis.
    box.setFromObject(gate);
    gate.position.set(ARENA_HALF - 0.2, -box.min.y + BRIDGE_DECK_Y, 0);
    // Spin 180° from the previous 0-rad orientation — user request, makes the
    // "front" face of the torii (and its plaque/markings) read from inside the
    // arena rather than from the NAP zone side.
    gate.rotation.y = Math.PI;

    gate.traverse(o => {
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
    });
    gate.name = 'torii-gate'; // parity with the fallback for the proof-surface binding
    scene.add(gate);
    draco.dispose();
  }, undefined, err => {
    console.warn('[arena] torii-gate.glb failed, using fallback:', err);
    draco.dispose();
  });
}

// ── Travel gateway — the metaverse PORTAL model (v0.2.239) ───────────────────
// Distinct from the entrance torii-gate.glb. This is the actual travel portal,
// placed on the FAR side of the NAP zone (TRAVEL_GATE_X). The portal trigger,
// rings, spinning diamond, detection zone and "Press F to travel" prompt all sit
// here (wired in main.js) — the entrance gate stays a pure marker, no travel.
function _buildTravelGateway() {
  // Ground height at the far-side portal: it sits in the NAP island interior, so
  // its feet ride the undulating NAP surface, not y=0.
  const gwY = sampleNapHeight(TRAVEL_GATE_X, TRAVEL_GATE_Z);
  // Fallback procedural gateway shown immediately; GLB replaces it on load.
  const mat = new THREE.MeshStandardMaterial({
    color: C_TURQ, emissive: 0x0e8f86, emissiveIntensity: 0.6, roughness: 0.4,
  });
  const fallback = new THREE.Group();
  const lp = new THREE.Mesh(new THREE.BoxGeometry(0.5, 5, 0.5), mat);
  lp.position.set(0, 2.5, -3); fallback.add(lp);
  const rp = lp.clone(); rp.position.set(0, 2.5, 3); fallback.add(rp);
  const cb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 6.5), mat);
  cb.position.set(0, 5.2, 0); fallback.add(cb);
  fallback.position.set(TRAVEL_GATE_X, gwY, TRAVEL_GATE_Z);
  fallback.rotation.y = Math.PI / 2 + TRAVEL_GATE_YAW_DELTA;
  fallback.name = 'travel-gateway';
  scene.add(fallback);

  // Accent light — turquoise, marks the travel portal regardless of GLB.
  const gl = new THREE.PointLight(C_TURQ, 3, 12);
  gl.position.set(TRAVEL_GATE_X - 1, 4 + gwY, TRAVEL_GATE_Z); scene.add(gl);

  // nostrich: the travel gateway GLB is DECORATIVE and OPTIONAL. It loads async,
  // long after boot, and must NEVER block arena entry. The turquoise procedural
  // fallback above is added to the scene IMMEDIATELY and is only swapped out on a
  // fully successful load+process — so any failure (Draco decoder unreachable,
  // 404, malformed GLB, processing throw) leaves the visible fallback in place and
  // surfaces a specific loggable error, while ENTER ARENA proceeds untouched.
  const markGatewayFallback = (reason, err) => {
    console.error('[arena] travel-gateway GLB unavailable — using procedural fallback:', reason, err || '');
    if (typeof window !== 'undefined') {
      window.__toriiTravelGatewayFailed = true;
      window.__toriiTravelGatewayFailReason = reason;
    }
  };
  let draco;
  try {
    draco = new DRACOLoader();
    draco.setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(draco);
    loader.load('/torii-gateway-experience.glb', gltf => {
      try {
        const gate = gltf.scene;

        // Scale to an imposing portal — a touch taller than the entrance gate so
        // the far-side destination reads as the bigger landmark. Uniform scale
        // preserves the GLB aspect ratio.
        const box = new THREE.Box3().setFromObject(gate);
        const size = new THREE.Vector3();
        box.getSize(size);
        const targetH = WALL_H * 1.6;
        const s = targetH / (size.y || 1);
        gate.scale.setScalar(s);

        // Centre on the far-side travel plane, feet on the floor, front facing the
        // approaching player (who walks east from the entrance).
        box.setFromObject(gate);
        gate.position.set(TRAVEL_GATE_X, -box.min.y + gwY, TRAVEL_GATE_Z);
        gate.rotation.y = Math.PI + TRAVEL_GATE_YAW_DELTA;

        gate.traverse(o => {
          if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
        });
        gate.name = 'travel-gateway';
        // Swap fallback → real model ONLY after processing succeeds, so a throw
        // above never leaves the scene with neither model.
        scene.remove(fallback);
        scene.add(gate);
      } catch (e) {
        markGatewayFallback('process-error', e); // fallback already in scene
      } finally {
        draco.dispose();
      }
    }, undefined, err => {
      markGatewayFallback('load-error', err);
      draco.dispose();
    });
  } catch (e) {
    // Loader construction itself failed — fallback is already shown.
    markGatewayFallback('loader-init-error', e);
    if (draco) draco.dispose();
  }
}

// ── NAP Zone — peaceful area past the torii gate ─────────────────────────
function _buildNapZone() {
  // Ground: undulating terrain mesh (Stage 1, v0.2.326). Replaces the flat
  // green floor plane — vertices are baked from the same sampleHeight() the
  // grass + physics heightfield use, so all three agree exactly. Named
  // 'nap-zone-floor' to preserve the scene.getObjectByName lookup.
  buildNapTerrainMesh(scene);

  // Soft teal accent light to mark the peace zone
  const napLight = new THREE.PointLight(0x6ad9d0, 2.0, 22);
  const NAP_W = NAP_FAR_X - NAP_X;
  napLight.position.set(NAP_X + NAP_W * 0.55, 5 + ISLAND_BASE_Y, 0);
  scene.add(napLight);

  _buildNapTree(NAP_X + 6, 0); // ~x=26 just past the gate, centred on z=0

  // Display-only proof-surface panels (v0.2.150). One-time setup; inert visual
  // markers gated behind the pure render plan. No interaction/hot-path work.
  buildProofSurfaceMeshes(scene);
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

  // Trunk - taller and gnarled. Two visible tiers of branches need a tall
  // central spine, so we doubled height from 2.4 -> 4.4 and shifted the
  // taper a touch. Slight lean for a wind-blown bonsai feel.
  const TRUNK_H = 4.4;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.30, 0.62, TRUNK_H, 12),
    woodMat,
  );
  trunk.position.y = TRUNK_H / 2;
  trunk.rotation.z = 0.06; // gentle lean
  trunk.castShadow = trunk.receiveShadow = true;
  group.add(trunk);

  // Branches splay in TWO tiers - lower tier at ~y=2.2 and upper tier at
  // ~y=3.6. Each tier wraps around the trunk asymmetrically. Each entry is
  //   [originY, tipX, tipY, tipZ, branchRadius, leafSize, leafTint]
  // The branch cylinder goes from (0, originY, 0) to (tx, ty, tz); a layered
  // cloud-leaf cluster is parented at the same tip.
  const branchDefs = [
    // Lower tier - reach OUT more than UP, big chunky pads catching ambient
    [2.2,  2.5, 2.6,  0.4, 0.18, 1.45, 0x3a8a4a],
    [2.2, -2.3, 2.5,  0.5, 0.17, 1.30, 0x2d6a3a],
    [2.2,  0.5, 2.7, -2.1, 0.15, 1.20, 0x4a9a55],
    [2.2, -0.6, 2.4,  2.2, 0.15, 1.15, 0x256b35],
    // Upper tier - shorter, lifted, smaller leaf pads for crown silhouette
    [3.6,  1.6, 4.5,  0.7, 0.13, 1.00, 0x4ea862],
    [3.6, -1.4, 4.7,  0.6, 0.12, 0.95, 0x35784a],
    [3.6,  0.4, 4.9, -1.5, 0.11, 0.85, 0x5cb872],
    [3.6, -0.3, 4.6,  1.6, 0.11, 0.80, 0x2f6d3f],
  ];
  for (const [originY, tx, ty, tz, br, ls, lc] of branchDefs) {
    const dx = tx - 0;
    const dy = ty - originY;
    const dz = tz - 0;
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
    const branch = new THREE.Mesh(
      new THREE.CylinderGeometry(br * 0.65, br, len, 6),
      woodMat,
    );
    // Cylinder default axis = +Y. Position midpoint along the branch line,
    // then orient via quaternion mapping +Y onto branch direction.
    branch.position.set(dx * 0.5, originY + dy * 0.5, dz * 0.5);
    const dir = new THREE.Vector3(dx, dy, dz).normalize();
    branch.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    branch.castShadow = branch.receiveShadow = true;
    group.add(branch);

    // Layered cloud-leaf cluster - 7 flattened icospheres stacked into two
    // visible foliage layers (upper crown + lower skirt) so each pad reads
    // as a tiered cloud rather than a single blob. Y-squash gives every puff
    // the thin disc silhouette; tier-tint shading between layers adds depth.
    const leafMat = new THREE.MeshStandardMaterial({
      color: lc,
      emissive: 0x0a2614, emissiveIntensity: 0.45,
      roughness: 0.85, flatShading: true,
    });
    const leafMatDark = new THREE.MeshStandardMaterial({
      color: new THREE.Color(lc).multiplyScalar(0.72),
      emissive: 0x081e10, emissiveIntensity: 0.35,
      roughness: 0.88, flatShading: true,
    });
    // Upper layer (lighter, sits above midline) + lower layer (darker, shadow)
    const puffs = [
      // Upper layer
      { r: ls,        ox:  0.0,        oy:  ls * 0.25, oz:  0.0,        mat: leafMat },
      { r: ls * 0.78, ox:  ls * 0.55,  oy:  ls * 0.40, oz:  ls * 0.20,  mat: leafMat },
      { r: ls * 0.70, ox: -ls * 0.50,  oy:  ls * 0.30, oz: -ls * 0.25,  mat: leafMat },
      { r: ls * 0.62, ox:  ls * 0.10,  oy:  ls * 0.55, oz:  ls * 0.40,  mat: leafMat },
      // Lower layer
      { r: ls * 0.85, ox:  ls * 0.15,  oy: -ls * 0.20, oz: -ls * 0.10,  mat: leafMatDark },
      { r: ls * 0.72, ox: -ls * 0.45,  oy: -ls * 0.10, oz:  ls * 0.30,  mat: leafMatDark },
      { r: ls * 0.60, ox:  ls * 0.40,  oy: -ls * 0.05, oz:  ls * 0.45,  mat: leafMatDark },
    ];
    const cluster = new THREE.Group();
    cluster.position.set(tx, ty, tz);
    for (const p of puffs) {
      const m = new THREE.Mesh(
        new THREE.IcosahedronGeometry(p.r, 1),
        p.mat,
      );
      m.position.set(p.ox, p.oy, p.oz);
      // Heavy Y-squash so each puff reads as a flat disc-cloud
      m.scale.set(1.0, 0.50, 1.0);
      m.castShadow = m.receiveShadow = true;
      cluster.add(m);
    }
    cluster.rotation.y = (tx * 0.7 + tz * 1.3) % (Math.PI * 2);
    group.add(cluster);
  }

  group.position.set(x, sampleNapHeight(x, z), z);
  // Subtle yaw - just enough to break machine-placed symmetry
  group.rotation.y = 0.35;
  scene.add(group);
}

export function getArenaBounds() { return ARENA_HALF; }
