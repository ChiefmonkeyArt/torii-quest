// engine/gateway/portalMeshPlan.js — PURE, node-safe RENDER PLAN for the dedicated
// in-world GATEWAY PORTAL marker (GATEWAY / NAP-zone handoff, v0.2.183, LEAN-2
// continuation). It turns the portal trigger's geometry (position + proximity range,
// from the v0.2.181 `createPortalTrigger`) into a plain-data description of a small,
// inert visual marker so the player can SEE the travel point they are approaching.
//
// ALL of the placement/colour/animation decisions live here as plain numbers/objects:
// NO THREE, NO DOM, NO renderer — so the plan is deterministic and node-testable. The
// browser-only adapter (`portalMesh.js`) consumes this plan and builds meshes ONCE.
//
// Constrained by construction:
//   - DISPLAY-ONLY + INERT. The marker is a visual landmark; it has no collider, no
//     raycast/click, no input, and changes NOTHING about the safety model. Proximity
//     still only ARMS (v0.2.181) and KeyF still CONFIRMS the same-origin `/zone/` hop.
//     Every plan + part pins navigated/performed/external/signed/published = false.
//   - RANGE-ALIGNED. The outer ring radius EQUALS the trigger range, so the ring the
//     player sees is exactly the proximity boundary that arms the portal.
//   - PURE + node-safe. Allocates only plain objects/numbers, never a THREE class, and
//     never reads a global window/document. The host passes position + range in.

// PORTAL_MESH_PLAN_VERSION — bumped when the plan part shape changes. v2 (v0.2.293):
// the marker is promoted from bare rings+beam into a recognisable TORII-GATE frame
// (two pillars + a top kasagi lintel + a lower nuki crossbar) — the game's namesake —
// and frame parts gain an `approach:true` flag so the host can drive a proximity glow.
export const PORTAL_MESH_PLAN_VERSION = 2;

// Badge stamped on the plan + debug report: a visible marker, but inert + display-only.
export const PORTAL_MESH_BADGE = 'PORTAL MESH · DISPLAY-ONLY · INERT';

// The scene-graph group name the adapter mounts the marker under (discoverable via
// scene.getObjectByName for tests / debugging). Parity with the proof-surface group.
export const PORTAL_MESH_GROUP = 'gateway-portal';

// Display palette — matches the arena's turquoise gateway accent (C_TURQ 0x1ad6c4)
// and the violet step colour (0x8b5cf6) already used elsewhere, so no new look is
// introduced. Plain hex the adapter hands to a material.
const COLOR_TURQ   = 0x1ad6c4;
const COLOR_VIOLET = 0x8b5cf6;

// Default proximity radius (world units) — mirrors gatewayPortalActivation /
// portalTrigger so a plan built without an explicit range still aligns with the gate.
const DEFAULT_RANGE = 3;

// Torii-gate frame dimensions (world units). The opening faces along the approach
// axis (±x), so the pillars are separated along z. Kept low-poly + asset-free.
const GATE_HALF_SPAN = 1.5;   // pillar offset on z (gate opening half-width)
const GATE_PILLAR_H  = 3.2;   // pillar height
const GATE_PILLAR_R  = 0.16;  // pillar radius
const GATE_TOP_Y     = 3.34;  // kasagi (top lintel) centre height
const GATE_CROSS_Y   = 2.55;  // nuki (lower crossbar) centre height

