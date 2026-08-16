// atmosphere.js — Torii Quest atmospheric layer (v0.2.482 mountain shader upgrade).
// Mountains (custom ShaderMaterial + procedural detail), instanced boulders,
// drifting ground mist, birds. All pure geometry — zero textures, zero downloads.
// Exported: initAtmosphere(), tickAtmosphere(dt)
import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA_HALF, NAP_FAR_X } from './config.js';

// ── Scratch / shared ─────────────────────────────────────────────────────────────────
const _dummy = new THREE.Object3D();
const _mtnN1 = new THREE.Vector3();
const _mtnN2 = new THREE.Vector3();
const _mtnNr = new THREE.Vector3();

// ── 1. Distant mountain range (v0.2.250, v0.2.482 shader upgrade) ──────────
// Layered 3D range: rounded dawn foothills in the near ring, jagged snow-capped
// alpine peaks in the far ring, fading into warm dawn haze. Real pyramidal geometry
// (not flat billboards) with face-based shading so lit slopes read as solid form.
// One BufferGeometry per ring = 3 draw calls total, zero textures, zero downloads.
//
// v0.2.482: Upgraded from MeshBasicMaterial to a custom ShaderMaterial that adds:
//   - Fresnel rim lighting (Journey-style edge glow catching dawn light)
//   - Procedural triplanar fbm noise for rock grain (zero textures, zero downloads)
//   - Normal perturbation per-fragment for surface detail on flat faces
//   - Altitude-based atmospheric tint (cool low, warm high)
//   - Per-vertex AO from crevice/valley/slope (shader modulates lighting + snow)
//   - Distance LOD (reduced noise detail on mid/far rings)
//   - Proper FogExp2 integration via Three.js fog chunks
//   - Luma cap below bloom threshold (0.86)
// Research: notes/mountain-research.md §6.3, §3.4, §3.3
const _MTN_DAWN = Object.freeze({
  // 3 rings: near (rounded foothills), mid (transitional), far (jagged alpine).
  // snowCaps = exact number of snow-capped peaks in that ring (user: "just a few, ~3").
  rings: [
    { dist:  78, count: 22, hMin: 10, hMax: 20, jag: 0.25, snowCaps: 0, haze: 0.07 }, // near foothills (clear of NAP zone)
    { dist:  96, count: 18, hMin: 20, hMax: 34, jag: 0.55, snowCaps: 0, haze: 0.17 }, // mid
    { dist: 116, count: 14, hMin: 32, hMax: 58, jag: 0.90, snowCaps: 3, haze: 0.30 }, // far alpine (3 snow caps)
  ],
  // Dawn light comes from the east (+x), low on the horizon. Lit slopes warm,
  // shadowed slopes cool. Colours blend by elevation + which way a face points.
  sunDir:   Object.freeze({ x: 0.70, y: 0.42, z: -0.45 }), // higher golden bronze sun
  base:     Object.freeze({ r: 0.30, g: 0.27, b: 0.34 }), // shadowed rock (cool plum-grey)
  lit:      Object.freeze({ r: 0.86, g: 0.66, b: 0.52 }), // dawn-lit warm rock
  foothill: Object.freeze({ r: 0.55, g: 0.60, b: 0.50 }), // soft sage-green for low foothills
  valleyFloor: Object.freeze({ r: 0.40, g: 0.44, b: 0.36 }), // muted lowland green-grey for valley dips
  snow:     Object.freeze({ r: 0.96, g: 0.94, b: 0.90 }), // snow
  snowLit:  Object.freeze({ r: 0.82, g: 0.76, b: 0.66 }), // v0.2.474: dimmed below bloom threshold
  crevice:  Object.freeze({ r: 0.08, g: 0.07, b: 0.10 }), // near-black fissure
  water:    Object.freeze({ r: 0.74, g: 0.93, b: 1.00 }), // bright meltwater cyan-white
  river:    Object.freeze({ r: 0.43, g: 0.72, b: 0.86 }), // glacial runoff blue
  haze:     Object.freeze({ r: 0.92, g: 0.80, b: 0.72 }), // warm peach haze aloft
});

// _mtnLerp(a,b,t) — linear blend between two {r,g,b} colour stops.
function _mtnLerp(a, b, t) {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}
// _mtnFaceShade(baseCol, nxAvg) — tint a base colour warm/cool by which way the
// face points relative to the dawn sun. East-facing (+x) → lit/warm; west → shadow.
function _mtnFaceShade(base, nxAvg) {
  const d = _MTN_DAWN.sunDir.x;       // dawn sun eastward component
  const facing = nxAvg * d;           // -1..1: lit when +, shadowed when -
  if (facing >= 0) return _mtnLerp(base, _MTN_DAWN.lit, facing * 0.7);
  return _mtnLerp(base, _MTN_DAWN.base, -facing * 0.5);
}

