// terrain/sea.js — Stage 2 SEA: custom-GLSL ocean surface (VISUAL ONLY).
//
// One big subdivided plane at SEA_LEVEL with a RawShaderMaterial (same pattern as
// the grass in arena-foliage.js: hand-written GLSL, a uTime uniform ticked each
// frame, scene-matched FogExp2). Waves are synthesised in-shader from the SAME
// wave layers seaConfig.js exposes to the CPU/tests — no external textures, no
// Three.js Water/Reflector, no refraction pass. No physics: the player never
// interacts with the sea in Stage 2.
//
// Browser-only (imports THREE). The wave GLSL is generated from SEA_WAVES so the
// shader can never drift from the pure seaWaveHeight() the tests lock.

import * as THREE from 'three';
import {
  SEA_LEVEL, SEA_SIZE, SEA_SEGMENTS, SEA_WAVES, SEA_WAVE_MAX_AMP,
} from './seaConfig.js';

const TAU = Math.PI * 2;

// GLSL float literal with enough precision to match the JS wave math.
const g = (n) => {
  const s = Number(n).toPrecision(9);
  return s.includes('.') || s.includes('e') ? s : `${s}.0`;
};

// Emit GLSL: the height sum h(p,t) and its analytic XZ derivatives (for the
// surface normal), unrolled from SEA_WAVES. p is world XZ (vec2), t is seconds.
function buildWaveGLSL() {
  const hLines = [];
  const dxLines = [];
  const dzLines = [];
  SEA_WAVES.forEach((w) => {
    const k = TAU / w.wavelength;
    const omega = k * w.speed;
    // arg = k*(dir·p) - omega*t
    const arg = `(${g(k * w.dirX)} * p.x + ${g(k * w.dirZ)} * p.y - ${g(omega)} * t)`;
    hLines.push(`  h += ${g(w.amplitude)} * sin${arg};`);
    // d/dx = A*k*dirX*cos(arg);  d/dz = A*k*dirZ*cos(arg)
    dxLines.push(`  dx += ${g(w.amplitude * k * w.dirX)} * cos${arg};`);
    dzLines.push(`  dz += ${g(w.amplitude * k * w.dirZ)} * cos${arg};`);
  });
  return /* glsl */`
    float seaHeight(vec2 p, float t) {
      float h = 0.0;
    ${hLines.join('\n    ')}
      return h;
    }
    // Surface normal from analytic slope: n = normalize(vec3(-dH/dx, 1, -dH/dz)).
    vec3 seaNormal(vec2 p, float t) {
      float dx = 0.0;
      float dz = 0.0;
    ${dxLines.join('\n    ')}
    ${dzLines.join('\n    ')}
      return normalize(vec3(-dx, 1.0, -dz));
    }
  `;
}

let _seaMat = null;

