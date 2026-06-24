// engine/world/proofSurfaceRenderPlan.js — PURE, node-safe planning layer for the
// FIRST display-only in-world proof-surface mesh pass (v0.2.150). It turns the
// already-safe layers — the specs (v0.2.147), the spec↔registry cross-check
// (v0.2.148), and the anchor→transform contract (v0.2.149) — into a plain-data
// RENDER PLAN that the browser-only mesh adapter (`proofSurfaceMeshes.js`)
// consumes. ALL of the decision logic (gating, placement, labels, colours) lives
// here as plain objects/numbers: NO THREE, NO DOM, NO renderer — so it is
// deterministic and node-testable. The plan only DESCRIBES panels; it renders
// nothing. The adapter builds meshes ONLY when `ok===true`.

import { PROOF_SURFACE_SPECS } from './proofSurfaceSpecs.js';
import { resolveAllAnchors } from './anchorTransforms.js';
import { checkProofSurfaceSpecs } from '../debug/proofSurfaceCheck.js';

export const RENDER_PLAN_BADGE = 'RENDER-PLAN · DISPLAY-ONLY · INERT';

// Per-step panel tint (plain hex numbers the adapter hands to a material).
// Display-only colour coding matching the MVP loop's step identity.
const STEP_COLOR = Object.freeze({
  TRAVEL: 0x1ad6c4, // turquoise
  MARKET: 0xf7931a, // bitcoin orange
  SCORE:  0x8b5cf6, // violet
  UPDATE: 0x4ea862, // green
});
const DEFAULT_COLOR = 0x9aa7b3;

// buildProofSurfaceRenderPlan(opts?) → a plain-data plan for the proof-surface
// mesh pass. By default it runs the live `resolveAllAnchors()` + the live
// `checkProofSurfaceSpecs()`; either may be injected via `opts.anchors` /
// `opts.check` (e.g. for tests or a candidate spec set). Both gates must pass for
// `ok` to be true. Each panel carries id/label/sublabel/kind/anchor, a PLAIN world
// `position`/`size` + `yawRad`, a display tint, and inert flags. Pure — allocates
// only plain objects/numbers, never a THREE class.
export function buildProofSurfaceRenderPlan(opts = {}) {
  const anchors = opts.anchors || resolveAllAnchors();
  const check = opts.check || checkProofSurfaceSpecs();
  const reasons = [];

  const anchorsOk = !!(anchors && anchors.ok);
  if (!anchorsOk) reasons.push('anchors-unresolved');

  const specCheckOk = !!(check && check.ok === true);
  if (!specCheckOk) reasons.push('spec-check-failed');

  const resolved = anchorsOk && Array.isArray(anchors.resolved) ? anchors.resolved : [];
  const specById = new Map(PROOF_SURFACE_SPECS.map((s) => [s.id, s]));

  const panels = resolved.map((t) => {
    const spec = specById.get(t.surfaceId) || null;
    const step = spec ? spec.step : '';
    return {
      id: t.surfaceId,
      label: spec ? spec.title : t.surfaceId,
      sublabel: spec ? `${spec.step} · ${spec.lean}` : '',
      kind: spec ? spec.kind : 'panel',
      anchor: t.anchor,
      // Scene-graph parent hint carried through from the anchor → the mesh adapter
      // mounts the board under the matching named group (see proofSurfaceParentBinding).
      parent: t.parent,
      position: { x: t.position.x, y: t.position.y, z: t.position.z },
      size: { width: t.size.width, height: t.size.height, depth: t.size.depth },
      yawRad: t.yawRad,
      color: STEP_COLOR[step] || DEFAULT_COLOR,
      // Inert by construction — the adapter never wires any behaviour onto these.
      readOnly: true,
      actionable: false,
    };
  });

  const ok = anchorsOk && specCheckOk && panels.length > 0;

  return {
    badge: RENDER_PLAN_BADGE,
    ok,
    gates: { anchorsOk, specCheckOk },
    count: panels.length,
    panels,
    reasons,
    // The PLAN never renders; the adapter owns and reports its own render state.
    rendered: false,
    actionable: false,
  };
}
