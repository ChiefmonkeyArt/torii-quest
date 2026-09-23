// engine/world/portalSurface.js — the browser-only THREE adapter for the iris + sky
// reveal (ADR-0118). A single transparent full-screen quad drawn OVER the arena frame;
// its uniforms are a dumb sink for portalSurfaceUniforms() (the tested math). Reveals the
// DESTINATION sky through an iris that opens from the gate (approach = aperture window,
// cross = iris expands to fullscreen). The world-B render-target texture (uPortalTex) is
// the next layer; today the revealed body is the resolved destination sky.
//
// ALLOCATION DISCIPLINE: every THREE object is created ONCE in initPortalSurface(); the
// per-frame path only mutates uniform scalars (and renders each frame once) — no
// per-frame allocation. The shared renderer is injected once at boot, not resolved here.
//
// Not imported by any node-safe leaf: this module is three + WebGL only, reached solely
// from arenaRuntime (the lazy ENTER ARENA chunk). It is `node --check`-ed for syntax.

import * as THREE from 'three';
import { REVEAL_MODE } from './portalReveal.js';
import { portalSurfaceUniforms } from './portalSurfaceUniforms.js';

// ── Module-scope singletons (created once) ──────────────────────────────────────
let _built = false;
let _scene = null;
let _camera = null;
let _mat = null;
let _renderer = null;
const _u = {
  uAspect: { value: 1 },
  uCenter: { value: new THREE.Vector2(0.5, 0.5) },
  uAperture: { value: 0.12 },
  uIris: { value: 0 },
  uSkyA: { value: new THREE.Vector3(0, 0, 0) },
  uSkyB: { value: new THREE.Vector3(0, 0, 0) },
  uSkyBlend: { value: 0 },
  uSoft: { value: 0.02 },
  uActive: { value: 0 },
  // Live-mirror (ADR-0118): the destination world render-to-target, sampled through
  // the aperture when bound. 0 = sky-only reveal (degraded), 1 = portal texture.
  uPortalTex: { value: null },
  uPortalActive: { value: 0 },
};

// ── Reveal controller state (driven by the host) ────────────────────────────────
let _revealing = false;
let _mode = REVEAL_MODE.CROSS;
let _startMs = 0;
let _durationMs = 1400;
let _gateCenter = null;
let _apertureRadius = 1.6;
let _skyAHex = '#cfe3f7';
let _skyBHex = '#0e1a2e';

const VERT = /* glsl */ `
uniform float uAspect;
varying vec2 vUv;                // aspect-corrected UV (x in [0, aspect], y in [0,1])
void main() {
  vUv = vec2(uv.x * uAspect, uv.y);
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform vec2 uCenter;     // gate aperture centre (ACUV)
uniform float uAperture;  // aperture radius (ACUV, screen-height units)
uniform float uIris;      // mask radius in aperture units (1 = gate, >1 = fullscreen)
uniform vec3 uSkyA;       // origin sky (linear)
uniform vec3 uSkyB;       // destination sky (linear)
uniform float uSkyBlend;  // 0 = origin, 1 = destination
uniform float uSoft;      // iris edge softness (aperture units)
uniform float uActive;    // 0 = fully off
uniform sampler2D uPortalTex;    // destination world render-target (live mirror)
uniform float uPortalActive;      // 0 = sky-only reveal, 1 = sample uPortalTex
varying vec2 vUv;

void main() {
  if (uActive < 0.001) discard;
  float d = length(vUv - uCenter) / max(uAperture, 1e-4);
  float mask = smoothstep(uIris + uSoft, uIris - uSoft, d);  // 1 inside the iris
  vec3 sky = mix(uSkyA, uSkyB, uSkyBlend);
  // Destination body: the live world-B texture when bound, else the destination sky.
  vec3 body = uSkyB;
  if (uPortalActive > 0.001) { body = texture2D(uPortalTex, vUv).rgb; }
  // A soft warm ring at the aperture edge sells the gate opening as a real physical iris.
  float ring = 1.0 - smoothstep(0.0, uSoft * 1.6, abs(d - uIris));
  vec3 col = mix(sky, body, mask * 0.86);        // destination body through the iris
  col += vec3(1.0, 0.66, 0.34) * ring * 0.55;    // aperture edge glow
  gl_FragColor = vec4(col, uActive * mask);
}
`;

