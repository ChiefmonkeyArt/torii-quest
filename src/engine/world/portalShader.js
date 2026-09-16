// engine/world/portalShader.js — the GLSL for the iris + sky-resolve reveal (ADR-0118).
//
// Exported as strings so the renderer can splice them into a full-screen / portal
// material without shipping an un-inspectable blob. `IRIS_MASK_GLSL` computes the
// radial aperture; `SKY_RESOLVE_GLSL` blends the origin + destination skies behind it.
// The uniforms (`uIris`, `uSkyBlend`, `uSkyA`, `uSkyB`, `uSoft`) are driven each frame
// from irisReveal.mirrorTimeline, so the GL stays a dumb sink for the tested math.

// Radial iris aperture: returns 0..1 coverage. uv ∈ [0,1]; distance 0 (centre) → 1
// (corner). `uIris` 0 = closed, 1 = open; `uSoft` softens the edge so the blades read
// like a physical iris rather than a hard cookie-cut.
export const IRIS_MASK_GLSL = /* glsl */ `
uniform float uIris;   // 0..1 aperture
uniform float uSoft;   // edge softness, world units of distance
float irisMask(vec2 uv) {
  vec2 c = uv - 0.5;
  float d = length(c) * 2.0;          // 0 centre → 1 corner
  float edge = uIris;
  return smoothstep(edge + uSoft, edge - uSoft, d);
}
`;

// Sky resolve: lerp the origin sky to the destination sky inside the iris aperture so
// the new world's sky resolves in as the hole opens. `mask` is irisMask() above.
export const SKY_RESOLVE_GLSL = /* glsl */ `
uniform vec3 uSkyA;      // origin sky (linear sRGB)
uniform vec3 uSkyB;      // destination sky (linear sRGB)
uniform float uSkyBlend; // 0..1 (skyResolve)
vec3 skyResolve(vec2 uv, float mask) {
  // resolve the sky first, then cut the aperture over it
  vec3 sky = mix(uSkyA, uSkyB, uSkyBlend);
  return sky * mask;
}
`;

// The combined portal fragment: destination world texture revealed through the iris,
// with the resolving sky as the backdrop outside the aperture. `uPortalTex` is the
// render-target of world B; `uPortalUV` maps the screen UV through the portal camera.
export const PORTAL_REVEAL_GLSL = /* glsl */ `
uniform sampler2D uPortalTex;
uniform vec3 uSkyA;
uniform vec3 uSkyB;
uniform float uIris;
uniform float uSkyBlend;
uniform float uSoft;
varying vec2 vUv;

float _iris(vec2 uv) {
  vec2 c = uv - 0.5;
  float d = length(c) * 2.0;
  return smoothstep(uIris + uSoft, uIris - uSoft, d);
}

void main() {
  float mask = _iris(vUv);
  vec4 portal = texture2D(uPortalTex, vUv);
  vec3 sky = mix(uSkyA, uSkyB, uSkyBlend);
  // resolve: sky shows first (outside/behind), portal world B fills the opening hole
  vec3 col = mix(sky, portal.rgb, mask);
  gl_FragColor = vec4(col, 1.0);
}
`;