// State for animated water features (pulsed in tickAtmosphere).
let _waterfallMesh = null;
const _riverMeshes = [];

// _buildMtnPeak(i, count, ring, opts) — generate a SMOOTH 3D mountain.
// v0.2.493: Indexed shared-vertex geometry (was triangle soup). 3× resolution
// (32 segs × 12 levels vs 12×6) with smooth fBM radial noise and
// computeVertexNormals() for Gouraud shading. Applies the Three.js terrain
// technique: dense grid + multi-octave noise + recomputed shared normals.
// Keeps existing ShaderMaterial, colors, snow, AO — just feeds it smoother data.
// opts: { isSnow, valley, crevices:[{angle,halfWidth}], waterfall }.
// Returns { positions, colors, ao, indices, meta }.
function _buildMtnPeak(i, count, ring, opts) {
  const { isSnow, valley, crevices } = opts;
  const seed = i * 12.9898 + ring.dist * 0.1;
  const rnd = (o) => {
    const s = Math.sin(seed + o * 78.233) * 43758.5453;
    return s - Math.floor(s);
  };
  const ang = (i / count) * Math.PI * 2 + ring.dist * 0.03;
  const cx = Math.cos(ang) * ring.dist;
  const cz = Math.sin(ang) * ring.dist;

  const hVar = ring.hMin + rnd(1) * (ring.hMax - ring.hMin);
  let h = hVar * (1 + (rnd(2) - 0.5) * ring.jag);
  if (valley) h *= 0.28 + rnd(7) * 0.12;

  let rad;
  if (valley)               rad = h * (1.8 + rnd(3) * 0.6);
  else if (ring.jag < 0.4)  rad = h * (1.00 + rnd(3) * 0.50) * 1.30;
  else if (ring.jag < 0.7)  rad = h * (0.65 + rnd(3) * 0.35);
  else                      rad = h * (0.45 + rnd(3) * 0.35);
  rad = Math.min(rad, ring.dist - NAP_FAR_X - 6);

  // v0.2.493: 3× resolution for smooth Gouraud shading (was 9-12 segs, 3-6 levels)
  const segs   = valley ? 24 : (ring.jag < 0.4 ? 28 : (ring.jag < 0.7 ? 30 : 32));
  const levels = valley ? 8  : (ring.jag < 0.4 ? 10 : (ring.jag < 0.7 ? 11 : 12));

  const hasSnow  = isSnow;
  const snowLine = hasSnow ? h * (0.50 + rnd(4) * 0.18) : Infinity;
  const apexDX = (rnd(5) - 0.5) * rad * 0.30 * ring.jag;
  const apexDZ = (rnd(6) - 0.5) * rad * 0.30 * ring.jag;
  const sun = _MTN_DAWN.sunDir;

  // v0.2.493: Smooth multi-octave angular noise for flowing ridgelines.
  // Replaces per-vertex pseudo-random hash that created jittery edges at
  // higher resolution. 4 octaves of sine at increasing frequency.
  function fbmAngle(angle, t) {
    let v = 0, a = 0.5;
    for (let oct = 0; oct < 4; oct++) {
      v += a * Math.sin(angle * (3 + oct * 4) + seed + t * 2.0);
      a *= 0.5;
    }
    return v; // ~-1..1
  }

  function creviceFactor(a, t) {
    let f = 0;
    if (crevices) {
      for (const c of crevices) {
        let d = Math.abs(((a - c.angle + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
        if (d < c.halfWidth) {
          const band = 1 - d / c.halfWidth;
          const heightFade = Math.max(0, 1 - t * 1.4);
          f = Math.max(f, band * heightFade);
        }
      }
    }
    return f;
  }

  // v0.2.493: Per-vertex color (was per-triangle). Computes facing from
  // radial direction instead of face normal, since normals aren't available
  // until after computeVertexNormals().
  function vertexColor(x, y, z, a, t, crv) {
    const dx = x - (cx + apexDX * t);
    const dz = z - (cz + apexDZ * t);
    const rLen = Math.sqrt(dx * dx + dz * dz) || 1;
    const nxAvg = dx / rLen;
    const nzAvg = dz / rLen;
    const facing = nxAvg * sun.x + nzAvg * sun.z;

    const faceAngle = Math.atan2(nzAvg, nxAvg);
    const snowWobble = 0.12 * Math.sin(seed * 2.1 + faceAngle * 3.7);
    const leewardBias = (nxAvg * sun.x + nzAvg * sun.z) < 0 ? -0.06 : 0.05;
    const snowEdge = hasSnow ? snowLine * (0.88 + snowWobble + leewardBias) : Infinity;
    const aboveSnow = y > snowEdge;

    const creviceSnow = hasSnow && crv > 0.25 && y > h * 0.45
      ? Math.min(0.55, crv * (y - h * 0.45) / (h * 0.3))
      : 0;

    let baseCol;
    if (aboveSnow || creviceSnow > 0.35) {
      baseCol = _MTN_DAWN.snow;
    } else if (valley) {
      baseCol = _MTN_DAWN.valleyFloor;
    } else if (ring.jag < 0.4) {
      baseCol = _MTN_DAWN.foothill;
    } else {
      const rockBase = y > h * 0.5
        ? _mtnLerp(_MTN_DAWN.base, _MTN_DAWN.foothill, 0.25)
        : _MTN_DAWN.base;
      const slopeApprox = t < 0.15 ? 0.3 : 0.6;
      baseCol = _mtnLerp(rockBase, _MTN_DAWN.crevice, slopeApprox * 0.12);
    }

    let col;
    if (facing >= 0) {
      col = aboveSnow
        ? _mtnLerp(baseCol, _MTN_DAWN.snowLit, facing * 0.5)
        : _mtnLerp(baseCol, _MTN_DAWN.lit,     facing * 0.6);
    } else {
      col = _mtnLerp(baseCol, _MTN_DAWN.base, -facing * 0.5);
    }
    if (crv > 0 && creviceSnow < 0.3) {
      col = _mtnLerp(col, _MTN_DAWN.crevice, crv * 0.85);
    } else if (creviceSnow > 0) {
      col = _mtnLerp(col, _MTN_DAWN.snow, creviceSnow * 0.35);
    }
    return col;
  }

  // v0.2.493: Per-vertex AO (was per-triangle slope/valley AO)
  function vertexAO(y, t, crv) {
    const valleyAO = y < h * 0.15 ? 0.30 : 0;
    const slopeAO = t > 0.3 ? (t - 0.3) * 0.10 : 0;
    return Math.max(0.15, 1 - crv * 0.55 - valleyAO - slopeAO);
  }

  // Build shared vertex grid: levels rows × segs columns + 1 apex vertex.
  // Vertex index = L * segs + s for L < levels; apex index = levels * segs.
  const positions = [];
  const colors = [];
  const aoArr = [];
  const indices = [];

  for (let L = 0; L <= levels; L++) {
    const t = L / levels;
    const y = t * h;
    const shrink = (valley || ring.jag < 0.4)
      ? Math.cos(t * Math.PI * 0.5)
      : Math.pow(1 - t, 0.85);
    const rBase = rad * shrink;

    if (L === levels) {
      // Apex — single shared vertex
      const ax = cx + apexDX, ay = h, az = cz + apexDZ;
      positions.push(ax, ay, az);
      const crv = creviceFactor(0, 1);
      const col = vertexColor(ax, ay, az, 0, 1, crv);
      colors.push(col.r, col.g, col.b);
      aoArr.push(vertexAO(ay, 1, crv));
    } else {
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const crag = 1 + fbmAngle(a, t) * ring.jag * 0.55 * (0.35 + t * 0.65);
        const rr = rBase * crag;
        const px = cx + Math.cos(a) * rr + apexDX * t;
        const py = y;
        const pz = cz + Math.sin(a) * rr + apexDZ * t;
        positions.push(px, py, pz);
        const crv = creviceFactor(a, t);
        const col = vertexColor(px, py, pz, a, t, crv);
        colors.push(col.r, col.g, col.b);
        aoArr.push(vertexAO(py, t, crv));
      }
    }
  }

  const apexIdx = levels * segs;

  // Index buffer: side faces between consecutive levels
  for (let L = 0; L < levels; L++) {
    for (let s = 0; s < segs; s++) {
      const s2 = (s + 1) % segs;
      const v00 = L * segs + s;
      const v01 = L * segs + s2;
      if (L + 1 === levels) {
        indices.push(v00, v01, apexIdx);
      } else {
        const v10 = (L + 1) * segs + s;
        const v11 = (L + 1) * segs + s2;
        indices.push(v00, v01, v11);
        indices.push(v00, v11, v10);
      }
    }
  }

  return { positions, colors, ao: aoArr, indices, meta: { cx, cz, h, ang, rad, waterfall: opts.waterfall } };
}

// ── Mountain ShaderMaterial (v0.2.482) ──────────────────────────────────────
// Custom shader replacing MeshBasicMaterial. Adds:
//   - Fresnel rim lighting (Journey-style edge glow catching dawn light)
//   - Procedural triplanar fbm noise for rock grain (zero textures)
//   - Normal perturbation per-fragment for surface detail on flat faces
//   - Altitude-based atmospheric tint (cool low, warm high)
//   - Per-vertex AO from crevice/valley/slope (shader modulates lighting + snow)
//   - Distance LOD (reduced noise detail on mid/far rings)
//   - Proper FogExp2 integration via Three.js fog chunks
//   - Luma cap below bloom threshold (0.86)
// Research: notes/mountain-research.md §6.3, §3.4, §3.3
function _createMountainMaterial(ringIndex) {
  const sunVec = new THREE.Vector3(_MTN_DAWN.sunDir.x, _MTN_DAWN.sunDir.y, _MTN_DAWN.sunDir.z).normalize();
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uSunDir:     { value: sunVec },
      uDetailStr:  { value: ringIndex === 0 ? 0.55 : ringIndex === 1 ? 0.32 : 0.14 },
      uRimColor:  { value: new THREE.Color(_MTN_DAWN.snowLit.r, _MTN_DAWN.snowLit.g, _MTN_DAWN.snowLit.b) },
    },
  ]);

  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `
      attribute float aAo;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying float vAo;
      varying vec3 vViewDir;
      #include <fog_pars_vertex>
      void main() {
        vColor = color;
        vAo = aAo;
        vec4 localPos = vec4(position, 1.0);
        vec3 localNormal = normal;
        #ifdef USE_INSTANCING
          localPos = instanceMatrix * localPos;
          localNormal = mat3(instanceMatrix) * localNormal;
        #endif
        vec4 worldPos = modelMatrix * localPos;
        vWorldPos = worldPos.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * localNormal);
        vViewDir = normalize(cameraPosition - worldPos.xyz);
        vec4 mvPosition = viewMatrix * worldPos;
        #include <fog_vertex>
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vColor;
      varying float vAo;
      varying vec3 vViewDir;
      uniform vec3 uSunDir;
      uniform float uDetailStr;
      uniform vec3 uRimColor;
      #include <fog_pars_fragment>

      // --- Procedural noise (hash → value noise → fbm) ---
      float hash3(vec3 p) {
        return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      }
      float noise3(vec3 p) {
        vec3 i = floor(p);
        vec3 f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        float n000 = hash3(i);
        float n100 = hash3(i + vec3(1.0, 0.0, 0.0));
        float n010 = hash3(i + vec3(0.0, 1.0, 0.0));
        float n110 = hash3(i + vec3(1.0, 1.0, 0.0));
        float n001 = hash3(i + vec3(0.0, 0.0, 1.0));
        float n101 = hash3(i + vec3(1.0, 0.0, 1.0));
        float n011 = hash3(i + vec3(0.0, 1.0, 1.0));
        float n111 = hash3(i + vec3(1.0, 1.0, 1.0));
        float nx00 = mix(n000, n100, f.x);
        float nx10 = mix(n010, n110, f.x);
        float nx01 = mix(n001, n101, f.x);
        float nx11 = mix(n011, n111, f.x);
        float nxy0 = mix(nx00, nx10, f.y);
        float nxy1 = mix(nx01, nx11, f.y);
        return mix(nxy0, nxy1, f.z);
      }
      float fbm3(vec3 p) {
        float v = 0.0;
        float a = 0.5;
        for (int i = 0; i < 3; i++) {
          v += a * noise3(p);
          p *= 2.07;
          a *= 0.5;
        }
        return v;
      }

      void main() {
        vec3 n = normalize(vWorldNormal);
        n = gl_FrontFacing ? n : -n;  // DoubleSide fix

        // --- Triplanar fbm noise for rock detail (2 samples per axis, 3 octaves) ---
        vec3 blend = abs(n);
        float bsum = max(blend.x + blend.y + blend.z, 0.0001);
        blend /= bsum;
        vec3 sp = vWorldPos * 0.25;
        float rockNoise = fbm3(sp.yzx) * blend.x
                        + fbm3(sp.xzy) * blend.y
                        + fbm3(sp.xyz) * blend.z;

        // --- Normal perturbation (cheap — offsets normal by noise gradient) ---
        float perturb = (rockNoise - 0.5) * uDetailStr * 0.35;
        vec3 perturbed = normalize(n + vec3(perturb, perturb * 0.25, perturb));

        // --- Diffuse lighting with enhanced contrast (Journey-style) ---
        float facing = dot(perturbed, uSunDir);
        float diffuse = 0.42 + 0.58 * max(facing, 0.0);

        // --- Base color from vertex colors (already baked with dawn shading) ---
        vec3 base = vColor;

        // --- Altitude tint: cool skylight low, warm dawn light high ---
        float alt = clamp(vWorldPos.y / 58.0, 0.0, 1.0);
        base *= mix(vec3(0.76, 0.77, 0.81), vec3(1.02, 0.96, 0.86), alt);

        // --- Apply diffuse contrast ---
        vec3 lit = base * diffuse;

        // --- Rock grain modulation ---
        lit *= 0.88 + 0.22 * rockNoise * uDetailStr;

        // --- Fresnel rim lighting (Journey-style edge glow) ---
        float fres = pow(1.0 - max(dot(n, vViewDir), 0.0), 3.0);
        lit += uRimColor * fres * 0.28;

        // --- AO darkening on crevices/valleys/overhangs ---
        lit *= 0.60 + 0.40 * vAo;

        // --- Luma cap below bloom threshold (0.86) ---
        float luma = dot(lit, vec3(0.299, 0.587, 0.114));
        if (luma > 0.80) lit *= 0.80 / luma;

        gl_FragColor = vec4(lit, 1.0);
        #include <fog_fragment>
      }
    `,
    vertexColors: true,
    fog: true,
    side: THREE.DoubleSide,
  });
}

