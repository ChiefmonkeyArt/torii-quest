// src/sdk/dashboard.js — BUILD-ONLY barrel for the Torii Quest project-
// oversight dashboard surfaces (R1, v0.2.261). These modules are heavy
// (toriiQuestData ≈ 139 KB; hostRouteSmoke ≈ 19 KB; updateFlowSmoke ≈ 18 KB),
// node-safe READ-ONLY data + render helpers consumed only by:
//
//   • tools/build-torii-quest-dashboard.mjs (static dashboard generator)
//   • tests/* (continuum/host/update dashboard suites)
//
// They are NOT imported by any runtime entry point. Re-exporting them through
// the main src/sdk/index.js barrel previously dragged ~176 KB of dashboard
// strings/HTML into the app chunk on every page load. Importing from this
// dedicated barrel keeps that weight out of the runtime bundle while
// preserving a single, stable SDK-shaped surface for build scripts and tests.
//
// READ-ONLY: pure data + HTML/JSON renderers. No relay/network/DOM/signing.
//
// NOTE: toriiQuestData carries the full curated progress + dashboard model; it
// is intentionally tree-shake-hostile (large frozen object graphs). Keep this
// barrel out of any runtime import path. If you need a tiny piece of it from
// runtime code, copy that piece to a small dedicated module instead of
// importing this file.

export * as toriiQuestDashboard from '../engine/dashboard/toriiQuestDashboardData.js';
export * as hostRouteSmoke from '../engine/host/hostRouteSmoke.js';
export * as updateFlowSmoke from '../engine/update/updateFlowSmoke.js';
// handoffControlPanel (v0.2.294): the handoff/release control panel — a Continuum
// project-oversight surface consumed ONLY by toriiQuestData.js + build tools + tests,
// never by a game-runtime entry. R1 originally left it on the runtime barrel; it lives
// here now so the runtime chunk no longer carries it via the tree-shake-hostile re-export.
export * as handoffControlPanel from '../engine/status/handoffControlPanel.js';

// Re-export stability metadata so dashboard tests can assert tier without
// reaching back through the runtime barrel.
export { STABILITY, SDK_VERSION } from './index.js';

// Tier metadata for the three dashboard surfaces, mirroring the SDK_SURFACE
// shape so downstream code that previously read SDK_SURFACE.continuum.tier
// can read DASHBOARD_SURFACE.continuum.tier instead.
import { STABILITY as _STABILITY } from './index.js';

export const DASHBOARD_SURFACE = Object.freeze({
  toriiQuestDashboard: {
    tier: _STABILITY.EXPERIMENTAL,
    module: '../engine/dashboard/toriiQuestDashboardData.js',
    note: 'Curated progress/dashboard model + static HTML/JSON renderer (build-only).',
  },
  hostRouteSmoke: {
    tier: _STABILITY.EXPERIMENTAL,
    module: '../engine/host/hostRouteSmoke.js',
    note: 'Static-host readiness rollup (build/dashboard-only).',
  },
  updateFlowSmoke: {
    tier: _STABILITY.EXPERIMENTAL,
    module: '../engine/update/updateFlowSmoke.js',
    note: 'Update-flow read-only smoke rollup (build/dashboard-only).',
  },
  handoffControlPanel: {
    tier: _STABILITY.EXPERIMENTAL,
    module: '../engine/status/handoffControlPanel.js',
    note: 'Handoff/release control panel — single-source project pickup posture (build/dashboard-only, READ-ONLY).',
  },
});
