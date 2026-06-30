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

// Material registry (v0.2.118) — the foliage shaders live here, not on
// `window`. main.js advances their uTime via tickFoliage() each frame and
// ToriiDebug reads them via getGrassMat()/getFlowerMat(). This replaces the
// old `window._grassMat`/`window._flowerMat` cross-module wiring; the globals
// are still set in _buildGrass/_buildWildflowers as DEPRECATED debug aliases
// (console/tester convenience) but internal code must not read them
// (regression check 10).
let _grassMat  = null;
let _flowerMat = null;
let _tulipMat  = null; // v0.2.263: 2nd flower archetype (tulip cup)

export function buildFoliage() {
  _buildGrass();
  _buildWildflowers();
  _buildTulips(); // v0.2.263: 2nd flower archetype for shape variety
}

// Per-frame shader tick — advances the grass + flower uTime uniforms. Reads
// module-scope refs only (no `window`, no allocation). Behaviour-identical to
// the previous main.js inline `window._grassMat.uniforms.uTime.value += dt`.
export function tickFoliage(dt) {
  if (_grassMat)  _grassMat.uniforms.uTime.value  += dt;
  if (_flowerMat) _flowerMat.uniforms.uTime.value += dt;
  if (_tulipMat)  _tulipMat.uniforms.uTime.value  += dt;
}

// Debug accessors — injected into ToriiDebug so the namespace can surface the
// live materials without reaching through a global.
export function getGrassMat()  { return _grassMat; }
export function getFlowerMat() { return _flowerMat; }
export function getTulipMat()  { return _tulipMat; } // v0.2.263