// Build the sea plane, apply the water shader, add it to `scene`. Returns the mesh.
export function buildSeaMesh(scene) {
  // Plane authored in XY then rotated flat so positions are (x, 0, z), normal +Y.
  const geo = new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, SEA_SEGMENTS, SEA_SEGMENTS);
  geo.rotateX(-Math.PI / 2);
  // Big flat sheet — never frustum-cull it out from under the camera.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), SEA_SIZE);

  const waveGLSL = buildWaveGLSL();

  _seaMat = new THREE.RawShaderMaterial({
    transparent: false,  // v0.2.488: opaque — nothing underneath shows through
    depthWrite: true,
    depthTest: true,
    side: THREE.DoubleSide,
    uniforms: {
      uTime:       { value: 0.0 },
      uLightDir:   { value: new THREE.Vector3(0.743, 0.371, -0.557) }, // toward arena sunrise sun (40,20,-30)
      uFogColor:   { value: new THREE.Color(0xc8dde8) },
      uFogDensity: { value: 0.008 },   // matches scene FogExp2
      uDeepColor:  { value: new THREE.Color(0x06222b) }, // trough — deep blue-teal
      uCrestColor: { value: new THREE.Color(0x2aa7a0) }, // crest — brighter teal
      uHorizonColor:{ value: new THREE.Color(0x9fd4d8) }, // fresnel tint toward horizon
    },
    vertexShader: /* glsl */`
      precision highp float;

      attribute vec3 position;

      uniform mat4 modelViewMatrix;
      uniform mat4 projectionMatrix;
      uniform mat3 normalMatrix;
      uniform float uTime;
      uniform vec3 uLightDir;

      varying float vHeight;
      varying vec3  vNormalView;
      varying vec3  vViewDir;
      varying vec3  vLightView;
      varying float vViewDepth;

      ${waveGLSL}

      void main() {
        vec2 p = position.xz;                 // world XZ (mesh centred at origin)
        float h = seaHeight(p, uTime);
        vHeight = h;

        vec3 world = vec3(position.x, h, position.z);
        vec4 viewPos = modelViewMatrix * vec4(world, 1.0);

        vec3 nWorld = seaNormal(p, uTime);
        vNormalView = normalize(normalMatrix * nWorld);
        vViewDir    = normalize(-viewPos.xyz);
        // Light direction carried into view space (w=0 → rotation only).
        vLightView  = normalize((modelViewMatrix * vec4(uLightDir, 0.0)).xyz);
        vViewDepth  = -viewPos.z;

        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: /* glsl */`
      precision highp float;

      uniform vec3  uDeepColor;
      uniform vec3  uCrestColor;
      uniform vec3  uHorizonColor;
      uniform vec3  uFogColor;
      uniform float uFogDensity;

      varying float vHeight;
      varying vec3  vNormalView;
      varying vec3  vViewDir;
      varying vec3  vLightView;
      varying float vViewDepth;

      #define MAX_AMP ${g(SEA_WAVE_MAX_AMP)}

      void main() {
        vec3 N = normalize(vNormalView);
        vec3 V = normalize(vViewDir);
        vec3 L = normalize(vLightView);

        // Deep in troughs → brighter at crests.
        float crest = clamp(vHeight / MAX_AMP * 0.5 + 0.5, 0.0, 1.0);
        vec3 color = mix(uDeepColor, uCrestColor, crest);

        // Fresnel — brighter, more horizon-tinted at grazing angles (toward the
        // horizon), transparent when looking straight down near shore.
        float fres = pow(1.0 - max(dot(N, V), 0.0), 5.0);
        color = mix(color, uHorizonColor, fres * 0.6);

        // v0.2.488: kill specular — was creating diagonal light streaks across water
        vec3  R = reflect(-L, N);
        float spec = pow(max(dot(R, V), 0.0), 60.0);
        color += vec3(1.0, 0.96, 0.85) * spec * 0.02;

        // Gentle diffuse so crest faces catch a little sun.
        float diff = max(dot(N, L), 0.0);
        color *= 0.85 + 0.25 * diff;

        // Translucency: clearer looking straight down (shore hints through),
        // more opaque toward the horizon where crests stack up.
        // v0.2.488: fully opaque — no terrain mesh grid or seams show through
        float alpha = 1.0;

        // Arena-matched exponential-squared fog (scene uses FogExp2 0xc8dde8, 0.008)
        // so the far edge dissolves into the mist horizon.
        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vViewDepth * vViewDepth);
        color = mix(color, uFogColor, fogFactor);

        gl_FragColor = vec4(color, alpha);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, _seaMat);
  mesh.name = 'sea';
  mesh.position.y = SEA_LEVEL;   // sheet sits 0.3m below the land datum
  mesh.frustumCulled = false;
  // Draw after the opaque terrain (which writes depth and thus occludes the sea
  // behind land) but the transparent sea itself does not write depth.
  mesh.renderOrder = 1;

  if (scene) scene.add(mesh);
  return mesh;
}

// Per-frame tick — advance the wave clock. Wired next to tickFoliage() in the
// arena render loop. No allocation, reads module scope only.
export function tickSea(dt) {
  if (_seaMat) _seaMat.uniforms.uTime.value += dt;
}

// Debug accessor (parity with getGrassMat()).
export function getSeaMat() { return _seaMat; }
