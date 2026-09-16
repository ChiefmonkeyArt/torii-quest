// engine/world/portalShader.js — the GLSL for the iris + sky-resolve reveal (ADR-0118).
//
// Exported as strings so the renderer can splice them into a full-screen / portal
// material without shipping an un-inspectable blob. `IRIS_MASK_GLSL` computes the
// radial aperture; `SKY_RESOLVE_GLSL` blends the origin + destination skies behind it.
// The uniforms (`uIris`, `uSkyBlend`, `uSkyA`, `uSkyB`, `uSoft`) are driven each frame
// from irisReveal.mirrorTimeline, so the GL stays a dumb sink for the tested math.

// Radial iris aperture centred on the GATE, in aperture units (ADR-0118 Decision 6):
// d = 1 is exactly the gate opening, and `uIris` 1 = aperture window, > 1 = expanded
// toward fullscreen. `uCenter`/`uAperture` are the gate's screen-space centre + opening
// radius (from the projected gate); `uSoft` softens the edge like a physical iris.
//   approach (uIris = 1)  → world B only within the gate opening
//   cross    (uIris → full) → iris expands past the frame to fullscreen
export const IRIS_MASK_GLSL = /* glsl */ `
uniform vec2 uCenter;    // gate aperture centre (UV)
uniform float uAperture; // aperture radius (UV)
uniform float uIris;     // radius in aperture units (1 = gate opening, >1 = fullscreen)
uniform float uSoft;     // edge softness, aperture units
float irisMask(vec2 uv) {
  float d = length(uv - uCenter) / max(uAperture, 1e-4);
  return smoothstep(uIris + uSoft, uIris - uSoft, d);
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
uniform vec2 uCenter;
uniform float uAperture;
uniform vec3 uSkyA;
uniform vec3 uSkyB;
uniform float uIris;
uniform float uSkyBlend;
uniform float uSoft;
varying vec2 vUv;

float _iris(vec2 uv) {
  float d = length(uv - uCenter) / max(uAperture, 1e-4);
  return smoothstep(uIris + uSoft, uIris - uSoft, d);
}

void main() {
  float mask = _iris(vUv);
  vec4 portal = texture2D(uPortalTex, vUv);
  vec3 sky = mix(uSkyA, uSkyB, uSkyBlend);
  // approach: origin sky outside, world B in the aperture; cross: iris expands while
  // the destination sky resolves, until world B fills the screen.
  vec3 col = mix(sky, portal.rgb, mask);
  gl_FragColor = vec4(col, 1.0);
}
`;