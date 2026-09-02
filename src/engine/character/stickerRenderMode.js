// engine/character/stickerRenderMode.js — the sticker RENDER-MODE model
// (ADR-0090 slice 2). Pure, node-safe (no THREE/DOM). Owns two decisions:
//
// 1. Which surfaces get BAKED decals (Three's DecalGeometry projected onto the
//    actual mesh triangles) versus PLANE decals (a normal-aligned quad sitting
//    above the surface). ADR-0090 says any-surface placement is authoritative;
//    the split is a rendering choice, not a targeting choice.
// 2. The runtime A/B override (`forcePlaneMode`) so the operator can flip the
//    same fire between baked and plane on the same surface at playtest and
//    decide which reads better. Surfaced on `ToriiDebug.stickers` from main.js.
//
// The classifier is deliberately conservative: baked decals need a static,
// non-instanced Mesh with a real face — anything animated (SkinnedMesh),
// instanced (InstancedMesh, e.g. grass), or lacking a face falls back to the
// existing plane path. When the operator flips `forcePlaneMode`, baking is
// disabled globally regardless — the plane path is universal.

// STICKER_RENDER_MODE — the two rendering paths.
export const STICKER_RENDER_MODE = Object.freeze({
  BAKED: 'baked', // DecalGeometry projected onto the target mesh
  PLANE: 'plane', // Normal-aligned MeshBasicMaterial quad above the surface
});

// createStickerRenderState() → the mutable runtime state carrying the A/B
// override. Kept in a factory so tests get an isolated instance and can't
// leak state across cases.
export function createStickerRenderState() {
  return { forcePlaneMode: false };
}

// isBakedEligible(hit) → boolean. A hit qualifies for baked rendering when:
//   - it carries an `object` with an `isMesh` shape (Three.Mesh),
//   - the object is NOT a SkinnedMesh (skin needs bone-parenting; DecalGeometry
//     bakes against bind-pose triangles and would slide off animation),
//   - the object is NOT an InstancedMesh (all instances share one geometry,
//     baking a decal onto shared geometry would tattoo every instance),
//   - a `face` is present (needed to build a target list for DecalGeometry).
// Pure predicate; never throws.
export function isBakedEligible(hit) {
  if (!hit || typeof hit !== 'object') return false;
  const obj = hit.object;
  if (!obj || obj.isMesh !== true) return false;
  if (obj.isSkinnedMesh === true) return false;
  if (obj.isInstancedMesh === true) return false;
  if (!hit.face) return false;
  return true;
}

// chooseStickerRenderMode(hit, state) → one of STICKER_RENDER_MODE. Combines
// the eligibility predicate with the runtime override: any `forcePlaneMode`
// state, or an ineligible hit, resolves to PLANE. Never throws.
export function chooseStickerRenderMode(hit, state) {
  const s = (state && typeof state === 'object') ? state : null;
  if (s && s.forcePlaneMode === true) return STICKER_RENDER_MODE.PLANE;
  return isBakedEligible(hit) ? STICKER_RENDER_MODE.BAKED : STICKER_RENDER_MODE.PLANE;
}

// setForcePlaneMode(state, on) → mutates `state.forcePlaneMode` and returns
// the new boolean. Coerces truthy/falsy inputs to a real boolean. Never throws.
export function setForcePlaneMode(state, on) {
  const s = (state && typeof state === 'object') ? state : null;
  if (!s) return false;
  s.forcePlaneMode = !!on;
  return s.forcePlaneMode;
}