// ── Instanced grass ───────────────────────────────────────────────────────────
function _buildGrass() {
  // v0.2.265: full blade rewrite — see the design notes above _buildGrass.
  const BLADE_SEGS   = 8;    // v0.2.265: rows (3 verts each). V-fold needs fewer rows than the flat ribbon.
  const BLADE_H      = 0.46; // v0.2.265: tuned — thinner blades read as a denser field.
  const BLADE_W      = 0.014;// v0.2.265: much thinner (was 0.052) — the core fix for "square-like" blades.
  const KEEL         = 0.008;// v0.2.265: V-channel fold depth (forward +Z). Gives the blade a crease + volume.
  const BLADES_PATCH = 40;   // v0.2.265: more blades per patch to compensate for thinner width.
  const PATCH_RADIUS = 0.78;
  const SPACING      = 0.95; // v0.2.265: slightly tighter grid for density.

  // 3 verts per row (left, keel, right) + one tip vertex. Rows use t = row/SEGS
  // (never reaching 1) so the top row keeps a non-zero width — this avoids the
  // degenerate zero-area triangles that produced NaN normals / black tip speckles.
  const VERTS_PER_BLADE = BLADE_SEGS * 3 + 1;
  const positions = [], uvs = [], indices = [];

  for (let b = 0; b < BLADES_PATCH; b++) {
    const base = b * VERTS_PER_BLADE;
    for (let row = 0; row < BLADE_SEGS; row++) {
      const t  = row / BLADE_SEGS;   // 0 at base .. (SEGS-1)/SEGS — never 1, avoids degenerate tip tris
      const y  = t * BLADE_H;
      // tight taper to a sharp point; keel fades out faster so the tip is clean.
      const hw   = BLADE_W * Math.pow(1.0 - t, 1.8);
      const keel = KEEL   * Math.pow(1.0 - t, 1.4);
      positions.push(-hw, y, 0,    0, y, keel,    hw, y, 0);
      uvs.push(0, t,  0.5, t,  1, t);
    }
    // Tip cap — a single apex vertex + two tris from the last row. Gives a clean
    // sharp point instead of collapsing the last row to zero width (which made
    // degenerate tris → NaN normals → black tip speckles).
    positions.push(0, BLADE_H, 0);
    uvs.push(0.5, 1.0);
    // Two faces per row pair: left face (left→keel) + right face (keel→right).
    for (let row = 0; row < BLADE_SEGS - 1; row++) {
      const l0 = base + row * 3;
      const k0 = l0 + 1, r0 = l0 + 2;
      const l1 = l0 + 3, k1 = l0 + 4, r1 = l0 + 5;
      indices.push(l0, k0, k1,  l0, k1, l1);   // left face
      indices.push(k0, r0, r1,  k0, r1, k1);   // right face
    }
    // tip cap tris
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
  geo.computeVertexNormals();   // bakes the V-channel fold normals

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0.0 },
      uWindDir: { value: { x: 0.707, y: 0.707 } },
    },
    vertexShader: /* glsl */`
      varying float vT;
      varying float vTint;   // per-blade colour tint (instanceColor.b)
      varying float vDiff;   // twist-rotated fold-normal diffuse
      uniform float uTime;
      uniform vec2  uWindDir;
      void main() {
        float h = ${BLADE_H.toFixed(4)};
        float t = clamp(position.y / h, 0.0, 1.0);
        vT = t;
        vTint = instanceColor.b;

        vec3 p = position;

        // (2) Quadratic Bezier spine — forward curl along the keel (+Z). Stronger curl
        // base so blades visibly arch over rather than standing flat.
        float curl = 0.18 + instanceColor.g * 0.22;
        float bz   = 2.0 * (1.0 - t) * t * (curl * 0.55) + t * t * curl;
        p.z += bz;
        // graceful droop: tip falls slightly so the arch reads as a curve
        p.y -= 0.06 * t * t;

        // Per-blade twist around the spine (Y) — the fold turns along its length
        // so the blade catches light variably instead of reading as one flat card.
        float twist = (fract(instanceColor.r * 7.31) - 0.5) * 1.3;
        float ang   = twist * t;
        float ca = cos(ang), sa = sin(ang);
        p.xz = vec2(ca * p.x - sa * p.z, sa * p.x + ca * p.z);
        // rotate the baked fold normal by the same twist
        vec3 nrm = vec3(ca * normal.x - sa * normal.z, normal.y, sa * normal.x + ca * normal.z);

        // (3) Wind — world-space, patch-coherent.
        vec3 wpos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

        // Traveling gust front: a sine sweeping across the field in the wind
        // direction. Blades ahead of the front are calm, at the front they peak —
        // this is what makes wind look like waves rolling over patches.
        float along = dot(wpos, vec3(uWindDir.x, 0.0, uWindDir.y));
        float front = sin(along * 0.30 - uTime * 1.6);
        float gust  = smoothstep(-0.15, 0.85, front);

        // Curl-noise-style organic variation (sum of offset sines) so the sway
        // isn't uniform — neighbouring blades differ slightly within a patch.
        float cn = ( sin(wpos.x * 0.70 + uTime * 0.80 + instanceColor.r * 6.2832)
                  + cos(wpos.z * 0.60 + uTime * 0.60 - instanceColor.r * 6.2832)
                  + sin((wpos.x + wpos.z) * 0.35 + uTime * 1.10) ) / 3.0;

        float wind = 0.04 + gust * 0.22 + cn * 0.05;
        float sway = wind * t * t;            // tip sways most, base stays put

        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        wp.xyz += vec3(uWindDir.x * sway, 0.0, uWindDir.y * sway);  // global wind dir
        wp.x  += cn * 0.03 * t;                                   // lateral flutter

        // Lighting — twist-rotated fold normal vs a warm key light.
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
        // Per-blade tint: lerp between a cool deep green and a warm yellow-green
        // so the field reads as varied growth, not a single flat colour.
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
        s:  0.65 + Math.random() * 0.75,  // v0.2.262: wider height/scale variance
        phase: Math.random(),
        speed: Math.random(),
        tint:  Math.random(),            // per-blade colour tint (cool→warm green)
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
    mesh.instanceColor.setXYZ(i, p.phase, p.speed, p.tint);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate  = true;
  // v0.2.265: fix instanced frustum culling. computeBoundingSphere() on the
  // geometry only bounds a single blade at the origin, so the whole field was
  // being culled when the camera wasn't aimed at the origin. InstancedMesh has
  // its own computeBoundingSphere() that accounts for every instance matrix.
  mesh.computeBoundingSphere();
  mesh.frustumCulled = true;
  scene.add(mesh);
  _grassMat = mat;
  window._grassMat = mat; // DEPRECATED debug alias (v0.2.118) — internal code uses tickFoliage()/getGrassMat()
}

// ── Instanced wildflowers ─────────────────────────────────────────────────────
function _buildWildflowers() {
  const FLOWER_COUNT = 340;  // v0.2.262: more blooms (was 220)
  const STEM_H = 0.52;
  const HEAD_R = 0.16;
  const SW     = 0.035;
  const PETAL_W = HEAD_R * 0.85;  // v0.2.262: slightly narrower petals (5 fit better than 4)

  const PALETTES = [
    [1.0,0.18,0.18],[1.0,0.55,0.08],[0.95,0.92,0.10],
    [0.18,0.82,0.28],[0.18,0.48,1.0],[0.82,0.18,0.92],
    [1.0,0.38,0.68],[1.0,1.0,1.0],[0.95,0.65,0.15],[0.35,0.95,0.85],
    // v0.2.262: richer palette — lavender, deep violet, coral, sky
    [0.62,0.45,0.92],[0.48,0.20,0.72],[1.0,0.42,0.32],[0.40,0.72,1.0],
  ];

  const positions = [], uvs = [], indices = [];
  function addQuad(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3) {
    const b = positions.length / 3;
    positions.push(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3);
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(b,b+1,b+2,b+1,b+3,b+2);
  }

  const R = PETAL_W, HR = HEAD_R * 2;
  const CUP = 0.030; // v0.2.263: petals cup more (outer edge raised → less flat card)
  // v0.2.263: 7 outer petals (was 5) for a fuller, rounder, less angular head.
  const OUTER = Array.from({length:7}, (_,k)=>k*2*Math.PI/7);
  OUTER.forEach(a => {
    const c = Math.cos(a), s = Math.sin(a);
    addQuad(-R*c,STEM_H,-R*s, R*c,STEM_H,R*s, -R*c,STEM_H+HR+CUP,-R*s, R*c,STEM_H+HR+CUP,R*s);
  });
  // v0.2.263: inner ring — 7 shorter petals offset half a step, fuller bloom.
  const Ri = R * 0.62, HRi = HR * 0.55, Y_OFF = HEAD_R * 0.18;
  OUTER.forEach(a => { const a2 = a + Math.PI/7; const c = Math.cos(a2), s = Math.sin(a2);
    addQuad(-Ri*c,STEM_H+Y_OFF,-Ri*s, Ri*c,STEM_H+Y_OFF,Ri*s,
            -Ri*c,STEM_H+Y_OFF+HRi+CUP,-Ri*s, Ri*c,STEM_H+Y_OFF+HRi+CUP,Ri*s);
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
    _scl.setScalar(0.6 + Math.random() * 0.95);  // v0.2.262: wider scale variance
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
  _flowerMat = mat;
  window._flowerMat = mat; // DEPRECATED debug alias (v0.2.118) — internal code uses tickFoliage()/getFlowerMat()
}

// ── Instanced tulips (2nd flower archetype, v0.2.263) ──────────────────────────
// A small open cup of 3 broad petals on a stem — a clearly different silhouette
// from the daisy, so the NAP zone reads as a mixed wildflower field rather than
// a single bloom type. Same footprint + tree exclusion as the daisy. One draw
// call; wind sway via uTime (ticked in tickFoliage).
function _buildTulips() {
  const TULIP_COUNT = 70;
  const STEM_H = 0.46;
  const CUP_H  = 0.22;
  const R0     = 0.05;   // base radius (cup mouth narrows at the bottom)
  const R1     = 0.16;   // rim radius (cup opens outward)
  const SW     = 0.035;
  const PETAL_W = R1 * 0.92;

  // Warm tulip palette — reds, oranges, yellows, pinks, white.
  const PALETTES = [
    [0.92,0.16,0.20],[0.98,0.55,0.10],[0.99,0.92,0.18],
    [0.95,0.85,0.92],[0.85,0.20,0.55],[0.99,0.80,0.30],[1.0,1.0,1.0],
  ];

  const positions = [], uvs = [], indices = [];
  function addQuad(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3) {
    const b = positions.length / 3;
    positions.push(x0,y0,z0,x1,y1,z1,x2,y2,z2,x3,y3,z3);
    uvs.push(0,0,1,0,0,1,1,1);
    indices.push(b,b+1,b+2,b+1,b+3,b+2);
  }

  const y0 = STEM_H, y1 = STEM_H + CUP_H;
  // 3 broad petals at 120°, each a quad from the narrow base to the wider rim.
  [0, 2*Math.PI/3, 4*Math.PI/3].forEach(a => {
    const c = Math.cos(a), s = Math.sin(a);
    const px = -s, pz = c;          // perpendicular to radial dir
    const hw = PETAL_W * 0.5;
    addQuad(
      R0*c + px*(-hw), y0, R0*s + pz*(-hw),
      R0*c + px*( hw), y0, R0*s + pz*( hw),
      R1*c + px*(-hw), y1, R1*s + pz*(-hw),
      R1*c + px*( hw), y1, R1*s + pz*( hw)
    );
  });
  // Stem cross (2 thin quads) — same treatment as the daisy stem.
  addQuad(-SW,0,0, SW,0,0, -SW,STEM_H,0, SW,STEM_H,0);
  addQuad(0,0,-SW, 0,0,SW,  0,STEM_H,-SW, 0,STEM_H,SW);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv',       new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const CUP_TOP = (STEM_H + CUP_H).toFixed(4);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0.0 } },
    vertexShader: /* glsl */`
      varying float vY;
      varying vec3  vCol;
      uniform float uTime;
      void main() {
        vY = position.y;
        #ifdef USE_INSTANCING_COLOR
          vCol = instanceColor;
        #else
          vCol = vec3(0.9, 0.2, 0.25);
        #endif
        float phase = float(gl_InstanceID) * 0.618;
        float stem  = step(0.30, position.y / ${CUP_TOP});
        float sway  = sin(uTime * 0.8 + phase) * 0.05 * stem;
        vec3 pos = position;
        pos.x += sway; pos.z += sway * 0.4;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(pos, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      varying float vY;
      varying vec3  vCol;
      void main() {
        // Darker at the base, brightening toward the rim — reads as a cup.
        float t = clamp(vY / ${CUP_TOP}, 0.0, 1.0);
        vec3 col = mix(vCol * 0.55, vCol * (0.95 + 0.25 * t), t);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  const TREE_X = NAP_X + 6;
  const TREE_Z = 0;
  const TREE_CLEAR_SQ = 1.5 * 1.5;
  const mesh = new THREE.InstancedMesh(geo, mat, TULIP_COUNT);
  const _col = new THREE.Color();
  for (let i = 0; i < TULIP_COUNT; i++) {
    let fx, fz;
    for (let t = 0; t < 6; t++) {
      fx = NAP_GRASS_X0 + Math.random() * NAP_GRASS_W;
      fz = NAP_GRASS_Z0 + Math.random() * NAP_GRASS_D;
      const dx = fx - TREE_X, dz = fz - TREE_Z;
      if (dx * dx + dz * dz >= TREE_CLEAR_SQ) break;
    }
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    _pos.set(fx, 0, fz);
    _quat.setFromAxisAngle(_up, Math.random() * Math.PI * 2);
    _scl.setScalar(0.7 + Math.random() * 0.9);  // v0.2.263: varied sizes
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
  _tulipMat = mat;
}
