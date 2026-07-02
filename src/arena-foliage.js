// arena-foliage.js — instanced grass blades + wildflowers. 2 draw calls total.
// Confined to the NAP Zone only (east of the torii gate) so the main arena
// reads as a clean turquoise underlit floor with mist swirls.
import * as THREE from 'three';
import { scene } from './scene.js';
import { ARENA_HALF, NAP_X, NAP_FAR_X, CRATES } from './config.js';
import { sampleNapHeight, sampleArenaHeight, riverCenterX, RIVER_HALF } from './terrain/heightmap.js';
import { SEA_LEVEL } from './terrain/seaConfig.js';

// Blades within the meandering river band (|x − riverCenterX(z)| < RIVER_HALF,
// Stage 5) would stand in / over the water, so exclude them from both zones'
// candidates. The band follows the curved centreline, so the test is z-aware.
const inRiver = (x, z) => Math.abs(x - riverCenterX(z)) < RIVER_HALF;

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

// Arena footprint (west of the gate), inset from the walls so blades don't poke
// through them. Stage 3 (v0.2.329): grass now covers the arena island too, tinted
// purple→orange (vs the NAP zone's green) via a per-blade zone flag.
const ARENA_GRASS_X0 = -ARENA_HALF + 1.0;
const ARENA_GRASS_X1 =  ARENA_HALF - 1.0;
const ARENA_GRASS_Z0 = -ARENA_HALF + 1.0;
const ARENA_GRASS_Z1 =  ARENA_HALF - 1.0;

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

