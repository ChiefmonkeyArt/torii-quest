// engine/world/proofSurfaceParentBinding.js — PURE, node-safe contract for how the
// display-only proof-surface boards (v0.2.150) MOUNT in the scene graph (v0.2.151).
// Each proof-surface anchor carries a `parent` HINT ('torii-gate' / 'nap-zone-floor');
// this module turns that hint into (a) the stable NAME of the live scene node the
// boards logically belong to and (b) the NAME of the per-parent display-only group
// the mesh adapter creates to hold them. It also groups a render plan's panels by
// their parent so the binding is explicit, discoverable, and testable.
//
// Pure + node-safe: NO Three/Rapier/DOM, NO renderer mutation, NO gameplay — it only
// computes plain-data names/groupings. It places and parents NOTHING; the browser-only
// adapter (`proofSurfaceMeshes.js`) reads this to build named subgroups. The boards stay
// display-only and inert — this contract adds no behaviour, just scene-graph structure.
import { getAnchor } from './anchorTransforms.js';

// Badge stamped on the binding report so a viewer can never mistake it for a live /
// rendered / actionable structure.
export const PARENT_BINDING_BADGE = 'PARENT-BINDING · SCENE-GRAPH · NO RENDER';

// Name of the root display-only group the adapter adds to the scene.
export const PROOF_SURFACE_GROUP = 'proof-surfaces';

// Each anchor `parent` hint → the stable name of the LIVE scene node those boards
// belong to (set on the node in arena.js so a reviewer can `scene.getObjectByName`
// it). Frozen — a read-only contract, not a live node reference.
export const PARENT_NODE_NAMES = Object.freeze({
  'torii-gate': 'torii-gate',
  'nap-zone-floor': 'nap-zone-floor',
});

// parentNodeName(parent) → the live scene-node name for a parent hint, or null. Pure.
export function parentNodeName(parent) {
  return PARENT_NODE_NAMES[parent] || null;
}

// parentGroupName(parent) → the name of the per-parent display-only mount group the
// adapter creates under the root group (e.g. 'proof-surfaces::torii-gate'). Pure.
export function parentGroupName(parent) {
  return `${PROOF_SURFACE_GROUP}::${parent}`;
}

// resolveParentBindings(plan) → a JSON-serialisable read-only report grouping a render
// plan's panels by their parent hint. Each group carries the parent hint, the live
// scene-node name it maps to, the per-parent group name the adapter uses, and the ids
// of the panels mounted there (in plan order). Panels whose parent can't be determined
// land in `unbound`. `ok===true` iff every panel bound and at least one group formed.
// Pure — reads only the plan's panels (+ the anchor registry as a fallback for parent);
// allocates only plain objects/arrays, never a THREE class.
export function resolveParentBindings(plan) {
  const panels = plan && Array.isArray(plan.panels) ? plan.panels : [];
  const order = [];
  const byParent = new Map();
  const unbound = [];

  for (const p of panels) {
    const anchor = p && p.anchor ? getAnchor(p.anchor) : null;
    const parent = (p && p.parent) || (anchor ? anchor.parent : null) || null;
    if (!parent) {
      unbound.push(p && p.id ? p.id : null);
      continue;
    }
    if (!byParent.has(parent)) {
      byParent.set(parent, {
        parent,
        parentNode: parentNodeName(parent),
        groupName: parentGroupName(parent),
        panelIds: [],
      });
      order.push(parent);
    }
    byParent.get(parent).panelIds.push(p.id);
  }

  return {
    badge: PARENT_BINDING_BADGE,
    group: PROOF_SURFACE_GROUP,
    count: panels.length,
    ok: unbound.length === 0 && order.length > 0,
    groups: order.map((k) => byParent.get(k)),
    unbound,
    // No live behaviour by construction — this is a scene-graph structure descriptor.
    rendered: false,
    actionable: false,
  };
}