// _finite(n) → n is a finite number.
function _finite(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// _vec(p) → a sanitised plain { x, y, z } (each finite, else 0), or null for non-objects.
function _vec(p) {
  if (!p || typeof p !== 'object') return null;
  return {
    x: _finite(p.x) ? p.x : 0,
    y: _finite(p.y) ? p.y : 0,
    z: _finite(p.z) ? p.z : 0,
  };
}

// buildPortalMeshPlan(opts?) → a plain-data plan for the portal marker.
//
//   opts {
//     position: { x, y, z }  — world position of the portal (the trigger's portalPos)
//     range:    number       — proximity radius; the outer ring matches it (default 3)
//     title:    string       — display label (carried through for the debug surface)
//   }
//
// Returns:
//   { version, badge, ok, anchor:{x,y,z}, range, ringRadius, title, count,
//     parts:[ { id, kind, role, geometry, position, rotation, color,
//               emissiveIntensity, opacity, transparent, spin, pulse,
//               navigated:false, performed:false, external:false,
//               signed:false, published:false, readOnly:true, actionable:false } ],
//     reasons, rendered:false, actionable:false }
//
// Pure — never throws; degrades to ok:false with a reason on bad input.
export function buildPortalMeshPlan(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const reasons = [];

  const anchor = _vec(o.position);
  if (!anchor) reasons.push('invalid-position');

  const r = Number(o.range);
  const range = r > 0 && Number.isFinite(r) ? r : DEFAULT_RANGE;
  if (!(r > 0 && Number.isFinite(r))) reasons.push('range-defaulted');

  const title = typeof o.title === 'string' && o.title ? o.title : 'Gateway Portal';

  // The outer ring IS the proximity boundary — its radius equals the trigger range so
  // the player can read exactly where the portal arms.
  const ringRadius = range;

  // Inert flags spread into every part LAST so a consumer can never flip them.
  const INERT = Object.freeze({
    navigated: false, performed: false, external: false,
    signed: false, published: false, readOnly: true, actionable: false,
  });

  // Parts are described relative to the group ORIGIN; the adapter mounts the group at
  // `anchor`, so a part's `position` is a local offset. Geometry is param-only — the
  // adapter maps `geometry.type` → a THREE primitive. Small segment counts keep the
  // marker light (no heavy assets, no high-poly geometry).
  const parts = [
    {
      id: 'outer-ring',
      kind: 'ring',
      role: 'range-boundary', // radius === trigger range
      geometry: { type: 'torus', radius: ringRadius, tube: 0.12, radialSegments: 10, tubularSegments: 48 },
      position: { x: 0, y: 0.06, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 }, // lay flat on the ground
      color: COLOR_TURQ,
      emissiveIntensity: 0.55,
      opacity: 1,
      transparent: false,
      spin: false,
      pulse: true, // gentle emissive breathing (adapter mutates a scalar only)
      approach: false,
      ...INERT,
    },
    {
      id: 'inner-ring',
      kind: 'ring',
      role: 'accent',
      geometry: { type: 'torus', radius: Math.max(0.4, ringRadius * 0.45), tube: 0.06, radialSegments: 8, tubularSegments: 36 },
      position: { x: 0, y: 0.08, z: 0 },
      rotation: { x: -Math.PI / 2, y: 0, z: 0 },
      color: COLOR_VIOLET,
      emissiveIntensity: 0.45,
      opacity: 1,
      transparent: false,
      spin: false,
      pulse: false,
      approach: false,
      ...INERT,
    },
    // ── TORII-GATE FRAME (v0.2.293) — the namesake silhouette around the portal.
    // The opening faces ±x (the approach axis); pillars sit on ±z. `approach:true`
    // lets the host brighten the frame as the player nears (scalar glow, no alloc).
    {
      id: 'pillar-left',
      kind: 'pillar',
      role: 'gate-post',
      geometry: { type: 'cylinder', radiusTop: GATE_PILLAR_R, radiusBottom: GATE_PILLAR_R * 1.12, height: GATE_PILLAR_H, radialSegments: 12 },
      position: { x: 0, y: GATE_PILLAR_H / 2, z: -GATE_HALF_SPAN },
      rotation: { x: 0, y: 0, z: 0 },
      color: COLOR_TURQ,
      emissiveIntensity: 0.4,
      opacity: 1,
      transparent: false,
      spin: false,
      pulse: false,
      approach: true,
      ...INERT,
    },
    {
      id: 'pillar-right',
      kind: 'pillar',
      role: 'gate-post',
      geometry: { type: 'cylinder', radiusTop: GATE_PILLAR_R, radiusBottom: GATE_PILLAR_R * 1.12, height: GATE_PILLAR_H, radialSegments: 12 },
      position: { x: 0, y: GATE_PILLAR_H / 2, z: GATE_HALF_SPAN },
      rotation: { x: 0, y: 0, z: 0 },
      color: COLOR_TURQ,
      emissiveIntensity: 0.4,
      opacity: 1,
      transparent: false,
      spin: false,
      pulse: false,
      approach: true,
      ...INERT,
    },
    {
      id: 'kasagi',
      kind: 'lintel',
      role: 'gate-top', // the overhanging top beam
      geometry: { type: 'box', width: 0.5, height: 0.26, depth: GATE_HALF_SPAN * 2 + 0.7 },
      position: { x: 0, y: GATE_TOP_Y, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: COLOR_TURQ,
      emissiveIntensity: 0.46,
      opacity: 1,
      transparent: false,
      spin: false,
      pulse: false,
      approach: true,
      ...INERT,
    },
    {
      id: 'nuki',
      kind: 'crossbar',
      role: 'gate-tie', // the lower tie-beam between the posts
      geometry: { type: 'box', width: 0.38, height: 0.2, depth: GATE_HALF_SPAN * 2 + 0.1 },
      position: { x: 0, y: GATE_CROSS_Y, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: COLOR_VIOLET,
      emissiveIntensity: 0.44,
      opacity: 1,
      transparent: false,
      spin: false,
      pulse: false,
      approach: true,
      ...INERT,
    },
    {
      id: 'beam',
      kind: 'beam',
      role: 'shaft',
      geometry: { type: 'cylinder', radiusTop: 0.16, radiusBottom: 0.16, height: 2.6, radialSegments: 12 },
      position: { x: 0, y: 1.4, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: COLOR_TURQ,
      emissiveIntensity: 0.5,
      opacity: 0.16, // faint, see-through gateway shaft
      transparent: true,
      spin: false,
      pulse: false,
      approach: false,
      ...INERT,
    },
    {
      id: 'core',
      kind: 'core',
      role: 'marker',
      geometry: { type: 'octahedron', radius: 0.34, detail: 0 },
      position: { x: 0, y: 1.7, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      color: COLOR_VIOLET,
      emissiveIntensity: 0.85,
      opacity: 1,
      transparent: false,
      spin: true, // slow idle spin (adapter mutates rotation.y by dt — no allocation)
      pulse: false,
      approach: true, // brightens as the player approaches (host-driven scalar)
      ...INERT,
    },
  ];

  const ok = !!anchor && parts.length > 0;

  return {
    version: PORTAL_MESH_PLAN_VERSION,
    badge: PORTAL_MESH_BADGE,
    ok,
    anchor: anchor || { x: 0, y: 0, z: 0 },
    range,
    ringRadius,
    title,
    count: parts.length,
    parts,
    reasons,
    // The PLAN renders nothing; the adapter owns + reports its own render state.
    rendered: false,
    actionable: false,
    navigated: false,
    performed: false,
    external: false,
    signed: false,
    published: false,
  };
}

// describePortalMeshPlan(opts?) → one stable, human-readable line for a debug/audit
// log. Pure, never throws.
export function describePortalMeshPlan(opts = {}) {
  const p = buildPortalMeshPlan(opts);
  if (!p.ok) return `Portal mesh plan INVALID (${p.reasons.join(', ') || 'unknown'}).`;
  return `Portal marker for "${p.title}": ${p.count} inert parts, outer ring r=${p.ringRadius} (== trigger range), at (${p.anchor.x}, ${p.anchor.y}, ${p.anchor.z}). Display-only.`;
}

// DEMO_PORTAL_MESH_OPTS — deterministic sample for the debug shell ONLY (mirrors the
// live v0.2.181 trigger geometry: ARENA_HALF=20 on the east gate, range 3).
export const DEMO_PORTAL_MESH_OPTS = Object.freeze({
  position: { x: 20, y: 0, z: 0 },
  range: 3,
  title: 'Plebeian Market Bazaar',
});