// v0.2.311: JS smoothstep (GLSL has it built in, JS does not). Used by the
// procedural blade/noise texture generators in _buildGrass. The earlier green
// pass (v0.2.310) called smoothstep() in JS, throwing ReferenceError on Enter
// Nap Zone and leaving the arena in a broken black-screen state.
function smoothstep(edge0, edge1, x) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function buildFoliage() {
  _buildGrass();
  // v0.2.312: wildflowers + tulips removed at user request (grass-only NAP zone).
  // _buildWildflowers();
  // _buildTulips();
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

// ── Instanced grass (terra port, v0.2.310 — GREEN PASS) ──────────────────────
// spacejack/terra flat-ribbon instanced grass (MIT, © 2016-2017 Mike Linkovich).
// v0.2.309 proved the shape: the flat ribbon's geometric tip taper (1 - hpct^3)
// reads as a true point from every angle, and the per-vertex curve*hpct rotation
// bends each blade as one continuous curve — fixing the two issues the solid
// cone (v0.2.286-308) plateaued on. The user confirmed "best grass by a long
// way" on the v0.2.309 diagnostic.
//
// This GREEN PASS completes the terra port: procedural grass blade texture +
// noise texture (no npm dep, generated as DataTextures at runtime), terra's
// noise-texture wind (the big visual win over the cone's sin-gust), directional
// sun + ambient + ambient-occlusion lighting, and hand-wired exponential-squared
// fog matched to the arena's FogExp2(0xc8dde8, 0.008).
//
// DIAGNOSTIC PRESERVED: a uMode uniform (0=green/lit, 1=blue→red diagnostic)
// lets the blue/red look the user called "very cool" be toggled back instantly
// from the console: window._grassMat.uniforms.uMode.value = 1
//
// Paradigm: InstancedBufferGeometry + RawShaderMaterial. NO instanceMatrix —
// positions computed in-shader from a `vindex` attribute; per-blade data in two
// vec4 instanced attributes: `offset` (x, z, _, rot) and `shape` (width, height,
// lean, curve). Y-up: blade grows +Y, ground is XZ, bend plane is Y/Z, blade
// yaw rotates X/Z. (Z-up→Y-up conversion applied to terra's original GLSL.)
function _buildGrass() {
  const BLADE_SEGS   = 5;
  const BLADE_VERTS  = (BLADE_SEGS + 1) * 2;
  const BLADE_INDICES = BLADE_SEGS * 12;
  const BLADE_WIDTH  = 0.050;
  const BLADE_HEIGHT_MIN = 0.42;
  const BLADE_HEIGHT_MAX = 0.58;
  // v0.2.314: doubled density to fill gaps. v0.2.329: grass now spans BOTH the NAP
  // footprint (~874 sq units) AND the arena footprint (~1444 sq units, ~2318 total).
  // 110k blades ≈ 47 blades/sq unit across both zones → a continuous sward without
  // the huge instance count a full-density arena would need. Candidates from both
  // zones are interleaved then Fisher–Yates thinned to TARGET_BLADES.
  const TARGET_BLADES = 110000;
  const CAND_SPACING  = 0.032;

  // ── Procedural grass blade texture (no asset file, DataTexture) ───────────
  // 8x64 RGBA. Vertical blade: soft alpha edges + faint midrib + green gradient
  // (darker base → brighter mid → pale tip). Sampled with RepeatWrapping on T.
  function makeBladeTexture() {
    const W = 8, H = 64;
    const data = new Uint8Array(W * H * 4);
    for (let y = 0; y < H; y++) {
      const v = y / (H - 1);                  // 0 base .. 1 tip
      for (let x = 0; x < W; x++) {
        const u = x / (W - 1) - 0.5;          // -0.5..0.5 across blade width
        // Green gradient: rich base green → lighter mid → pale yellow-green tip
        const r = 0.27 + (0.18 - 0.27) * v;
        const g = 0.60 + (0.43 - 0.60) * v;
        const b = 0.15 + (0.12 - 0.15) * v;
        // Faint midrib (centre column slightly brighter)
        const rib = 1.0 - smoothstep(0.0, 0.18, Math.abs(u));
        // Soft alpha edge so blade silhouette isn't a hard rectangle
        const edge = 1.0 - smoothstep(0.30, 0.50, Math.abs(u));
        // Tip tapers in alpha too (top 15% fades to soft point)
        const tipFade = 1.0 - smoothstep(0.85, 1.0, v) * 0.6;
        const a = Math.max(edge, 0.0) * tipFade;
        const o = (y * W + x) * 4;
        data[o + 0] = Math.min(255, (r + rib * 0.05) * 255);
        data[o + 1] = Math.min(255, (g + rib * 0.08) * 255);
        data[o + 2] = Math.min(255, (b + rib * 0.03) * 255);
        data[o + 3] = Math.min(255, a * 255);
      }
    }
    const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  // ── Procedural noise texture (wind driver, DataTexture) ───────────────────
  // 64x64 RGB smoothed value noise. Green channel is sampled with a time offset
  // to drive organic, non-repeating wind gusts across the field (terra's trick:
  // "using the lighting channel as noise makes the best looking wind").
  function makeNoiseTexture() {
    const S = 64;
    const raw = new Float32Array(S * S);
    for (let i = 0; i < raw.length; i++) raw[i] = Math.random();
    // Box-blur a few passes → smooth low-frequency blobs (organic gusts)
    const buf = new Float32Array(S * S);
    for (let pass = 0; pass < 3; pass++) {
      for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
          let s = 0, c = 0;
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const xx = (x + dx + S) % S, yy = (y + dy + S) % S;
              s += raw[yy * S + xx]; c++;
            }
          }
          buf[y * S + x] = s / c;
        }
      }
      raw.set(buf);
    }
    // v0.2.312: RGBA, not RGB. RGBFormat triggers GL_INVALID_ENUM on
    // glTexStorage2D in WebGL2/Three r184 (0x1907 is an unsized internal
    // format), silently breaking the sampler and making the grass invisible.
    const data = new Uint8Array(S * S * 4);
    for (let i = 0; i < raw.length; i++) {
      const v = Math.max(0, Math.min(255, raw[i] * 255));
      data[i * 4 + 0] = v; data[i * 4 + 1] = v; data[i * 4 + 2] = v; data[i * 4 + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    // v0.2.322: pin sampling deterministically. LinearFilter + no mipmaps gives
    // smooth interpolation for the vertex-shader wind fetch (no texel snapping,
    // no driver-dependent LinearMipmapLinear behaviour on a 64² field).
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }

  const grassTex = makeBladeTexture();
  const noiseTex = makeNoiseTexture();

  // ── terra initBladeIndices — two-sided ribbon ─────────────────────────────
  function initBladeIndices(id, vc1, vc2) {
    let i = 0, seg;
    for (seg = 0; seg < BLADE_SEGS; ++seg) {
      id[i++] = vc1 + 0; id[i++] = vc1 + 1; id[i++] = vc1 + 2;
      id[i++] = vc1 + 2; id[i++] = vc1 + 1; id[i++] = vc1 + 3;
      vc1 += 2;
    }
    for (seg = 0; seg < BLADE_SEGS; ++seg) {
      id[i++] = vc2 + 2; id[i++] = vc2 + 1; id[i++] = vc2 + 0;
      id[i++] = vc2 + 3; id[i++] = vc2 + 1; id[i++] = vc2 + 2;
      vc2 += 2;
    }
    return i;
  }

  // ── Candidate grid → Fisher–Yates thinning (both zones, obstacles cleared) ──
  // Each candidate is a TRIPLE (x, z, zone): zone 0 = NAP (green), 1 = arena
  // (purple→orange). The bonsai in the NAP zone and the arena crates are cleared
  // so blades don't grow through solid props.
  const TREE_X = NAP_X + 6;
  const TREE_Z = 0;
  const TREE_CLEAR_SQ = 1.5 * 1.5;
  // Arena crate footprints (+0.15m margin) — reject blades inside so they don't
  // poke through the crate boxes. CRATES = [cx, cz, hw, hd, ch].
  const crateBoxes = CRATES.map(([cx, cz, hw, hd]) => ({
    x0: cx - hw - 0.15, x1: cx + hw + 0.15,
    z0: cz - hd - 0.15, z1: cz + hd + 0.15,
  }));
  const inCrate = (x, z) => {
    for (const b of crateBoxes) {
      if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
    }
    return false;
  };

  // Beach/surf exclusion (v0.2.336, lowered v0.2.337) — since the sea-facing edges
  // now slope DOWN to SEA_LEVEL over BEACH_INSET INSIDE the footprint, blades placed
  // there would stand in the surf. Reject any candidate whose sampled terrain sits
  // below GRASS_MIN_Y so grass thins out toward the water. v0.2.337: GRASS_MIN_Y now
  // sits just ABOVE SEA_LEVEL (not +0.2), so grass extends right down to the
  // waterline — the sea laps the lowest blades instead of stopping on a bare strip.
  const GRASS_MIN_Y = SEA_LEVEL + 0.04;   // ≈ -0.22: grass meets the waterline

  const candidates = [];
  // NAP zone (green) — bonsai cleared.
  for (let x = NAP_GRASS_X0; x <= NAP_GRASS_X1; x += CAND_SPACING) {
    for (let z = NAP_GRASS_Z0; z <= NAP_GRASS_Z1; z += CAND_SPACING) {
      const jx = x + (Math.random() - 0.5) * CAND_SPACING * 0.7;
      const jz = z + (Math.random() - 0.5) * CAND_SPACING * 0.7;
      const dx = jx - TREE_X, dz = jz - TREE_Z;
      if (dx * dx + dz * dz < TREE_CLEAR_SQ) continue;
      if (inRiver(jx, jz)) continue;
      if (sampleNapHeight(jx, jz) < GRASS_MIN_Y) continue; // no blades on the beach/surf
      candidates.push(jx, jz, 0);
    }
  }
  // Arena zone (purple→orange) — crates cleared.
  for (let x = ARENA_GRASS_X0; x <= ARENA_GRASS_X1; x += CAND_SPACING) {
    for (let z = ARENA_GRASS_Z0; z <= ARENA_GRASS_Z1; z += CAND_SPACING) {
      const jx = x + (Math.random() - 0.5) * CAND_SPACING * 0.7;
      const jz = z + (Math.random() - 0.5) * CAND_SPACING * 0.7;
      if (inCrate(jx, jz)) continue;
      if (inRiver(jx, jz)) continue;
      if (sampleArenaHeight(jx, jz) < GRASS_MIN_Y) continue; // no blades on the beach/surf
      candidates.push(jx, jz, 1);
    }
  }
  const total = Math.floor(candidates.length / 3);
  const pick = Math.min(TARGET_BLADES, total);
  for (let k = 0; k < pick; k++) {
    const r = k + Math.floor(Math.random() * (total - k));
    const kx = candidates[k * 3], kz = candidates[k * 3 + 1], kzone = candidates[k * 3 + 2];
    candidates[k * 3]     = candidates[r * 3];
    candidates[k * 3 + 1] = candidates[r * 3 + 1];
    candidates[k * 3 + 2] = candidates[r * 3 + 2];
    candidates[r * 3]     = kx;
    candidates[r * 3 + 1] = kz;
    candidates[r * 3 + 2] = kzone;
  }

  const count = pick;
  const vindexArr = new Float32Array(BLADE_VERTS * 2);
  for (let i = 0; i < vindexArr.length; i++) vindexArr[i] = i;
  const offsetArr = new Float32Array(count * 4);
  const shapeArr  = new Float32Array(count * 4);
  const zoneArr   = new Float32Array(count); // 0 = NAP (green), 1 = arena (purple→orange)
  const indexArr  = new Uint16Array(BLADE_INDICES);
  initBladeIndices(indexArr, 0, BLADE_VERTS);

  for (let i = 0; i < count; i++) {
    const x    = candidates[i * 3];
    const z    = candidates[i * 3 + 1];
    const zone = candidates[i * 3 + 2];
    const ry = Math.random() * Math.PI * 2;
    const s  = 0.85 + Math.random() * 0.35;
    const tall = Math.random() < 0.21;
    const h = (BLADE_HEIGHT_MIN + Math.pow(Math.random(), 4.0) * (BLADE_HEIGHT_MAX - BLADE_HEIGHT_MIN)) * s * (tall ? 1.21 : 1.0);
    const w = BLADE_WIDTH * s * (0.9 + Math.random() * 0.2);
    offsetArr[i * 4 + 0] = x;
    offsetArr[i * 4 + 1] = z;
    offsetArr[i * 4 + 2] = zone > 0.5 ? sampleArenaHeight(x, z) : sampleNapHeight(x, z);
    offsetArr[i * 4 + 3] = ry;
    shapeArr[i * 4 + 0] = w;
    shapeArr[i * 4 + 1] = h;
    shapeArr[i * 4 + 2] = Math.random() * 0.3;       // lean
    shapeArr[i * 4 + 3] = 0.05 + Math.random() * 0.3; // curve
    zoneArr[i] = zone;
  }

  const geo = new THREE.InstancedBufferGeometry();
  geo.setIndex(new THREE.BufferAttribute(indexArr, 1));
  geo.setAttribute('vindex', new THREE.BufferAttribute(vindexArr, 1));
  geo.setAttribute('offset', new THREE.InstancedBufferAttribute(offsetArr, 4));
  geo.setAttribute('shape',  new THREE.InstancedBufferAttribute(shapeArr, 4));
  geo.setAttribute('aZone',  new THREE.InstancedBufferAttribute(zoneArr, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 10000);

  const mat = new THREE.RawShaderMaterial({
    uniforms: {
      uTime:          { value: 0.0 },
      uMode:          { value: 0.0 }, // 0 = green/lit, 1 = blue→red diagnostic
      uMap:           { value: grassTex },
      uNoise:         { value: noiseTex },
      uNoiseScale:    { value: 0.025 },    // wind noise frequency across the field
      // v0.2.322 — murmuration wind restored. uWindIntensity 0.18 drives a
      // two-layer wave+gust field (see the vertex shader). Slow scrolls + explicit
      // LinearFilter on uNoise keep it jitter-free (v0.2.321 proved wind was the
      // jitter cause; v0.2.322 fixes the params, not the pipeline).
      // v0.2.323: amplitude boosted 0.18 -> 0.38 for obvious, visible waves.
      // v0.2.325: 0.38 -> 0.50 — bigger bend so wave crest bands read clearly.
      uWindIntensity: { value: 0.50 },
      uLightDir:      { value: new THREE.Vector3(0.743, 0.371, -0.557) }, // toward arena sunrise sun (40,20,-30)
      uFogColor:      { value: new THREE.Color(0xc8dde8) },
      uFogDensity:    { value: 0.008 },    // matches scene FogExp2
      uGrassFadeFar:   { value: 60.0 },
    },
    vertexShader: /* glsl */`
      precision highp float;

      attribute float vindex;
      attribute vec4 offset;  // (x, z, _, rot)
      attribute vec4 shape;   // (width, height, lean, curve)
      attribute float aZone;  // 0 = NAP (green), 1 = arena (purple→orange)

      uniform float uTime;
      uniform vec3 uLightDir;
      uniform sampler2D uNoise;
      uniform float uNoiseScale;
      uniform float uWindIntensity;

      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;

      varying vec2 vUv;
      varying vec4 vColor;
      varying float vT;
      varying float vZone;

      #define BLADE_SEGS  ${BLADE_SEGS.toFixed(1)}
      #define BLADE_VERTS ${BLADE_VERTS.toFixed(1)}

      vec2 rotate(float x, float y, vec2 r) {
        return vec2(x * r.x - y * r.y, x * r.y + y * r.x);
      }

      void main() {
        float vi    = mod(vindex, BLADE_VERTS);
        float di    = floor(vi / 2.0);
        float hpct  = di / BLADE_SEGS;
        float bside = floor(vindex / BLADE_VERTS);
        float bedge = mod(vi, 2.0);
        vT = hpct;
        vZone = aZone;

        // Build blade local: X = width, Y = up (height), Z = forward bend axis.
        // Edges taper geometrically toward a true point at the tip.
        vec3 vpos = vec3(
          shape.x * (bedge - 0.5) * (1.0 - pow(hpct, 3.0)),
          shape.y * di / BLADE_SEGS,
          0.0
        );

        // Blade face normal (±Z in Y-up local) pre-rotated by blade yaw (X/Z).
        float n = bside * 2.0 - 1.0;
        vec2 yawv = vec2(cos(offset.w), sin(offset.w));
        vec3 normal = vec3(rotate(0.0, n, yawv).x, 0.0, rotate(0.0, n, yawv).y);

        // Natural lean + animated curve. Bend lives in the vertical Y/Z plane.
        // v0.2.322: gentle per-blade-phased base sway (slow, low amplitude, small
        // spatial phase scale) → independent waving, no global unison. (v0.2.321
        // zeroed this for the wind-vs-aliasing diagnostic.)
        // v0.2.323: amplitude + speed boosted so the sway reads as obvious motion.
        float curve = shape.w + 0.09 * sin(uTime * 1.8 + offset.x * 0.12 + offset.y * 0.09 + shape.y);
        float rot = shape.z + curve * hpct;
        vec2 rotv = vec2(cos(rot), sin(rot));
        vpos.yz = rotate(vpos.y, vpos.z, rotv);
        normal.yz = rotate(normal.y, normal.z, rotv);

        // Blade yaw around Y-up (rotate ground plane X/Z).
        vpos.xz = rotate(vpos.x, vpos.z, yawv);

        // World ground position (XZ). offset = (x, z, _, rot): world X in .x,
        // world Z in .y. (v0.2.313: the green-pass refactor wrongly used offset.xz,
        // which read the unused .z slot as 0 → every blade collapsed to z=0, the
        // "diagonal strip" bug. .xy is correct.)
        vec2 bladePos = offset.xy;

        // v0.2.322 — murmuration wind. Two independent per-blade-phased layers so
        // the field never moves in unison: a slow low-freq traveling WAVE plus a
        // faster localized GUST (smoothstep+squared for soft peaks between calm).
        // Nearby blades share a gust while distant blades phase apart — starling
        // murmuration, not a uniform lean. LinearFilter on uNoise (set in JS)
        // guarantees smooth interpolation; slow scrolls (≤~9 texels/sec) keep it
        // jitter-free (v0.2.321 proved the old fast scroll was the jitter cause).
        // v0.2.323: amplitude + wave-travel boosted for OBVIOUS motion (was too subtle).
        // v0.2.324: directional sine waves gated by drifting envelopes.
        // v0.2.325: SHORTER WAVELENGTH + cleaner axis-aligned travel + bigger
        // amplitude so distinct wave CREST BANDS are visible sweeping across
        // large areas of the field (v0.2.324's ~11u period made whole regions
        // bend in unison → looked like one mass rising). Period now ~5-6u →
        // many visible crests; crest speed ~2u/s reads as a clear sweep. Pure
        // sines of (pos*k - t*speed): smooth everywhere, can't reintroduce jitter.
        vec2 sp = bladePos * uNoiseScale + 0.5;

        // Ambient fine low-freq sway (the underlying murmur beneath the waves).
        float base = texture2D(uNoise,
          vec2(sp.x - uTime / 30.0, sp.y - uTime / 45.0) * 2.0).g;
        base = (clamp(base, 0.25, 1.0) - 0.25) * (1.0 / 0.75);
        base = base * base;

        // Traveling wave A — sweeps +X. Short wavelength so crests are VISIBLE
        // moving across the field. Broad low-threshold envelope so it covers large
        // areas but still breathes in/out (not a flat uniform sine everywhere).
        float envA = texture2D(uNoise, vec2(sp.y * 1.2 + 0.4, sp.x - uTime / 55.0) * 1.6).g;
        envA = smoothstep(0.15, 1.0, envA);
        float waveA = sin(bladePos.x * 1.1 - uTime * 2.4) * envA;

        // Traveling wave B — sweeps +Z, different wavelength + speed + phase,
        // crosses wave A so the two never sync (independent waves of wind).
        float envB = texture2D(uNoise, vec2((sp.x + sp.y) * 0.9, sp.y + uTime / 45.0) * 1.9).g;
        envB = smoothstep(0.20, 1.0, envB);
        float waveB = sin(bladePos.y * 1.5 + uTime * 1.8) * envB;

        float wind = (base * 0.20 + waveA * 0.55 + waveB * 0.50) * uWindIntensity;
        wind *= hpct;                       // tall parts sway more
        wind = -wind;
        rotv = vec2(cos(wind), sin(wind));
        vpos.yz = rotate(vpos.y, vpos.z, rotv);   // wind bends Y/Z (axis-aligned)
        normal.yz = rotate(normal.y, normal.z, rotv);

        // ── Lighting (ported from terra) ───────────────────────────────────
        // Directional sun (abs so both faces catch light) + ambient, then
        // ambient occlusion darkening the base, then per-blade colour jitter.
        float diffuse = abs(dot(normal, uLightDir));
        float light = 0.35 * diffuse + 0.65;
        float heightLight = 1.0 - hpct;
        heightLight = heightLight * heightLight;
        light = max(light - heightLight * 0.5, 0.0);

        // Per-blade vertical gradient base→tip, using the blade's LOCAL vertical
        // (hpct = di/BLADE_SEGS), NOT world Y — so every blade shows the full
        // gradient regardless of terrain height. NAP zone stays green (v0.2.303);
        // arena zone goes PURPLE base → ORANGE tip (v0.2.329).
        vec3 bladeCol = aZone > 0.5
          ? mix(vec3(0.45, 0.20, 0.65), vec3(0.95, 0.55, 0.15), hpct)
          : mix(vec3(0.27, 0.60, 0.15), vec3(0.18, 0.43, 0.12), hpct);
        vColor = vec4(
          light * 0.75 + cos(offset.x * 80.0) * 0.1,
          light * 0.95 + sin(offset.y * 140.0) * 0.05,
          light * 0.95 + sin(offset.x * 99.0) * 0.05,
          1.0
        );
        vColor.rgb *= bladeCol;
        vColor.rgb = min(vColor.rgb, 1.0);

        // Grass texture coordinate: x = blade edge (0..1), y = height (0..1).
        vUv = vec2(bedge, di / BLADE_SEGS);

        // Translate to world (ground XZ, blade grows +Y).
        vpos.x += bladePos.x;
        vpos.z += bladePos.y;
        vpos.y += offset.z;  // terrain height (Stage 1 v0.2.326)

        gl_Position = projectionMatrix * modelViewMatrix * vec4(vpos, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      uniform sampler2D uMap;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform float uGrassFadeFar;
      uniform float uMode;

      varying vec2 vUv;
      varying vec4 vColor;
      varying float vT;
      varying float vZone;

      void main() {
        vec4 color;
        if (uMode > 0.5) {
          // DIAGNOSTIC: blue base → red tip (the look the user called "very cool")
          vec3 base = vec3(0.10, 0.30, 0.95);
          vec3 tip  = vec3(0.95, 0.15, 0.15);
          color = vec4(mix(base, tip, vT), 1.0);
        } else if (vZone > 0.5) {
          // Arena: purple→orange blade colour, texture used only for its ALPHA
          // silhouette (multiplying RGB would drag the gradient back toward green).
          color = vec4(vColor.rgb, texture2D(uMap, vUv).a);
        } else {
          // Lit green: vertex colour × blade texture (alpha silhouette + midrib)
          color = vColor * texture2D(uMap, vUv);
        }

        float depth = gl_FragCoord.z / gl_FragCoord.w;

        // Distance alpha fade so the patch edge doesn't pop.
        color.a = 1.0 - smoothstep(uGrassFadeFar * 0.55, uGrassFadeFar * 0.8, depth);

        // Arena-matched exponential-squared fog (scene uses FogExp2 0.008).
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * depth * depth);
        color.rgb = mix(color.rgb, uFogColor, fogFactor);

        gl_FragColor = color;
      }
    `,
    side: THREE.DoubleSide,
    transparent: true,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.position.y = -0.05;

  // v0.2.326: the flat ground-cover plane was removed — the NAP terrain mesh
  // (terrainMesh.js) now provides the ground surface between blades.

  scene.add(mesh);
  _grassMat = mat;
  window._grassMat = mat; // DEPRECATED debug alias (v0.2.118) — internal code uses tickFoliage()/getGrassMat()

  // v0.2.274: diagnostic stamp. Open the browser console (F12) and look for the
  // line starting with [grass-build] — it prints the EXACT params the browser is
  // running, so you can confirm live vs cached. If this line is missing, the grass
  // code never ran (stale bundle).
  const stamp = `[grass-build] v0.2.329 blades=${count} zones=NAP+ARENA bladeW=${BLADE_WIDTH} bladeH=${BLADE_HEIGHT_MIN}-${BLADE_HEIGHT_MAX} segs=${BLADE_SEGS} shape=TERRA-FLAT-RIBBON taper=(1-hpct^3)-GEOMETRIC-POINT bend=curve*hpct-YZ yaw=XZ wind=TRAVELING-WAVES-SHORTWL(base*0.20+waveA*0.55+waveB*0.50,axis-aligned,period~5.5u,crest~2u/s,gated-env,noiseScale=${0.025},uWindIntensity=${0.50},LinearFilter,noMipmap) sway=0.09*sin(uTime*1.8+off*0.12) VERTEX_ANIM=ON lighting=SUN+AMBIENT+AO nap-green=(0.27,0.60,0.15)->(0.18,0.43,0.12) arena-purple->orange=(0.45,0.20,0.65)->(0.95,0.55,0.15,per-blade-hpct) fog=EXP2(0xc8dde8,0.008) placement=offset.xy-XZ height=per-zone-sample DIAGNOSTIC=uMode(blue->red,set uniforms.uMode.value=1) FLOWERS=REMOVED Y-UP`;
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
      if (dx * dx + dz * dz >= TREE_CLEAR_SQ && !inRiver(fx, fz)) break;
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
      if (dx * dx + dz * dz >= TREE_CLEAR_SQ && !inRiver(fx, fz)) break;
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
