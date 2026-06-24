// engine/world/proofSurfaceMeshes.js — the FIRST display-only in-world proof-
// surface mesh pass (v0.2.150). It consumes the PURE render plan
// (`proofSurfaceRenderPlan.js`) and, ONLY when the plan's gates pass, creates
// simple inert panel meshes in the NAP zone.
//
// DISPLAY-ONLY and INERT: no click handlers, no raycast/interaction, no
// navigation, no payments, no Nostr actions, no live data, no external fetch.
// The panels are visual markers; nothing reads input or ticks.
//
// ALLOCATION DISCIPLINE: every Three.js object here is created EXACTLY ONCE, in
// `buildProofSurfaceMeshes()`, which arena.js calls a single time during scene
// setup. There is NO per-frame / hot-path allocation in this module and nothing
// runs on tick — so the no-alloc hot-path rule is preserved (this is setup code,
// not a foundation hot-path module). A `_built` guard makes re-entry a no-op.
import * as THREE from 'three';
import { buildProofSurfaceRenderPlan, RENDER_PLAN_BADGE } from './proofSurfaceRenderPlan.js';
import { resolveParentBindings, parentGroupName, PROOF_SURFACE_GROUP } from './proofSurfaceParentBinding.js';

// Render state mirrored for the debug surface. `rendered` is true ONLY after a
// successful build; `reasons` carries the plan's gate failures otherwise. Frozen
// so a reader can never mutate it.
let _state = Object.freeze({ rendered: false, count: 0, ok: false, badge: RENDER_PLAN_BADGE, reasons: ['not-built'] });

// proofSurfaceRenderState() → the last build result (read-only). Surfaced at
// ToriiDebug.shells.surfaceRender() so a reviewer can confirm whether the inert
// panels rendered and that the spec/anchor gates passed.
export function proofSurfaceRenderState() { return _state; }

// _labelTexture(label, sublabel) → a CanvasTexture with the panel's title drawn
// on a dark plate — the same canvas-texture pattern the bitcoin sun sprite uses
// in scene.js, so no new dependency is introduced. One-time creation only; needs
// a DOM canvas, so it runs in the browser scene-setup path, never in node.
function _labelTexture(label, sublabel) {
  const w = 512, h = 256;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0a141a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#e8f6f4';
  ctx.font = 'bold 64px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(label || ''), w / 2, h / 2 - 28);
  ctx.font = '32px sans-serif';
  ctx.fillStyle = '#9fc7c2';
  ctx.fillText(String(sublabel || ''), w / 2, h / 2 + 44);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 4;
  return tex;
}

// buildProofSurfaceMeshes(scene, opts?) → builds the inert proof-surface panels in
// `scene` IF the render plan's gates (anchors + spec↔registry check) pass, else
// builds NOTHING. Returns the render state (also via proofSurfaceRenderState()).
// Idempotent: only the first successful build renders; later calls are no-ops.
// `opts` is forwarded to the plan (e.g. injected anchors/check).
export function buildProofSurfaceMeshes(scene, opts = {}) {
  if (_state.rendered) return _state;

  const plan = buildProofSurfaceRenderPlan(opts);
  if (!plan.ok || !scene) {
    const reasons = plan.reasons.length ? plan.reasons.slice() : [];
    if (!scene) reasons.push('no-scene');
    _state = Object.freeze({ rendered: false, count: 0, ok: false, badge: plan.badge, reasons });
    return _state;
  }

  // Mount the boards under one ROOT group, with a named SUBGROUP per parent hint
  // (e.g. 'proof-surfaces::torii-gate') so each board's logical scene-graph parent is
  // explicit and discoverable via scene.getObjectByName. The binding (v0.2.151) is a
  // pure plan→grouping map; boards keep their WORLD positions (subgroups sit at the
  // origin), so this is a structural change only — no placement / visual change.
  const binding = resolveParentBindings(plan);
  const group = new THREE.Group();
  group.name = PROOF_SURFACE_GROUP;

  const subByParent = new Map();
  for (const g of binding.groups) {
    const sub = new THREE.Group();
    sub.name = g.groupName;
    group.add(sub);
    subByParent.set(g.parent, sub);
  }

  for (const panel of plan.panels) {
    const boardMat = new THREE.MeshStandardMaterial({
      color: panel.color, emissive: panel.color, emissiveIntensity: 0.22,
      roughness: 0.6, metalness: 0.0,
    });
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(panel.size.width, panel.size.height, panel.size.depth),
      boardMat,
    );
    board.position.set(panel.position.x, panel.position.y, panel.position.z);
    board.rotation.y = panel.yawRad;
    board.castShadow = false;
    board.receiveShadow = true;

    // Display-only label plate on the board's front (+Z local) face. The board's
    // yaw carries the plate to the correct world facing.
    const plateMat = new THREE.MeshBasicMaterial({
      map: _labelTexture(panel.label, panel.sublabel),
    });
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(panel.size.width * 0.92, panel.size.height * 0.78),
      plateMat,
    );
    plate.position.set(0, 0, panel.size.depth / 2 + 0.01);
    board.add(plate);

    // Mount under the board's parent subgroup; fall back to the root group if a
    // panel's parent had no binding (keeps every board in the scene regardless).
    const sub = subByParent.get(panel.parent) || group;
    sub.add(board);
  }

  scene.add(group);
  const parents = binding.groups.map((g) => ({ parent: g.parent, parentNode: g.parentNode, groupName: g.groupName, count: g.panelIds.length }));
  _state = Object.freeze({ rendered: true, count: plan.panels.length, ok: true, badge: plan.badge, reasons: [], parents: Object.freeze(parents) });
  return _state;
}