function _buildMountains() {
  const wfMetas = []; // peaks flagged for a waterfall
  let ringIdx = 0;
  for (const ring of _MTN_DAWN.rings) {
    const allP = [];
    const allC = [];
    const allA = []; // v0.2.482: AO values
    const allI = []; // v0.2.493: index buffer for shared-vertex geometry
    let vertOffset = 0;
    // Designate snow-cap peaks: spread `snowCaps` indices around the ring.
    const snowIdx = new Set();
    for (let k = 0; k < ring.snowCaps; k++) {
      snowIdx.add(Math.floor(((k + 0.5) / ring.snowCaps) * ring.count));
    }
    // Designate waterfall peaks: 2 on the far ring, 1 on the mid ring.
    const wfTargets = ring.jag > 0.8 ? [0.30, 0.72] : (ring.jag > 0.5 ? [0.35] : []);
    const wfIdx = new Set();
    for (const f of wfTargets) {
      let idx = Math.floor(f * ring.count);
      while (snowIdx.has(idx)) idx = (idx + 1) % ring.count; // nudge off snow peaks
      wfIdx.add(idx);
    }
    for (let i = 0; i < ring.count; i++) {
      const seed = i * 12.9898 + ring.dist * 0.1;
      const prnd = (o) => { const s = Math.sin(seed + o * 78.233) * 43758.5453; return s - Math.floor(s); };
      // ~22% of non-snow peaks become valleys (low dips in the silhouette).
      const valley = !snowIdx.has(i) && prnd(30) < 0.22;
      // 1-2 crevice bands per peak (deterministic) — vertical fissures down faces.
      const nCrev = ring.jag < 0.4 ? 1 : 2;
      const crevices = [];
      for (let c = 0; c < nCrev; c++) {
        crevices.push({ angle: prnd(40 + c) * Math.PI * 2, halfWidth: 0.10 + prnd(50 + c) * 0.10 });
      }
      const p = _buildMtnPeak(i, ring.count, ring, {
        isSnow: snowIdx.has(i),
        valley,
        crevices,
        waterfall: wfIdx.has(i),
      });
      allP.push(...p.positions);
      allC.push(...p.colors);
      allA.push(...p.ao);
      for (let k = 0; k < p.indices.length; k++) allI.push(p.indices[k] + vertOffset);
      vertOffset += p.positions.length / 3;
      if (p.meta.waterfall) wfMetas.push(p.meta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(allP, 3));
    geo.setAttribute('color',    new THREE.Float32BufferAttribute(allC, 3));
    geo.setAttribute('aAo',      new THREE.Float32BufferAttribute(allA, 1));
    geo.setIndex(allI); // v0.2.493: indexed geometry for smooth normals
    // Per-vertex haze blend toward warm dawn colour by elevation: peaks catch more
    // haze aloft, bases stay grounded. Done via vertex colour (zero shader cost).
    // v0.2.482: Far ring desaturates harder toward sky color (Firewatch depth cue).
    const haze = _MTN_DAWN.haze;
    const colAttr = geo.getAttribute('color');
    const posAttr = geo.getAttribute('position');
    const ringHMax = ring.hMax;
    const desatAmt = ringIdx === 2 ? 0.28 : ringIdx === 1 ? 0.14 : 0.05;
    const skyR = 0.80, skyG = 0.74, skyB = 0.70; // desaturated warm sky-grey
    for (let k = 0; k < colAttr.count; k++) {
      const y = posAttr.getY(k);
      const ht = Math.min(1, y / ringHMax);          // 0 at base → 1 at peak
      const hazeMix = ring.haze * (0.4 + ht * 0.6);  // more haze aloft
      let r = colAttr.getX(k) + (haze.r - colAttr.getX(k)) * hazeMix;
      let g = colAttr.getY(k) + (haze.g - colAttr.getY(k)) * hazeMix;
      let b = colAttr.getZ(k) + (haze.b - colAttr.getZ(k)) * hazeMix;
      // Desaturation toward sky color (stronger on far ring, by altitude)
      const dm = desatAmt * ht;
      r += (skyR - r) * dm;
      g += (skyG - g) * dm;
      b += (skyB - b) * dm;
      colAttr.setXYZ(k, r, g, b);
    }
    colAttr.needsUpdate = true;
    geo.computeVertexNormals(); // v0.2.493: smooth Gouraud normals on shared vertices
    // v0.2.482: Custom ShaderMaterial replaces MeshBasicMaterial.
    // Unlocks Fresnel rim, procedural rock noise, altitude tint, AO.
    const mat = _createMountainMaterial(ringIdx);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    scene.add(mesh);
    ringIdx++;
  }
  _buildWaterfalls(wfMetas);
  // v0.2.488: rivers REMOVED — diagonal ground ribbons were showing through
  // the water as parallel lines beneath the island. User asked to remove the layer.
  // _buildRivers(wfMetas);
  _buildBoulders(); // v0.2.482: instanced procedural rocks on near ring
}

// ── Instanced boulders (v0.2.482) ────────────────────────────────────────────
// Procedural low-poly rocks (icosahedron + noise displacement) scattered on the
// near ring's mountain bases. One InstancedMesh = one draw call, zero textures.
// Research: notes/mountain-research.md §1.8
const _BOULDER_COUNT = 30;
let _boulderMesh = null;

function _buildBoulders() {
  // Procedural rock geometry: icosahedron with noise-displaced vertices.
  const geo = new THREE.IcosahedronGeometry(1, 1); // subdiv 1 → 80 faces
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const n = Math.sin(x * 4.3 + y * 2.7) * Math.cos(z * 3.1) * 0.25
            + Math.sin(x * 8.1 + z * 5.3) * 0.12;
    const len = Math.sqrt(x * x + y * y + z * z) || 1;
    pos.setXYZ(i, x + (x / len) * n, y + (y / len) * n, z + (z / len) * n);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  // Vertex colors matching mountain rock palette.
  const colArr = new Float32Array(pos.count * 3);
  const c = _MTN_DAWN.base;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = Math.max(0, Math.min(1, y * 0.5 + 0.5));
    colArr[i * 3]     = c.r * (0.65 + f * 0.55);
    colArr[i * 3 + 1] = c.g * (0.65 + f * 0.55);
    colArr[i * 3 + 2] = c.b * (0.65 + f * 0.55);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colArr, 3));
  // AO attribute — all 0.7 (slightly darkened rock, no crevice/valley variation).
  const aoArr = new Float32Array(pos.count);
  aoArr.fill(0.7);
  geo.setAttribute('aAo', new THREE.Float32BufferAttribute(aoArr, 1));

  // Same mountain shader with near-ring detail level.
  const mat = _createMountainMaterial(0);
  _boulderMesh = new THREE.InstancedMesh(geo, mat, _BOULDER_COUNT);
  _boulderMesh.frustumCulled = false;

  // Place boulders near the near ring's mountain bases (outside the playfield).
  const nearRing = _MTN_DAWN.rings[0];
  for (let i = 0; i < _BOULDER_COUNT; i++) {
    const ang = (i / _BOULDER_COUNT) * Math.PI * 2 + Math.sin(i * 7.3) * 0.4;
    const r = nearRing.dist - 4 - Math.abs(Math.sin(i * 2.1)) * 10;
    const scale = 0.7 + Math.abs(Math.sin(i * 3.7)) * 1.5;
    _dummy.position.set(Math.cos(ang) * r, 0.3, Math.sin(ang) * r);
    _dummy.rotation.set(
      Math.sin(i * 1.3) * 0.3,
      (i / _BOULDER_COUNT) * Math.PI * 2,
      Math.cos(i * 2.7) * 0.3,
    );
    _dummy.scale.setScalar(scale);
    _dummy.updateMatrix();
    _boulderMesh.setMatrixAt(i, _dummy.matrix);
  }
  _boulderMesh.instanceMatrix.needsUpdate = true;
  scene.add(_boulderMesh);
}

