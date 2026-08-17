// engine/world/proofSurfaceSpecs.js — pure, node-safe LAYOUT/SPEC contracts for
// the four future in-world MVP proof meshes (v0.2.147). Each of the four PoC proof
// surfaces (gateway portal panel, product stall panel, leaderboard board, update
// prompt board) gets a plain-data spec: a stable id, the loop step + LEAN slice it
// proves, the SDK preview namespace + ToriiDebug.shells report that feed it, an
// in-world anchor hint, approximate position/size, and its inert invariants.
//
// This is the SPEC layer the future mesh pass will read — it does NOT render
// anything yet. Pure + node-safe: NO Three/Rapier/DOM, NO renderer mutation, NO
// gameplay integration, NO network/navigation/signing. Positions/sizes are PLAIN
// objects ({x,y,z} / {width,height,depth}) and a plain `yawRad` number — NOT
// THREE classes — so nothing allocates a Vector3/Matrix4 and the module imports
// clean in a node/vitest env. Every surface stays `readOnly:true`/`actionable:false`.
//
// The proof surfaces live east of the torii gate, in the NAP zone (the peaceful,
// weapon-free area beyond the gate) — fitting the freedom-tech loop they preview.

import { TRAVEL_GATE_X, TRAVEL_GATE_Z } from '../../config.js';

// Badge stamped on the layout summary so a viewer can never mistake these specs
// for live, rendered, or actionable meshes. They describe a future placement; they
// place nothing.
export const PROOF_SURFACE_BADGE = 'SPEC · INERT · LAYOUT-ONLY';

// Centre of the NAP-zone floor along X — a convenient anchor for the stalls/boards.
// v0.2.515: Panels flank the travel gateway torii gate, facing inward.

// The ordered proof-surface specs, in MVP-loop order (Market→Score remain in-world;
// Travel + Update were removed v0.2.316 — the torii gateway realises Travel and the
// homescreen realises Update-check). Positions/sizes are APPROXIMATE placement hints
// in world metres — plain data, never THREE objects. `yawRad` is an approximate
// facing (radians about +Y); the mesh pass owns the exact transform. Every spec is
// frozen so a consumer can treat it as a read-only contract.
export const PROOF_SURFACE_SPECS = Object.freeze([
  Object.freeze({
    id: 'product-stall-panel',
    step: 'MARKET', lean: 'LEAN-3',
    title: 'PRODUCT', kind: 'stall-panel',
    previewSdk: 'productPreview', shell: 'productPreview',
    anchor: 'nap-zone-gate-left',
    note: 'Plebeian/Nostr market stall; previews one listing read-only. No checkout/pay/zap.',
    position: Object.freeze({ x: -7, y: 2.0, z: 31 }), // v0.2.519: NAP zone edge
    size: Object.freeze({ width: 2.4, height: 1.6, depth: 0.1 }),
    yawRad: Math.PI + 0.15 - Math.PI / 18, // v0.2.525: +10° CW
    invariants: Object.freeze({ readOnly: true, actionable: false }),
  }),
  Object.freeze({
    id: 'leaderboard-board',
    step: 'SCORE', lean: 'LEAN-4',
    title: 'LEADERBOARD', kind: 'notice-board',
    previewSdk: 'leaderboardPreview', shell: 'leaderboardPreview',
    anchor: 'nap-zone-gate-right',
    note: 'Far-centre notice board; previews local/mock ranked scores. Never signs or publishes.',
    position: Object.freeze({ x: 5, y: 2.6, z: 31 }), // NAP zone edge
    size: Object.freeze({ width: 3.2, height: 2.2, depth: 0.12 }),
    yawRad: Math.PI + 0.15 + Math.PI / 36, // v0.2.525: +5° CCW
    invariants: Object.freeze({ readOnly: true, actionable: false, signed: false, published: false }),
  }),
]);

// Stable id list in loop order. Pure constant.
export const PROOF_SURFACE_IDS = Object.freeze(PROOF_SURFACE_SPECS.map((s) => s.id));

// getProofSurfaceSpec(id) → the frozen spec for `id`, or null if unknown. Pure.
export function getProofSurfaceSpec(id) {
  return PROOF_SURFACE_SPECS.find((s) => s.id === id) || null;
}

// proofSurfaceLayout() → a compact, JSON-serialisable read-only summary of the four
// proof-surface specs: the anchor zone, an axis-aligned bounds box over the placement
// positions (plain numbers), an `allInert` gate read from the specs' own invariants
// (so it can never over-claim), and the spec list. For an AI handoff / FOSS dev to
// see, in one call, where the future proof meshes will sit and that they stay inert.
// Pure — allocates only plain objects/arrays, never a THREE class.
export function proofSurfaceLayout() {
  const xs = PROOF_SURFACE_SPECS.map((s) => s.position.x);
  const zs = PROOF_SURFACE_SPECS.map((s) => s.position.z);
  const allInert = PROOF_SURFACE_SPECS.every(
    (s) =>
      s.invariants.readOnly === true &&
      s.invariants.actionable === false &&
      s.invariants.signed !== true &&
      s.invariants.published !== true,
  );
  return {
    badge: PROOF_SURFACE_BADGE,
    anchorZone: 'nap-zone', // east of the torii gate (NAP_X..NAP_FAR_X)
    count: PROOF_SURFACE_SPECS.length,
    bounds: {
      minX: Math.min(...xs), maxX: Math.max(...xs),
      minZ: Math.min(...zs), maxZ: Math.max(...zs),
    },
    specs: PROOF_SURFACE_SPECS,
    allInert,
    // No live behaviour by construction — these are placement specs, not meshes.
    rendered: false,
    actionable: false,
  };
}
