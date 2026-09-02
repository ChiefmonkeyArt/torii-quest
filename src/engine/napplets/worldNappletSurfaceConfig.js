// engine/napplets/worldNappletSurfaceConfig.js — frozen per-surface napplet config
// for the world shell (ADR-0057). PURE + node-safe: plain data, no DOM/Three.
//
// This is the napplet adapter for the EXISTING proof surfaces in proofSurfaceSpecs.js.
// It deliberately does NOT mutate proofSurfaceSpecs.js — that module's contract is
// inert / readOnly / actionable:false, and this config keeps it that way. Each entry
// keys off a proof surface id and adds only the napplet-shell metadata the world
// handlers need: zone, surfaceKind, an allow-list of world.emit kinds, and the
// (informational) world transform derived from the proof spec placement.
//
// `enabled` is false for every surface in v0 — the scaffold is test-only. A future
// ADR flips a surface on when it converts the real product panel / leaderboard.

import { PROOF_SURFACE_SPECS } from '../world/proofSurfaceSpecs.js';

// surfaceKind vocabulary from nap-torii-world v0: panel | npc | gate | mirror | sticker-slot
const KIND_BY_PROOF = {
  'product-stall-panel': 'panel',
  'leaderboard-board': 'panel',
};

// v0 world.emit allow-list per surface. ADR-0058: the product panel is a read-only
// display surface — it has NO emit kinds (allowedEmitKinds: []). purchase /
// sticker-place / leaderboard-submit / npc-say are NOT wired in this increment (they
// land when the real surfaces convert). The leaderboard stays ['custom'] but disabled.
const EMIT_ALLOW = {
  panel: Object.freeze(['custom']),
};

// ADR-0058: per-surface overrides. The live product panel is read-only — no emits.
const EMIT_OVERRIDE = {
  'product-stall-panel': Object.freeze([]),
};

function _buildEntry(spec) {
  const surfaceKind = KIND_BY_PROOF[spec.id] || 'panel';
  return Object.freeze({
    surfaceId: spec.id,
    zoneId: 'nap',
    surfaceKind,
    // Informational only — napplets MUST NOT use this for physics or collision.
    surfaceTransform: Object.freeze({
      position: Object.freeze([spec.position.x, spec.position.y, spec.position.z]),
      yaw: spec.yawRad,
    }),
    allowedEmitKinds: Object.freeze(EMIT_OVERRIDE[spec.id] || [...(EMIT_ALLOW[surfaceKind] || [])]),
    enabled: spec.id === 'product-stall-panel', // ADR-0058: product panel is live; others dormant.
  });
}

export const WORLD_NAPPLET_SURFACE_CONFIG = Object.freeze(
  PROOF_SURFACE_SPECS.map(_buildEntry),
);

// getWorldSurfaceConfig(surfaceId) → the frozen config entry, or null.
export function getWorldSurfaceConfig(surfaceId) {
  return WORLD_NAPPLET_SURFACE_CONFIG.find((c) => c.surfaceId === surfaceId) || null;
}

// listWorldSurfaces(zoneId?) → config entries, optionally filtered to a zone.
export function listWorldSurfaces(zoneId) {
  if (zoneId) return WORLD_NAPPLET_SURFACE_CONFIG.filter((c) => c.zoneId === zoneId);
  return WORLD_NAPPLET_SURFACE_CONFIG;
}