// ── Waterfalls (v0.2.250) ────────────────────────────────────────────────────
// Thin bright vertical strips cascading down the arena-facing flank of a few
// tall peaks. Built into ONE BufferGeometry (one draw call), additive-blended so
// the meltwater glows against the rock. Pulse-animated in tickAtmosphere.
function _buildWaterfalls(metas) {
  if (!metas.length) return;
  const verts = [];
  const colors = [];
  const W = 1.2; // strip width
  for (const m of metas) {
    const arenaDir = Math.atan2(-m.cz, -m.cx);       // angle from peak toward origin
    const ca = Math.cos(arenaDir), sa = Math.sin(arenaDir);
    // Sit the fall on the arena-facing flank (near the foot) so it's visible.
    const offset = m.rad * 0.85;
    const bx = m.cx + ca * offset;
    const bz = m.cz + sa * offset;
    const yTop = m.h * 0.60;
    const yBot = 0;
    // Width axis perpendicular to arenaDir in XZ; quad built in world space.
    const px = -sa, pz = ca;
    const hw = W / 2;
    const p = [
      [bx + px * -hw, yTop, bz + pz * -hw], // top-left
      [bx + px *  hw, yTop, bz + pz *  hw], // top-right
      [bx + px *  hw, yBot, bz + pz *  hw], // bot-right
      [bx + px * -hw, yBot, bz + pz * -hw], // bot-left
    ];
    const cTop = _MTN_DAWN.water;
    const cBot = { r: cTop.r * 0.65, g: cTop.g * 0.82, b: cTop.b };
    const colOf = (y) => _mtnLerp(cBot, cTop, (y - yBot) / (yTop - yBot));
    const tris = [[0, 1, 2], [0, 2, 3]];
    for (const [ia, ib, ic] of tris) {
      verts.push(p[ia][0], p[ia][1], p[ia][2], p[ib][0], p[ib][1], p[ib][2], p[ic][0], p[ic][1], p[ic][2]);
      const col = colOf((p[ia][1] + p[ib][1] + p[ic][1]) / 3);
      for (let v = 0; v < 3; v++) colors.push(col.r, col.g, col.b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity: 0.82,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: true,
  });
  _waterfallMesh = new THREE.Mesh(geo, mat);
  _waterfallMesh.frustumCulled = false;
  scene.add(_waterfallMesh);
}

// ── Rivers (v0.2.250) ─────────────────────────────────────────────────────────
// Winding ground ribbons flowing from waterfall bases toward the arena edge
// (stopping clear of the NAP zone). Flat triangle strips at y≈0.12, semi-
// transparent glacial blue. Up to 2 rivers, each its own small mesh.
function _buildGroundRibbon(path, width, colorHex, opacity, y) {
  const verts = [];
  const cols = [];
  const c = new THREE.Color(colorHex);
  const hw = width / 2;
  for (let k = 0; k < path.length - 1; k++) {
    const [x0, z0] = path[k], [x1, z1] = path[k + 1];
    const dx = x1 - x0, dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len * hw, nz = dx / len * hw; // perpendicular in XZ
    const p0 = [x0 + nx, y, z0 + nz], p1 = [x0 - nx, y, z0 - nz];
    const p2 = [x1 - nx, y, z1 - nz], p3 = [x1 + nx, y, z1 + nz];
    verts.push(...p0, ...p1, ...p2,  ...p0, ...p2, ...p3);
    for (let v = 0; v < 6; v++) cols.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color',    new THREE.Float32BufferAttribute(cols, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshBasicMaterial({
    vertexColors: true, transparent: true, opacity, depthWrite: false,
    side: THREE.DoubleSide, fog: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);
  return mesh;
}

function _buildRivers(metas) {
  // One winding ground ribbon from up to 2 waterfall bases toward the arena edge.
  const sources = metas.slice(0, 2);
  let idx = 0;
  for (const m of sources) {
    const arenaDir = Math.atan2(-m.cz, -m.cx);
    const ca = Math.cos(arenaDir), sa = Math.sin(arenaDir);
    const offset = m.rad * 0.85;                       // start at the fall's base
    const startX = m.cx + ca * offset, startZ = m.cz + sa * offset;
    const endDist = NAP_FAR_X + 6;                       // stop clear of NAP zone
    const endX = ca * endDist, endZ = sa * endDist;
    const perpX = -sa, perpZ = ca;
    const N = 10;
    const pts = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const bx = startX + (endX - startX) * t;
      const bz = startZ + (endZ - startZ) * t;
      // Wiggle perpendicular to the flow; gentler near the arena edge.
      const wig = Math.sin(t * Math.PI * 3 + idx * 1.7) * (1.6 * (1 - t * 0.6));
      pts.push([bx + perpX * wig, bz + perpZ * wig]);
    }
    _riverMeshes.push(_buildGroundRibbon(pts, 1.7, 0x6fb8d6, 0.5, 0.12 + idx * 0.01));
    idx++;
  }
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
const _MIST_COUNT = 18;
const _ARENA_SWIRL_COUNT = 24;
const _mistMeshes = [];
const _arenaSwirls = []; // { sprite, baseX, baseZ, baseY, phase, ampX, ampZ, life, lifeMax, baseScale, ... }
let   _mistUTime  = 0;

// Canvas-painted soft puff texture — radial gradient, hot turquoise core fading
// to fully transparent edge. Cached and shared by every swirl sprite so the
// texture cost is paid once.
let _puffTexture = null;
function _buildPuffTexture() {
  if (_puffTexture) return _puffTexture;
  const SIZE = 128;
  const cvs  = document.createElement('canvas');
  cvs.width = SIZE; cvs.height = SIZE;
  const ctx = cvs.getContext('2d');
  const grad = ctx.createRadialGradient(SIZE/2, SIZE/2, 0, SIZE/2, SIZE/2, SIZE/2);
  grad.addColorStop(0.00, 'rgba(190, 240, 230, 0.70)');
  grad.addColorStop(0.25, 'rgba(140, 220, 205, 0.40)');
  grad.addColorStop(0.55, 'rgba(100, 210, 190, 0.15)');
  grad.addColorStop(1.00, 'rgba(100, 210, 190, 0.00)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, SIZE, SIZE);
  _puffTexture = new THREE.CanvasTexture(cvs);
  _puffTexture.colorSpace = THREE.SRGBColorSpace;
  return _puffTexture;
}

// Arena swirls — volumetric-feel smoke puffs. Each puff is a camera-facing
// THREE.Sprite using the soft radial-gradient canvas texture, additively
// blended so overlapping puffs build into a glowing low haze. Each puff drifts
// slowly upward, fades in over its first 20% of life, holds, then fades out
// and respawns near the floor. Reads as drifting smoke instead of flat slabs.
function _buildArenaSwirls() {
  const tex = _buildPuffTexture();

  for (let i = 0; i < _ARENA_SWIRL_COUNT; i++) {
    const mat = new THREE.SpriteMaterial({
      map: tex,
      color: 0x7fd9c8,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: false,
      blending: THREE.AdditiveBlending,
    });
    const sp = new THREE.Sprite(mat);
    const baseScale = 5.0 + Math.random() * 4.5;
    sp.scale.set(baseScale, baseScale, 1);
    sp.renderOrder = 2;
    sp.frustumCulled = false;

    const baseX = (Math.random() - 0.5) * (ARENA_HALF * 2 - 4);
    const baseZ = (Math.random() - 0.5) * (ARENA_HALF * 2 - 4);
    const y     = 0.25 + Math.random() * 0.5;
    sp.position.set(baseX, y, baseZ);
    scene.add(sp);

    const lifeMax = 4.5 + Math.random() * 3.5;
    _arenaSwirls.push({
      sprite: sp,
      baseX, baseZ, baseY: y,
      phase:     Math.random() * Math.PI * 2,
      ampX:      0.4 + Math.random() * 0.9,
      ampZ:      0.4 + Math.random() * 0.9,
      rise:      0.18 + Math.random() * 0.22,
      maxOpacity:0.20 + Math.random() * 0.18,
      baseScale,
      lifeMax,
      life:      Math.random() * lifeMax,
    });
  }
}

function _buildMist() {
  const mat = new THREE.MeshBasicMaterial({
    color: 0xd4eaf5,
    transparent: true,
    // Lowered 0.045 → 0.028 (v0.2.342): on the new sandy ground the near-flat mist
    // planes were starting to read as stray sheets; keep them as barely-there haze.
    opacity: 0.028,
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

  // Waterfall shimmer — gentle brightness pulse so the meltwater reads alive.
  if (_waterfallMesh) {
    _waterfallMesh.material.opacity = 0.70 + Math.sin(_mistUTime * 2.4) * 0.10;
  }

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

  // Arena swirls — billboard smoke puffs with birth/drift/death lifecycle.
  // Each puff rises slowly, drifts in a small ellipse, fades in then out, and
  // respawns near the floor at a fresh ground position. Sprites auto-face the
  // camera so the result reads volumetric without needing real volumetric fog.
  for (const s of _arenaSwirls) {
    s.life += dt;
    if (s.life >= s.lifeMax) {
      s.life   = 0;
      s.baseX  = (Math.random() - 0.5) * (ARENA_HALF * 2 - 4);
      s.baseZ  = (Math.random() - 0.5) * (ARENA_HALF * 2 - 4);
      s.baseY  = 0.25 + Math.random() * 0.4;
      s.phase  = Math.random() * Math.PI * 2;
      s.lifeMax = 4.5 + Math.random() * 3.5;
      s.baseScale = 5.0 + Math.random() * 4.5;
    }

    const lt = s.life / s.lifeMax;
    let alpha;
    if (lt < 0.20)      alpha = lt / 0.20;
    else if (lt > 0.70) alpha = (1.0 - lt) / 0.30;
    else                alpha = 1.0;
    s.sprite.material.opacity = alpha * s.maxOpacity;

    const t = _mistUTime;
    s.sprite.position.x = s.baseX + Math.cos(t * 0.35 + s.phase) * s.ampX;
    s.sprite.position.z = s.baseZ + Math.sin(t * 0.30 + s.phase) * s.ampZ;
    s.sprite.position.y = s.baseY + s.rise * s.life;

    const swell = 1.0 + lt * 0.45;
    s.sprite.scale.set(s.baseScale * swell, s.baseScale * swell, 1);
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
