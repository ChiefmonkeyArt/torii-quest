// arena-foliage.js — instanced grass blades + wildflowers. 2 draw calls total.
// Confined to the NAP Zone only (east of the torii gate) so the main arena
// reads as a clean turquoise underlit floor with mist swirls.
import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA_HALF, NAP_X, NAP_FAR_X } from './config.js';

// NAP-zone footprint shared by both grass + flowers.
//   x: just inside the gate edge → just inside the far wall (small inset so
//      blades don't intersect the torii pillars or NAP_FAR_X clamp).
//   z: full arena width minus a small inset.
const NAP_GRASS_X0 = NAP_X + 1.0;
const NAP_GRASS_X1 = NAP_FAR_X - 1.0;
const NAP_GRASS_Z0 = -ARENA_HALF + 1.0;
const NAP_GRASS_Z1 =  ARENA_HALF - 1.0;
const NAP_GRASS_W  = NAP_GRASS_X1 - NAP_GRASS_X0;
const NAP_GRASS_D  = NAP_GRASS_Z1 - NAP_GRASS_Z0;

// Module-level scratch — shared with arena.js equivalents but isolated here
const _up   = new THREE.Vector3(0, 1, 0);
const _pos  = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl  = new THREE.Vector3();
const _m4   = new THREE.Matrix4();

export function buildFoliage() {
  _buildGrass();
  _buildWildflowers();
}

