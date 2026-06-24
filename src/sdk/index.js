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
export * as component from '../engine/components/contract.js';
export * as registry from '../engine/components/registry.js';
export * as toriiGateway from '../engine/components/toriiGateway.js';
export * as productDisplay from '../engine/components/productDisplay.js';
export * as productPanel from '../engine/components/productPanel.js';
export * as productPanelShell from '../engine/components/productPanelShell.js';
export * as productPreview from '../engine/components/productPreview.js';
export * as travelIntent from '../engine/gateway/travelIntent.js';
export * as gatewayHandoff from '../engine/gateway/gatewayHandoff.js';
export * as gatewayPortal from '../engine/gateway/gatewayPortal.js';
export * as gatewayPreview from '../engine/gateway/gatewayPreview.js';
export * as leaderboard from '../engine/nostr/leaderboard.js';
export * as leaderboardPublisher from '../engine/nostr/leaderboardPublisher.js';
export * as leaderboardView from '../engine/nostr/leaderboardView.js';
export * as leaderboardPreview from '../engine/nostr/leaderboardPreview.js';
export * as relayRead from '../engine/nostr/relayRead.js';
export * as leaderboardRelayRead from '../engine/nostr/leaderboardRelayRead.js';
export * as profileRead from '../engine/nostr/profileRead.js';
export * as consentGate from '../engine/consent/consentGate.js';
export * as submitIntent from '../engine/leaderboard/submitIntent.js';
export * as gatewayRead from '../engine/gateway/gatewayRead.js';
export * as travelConfirm from '../engine/gateway/travelConfirm.js';
export * as updateCheck from '../engine/update/updateCheck.js';
export * as updatePreview from '../engine/update/updatePreview.js';
export * as githubReleaseSource from '../engine/update/githubReleaseSource.js';
export * as updateStatus from '../engine/update/updateStatus.js';
export * as mvpLoop from '../engine/mvpLoop.js';
export * as proofSurfaceSpecs from '../engine/world/proofSurfaceSpecs.js';
export * as anchorTransforms from '../engine/world/anchorTransforms.js';
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
  // Component economy contract (CMP-2) — mount/unmount + manifest validation.
  component:       { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/contract.js' },
  // Component loader/registry (CMP-7, v0.2.135) — local built-in lookup only.
  registry:        { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/registry.js' },
  // Reference component: Torii gateway (CMP-8 skeleton, v0.2.133).
  toriiGateway:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/toriiGateway.js' },
  // Reference component: read-only product display (CMP-13 skeleton, v0.2.134).
  productDisplay:  { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/productDisplay.js' },
  // Product panel view-model shell (CMP-13 continuation, v0.2.135).
  productPanel:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/productPanel.js' },
  // Product panel render shell — read-only layout spec (CMP-13, v0.2.136).
  productPanelShell: { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/productPanelShell.js' },
  // Plebeian/Nostr product/market visible PREVIEW block — inert title/HUD card (LEAN-3, v0.2.140).
  productPreview:  { tier: STABILITY.EXPERIMENTAL, module: '../engine/components/productPreview.js' },
  // Gateway protocol URL-handoff / travel-intent helpers (GWPROTO-1, v0.2.134).
  travelIntent:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/travelIntent.js' },
  // Gateway portal/handoff shell — component → travel intent (CMP-8, v0.2.135).
  gatewayHandoff:  { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/gatewayHandoff.js' },
  // Gateway portal VIEW shell — render-ready portal view-model (CMP-8, v0.2.136).
  gatewayPortal:   { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/gatewayPortal.js' },
  // Gateway/NAP-to-NAP visible PREVIEW block — inert title/HUD card (LEAN-2, v0.2.139).
  gatewayPreview:  { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/gatewayPreview.js' },
  // Nostr leaderboard score-event helpers (LB-1 skeleton, v0.2.134).
  leaderboard:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/leaderboard.js' },
  // Leaderboard publisher adapter shape (LB-1 continuation, v0.2.135).
  leaderboardPublisher: { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/leaderboardPublisher.js' },
  // Read-only leaderboard display + build-only preview shell (LB-1, v0.2.136).
  leaderboardView: { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/leaderboardView.js' },
  // Local/mock leaderboard visible PREVIEW block — inert title/HUD card (LEAN-4, v0.2.141).
  leaderboardPreview: { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/leaderboardPreview.js' },
  // READ-ONLY Nostr relay adapter foundation (NOSTR-READ, v0.2.159) — pure relay-URL
  // validation, event normalise/validate, NIP-01 filter matching, REQ/CLOSE frame
  // builders, and an injected-transport adapter; NO signing/publishing/socket/auto-connect.
  relayRead:       { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/relayRead.js' },
  // READ-ONLY leaderboard relay-read PROOF (NOSTR-READ / LB-1, v0.2.160) — builds the
  // kind-30000 score filter, extracts/validates/dedupes score objects from injected
  // relay events, ranks them via leaderboardView; NO signing/publishing/socket.
  leaderboardRelayRead: { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/leaderboardRelayRead.js' },
  // READ-ONLY Nostr identity/profile PROOF (NOSTR-READ / IDENTITY, v0.2.161) — builds the
  // kind:0 profile filter, parses + sanitises (https-only URLs) metadata into a display-only
  // identity view-model, selects the newest profile per author; NO signing/publishing/socket/DOM.
  profileRead:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/profileRead.js' },
  // Explicit, auditable CONSENT-GATE foundation (CONSENT-1, v0.2.162) — pure
  // build/validate/summarise/evaluate over a known-action registry; read-only
  // actions always allowed, write/sign/publish/update/travel actions blocked unless
  // an explicit matching grant is present. INERT: never signs/publishes/acts; the
  // decision is permission for the host to act later, not an action taken here.
  consentGate:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/consent/consentGate.js' },
  // Leaderboard SUBMIT INTENT / PREVIEW (LB-SUBMIT, v0.2.163) — builds a sanitised,
  // unsigned kind-30000 score draft and routes it through consentGate
  // (`leaderboard:submit`). INERT: blocked without a matching grant; never
  // signs/publishes/sends/connects — performed:false on every report.
  submitIntent:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/leaderboard/submitIntent.js' },
  // READ-ONLY gateway destination relay-read PROOF (GATEWAY / NAP-zone handoff, v0.2.164) —
  // builds the kind-30078 + torii-gateway topic filter, extracts + sanitises destination
  // records (https-only URLs, ws/wss relays, control/markup-stripped text) into a safe
  // travel-preview model, selects the newest record per addressable zone; NO navigation,
  // signing, publishing, socket, or auto-connect — navigated:false on every report.
  gatewayRead:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/gatewayRead.js' },
  // Gateway TRAVEL CONFIRMATION / INTENT (GATEWAY / NAP-zone handoff, v0.2.165) —
  // sanitises a gatewayRead destination preview and routes it through consentGate
  // (`gateway:travel`). INERT: blocked without a matching grant; never navigates,
  // signs, publishes, sends, or connects — navigated:false/performed:false on every report.
  travelConfirm:   { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/travelConfirm.js' },
  // torii.quest GitHub release/update-check helpers (LEAN-5, v0.2.138) — pure
  // compare + inert view-model; NO network fetch, NO auto-update.
  updateCheck:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/update/updateCheck.js' },
  // torii.quest update-check visible PREVIEW block — inert title/HUD card (LEAN-5, v0.2.142).
  updatePreview:   { tier: STABILITY.EXPERIMENTAL, module: '../engine/update/updatePreview.js' },
  // torii.quest GitHub Releases source adapter (LEAN-5, v0.2.157) — pure normalise
  // of a releases-latest/array/manifest payload into evaluateUpdate()'s shape; an
  // optional host-only fetch helper that requires an injected fetcher (no auto-fetch).
  githubReleaseSource: { tier: STABILITY.EXPERIMENTAL, module: '../engine/update/githubReleaseSource.js' },
  // torii.quest in-game UPDATE-STATUS panel (LEAN-5, v0.2.158) — folds the release
  // source + inert preview into one render-ready, display-only update-status view;
  // NO network, NO auto-update, NO action surface.
  updateStatus:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/update/updateStatus.js' },
  // MVP loop header — frames the four PoC preview cards as one Travel→Market→Score→Update loop (v0.2.143).
  mvpLoop:         { tier: STABILITY.EXPERIMENTAL, module: '../engine/mvpLoop.js' },
  // In-world proof-mesh LAYOUT/SPEC contracts for the four MVP proof surfaces — pure
  // placement data for the future mesh pass; no Three/render (v0.2.147).
  proofSurfaceSpecs: { tier: STABILITY.EXPERIMENTAL, module: '../engine/world/proofSurfaceSpecs.js' },
  // Pure anchor→transform contract for the four proof surfaces — resolves each
  // spec's anchor id into a plain transform descriptor for the future mesh pass;
  // no Three/render/gameplay (v0.2.149).
  anchorTransforms: { tier: STABILITY.EXPERIMENTAL, module: '../engine/world/anchorTransforms.js' },
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
