// engine/world/anchorTransforms.js — pure, node-safe ANCHOR→TRANSFORM contract
// for the four future in-world MVP proof meshes (v0.2.149). Each proof-surface
// spec in proofSurfaceSpecs.js carries an `anchor` string (e.g.
// 'torii-gate-threshold'); this module is the single source of truth for what
// that anchor MEANS in world space — a ground origin, a parenting hint, the NAP
// zone it belongs to, and a human note — so the future mesh pass has one place
// to resolve "where does this surface sit" without re-deriving coordinates.
//
// Pure + node-safe: NO Three/Rapier/DOM, NO renderer mutation, NO gameplay. All
// coordinates are PLAIN objects ({x,y,z}) and plain numbers — never THREE
// classes — so nothing allocates a Vector3/Matrix4 and the module imports clean
// in a node/vitest env. This describes a placement contract; it places nothing.
//
// The anchors all live east of the torii gate, in the NAP zone (NAP_X..NAP_FAR_X),
// matching the proof surfaces they support.

import { NAP_X, NAP_FAR_X } from '../../config.js';
import { PROOF_SURFACE_SPECS } from './proofSurfaceSpecs.js';

// Badge stamped on resolved transforms / the resolve summary so a viewer can
// never mistake these descriptors for live, rendered, or actionable transforms.
export const ANCHOR_BADGE = 'ANCHOR · PLAIN-TRANSFORM · NO RENDER';

// Centre of the NAP-zone floor along X — kept consistent with proofSurfaceSpecs.
const NAP_MID_X = (NAP_X + NAP_FAR_X) / 2; // (20 + 45) / 2 = 32.5

// The anchor registry: anchor id → plain placement metadata. Each anchor's
// `origin` is the GROUND point (y:0) the surface stands on; `parent` is a hint
// for the future mesh pass about what the panel should be attached to (still
// plain data, not a live scene-graph node); `zone` is the NAP-zone region; the
// `note` documents intent. Frozen so consumers treat it as a read-only contract.
export const PROOF_SURFACE_ANCHORS = Object.freeze({
  'torii-gate-threshold': Object.freeze({
    id: 'torii-gate-threshold',
    parent: 'torii-gate',
    zone: 'nap-zone',
    origin: Object.freeze({ x: NAP_X, y: 0, z: 0 }),
    note: 'Ground at the torii gate threshold (east wall plane, z=0). Gateway panel stands just past it.',
  }),
  'nap-zone-north-stall': Object.freeze({
    id: 'nap-zone-north-stall',
    parent: 'nap-zone-floor',
    zone: 'nap-zone',
    origin: Object.freeze({ x: NAP_MID_X, y: 0, z: -9 }),
    note: 'Ground at the north market-stall spot (mid NAP zone, north of the central walkway).',
  }),
  'nap-zone-far-centre': Object.freeze({
    id: 'nap-zone-far-centre',
    parent: 'nap-zone-floor',
    zone: 'nap-zone',
    origin: Object.freeze({ x: NAP_FAR_X - 5, y: 0, z: 0 }),
    note: 'Ground at the far-centre notice-board spot (deep NAP zone, on the central axis z=0).',
  }),
  'nap-zone-south-board': Object.freeze({
    id: 'nap-zone-south-board',
    parent: 'nap-zone-floor',
    zone: 'nap-zone',
    origin: Object.freeze({ x: NAP_MID_X, y: 0, z: 9 }),
    note: 'Ground at the south update-board spot (mid NAP zone, south of the central walkway).',
  }),
});

// Stable anchor-id list. Pure constant.
export const ANCHOR_IDS = Object.freeze(Object.keys(PROOF_SURFACE_ANCHORS));

// getAnchor(id) → the frozen anchor metadata for `id`, or null if unknown. Pure.
export function getAnchor(id) {
  return PROOF_SURFACE_ANCHORS[id] || null;
}

// resolveAnchorTransform(spec) → a plain transform descriptor binding a proof-
// surface spec to its anchor, or null if the spec's anchor is unknown. The
// descriptor carries: the anchor id/parent/zone, the anchor ground `origin`, the
// surface's world `position`, the `offset` from origin → position (so the mesh
// pass can parent to the anchor and apply a local offset), plus the surface's
// `size` and `yawRad` copied through. Pure — allocates only plain objects/numbers,
// never a THREE class; reads only static spec + anchor data.
export function resolveAnchorTransform(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const anchor = getAnchor(spec.anchor);
  if (!anchor) return null;
  const { origin } = anchor;
  const pos = spec.position;
  return {
    badge: ANCHOR_BADGE,
    surfaceId: spec.id,
    anchor: anchor.id,
    parent: anchor.parent,
    zone: anchor.zone,
    origin: { x: origin.x, y: origin.y, z: origin.z },
    position: { x: pos.x, y: pos.y, z: pos.z },
    offset: { x: pos.x - origin.x, y: pos.y - origin.y, z: pos.z - origin.z },
    size: { width: spec.size.width, height: spec.size.height, depth: spec.size.depth },
    yawRad: spec.yawRad,
    // No live behaviour by construction — this is a placement descriptor.
    rendered: false,
    actionable: false,
  };
}

// resolveAllAnchors(specs = PROOF_SURFACE_SPECS) → a JSON-serialisable read-only
// report resolving every spec's anchor: `resolved` carries one transform
// descriptor per spec whose anchor is known; `unresolved` lists {surfaceId,anchor}
// for any spec pointing at an unknown anchor. `ok===true` iff every spec resolved.
// Pure — no render/network/DOM/THREE.
export function resolveAllAnchors(specs = PROOF_SURFACE_SPECS) {
  const list = Array.isArray(specs) ? specs : [];
  const resolved = [];
  const unresolved = [];
  for (const spec of list) {
    const t = resolveAnchorTransform(spec);
    if (t) resolved.push(t);
    else unresolved.push({ surfaceId: spec && spec.id ? spec.id : null, anchor: spec ? spec.anchor : null });
  }
  return {
    badge: ANCHOR_BADGE,
    count: list.length,
    ok: unresolved.length === 0,
    resolved,
    unresolved,
    // No live behaviour by construction — these are placement descriptors.
    rendered: false,
    actionable: false,
  };
}