/** Bind the shared renderer (arenaRuntime wires it once at boot). */
export function setPortalSurfaceRenderer(renderer) {
  if (renderer && typeof renderer.render === 'function') _renderer = renderer;
}

/** Build the overlay once (idempotent). Safe to call on every init. */
export function initPortalSurface() {
  if (_built) return;
  _scene = new THREE.Scene();
  _camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  _mat = new THREE.ShaderMaterial({
    uniforms: _u,
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), _mat);
  quad.frustumCulled = false;
  _scene.add(quad);
  _built = true;
}

/** Begin a reveal. `gateCenter` is {x,y,z} world; `apertureRadius` the gate opening radius. */
export function beginPortalReveal({
  gateCenter, apertureRadius = 1.6,
  skyAHex = '#cfe3f7', skyBHex = '#0e1a2e',
  durationMs = 1400, mode = REVEAL_MODE.CROSS,
} = {}) {
  initPortalSurface();
  _gateCenter = gateCenter && typeof gateCenter.x === 'number' ? gateCenter : null;
  _apertureRadius = Number.isFinite(apertureRadius) && apertureRadius > 0 ? apertureRadius : 1.6;
  _skyAHex = typeof skyAHex === 'string' ? skyAHex : '#cfe3f7';
  _skyBHex = typeof skyBHex === 'string' ? skyBHex : '#0e1a2e';
  _durationMs = Math.max(1, Number.isFinite(durationMs) ? durationMs : 1400);
  _mode = (mode === REVEAL_MODE.APPROACH || mode === REVEAL_MODE.SETTLED) ? mode : REVEAL_MODE.CROSS;
  _startMs = performance.now();
  _revealing = true;
}

export function endPortalReveal() {
  _revealing = false;
  _u.uActive.value = 0;
}

export function isPortalRevealing() { return _revealing; }

/**
 * Bind the destination world's render-target texture into the iris, so the aperture
 * reveals the LIVE world-B render (the mirror) rather than a flat sky. Pass null to
 * drop back to the sky-only reveal. The texture is sampled inside the iris aperture;
 * outside it the resolving sky is unchanged — so a missing/failed mirror degrades
 * gracefully to the existing sky behaviour.
 */
export function bindPortalTexture(texture) {
  _u.uPortalTex.value = (texture && typeof texture === 'object') ? texture : null;
  _u.uPortalActive.value = _u.uPortalTex.value ? 1 : 0;
}

/**
 * Drive + draw one reveal frame OVER the already-rendered arena. No-op unless a reveal
 * is running. `camera` is the live PerspectiveCamera (matrixWorld up to date). The host
 * calls this AFTER renderFrame() in the loop — for the LIVE APERTURE on capture you will
 * instead want world B drawn into a target behind this; today it reveals the sky.
 */
export function renderPortalSurface({ camera, viewWidth, viewHeight } = {}) {
  if (!_revealing || !_built || !camera || !_renderer) return;
  const t = Math.min(1, (performance.now() - _startMs) / _durationMs);
  const u = portalSurfaceUniforms({
    camera, viewWidth, viewHeight,
    gateCenter: _gateCenter, apertureRadius: _apertureRadius,
    mode: _mode, t,
    skyAHex: _skyAHex, skyBHex: _skyBHex,
  });
  if (!u.active) return;

  _u.uAspect.value = u.aspect;
  _u.uCenter.value.set(u.centerX, u.centerY);
  _u.uAperture.value = u.aperture;
  _u.uIris.value = u.iris;
  _u.uSkyA.value.set(u.skyA.r, u.skyA.g, u.skyA.b);
  _u.uSkyB.value.set(u.skyB.r, u.skyB.g, u.skyB.b);
  _u.uSkyBlend.value = u.skyBlend;
  _u.uSoft.value = u.soft;
  _u.uActive.value = 1;

  _renderer.render(_scene, _camera);

  // Every mode holds until the host explicitly ends the reveal (endPortalReveal).
  // APPROACH pins the aperture at the gate opening once `t` settles — the player
  // keeps looking through the window (parallax live) for as long as the browse loop
  // stays open, rather than the iris snapping shut at t>=1.
}

export function disposePortalSurface() {
  if (!_built) return;
  if (_mat) _mat.dispose();
  _built = false;
  _scene = null; _camera = null; _mat = null; _renderer = null;
  _revealing = false;
  _u.uActive.value = 0;
}