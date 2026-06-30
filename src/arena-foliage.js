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
  // v0.2.267: FROM-SCRATCH BLADE based on the threejsdemos.com procedural grass
  // demo (grass-controller.js). The flat-ribbon approach (v0.2.266c) still read
  // as jagged shards in SwiftShader. The demo's proven recipe: a PlaneGeometry
  // blade with a CPU piecewise taper (wide base → gradual middle → sharp tip) +
  // a slight quadratic forward curve, driven by an InstancedMesh whose
  // instanceColor carries (phase, brightness, hueShift). The organic multi-octave
  // gust wind from v0.2.266 is retained on top — only the blade + colour pipeline
  // are ported from the demo.
  // v0.2.286: 3-SIDED BLADE (triangular-prism cross-section). The flat ribbon
  // (PlaneGeometry, DoubleSide) read as a fat angular card whenever it faced the
  // camera, and ~half the blades were invisible edge-on at any angle. Thinning a
  // 2D plane only makes a thinner card; it never becomes thin 3D grass, which is
  // why every width cut from v0.2.282->285 still read as "fat angular square".
  // A 3-sided blade has real volume: 3 outward faces around a tiny triangular
  // core, tapering to a 3-sided point. It occludes from every angle (no edge-on
  // vanishing) and never looks like a flat card. Cross-section radius is tiny so
  // each blade is a thin 3D needle, not a chunky prism.
  const BLADE_SEGS = 8;     // v0.2.294: more rows for a smooth cone silhouette (was 6).
  const BLADE_H    = 0.507; // 69% taller than original 0.30; 21% of blades get a further x1.21 Y.
  const BLADE_R    = 0.006; // v0.2.294: 6mm base — wide enough that the bright base is
                             // visible at the floor (breaks the tip-canopy illusion so the field
                             // reads point-up). 5-sided cross-section + quadratic taper keep it
                             // reading as a thin needle, not a fat shard.
  const TARGET_BLADES = 80000;  // DIAG: red-tip/blue-base at full density
                                // software-GPU machines (SwiftShader crashed at 250k instances). 80k
                                // 3-sided cones still read as a full field at ~95/m² over the NAP zone.
  const CAND_SPACING  = 0.040;  // fine candidate grid; partial Fisher-Yates selects TARGET_BLADES.

  // Build the N-sided blade as an indexed BufferGeometry: N corner columns
  // around the cross-section x (BLADE_SEGS+1) height rows. Radius tapers from
  // BLADE_R at the base to 0 at the tip; a slight forward curl (z += hr^2*0.06)
  // gives a gentle lean (tips stay upright + pointed, not flopped flat).
  // v0.2.294: 5-sided cross-section (was 3). 3 flat sides at a 6mm base read as
  // fat angular shards; 5 sides is rounder so each blade reads as a thin needle.
  const BLADE_SIDES = 5;
  const _angles = Array.from({ length: BLADE_SIDES }, (_, k) => k * 2 * Math.PI / BLADE_SIDES);
  const _rows = BLADE_SEGS + 1;
  const _gPos = [];
  const _gIdx = [];
  for (let j = 0; j < _rows; j++) {
    const hr = j / BLADE_SEGS;                 // 0..1
    const y  = hr * BLADE_H;
    // v0.2.294: QUADRATIC taper — wide base collapses FAST to a thin point, so the
    // blade reads as a clear cone (wide base -> thin pointy top) and the wide
    // base stays the dominant visible feature at the floor instead of a tip-canopy.
    let taper = (1.0 - hr) * (1.0 - hr);
    if (hr >= 0.999) taper = 0.0;              // sharp point at the tip (in the air)
    const r = BLADE_R * taper;
    // lean peaks at the TIP (hr=1) so the pointed top is what sways.
    const lean = hr * hr * 0.06;
    for (let k = 0; k < BLADE_SIDES; k++) {
      _gPos.push(r * Math.cos(_angles[k]), y, r * Math.sin(_angles[k]) + lean);
    }
  }
  // N side faces, each a quad strip up the height between corner k and k+1.
  for (let j = 0; j < BLADE_SEGS; j++) {
    for (let k = 0; k < BLADE_SIDES; k++) {
      const k2 = (k + 1) % BLADE_SIDES;
      const b0 = j * BLADE_SIDES + k,  b1 = j * BLADE_SIDES + k2;
      const t0 = (j + 1) * BLADE_SIDES + k, t1 = (j + 1) * BLADE_SIDES + k2;
      _gIdx.push(b0, b1, t0,  b1, t1, t0);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(_gPos, 3));
  geo.setIndex(_gIdx);
  geo.computeVertexNormals();   // per-face outward normals -> real 3D two-sided lighting in frag

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime:    { value: 0.0 },
      uWindDir: { value: { x: 0.707, y: 0.707 } },
    },
    vertexShader: /* glsl */`
      varying float vT;       // height ratio 0..1
      varying float vBright;  // per-blade brightness (instanceColor.g)
      varying float vHue;     // per-blade hue shift (instanceColor.b)
      varying vec3  vWn;      // world-space blade facing normal (two-sided lighting in frag)
      uniform float uTime;
      uniform vec2  uWindDir;
      void main() {
        float h = ${BLADE_H.toFixed(4)};
        float t = clamp(position.y / h, 0.0, 1.0);
        vT = t;
        vBright = instanceColor.g;
        vHue = instanceColor.b;

        vec3 p = position;

        // World-space instance origin for the patch-coherent gust field.
        vec3 wpos = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float ph = instanceColor.r * 6.2832;   // per-blade phase

        // v0.2.266 ORGANIC WIND (retained): a low-frequency multi-octave gust
        // envelope built from incommensurate sines, each per-blade phase-shifted,
        // so neighbouring blades desync and patches rise independently - reads as
        // rolling gusts, not a metronome. Layered on top of the demo blade.
        float g1 = sin(wpos.x * 0.21 + uTime * 0.70 + ph);
        float g2 = sin(wpos.z * 0.17 - uTime * 0.50 + ph * 1.7);
        float g3 = sin((wpos.x + wpos.z) * 0.11 + uTime * 0.30 + ph * 0.6);
        float gust = (g1 * 0.5 + g2 * 0.3 + g3 * 0.2) * 0.5 + 0.5;   // 0..1
        gust = smoothstep(0.25, 0.95, gust);

        // High-frequency flutter - independent tip shimmer, different direction/tempo.
        float flut = sin(wpos.x * 1.30 + wpos.z * 0.70 + uTime * 2.20 + ph * 3.1)
                   + cos(wpos.z * 1.10 - wpos.x * 0.50 + uTime * 1.70 - ph * 2.3);

        // heightPower: tips bend most, base stays put (quadratic - from the demo).
        float heightPower = t * t;
        float amp = 0.6 + vBright * 0.4;     // per-blade wind amplitude (demo pattern)
        // v0.2.272: gustier still — heavy gust coefficient so the rolling patch-to-patch
        // variation reads strongly; wind-bend also flops blades over (more ground cover).
        float wind = 0.030 + gust * 0.14 + flut * 0.016;  // v0.2.294: gentler gust (was 0.34) so tips sway, not flop flat
        float sway = wind * heightPower * amp;

        // Apply bend in world space along the gust direction + perpendicular flutter.
        vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
        wp.xyz += vec3(uWindDir.x * sway, 0.0, uWindDir.y * sway);
        wp.x += (-uWindDir.y) * flut * 0.016 * t;
        wp.z += ( uWindDir.x) * flut * 0.016 * t;

        // Vertical compression when bending (demo physics) - keeps arc length believable.
        float totalBend = abs(sway) + abs(flut * 0.016 * t);
        wp.y *= (1.0 - totalBend * 0.1 * heightPower);

        // World facing normal for two-sided lighting in the fragment shader.
        vWn = mat3(modelMatrix * instanceMatrix) * normal;

        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */`
      varying float vT;
      varying float vBright;
      varying float vHue;
      varying vec3  vWn;

      // HSV <-> RGB (from the demo) for per-blade hue/saturation variation.
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
        // v0.2.294: BRIGHT-BASE / SOFT-TIP gradient (INVERTED from the demo).
        // The old dark-root/bright-tip gradient made the WIDE base vanish into
        // the dark ground cover while only the narrow bright tip showed — so the
        // whole field read as 'wide at top, narrow at bottom' (point-down) even
        // though the cone geometry is point-up. Flipping the geometry never
        // helped because the bright tip always dominated the visible mass.
        // Brightening the base above the ground cover (0x3d5a2f ~= 0.24,0.35,0.18)
        // makes the wide base the visible anchor at the floor, so the silhouette
        // reads as a point-up cone: wide bright base -> narrow softer tip.
        vec3 rootCol = vec3(0.27, 0.60, 0.15);  // BRIGHT wide base — lighter than ground cover
        vec3 baseCol = vec3(0.24, 0.55, 0.14);
        vec3 midCol  = vec3(0.21, 0.49, 0.13);
        vec3 tipCol  = vec3(0.18, 0.43, 0.12);  // softer narrow tip (no bright top-heavy mass)

        // Per-blade brightness variation (0.8..1.2).
        float bright = 0.8 + vBright * 0.4;
        rootCol *= bright; baseCol *= bright; midCol *= bright; tipCol *= bright;

        vec3 col;
        if (vT < 0.2)      col = mix(rootCol, baseCol, vT * 5.0);
        else if (vT < 0.7) col = mix(baseCol, midCol,  (vT - 0.2) * 2.0);
        else               col = mix(midCol,  tipCol,  (vT - 0.7) * 3.33);

        // HSV hue shift (+/-5%, stays green) + saturation variation (demo).
        vec3 hsv = rgb2hsv(col);
        hsv.x += (vHue - 0.5) * 0.1;
        hsv.x = fract(hsv.x);
        hsv.y *= (0.85 + vBright * 0.3);
        col = hsv2rgb(hsv);

        // Two-sided diffuse from the world facing normal (flip for back faces)
        // + subsurface back-light (demo) for translucency.
        vec3 wn = normalize(vWn);
        if (!gl_FrontFacing) wn = -wn;
        vec3 L = normalize(vec3(1.0, 1.0, 0.5));
        float NdotL = dot(wn, L);
        float light = NdotL * 0.6 + 0.4;
        light += max(0.0, -NdotL) * 0.3;
        col *= light;

        // Per-pixel micro-noise for natural variation (demo).
        float noise = fract(sin(gl_FragCoord.x * 12.9898 + gl_FragCoord.y * 78.233) * 43758.5453);
        col *= (0.95 + noise * 0.1);

        gl_FragColor = vec4(col, 1.0);
      }
    `,
    side: THREE.DoubleSide,
  });

  // Patch grid confined to NAP-zone footprint — see NAP_GRASS_* constants at
  // the top of the file. Skip any patch that lands within ~1.5u of the tree
  // trunk at (NAP_X+6, 0) so we don't bury the bonsai base in blades.
  // v0.2.272: EXACTLY TARGET_BLADES blades. A fine candidate grid is collected,
  // then a partial Fisher–Yates shuffle selects exactly TARGET_BLADES of them
  // so the field stays evenly thinned (uniform, no clumps) at the requested
  // count rather than being driven by spacing.
  const TREE_X = NAP_X + 6;
  const TREE_Z = 0;
  const TREE_CLEAR_SQ = 1.5 * 1.5;
  const candidates = [];
  for (let x = NAP_GRASS_X0; x <= NAP_GRASS_X1; x += CAND_SPACING) {
    for (let z = NAP_GRASS_Z0; z <= NAP_GRASS_Z1; z += CAND_SPACING) {
      // jitter scaled to spacing so blades stay evenly distributed (no re-clumping)
      const jx = x + (Math.random() - 0.5) * CAND_SPACING * 0.7;
      const jz = z + (Math.random() - 0.5) * CAND_SPACING * 0.7;
      const dx = jx - TREE_X, dz = jz - TREE_Z;
      if (dx * dx + dz * dz < TREE_CLEAR_SQ) continue;
      candidates.push(jx, jz);
    }
  }
  // Partial Fisher–Yates: pick exactly TARGET_BLADES (or fewer if the candidate
  // pool ran short) uniformly at random — keeps the thinning even across the zone.
  const patches = [];
  const pick = Math.min(TARGET_BLADES, Math.floor(candidates.length / 2));
  for (let k = 0; k < pick; k++) {
    const r = k + Math.floor(Math.random() * (Math.floor(candidates.length / 2) - k));
    // swap candidate k and r (each is a (x,z) pair)
    const kx = candidates[k * 2], kz = candidates[k * 2 + 1];
    candidates[k * 2]     = candidates[r * 2];
    candidates[k * 2 + 1] = candidates[r * 2 + 1];
    candidates[r * 2]     = kx;
    candidates[r * 2 + 1] = kz;
    patches.push({
      x: candidates[k * 2],
      z: candidates[k * 2 + 1],
      ry: Math.random() * Math.PI * 2,
      s:  0.85 + Math.random() * 0.35,  // tighter scale variance for even coverage
      phase: Math.random(),
      speed: Math.random(),
      tint:  Math.random(),            // per-blade colour tint (cool→warm green)
      tall:  Math.random() < 0.21,     // v0.2.285: 21% of blades get a further ×1.21 height
    });
  }

  const count = patches.length;
  const mesh  = new THREE.InstancedMesh(geo, mat, count);
  mesh.instanceColor = new THREE.BufferAttribute(new Float32Array(count * 3), 3);

  for (let i = 0; i < count; i++) {
    const p = patches[i];
    _pos.set(p.x, 0, p.z);
    _quat.setFromAxisAngle(_up, p.ry);
    // v0.2.285: non-uniform scale — tall blades get ×1.21 on Y (a further 21% on top
    // of the global +69%). XZ scale stays even so coverage/thinning is unchanged.
    const sy = p.s * (p.tall ? 1.21 : 1.0);
    _scl.set(p.s, sy, p.s);
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
  // v0.2.275: sink the whole field 5cm so blade ROOTS sit below the floor
  // surface (Y=-0.05). Blades are zero-thickness ribbons rooted flush with the
  // floor (Y=0), so the bare floor stays visible through the gaps at ground
  // level no matter how dense the field is. Burying the root line below the
  // floor + the ground-cover plane below occludes that base gap — visible blade
  // now starts at the surface, not on it.
  mesh.position.y = -0.05;

  // v0.2.275: ground-cover mat. Flat dark-green plane 5mm above the floor
  // spanning the full NAP-zone grass footprint. Reads as mossy ground in the
  // gaps between blades so the bare sage floor (0x96A78A) never shows through
  // at the base. Pairs with the root sink above to fully hide the floor.
  const gcX = NAP_GRASS_X0 + NAP_GRASS_W / 2;
  const gcZ = NAP_GRASS_Z0 + NAP_GRASS_D / 2;
  const groundCover = new THREE.Mesh(
    new THREE.PlaneGeometry(NAP_GRASS_W, NAP_GRASS_D),
    new THREE.MeshStandardMaterial({ color: 0x3d5a2f, roughness: 1.0 }),
  );
  groundCover.rotation.x = -Math.PI / 2;
  groundCover.position.set(gcX, 0.005, gcZ);
  groundCover.receiveShadow = true;
  scene.add(groundCover);

  scene.add(mesh);
  _grassMat = mat;
  window._grassMat = mat; // DEPRECATED debug alias (v0.2.118) — internal code uses tickFoliage()/getGrassMat()

  // v0.2.274: diagnostic stamp. Open the browser console (F12) and look for
  // the line starting with [grass-build] — it prints the EXACT params the
  // browser is actually running, so you can confirm whether you're seeing a
  // cached old build or the live one. If this line is missing entirely, the
  // grass code never ran (stale bundle). flare 5.6 + count 500000 = live v0.2.274.
  const stamp = `[grass-build] v0.2.294 blades=${count} bladeR=${BLADE_R} bladeH=${BLADE_H} taper=(1-hr)^2 cross=5-sided POINT-UP lean=0.06 sink=-0.05 groundCover=0x3d5a2f windGust=0.14 tall21pct=x1.21Y tip=up grad=BRIGHT-BASE/SOFT-TIP`;
  console.info(stamp);
  window.__GRASS_BUILD = stamp;
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
