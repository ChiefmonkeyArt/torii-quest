// src/sdk/index.js — Torii Quest public SDK entrypoint (ARS-5, v0.2.131).
//
// The single, intentional import point for external contributors and future
// community/marketplace components (see strategy.md "Reusable Components
// Library and Community Marketplace" + the CMP-* tasks in todo.md).
//
// Design rules (keep this tiny and future-safe):
//   - Re-export ONLY pure, node-testable leaf modules from the engine/ layer.
//     Nothing here may transitively import scene.js (it builds a WebGLRenderer
//     at module load), so the SDK stays importable in a plain node/vitest env.
//   - No runtime wiring (no game loop, no scene, no DOM). This is a surface
//     map, not a framework — it must not grow a coupling explosion.
//   - Every exported surface carries a STABILITY tier in SDK_SURFACE so callers
//     know what they can rely on. Tiers are documented in CODE_INDEX.md.
//   - Modules that ARE part of the public story but not safe/ready to re-export
//     yet (physics bodies/raycast low level, identity, full player/bot runtime)
//     are listed in SDK_SURFACE with tier 'internal' and module:null — a
//     forward-declared slot, not a live export.

import { VERSION } from '../config.js';

// ---- Live re-exports (curated, node-safe) ---------------------------------
export * as aim from '../engine/combat/aim.js';
export * as classifier from '../engine/combat/classifier.js';
export * as damage from '../engine/combat/damage.js';
export * as interactions from '../engine/physics/interactions.js';
export * as reloadPose from '../engine/weapons/reloadPose.js';
export * as muzzle from '../engine/weapons/muzzle.js';
export * as botAgent from '../engine/entities/bot-agent.js';
export * as snapshot from '../engine/debug/snapshot.js';
export * as phaseScreens from '../engine/ui/phaseScreens.js';
export { createRaycastService, raycastService } from '../engine/physics/raycastService.js';

// ---- Metadata --------------------------------------------------------------
// SDK version tracks the build version (single source of truth: config.js).
export const SDK_VERSION = VERSION;

export const STABILITY = Object.freeze({
  STABLE: 'stable',             // locked by tests; safe to depend on
  EXPERIMENTAL: 'experimental', // works + tested but shape may change
  INTERNAL: 'internal',         // not (yet) a public surface — do not depend on
});

const TIERS = Object.freeze(new Set(Object.values(STABILITY)));

// The public surface map. `module` is the import specifier relative to this
// file (null = forward-declared, not yet exported). `tier` is one of STABILITY.
export const SDK_SURFACE = Object.freeze({
  aim:             { tier: STABILITY.STABLE,       module: '../engine/combat/aim.js' },
  classifier:      { tier: STABILITY.STABLE,       module: '../engine/combat/classifier.js' },
  damage:          { tier: STABILITY.STABLE,       module: '../engine/combat/damage.js' },
  interactions:    { tier: STABILITY.STABLE,       module: '../engine/physics/interactions.js' },
  raycastService:  { tier: STABILITY.STABLE,       module: '../engine/physics/raycastService.js' },
  reloadPose:      { tier: STABILITY.STABLE,       module: '../engine/weapons/reloadPose.js' },
  muzzle:          { tier: STABILITY.STABLE,       module: '../engine/weapons/muzzle.js' },
  botAgent:        { tier: STABILITY.EXPERIMENTAL, module: '../engine/entities/bot-agent.js' },
  snapshot:        { tier: STABILITY.EXPERIMENTAL, module: '../engine/debug/snapshot.js' },
  phaseScreens:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/ui/phaseScreens.js' },
  // Forward-declared internals — public story, not safe/ready to re-export yet:
  physicsBodies:   { tier: STABILITY.INTERNAL,     module: null },
  physicsRaycast:  { tier: STABILITY.INTERNAL,     module: null },
  player:          { tier: STABILITY.INTERNAL,     module: null },
  identity:        { tier: STABILITY.INTERNAL,     module: null },
});

// Convenience: list surface names at a given tier.
export function surfacesByTier(tier) {
  return Object.entries(SDK_SURFACE)
    .filter(([, meta]) => meta.tier === tier)
    .map(([name]) => name);
}

export { TIERS as STABILITY_TIERS };