// ── Instanced grass ───────────────────────────────────────────────────────────
function _buildGrass() {
  const BLADE_SEGS   = 7;
  const BLADE_H      = 0.42;
  const BLADE_W      = 0.038;
  const BLADES_PATCH = 20;
  const PATCH_RADIUS = 0.75;
  const SPACING      = 1.3;

  const VERTS_PER_BLADE = BLADE_SEGS * 2 + 1;
  const positions = [], uvs = [], indices = [];

  for (let b = 0; b < BLADES_PATCH; b++) {
    const angle  = (b / BLADES_PATCH) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const r      = PATCH_RADIUS * Math.sqrt(0.05 + Math.random() * 0.95);
    const bx     = Math.cos(angle) * r;
    const bz     = Math.sin(angle) * r;
    const lean   = 0.10 + Math.random() * 0.20;
    const leanDx = Math.cos(angle + (Math.random() - 0.5));
    const leanDz = Math.sin(angle + (Math.random() - 0.5));
    const perpX  = -leanDz;
    const perpZ  =  leanDx;
    const base   = b * VERTS_PER_BLADE;

    for (let row = 0; row <= BLADE_SEGS - 1; row++) {
      const t  = row / BLADE_SEGS;
      const y  = t * BLADE_H;
      const hw = BLADE_W * Math.pow(1.0 - t, 1.6);
      const lx = lean * t * t * leanDx;
      const lz = lean * t * t * leanDz;
      positions.push(
        bx + lx - perpX * hw, y, bz + lz - perpZ * hw,
        bx + lx + perpX * hw, y, bz + lz + perpZ * hw
      );
      uvs.push(0, t, 1, t);
    }
    const tipLx = lean * leanDx;
    const tipLz = lean * leanDz;
    positions.push(bx + tipLx, BLADE_H, bz + tipLz);
    uvs.push(0.5, 1.0);

    for (let row = 0; row < BLADE_SEGS - 1; row++) {
      const b0 = base + row * 2;
      indices.push(b0, b0+2, b0+1,  b0+1, b0+2, b0+3);
    }
    const lastLeft = base + (BLADE_SEGS - 1) * 2;
    const lastRight = base + (BLADE_SEGS - 1) * 2 + 1;
    const tipIdx   = base + VERTS_PER_BLADE - 1;
    indices.push(lastLeft, tipIdx, lastRight);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0.0 },
      uWindDir: { value: { x: 0.707, y: 0.707 } },
    },
    vertexShader: /* glsl */`
      varying float vT;
      uniform float uTime;
      uniform vec2  uWindDir;
      void main() {
        vT = clamp(position.y / ${BLADE_H.toFixed(4)}, 0.0, 1.0);
        float phase = instanceColor.r * 6.2832;
        float speed = 0.15 + instanceColor.g * 0.28;
        float sway  = sin(uTime * speed + phase) * 0.24 * vT * vT;
        vec3 pos    = position;
        pos.x += sway + uWindDir.x * 0.20 * vT * vT;
        pos.z +=        uWindDir.y * 0.20 * vT * vT;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vT;
      void main() {
        vec3 rootCol = vec3(0.01, 0.14, 0.02);
        vec3 midCol  = vec3(0.09, 0.48, 0.07);
        vec3 tipCol  = vec3(0.32, 0.92, 0.20);
        vec3 col = vT < 0.5
          ? mix(rootCol, midCol, vT * 2.0)
          : mix(midCol,  tipCol, (vT - 0.5) * 2.0);
        float ao = smoothstep(0.0, 0.15, vT);
        gl_FragColor = vec4(col * (0.6 + 0.4 * ao), 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  // Patch grid confined to NAP-zone footprint — see NAP_GRASS_* constants at
  // the top of the file. Skip any patch that lands within ~1.5u of the tree
  // trunk at (NAP_X+6, 0) so we don't bury the bonsai base in blades.
  const TREE_X = NAP_X + 6;
  const TREE_Z = 0;
  const TREE_CLEAR_SQ = 1.5 * 1.5;
  const patches = [];
  for (let x = NAP_GRASS_X0; x <= NAP_GRASS_X1; x += SPACING) {
    for (let z = NAP_GRASS_Z0; z <= NAP_GRASS_Z1; z += SPACING) {
      const jx = x + (Math.random() - 0.5) * 0.5;
      const jz = z + (Math.random() - 0.5) * 0.5;
      const dx = jx - TREE_X, dz = jz - TREE_Z;
      if (dx * dx + dz * dz < TREE_CLEAR_SQ) continue;
      patches.push({
        x: jx,
        z: jz,
        ry: Math.random() * Math.PI * 2,
        s:  0.7 + Math.random() * 0.6,
        phase: Math.random(),
        speed: Math.random(),
      });
    }
  }

  const count = patches.length;
  const mesh  = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.BufferAttribute(new Float32Array(count * 3), 3);

  for (let i = 0; i < count; i++) {
    const p = patches[i];
    _pos.set(p.x, 0, p.z);
    _quat.setFromAxisAngle(_up, p.ry);
    _scl.setScalar(p.s);
    _m4.compose(_pos, _quat, _scl);
    mesh.setMatrixAt(i, _m4);
    mesh.instanceColor.setXYZ(i, p.phase, p.speed, 0);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate  = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.frustumCulled = true;
  scene.add(mesh);
  window._grassMat = mat;
}

// ── Instanced wildflowers ─────────────────────────────────────────────────────
function _buildWildflowers() {
  const FLOWER_COUNT = 220;
  const STEM_H = 0.52;
  const HEAD_R = 0.16;
  const SW     = 0.035;

  const PALETTES = [
    [1.0,0.18,0.18],[1.0,0.55,0.08],[0.95,0.92,0.10],
    [0.18,0.82,0.28],[0.18,0.48,1.0],[0.82,0.18,0.92],
    [1.0,0.38,0.68],[1.0,1.0,1.0],[0.95,0.65,0.15],[0.35,0.95,0.85],
  ];

  const positions = [], uvs = [], indices = [];
  function addQuad(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3) {
    const b = positions.length / 3;
    positions.push(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3);
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(b,b+1,b+2,b+1,b+3,b+2);
  }

  const R = HEAD_R, HR = HEAD_R * 2;
  [0, Math.PI/4, Math.PI/2, (3*Math.PI)/4].forEach(a => {
    const c = Math.cos(a), s = Math.sin(a);
    addQuad(-R*c,STEM_H,-R*s, R*c,STEM_H,R*s, -R*c,STEM_H+HR,-R*s, R*c,STEM_H+HR,R*s);
  });
  addQuad(-SW,0,0, SW,0,0, -SW,STEM_H,0, SW,STEM_H,0);
  addQuad(0,0,-SW, 0,0,SW,  0,STEM_H,-SW, 0,STEM_H,SW);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const STEM_TOP = (STEM_H + HEAD_R * 2).toFixed(4);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: /* glsl */`
      varying vec2  vUv;
      varying float vStem;
      varying vec3  vCol;
      uniform float uTime;
      void main() {
        vUv   = uv;
        vStem = step(0.30, position.y / ${STEM_TOP});
        float phase = float(gl_InstanceID) * 0.618;
        float sway  = sin(uTime * 0.85 + phase) * 0.055 * vStem;
        vec3 pos = position;
        pos.x += sway; pos.z += sway * 0.35;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(1.0, 0.4, 0.4);
        #endif
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying vec2  vUv;
      varying float vStem;
      varying vec3  vCol;
      void main() {
        float d = length(vUv - vec2(0.5));
        float edge = 1.0 - smoothstep(0.40, 0.50, d);
        if (vStem < 0.5 && edge < 0.05) discard;
        float isCentre = 1.0 - smoothstep(0.14, 0.20, d);
        float bright   = 0.75 + 0.25 * (1.0 - d * 1.8);
        vec3 stemCol   = vec3(0.10, 0.46, 0.07);
        vec3 centreCol = vec3(1.0, 0.90, 0.10);
        vec3 col = vStem < 0.5
          ? stemCol
          : mix(vCol * bright, centreCol, isCentre);
        gl_FragColor = vec4(col, vStem < 0.5 ? 1.0 : edge);
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  // Flowers also confined to the NAP zone. Reject any sample inside the tree
  // exclusion radius to keep the trunk base clean.
  const TREE_X = NAP_X + 6;
  const TREE_Z = 0;
  const TREE_CLEAR_SQ = 1.5 * 1.5;
  const mesh = new THREE.InstancedMesh(geo, mat, FLOWER_COUNT);
  const _col = new THREE.Color();
  for (let i = 0; i < FLOWER_COUNT; i++) {
    let fx, fz;
    // Rejection sample — max a few tries, fall back to last value if all fail
    for (let t = 0; t < 6; t++) {
      fx = NAP_GRASS_X0 + Math.random() * NAP_GRASS_W;
      fz = NAP_GRASS_Z0 + Math.random() * NAP_GRASS_D;
      const dx = fx - TREE_X, dz = fz - TREE_Z;
      if (dx * dx + dz * dz >= TREE_CLEAR_SQ) break;
    }
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    _pos.set(fx, 0, fz);
    _quat.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
    _scl.setScalar(0.65 + Math.random() * 0.75);
    _m4.compose(_pos, _quat, _scl);
    mesh.setMatrixAt(i, _m4);
    mesh.setColorAt(i, _col.setRGB(pal[0], pal[1], pal[2]));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.geometry.computeBoundingBox();
  mesh.geometry.computeBoundingSphere();
  mesh.frustumCulled = true;
  scene.add(mesh);
  window._flowerMat = mat;
}
