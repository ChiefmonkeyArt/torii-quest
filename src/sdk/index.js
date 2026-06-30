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
export * as nostrReadHealth from '../engine/nostr/readHealth.js';
export * as consentGate from '../engine/consent/consentGate.js';
export * as consentView from '../engine/consent/consentView.js';
export * as submitIntent from '../engine/leaderboard/submitIntent.js';
export * as leaderboardLivePublish from '../engine/leaderboard/livePublish.js';
export * as gatewayRead from '../engine/gateway/gatewayRead.js';
export * as travelConfirm from '../engine/gateway/travelConfirm.js';
export * as handoffPlan from '../engine/gateway/handoffPlan.js';
export * as handoffExecute from '../engine/gateway/handoffExecute.js';
export * as hostTransport from '../engine/gateway/hostTransport.js';
export * as gatewayActivation from '../engine/gateway/gatewayActivation.js';
export * as gatewayPortalActivation from '../engine/gateway/gatewayPortalActivation.js';
export * as portalTrigger from '../engine/gateway/portalTrigger.js';
export * as zoneRoute from '../engine/gateway/zoneRoute.js';
export * as portalMeshPlan from '../engine/gateway/portalMeshPlan.js';
export * as zoneLabel from '../engine/gateway/zoneLabel.js';
export * as travelSmoke from '../engine/gateway/travelSmoke.js';
export * as updateCheck from '../engine/update/updateCheck.js';
export * as updatePreview from '../engine/update/updatePreview.js';
export * as githubReleaseSource from '../engine/update/githubReleaseSource.js';
export * as updateStatus from '../engine/update/updateStatus.js';
// updateFlowSmoke, hostRouteSmoke, continuum: moved to src/sdk/dashboard.js (R1, v0.2.261)
// — dashboard-only surfaces (~176 KB combined). They were dragging strings/HTML into
// the runtime app chunk; build scripts and tests now import them from the dashboard
// barrel directly. Do NOT re-add them here.
export * as mvpReadiness from '../engine/status/mvpReadiness.js';
export * as handoffControlPanel from '../engine/status/handoffControlPanel.js';
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
  // READ-ONLY Nostr read-path HEALTH model (NOSTR-READ, v0.2.194) — folds the shipped
  // relayRead/profileRead/leaderboardRelayRead proofs + the consent gate into one
  // read-only health report (six signals: relay read model, no-EVENT verb, profile
  // read, leaderboard read, write paths gated, SEC-1/2/3 future-gated) over
  // deterministic LOCAL sample events; NO network/relay/sign/publish — readOnly:true,
  // signed:false, published:false pinned on every report.
  nostrReadHealth: { tier: STABILITY.EXPERIMENTAL, module: '../engine/nostr/readHealth.js' },
  // Explicit, auditable CONSENT-GATE foundation (CONSENT-1, v0.2.162) — pure
  // build/validate/summarise/evaluate over a known-action registry; read-only
  // actions always allowed, write/sign/publish/update/travel actions blocked unless
  // an explicit matching grant is present. INERT: never signs/publishes/acts; the
  // decision is permission for the host to act later, not an action taken here.
  consentGate:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/consent/consentGate.js' },
  // CONSENT UX VIEW-MODEL foundation (CONSENT-2, v0.2.166) — turns consentGate
  // requests/decisions into clear user-facing PROMPT copy + preview rows (title,
  // badge, severity, body lines, action/cancel labels, allowed/blocked + reason).
  // DISPLAY-ONLY: every view is performed:false/actionable:false/readOnly:true; it
  // exposes NO confirm/sign/publish/travel method and never performs an action.
  consentView:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/consent/consentView.js' },
  // Leaderboard SUBMIT INTENT / PREVIEW (LB-SUBMIT, v0.2.163) — builds a sanitised,
  // unsigned kind-30000 score draft and routes it through consentGate
  // (`leaderboard:submit`). INERT: blocked without a matching grant; never
  // signs/publishes/sends/connects — performed:false on every report.
  submitIntent:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/leaderboard/submitIntent.js' },
  // LIVE leaderboard publish wiring (M2, v0.2.281) — promotes the relay write to a
  // real NIP-07 sign + relay fan-out, but ONLY behind explicit consent AND the
  // SEC-1 publishGate verdict `crypto-verified`. Reuses nostr.js signEvent +
  // fanoutPublish as injected seams; the write goes THROUGH the gate, never around.
  leaderboardLivePublish: { tier: STABILITY.EXPERIMENTAL, module: '../engine/leaderboard/livePublish.js' },
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
  // Host TRAVEL HANDOFF SEAM (GATEWAY / NAP-zone handoff, v0.2.167) — turns an
  // allowed gateway:travel intent into an INERT dry-run handoff + rollback plan.
  // NO browser navigation, world unload/reload, signing, publishing, or relay I/O —
  // dryRun:true/navigated:false/performed:false/readOnly:true on every plan.
  handoffPlan:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/handoffPlan.js' },
  // First controlled SAME-ORIGIN travel EXECUTOR (GATEWAY / NAP-zone handoff, v0.2.168) —
  // acts on a v0.2.167 READY handoff plan ONLY through an injected host transport and ONLY
  // for a safe same-origin route; the external targetUrl is never executed. NO direct
  // browser navigation, world reload, signing, publishing, or network I/O — external:false/
  // worldReloaded:false/signed:false/published:false/network:false on every report; default
  // no-op without a transport, single rollback (no timers) on navigate failure.
  handoffExecute:  { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/handoffExecute.js' },
  // Real same-site host TRANSPORT ADAPTER for gateway travel (GATEWAY / NAP-zone handoff,
  // v0.2.170) — builds the `{ navigate, snapshot, rollback, log }` transport that
  // handoffExecute consumes, with every browser primitive INJECTED via a host object.
  // Same-origin route changes ONLY (re-validated with safeRoutePath); default in-memory
  // recording host performs no real navigation; createBrowserHostTransport(win) is the
  // History-pushState runtime seam (no reload/external nav). NO network/sign/publish/relay.
  hostTransport:   { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/hostTransport.js' },
  // LIVE-WIRE seam for a CONFIRMED same-origin gateway hop (GATEWAY / NAP-zone handoff,
  // v0.2.178, LEAN-2) — the missing link that joins planHandoff/executeHandoff to
  // createBrowserHostTransport(window). activateGatewayHandoff REFUSES to resolve a
  // transport or navigate unless opts.confirmed === true (literal), preserves the consent
  // gate, enforces safeRoutePath + an OPTIONAL same-origin routeAllowlist, and drives the
  // v0.2.168 executor. Same-origin history.pushState ONLY — NO external nav/world-reload/
  // network/sign/publish/relay; default no-op without a window/transport.
  gatewayActivation: { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/gatewayActivation.js' },
  // In-world GATEWAY PORTAL activation seam (GATEWAY / NAP-zone handoff, v0.2.180) —
  // bridges a gateway COMPONENT to the v0.2.178 confirmed same-origin hop: maps the
  // internal `target` → a `/zone/<slug>` activation input (external website dropped),
  // sanitises the route allowlist to a meaningful scoped prefix (never `['/']`), and
  // exposes an ARM → CONFIRM boundary controller (arming is inert; only confirm acts)
  // plus a scalar proximity helper. Injected transport only — NO module-scope window,
  // NO external nav/world-reload/network/sign/publish; SEC-2 signed tier untouched.
  gatewayPortalActivation: { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/gatewayPortalActivation.js' },
  // In-world PROXIMITY → CONFIRM trigger (LEAN-2, v0.2.181) — ticks the player
  // position to ARM/disarm the injected portal boundary + raise a prompt (both
  // inert), and an explicit interact() that is the ONLY navigating step. Pure: the
  // boundary (holding any injected window) is injected; NO module-scope window.
  portalTrigger:   { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/portalTrigger.js' },
  // pure SPA `/zone/<slug>` route parser/resolver (v0.2.182) — classifies a
  // same-origin path as home/zone/invalid, validates the slug strictly, and maps a
  // valid zone to an INERT display state. NO network/relay/nav; same-origin only.
  zoneRoute:       { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/zoneRoute.js' },
  // PURE render plan for the in-world GATEWAY PORTAL marker (LEAN-2, v0.2.183) —
  // turns the trigger position + range into plain-data inert marker parts (outer
  // ring radius === trigger range); NO THREE/DOM/render/nav. The browser-only
  // adapter (portalMesh.js) consumes it and builds inert meshes ONCE.
  portalMeshPlan:  { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/portalMeshPlan.js' },
  // PURE display-label helpers for the portal prompt + zone notice (LEAN-2,
  // v0.2.184) — turn a same-origin zone slug/route/title into the short inert HUD
  // strings (prompt names the target; entered-notice names the zone). Safe alnum
  // labels, NO DOM/nav/network. Pure polish; changes no navigation safety.
  zoneLabel:       { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/zoneLabel.js' },
  // PURE gateway TRAVEL SMOKE harness (LEAN-2, v0.2.195) — folds the shipped travel-
  // flow contracts (trigger arming, same-origin /zone/ route, scoped allowlist,
  // hostile-route rejection, no external URL, consent gate, no auto travel/write)
  // into ONE fail-fast read-only smoke report. Drives the boundary with dryRun:true
  // and NO injected transport: it navigates/performs/signs/publishes NOTHING.
  travelSmoke:     { tier: STABILITY.EXPERIMENTAL, module: '../engine/gateway/travelSmoke.js' },
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
  // updateFlowSmoke + hostRouteSmoke: moved to DASHBOARD_SURFACE in src/sdk/dashboard.js (R1, v0.2.261).
  // MVP release-readiness rollup (v0.2.198) — folds the pure local readiness
  // signals (version, nostr read health, gateway travel / update-flow / host-route
  // smoke, release-metadata floor, injected test/VPS/docs verdicts) into ONE
  // read-only rollup with an MVP percentage/status + next safe task; NO deploy,
  // NO network, never acts.
  mvpReadiness:    { tier: STABILITY.EXPERIMENTAL, module: '../engine/status/mvpReadiness.js' },
  // Handoff / release control panel (v0.2.233) — pure single-source-of-truth for the one-glance
  // project pickup posture (version + live URLs, entry/dashboard smoke evidence, the manual
  // blocker, next safe task, do-not list, non-religious operating principles). GREEN-REQUIRES-
  // EVIDENCE. READ-ONLY: approves/deploys/publishes NOTHING.
  handoffControlPanel: { tier: STABILITY.EXPERIMENTAL, module: '../engine/status/handoffControlPanel.js' },
  // MVP loop header — frames the four PoC preview cards as one Travel→Market→Score→Update loop (v0.2.143).
  mvpLoop:         { tier: STABILITY.EXPERIMENTAL, module: '../engine/mvpLoop.js' },
  // continuum: moved to DASHBOARD_SURFACE in src/sdk/dashboard.js (R1, v0.2.261).
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
