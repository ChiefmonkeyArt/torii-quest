// engine/debug/toriiDebug.js — deliberate, namespaced alpha debug API.
// v0.2.110. Replaces the habit of sprinkling random `window._foo` globals with
// a single discoverable `window.ToriiDebug` surface. Debug tools ship
// UNCONDITIONALLY in alpha (no flag gate) — this is intentional for a public
// alpha so testers and FOSS contributors can poke at the live game.
//
// Backwards compatibility: the pre-existing functional globals are LEFT IN
// PLACE because they are load-bearing wiring, not just debug taps:
//   • window._onBotHit   — DEPRECATED (v0.2.117). The internal weapons.js → main.js
//                          bot-hit bridge now runs over the event bus
//                          (EV.BOT_HIT_BY_PLAYER). This global remains ONLY as a
//                          documented debug tap that forwards onto the bus, so
//                          console/tester calls keep working. Internal code must
//                          not call it (regression check [9]).
//   • window._grassMat    — DEPRECATED (v0.2.118). arena-foliage.js now owns the
//                          shader in a module-scope registry, ticked by main.js
//                          via tickFoliage() and surfaced here through the
//                          injected getGrassMat() accessor. The global remains
//                          ONLY as a documented debug alias; internal code must
//                          not read it (regression check [10]).
//   • window._flowerMat   — DEPRECATED (v0.2.118), same as _grassMat (getFlowerMat()).
//   • window._mirrorMesh  — DEPRECATED (v0.2.119). mirror.js owns the Reflector
//                          handle in a module-scope ref, surfaced here through
//                          the injected getMirror() accessor. The global remains
//                          ONLY as a documented debug alias; internal code must
//                          not read it (regression check [10]).
// ToriiDebug MIRRORS these (read-only convenience) under ToriiDebug.fx /
// ToriiDebug.world so they are discoverable from one namespace, but the
// originals keep working so nothing breaks.
//
// `refs` is injected by main.js (which already imports every subsystem) so this
// module stays dependency-light and free of circular imports. The world/identity
// skeletons are imported directly because they are pure + inert (no game-module
// deps, nothing fires on import) — exposing them here makes the foundation
// boundaries discoverable and manually testable from the console.
import * as napZone from '../../world/napZone.js';
import * as handoff from '../../world/handoff.js';
import * as presence from '../../identity/presence.js';
import { buildSnapshot, buildCombatReport, buildPhysicsReport } from './snapshot.js';
import { raycastService } from '../physics/raycastService.js';
import { gatewayReport, gatewayPreviewReport, productReport, productPreviewReport, leaderboardReport, leaderboardPreviewReport, leaderboardRelayReadReport, profileReadReport, consentGateReport, consentPromptReport, leaderboardSubmitReport, gatewayReadReport, gatewayTravelReport, handoffPlanReport, handoffExecuteReport, hostTransportReport, gatewayActivationReport, gatewayPortalActivationReport, portalTriggerReport, updatePreviewReport, updateStatusReport, mvpLoopReport, buildShellReport, shellsSummary, shellsDiff } from './shellReport.js';
import { proofSurfaceLayout } from '../world/proofSurfaceSpecs.js';
import { checkProofSurfaceSpecs } from './proofSurfaceCheck.js';
import { resolveAllAnchors } from '../world/anchorTransforms.js';
import { proofSurfaceRenderState } from '../world/proofSurfaceMeshes.js';
import { buildProofSurfaceRenderPlan } from '../world/proofSurfaceRenderPlan.js';
import { resolveParentBindings } from '../world/proofSurfaceParentBinding.js';
import { proofSurfaceGate } from './proofSurfaceGate.js';

export function installToriiDebug(refs) {
  const {
    version, bots, hitBot, playerObj, resetPlayerPos,
    castRay, castRayStatic, hasLineOfSight, getWorld, getLastHit,
    getLastShot, getLastMiss,
    getGrassMat, getFlowerMat, getMirror,
    // v0.2.130 — snapshot/report providers.
    getState, getPhase, getCrateSummary, config,
  } = refs;

  // v0.2.130 — providers for the JSON-serialisable debug snapshot. Each is a
  // function the pure snapshot builder reads behind safe(), so the surface never
  // throws even before physics/state are ready. Counts come from the live Rapier
  // world (not serialisable itself) and the bot roster.
  const snapProviders = {
    version,
    getPhase, getState,
    getPlayerPos: () => (playerObj ? playerObj.position : null),
    getLastHit, getLastShot, getLastMiss,
    isPhysicsReady: () => !!(getWorld && getWorld()),
    getBodyCount:     () => { const w = getWorld && getWorld(); return w ? w.bodies.len() : null; },
    getColliderCount: () => { const w = getWorld && getWorld(); return w ? w.colliders.len() : null; },
    getBotSummary: () => ({ total: bots.length, alive: bots.filter(b => b.alive).length }),
    getCrateSummary,
    config,
  };

  const api = {
    version,

    bots: {
      get list()  { return bots; },
      get count() { return bots.filter(b => b.alive).length; },
      // Damage the i-th bot by n (defaults to a lethal-ish 5). Returns the bot.
      damage(i = 0, n = 5) {
        const b = bots[i];
        if (b) hitBot(b, n);
        return b || null;
      },
    },

    player: {
      get position() { return playerObj.position; },
      resetToArena() { resetPlayerPos(); },
    },

    physics: {
      raycast: castRay,
      raycastStatic: castRayStatic,
      lineOfSight: hasLineOfSight,
      get world() { return getWorld(); },
      // v0.2.130 — injectable raycast facade (SDK first slice). Consumers can
      // depend on this service instead of the raw functions above.
      service: raycastService,
      // v0.2.130 — JSON-serialisable physics summary (world readiness +
      // body/collider/bot/crate counts). Safe to call before physics loads.
      report() { return buildPhysicsReport(snapProviders); },
    },

    world: {
      get mirror() { return (getMirror ? getMirror() : null) || null; },
      // Foundation skeletons (inert): zone metadata + local handoff helpers.
      napZone,
      handoff,
    },

    // Identity skeletons (inert): presence/discovery, disabled by default.
    identity: { presence },

    fx: {
      get grass()  { return (getGrassMat  ? getGrassMat()  : null) || null; },
      get flower() { return (getFlowerMat ? getFlowerMat() : null) || null; },
    },

    // Combat — last bot-hit classification (impact Y, foot Y, neck-line, head
    // sphere proximity, resolved part vs final class, damage). For tuning the
    // headshot/body thresholds live from the console after a shot.
    //
    // Target-practice diagnostics (v0.2.124):
    //   lastShot — most recent FIRED shot: {origin, dir, aim, pred, outcome,
    //              predicted:{reason,label}, reason, label, resolved, flightTime}.
    //              `aim` is the crosshair (camera) ray; `pred` is the bullet line
    //              at fire; `outcome` is what the bullet actually hit. Compare
    //              aim vs outcome to see WHY a shot landed or missed.
    //   lastMiss — most recent shot that did NOT hit a live bot (same shape).
    combat: {
      get lastHit()  { return getLastHit  ? getLastHit()  : null; },
      get lastShot() { return getLastShot ? getLastShot() : null; },
      get lastMiss() { return getLastMiss ? getLastMiss() : null; },
      // v0.2.130 — JSON-serialisable {lastHit,lastShot,lastMiss} in one object.
      report() { return buildCombatReport(snapProviders); },
    },

    // v0.2.130 — one compact, JSON-serialisable status object for post-playtest
    // feedback: `JSON.stringify(ToriiDebug.snapshot())` → paste. Includes
    // version, phase, run state, player position, combat last shot/hit/miss,
    // physics/crate summary, and the key tuning values. Safe to call any time.
    snapshot() { return buildSnapshot(snapProviders); },

    // v0.2.137 — read-only reports over the v0.2.136 VIEW shells (gateway portal,
    // product panel, leaderboard). Lets a tester/AI handoff inspect what those
    // shells produce from one place, using safe demo fixtures by default. These
    // ONLY read the shells' pure return values — no signer, no relay/publish, no
    // navigation. Pass overrides to inspect your own component/product/scores.
    shells: {
      gateway(component, context, opts) { return gatewayReport(component, context, opts); },
      // v0.2.139 — the visible-but-inert gateway/NAP-to-NAP PREVIEW block (LEAN-2)
      // the title/HUD card draws. Read-only; actionable:false, never navigates.
      gatewayPreview(component, context, opts) { return gatewayPreviewReport(component, context, opts); },
      product(product) { return productReport(product); },
      // v0.2.140 — the visible-but-inert Plebeian/Nostr product/market PREVIEW
      // block (LEAN-3) the title/HUD card draws. Read-only; actionable:false, no
      // checkout/pay/zap.
      productPreview(product, opts) { return productPreviewReport(product, opts); },
      leaderboard(statsList, opts) { return leaderboardReport(statsList, opts); },
      // v0.2.141 — the visible-but-inert local/mock leaderboard PREVIEW block
      // (LEAN-4) the title/HUD card draws. Read-only; signed:false, published:false,
      // actionable:false — never signs, publishes, or submits.
      leaderboardPreview(statsList, opts) { return leaderboardPreviewReport(statsList, opts); },
      // v0.2.160 — the READ-ONLY leaderboard relay-read PROOF (NOSTR-READ / LB-1)
      // over a deterministic LOCAL sample of kind-30000 relay score events: proves
      // the READ→extract→dedupe→rank path. Read-only; signed:false, published:false
      // — no relay I/O, no signing, no publishing, no auto-connect.
      leaderboardRelayRead(events, opts) { return leaderboardRelayReadReport(events, opts); },
      // v0.2.161 — the READ-ONLY Nostr identity/profile PROOF (NOSTR-READ / IDENTITY)
      // over a deterministic LOCAL sample of kind:0 profile events: proves the
      // READ→parse→sanitise→newest-per-author path into a display-only identity
      // view-model. Read-only; signed:false, published:false — no relay I/O, no
      // signing, no publishing, no auto-connect, no DOM <img src> assignment.
      profileRead(events, opts) { return profileReadReport(events, opts); },
      // v0.2.162 — the READ-ONLY CONSENT-GATE foundation map (CONSENT-1): walks the
      // known-action registry showing each action's write/sign/danger facts + its
      // default (no-grant) decision, proving reads are allowed while write/sign/
      // publish/update/travel actions are blocked until an explicit grant arrives.
      // Pass { grants } to preview what WOULD be allowed. Inert; performed:false —
      // never signs, publishes, or acts.
      consentGate(opts) { return consentGateReport(opts); },
      // v0.2.166 — the CONSENT UX VIEW-MODEL preview (CONSENT-2): the user-facing
      // PROMPT copy a future confirm dialog WOULD draw for every known action —
      // headline, action/cancel labels, severity, allowed/blocked + reason — blocked
      // by default for writes. Pass { grants } to preview what copy WOULD show. Display
      // only; actionable:false/performed:false — never confirms, signs, publishes, or
      // navigates.
      consentPrompt(opts) { return consentPromptReport(opts); },
      // v0.2.163 — the READ-ONLY leaderboard SUBMIT INTENT / PREVIEW (LB-SUBMIT):
      // shows the inert, unsigned kind-30000 score draft a host WOULD submit and the
      // consent-gate decision for it. Blocked by default (consent-required); pass a
      // grant to preview what WOULD be allowed. Inert; performed:false — never signs,
      // publishes, sends, or connects.
      leaderboardSubmit(input, grant) { return leaderboardSubmitReport(input, grant); },
      // v0.2.164 — the READ-ONLY gateway destination relay-read PROOF (GATEWAY /
      // NAP-zone handoff): shows the sanitised travel-preview records a read-only
      // transport WOULD return for the torii-gateway topic, deduped to the newest per
      // zone. Inert; navigated:false — never navigates, signs, publishes, or connects
      // (deterministic local sample).
      gatewayRead(input) { return gatewayReadReport(input); },
      // v0.2.165 — the READ-ONLY gateway TRAVEL CONFIRMATION / INTENT (GATEWAY /
      // NAP-zone handoff): shows the sanitised destination a host WOULD travel to and
      // the consent-gate decision for it. Blocked by default (consent-required); pass
      // a grant to preview what WOULD be allowed. Inert; navigated:false/performed:false
      // — never navigates, signs, publishes, sends, or connects.
      gatewayTravel(input, grant) { return gatewayTravelReport(input, grant); },
      // v0.2.167 — the READ-ONLY host TRAVEL HANDOFF PLAN (GATEWAY / NAP-zone
      // handoff): shows the INERT dry-run plan a host executor WOULD run for an
      // allowed gateway:travel intent — target zone/route/url, preflight checks, the
      // ordered future command names, and the rollback route. Blocked by default; pass
      // a grant to preview a READY plan. dryRun:true/navigated:false/performed:false —
      // never navigates, unloads/reloads the world, signs, or publishes.
      handoffPlan(input, grant, hostContext) { return handoffPlanReport(input, grant, hostContext); },
      // v0.2.168 — the first controlled SAME-ORIGIN travel EXECUTOR (GATEWAY /
      // NAP-zone handoff): runs the v0.2.167 READY plan through the executor. By
      // DEFAULT no host transport is injected, so this is a NO-OP — the debug shell
      // never navigates the live app. Pass a fake transport ({ navigate, snapshot?,
      // rollback?, log? }) to preview an acting run. The external targetUrl is never
      // executed; external:false/worldReloaded:false/signed:false/published:false/
      // network:false — never signs, publishes, reloads the world, or writes network.
      handoffExecute(input, grant, transport, opts) { return handoffExecuteReport(input, grant, transport, opts); },
      // v0.2.170 — the real same-site host TRANSPORT ADAPTER (GATEWAY / NAP-zone
      // handoff): runs the v0.2.168 executor through a REAL transport built over an
      // IN-MEMORY recording host, so the safe same-origin route change is captured in
      // memory (pushStateCalls) with NO live browser navigation. Shows navigate/
      // snapshot/rollback behaviour + the host's recorded route. inMemory:true; the
      // external targetUrl is never executed; external:false/worldReloaded:false/
      // signed:false/published:false/network:false — never signs, publishes, reloads
      // the world, writes the network, or navigates externally.
      hostTransport(input, grant, opts) { return hostTransportReport(input, grant, opts); },
      // v0.2.178 — the LIVE-WIRE seam for a CONFIRMED same-origin gateway hop
      // (GATEWAY / NAP-zone handoff, LEAN-2): activateGatewayHandoff joins the
      // consent-gated plan to a host transport, but REFUSES to act unless
      // opts.confirmed === true. The debug shell drives an IN-MEMORY recording host,
      // so a confirmed hop is captured in memory (pushStateCalls) with NO live
      // browser navigation; pass opts.confirmed:false to see the unconfirmed no-op.
      // confirmed/live/transportKind reported; external:false/worldReloaded:false/
      // signed:false/published:false/network:false — never signs, publishes, reloads
      // the world, writes the network, or navigates externally.
      gatewayActivation(input, grant, opts) { return gatewayActivationReport(input, grant, opts); },
      // v0.2.180 — the in-world GATEWAY PORTAL activation seam: maps a gateway
      // COMPONENT onto a same-origin activation input (internal target → /zone/<slug>,
      // external website dropped) and runs it through activateGatewayHandoff over an
      // IN-MEMORY recording host. Arming is inert; only a confirmed hop acts. Same
      // safety pins as gatewayActivation — external/world/network/sign/publish false.
      gatewayPortalActivation(component, context, grant, opts) { return gatewayPortalActivationReport(component, context, grant, opts); },
      // v0.2.181 — the in-world PROXIMITY → CONFIRM trigger over an IN-MEMORY
      // recording-host boundary: far tick does NOT arm; near tick ARMS (inert); an
      // explicit interact() performs the CONFIRMED same-origin hop. Proximity never
      // navigates. Same safety pins — external/world/network/sign/publish false.
      portalTrigger(component, context, opts) { return portalTriggerReport(component, context, opts); },
      // v0.2.142 — the visible-but-inert torii.quest update-check PREVIEW block
      // (LEAN-5) the title/HUD card draws. Read-only; actionable:false — no network
      // fetch, no auto-update, no install, no navigation (deterministic local sample).
      updatePreview(release, opts) { return updatePreviewReport(release, opts); },
      // v0.2.158 — the inert in-game UPDATE-STATUS panel (LEAN-5): the v0.2.157
      // release source folded with the inert preview into one render-ready,
      // display-only update-status view (verdict + source diagnostics). Read-only;
      // actionable:false — no network fetch, no auto-update, no install, no
      // navigation (deterministic local sample feed by default).
      updateStatus(payload, opts) { return updateStatusReport(payload, opts); },
      // v0.2.143 — the inert MVP loop header block the title-screen card draws to
      // frame the four previews as one Travel→Market→Score→Update loop. Read-only;
      // actionable:false — content/labelling only, no navigation/fetch/sign/publish.
      mvpLoop(opts) { return mvpLoopReport(opts); },
      report(inputs) { return buildShellReport(inputs); },
      // v0.2.145 — one-call DISCOVERABILITY summary of the four MVP proof surfaces
      // (gateway/product/leaderboard/update previews) framed by the MVP loop: each
      // surface's SDK namespace, its ToriiDebug.shells report, and its inert
      // invariants (readOnly/actionable/signed/published), all READ from the live
      // reports. `allInert` is the single gate a reviewer can assert. Read-only;
      // no network/actions. For AI handoffs + FOSS devs (see SDK_DEBUG_INDEX.md).
      summary(inputs) { return shellsSummary(inputs); },
      // v0.2.146 — pure read-only DIFF of two shells.summary() outputs (before/after
      // a preview→live promotion). Classifies each invariant flip and flags the ones
      // that LOOSEN inertness, so a promotion can be reviewed mechanically. No
      // network/actions/DOM/THREE — only compares the two summaries already computed.
      diff(a, b) { return shellsDiff(a, b); },
      // v0.2.147 — read-only LAYOUT/SPEC summary for the four future in-world proof
      // meshes (gateway portal panel, product stall panel, leaderboard board, update
      // prompt board): where each will sit in the NAP zone + its inert invariants,
      // as PLAIN data. Spec layer only — no Three/render/gameplay. `allInert` reads
      // from the specs' own invariants. See SDK `proofSurfaceSpecs` + SDK_DEBUG_INDEX.md.
      surfaceSpecs() { return proofSurfaceLayout(); },
      // v0.2.148 — pure CROSS-CHECK that each proof-surface spec stays aligned with
      // the live registries it claims to feed from: `previewSdk` against the SDK
      // experimental namespaces, `shell` against the ToriiDebug.shells report names,
      // plus a re-assert of the inert invariants + a no-live-action-key scan. Returns
      // { ok, errors, warnings, surfaces } so a reviewer can mechanically confirm the
      // specs are wired correctly BEFORE the future mesh pass binds anything. Pass a
      // { sdk, shells } map to check against your own registries. No render/network.
      surfaceSpecCheck(surfaceMap, specs) { return checkProofSurfaceSpecs(surfaceMap, specs); },
      // v0.2.149 — pure ANCHOR→TRANSFORM resolution for the four proof surfaces:
      // binds each spec's `anchor` id to a plain transform descriptor (anchor
      // ground origin, surface position, the offset between them, size, yawRad)
      // and lists any unresolved anchors. `ok` is true iff every spec resolved.
      // The placement contract the future mesh pass reads — no Three/render/
      // gameplay. See SDK `anchorTransforms` + SDK_DEBUG_INDEX.md.
      anchorTransforms(specs) { return resolveAllAnchors(specs); },
      // v0.2.150 — render state of the FIRST display-only proof-surface mesh
      // pass: `{rendered, count, ok, badge, reasons}`. `rendered` is true only
      // after the inert panels were built (gates passed); otherwise `reasons`
      // carries the gate failures. Read-only. See SDK_DEBUG_INDEX.md.
      surfaceRender() { return proofSurfaceRenderState(); },
      // v0.2.151 — scene-graph PARENT BINDING for the proof-surface boards: groups
      // the live render plan's panels by their `parent` hint, mapping each to the
      // live scene-node name + the per-parent display-only group name the mesh
      // adapter mounts them under — `{ok,badge,group,count,groups,unbound}`. Pure,
      // read-only; builds nothing. See SDK_DEBUG_INDEX.md.
      surfaceBindings(opts) { return resolveParentBindings(buildProofSurfaceRenderPlan(opts)); },
      // v0.2.152 — PROMOTION/REGRESSION GATE: folds the spec cross-check, render plan,
      // and parent binding into one fail-fast `{ok,gates,counts,reasons}`. `ok` is true
      // iff all three layers hold, so a reviewer (or regression-check [12]) can confirm
      // the proof boards + bindings are safe/complete BEFORE any preview→live promotion.
      // Pure, read-only; builds nothing. See SDK_DEBUG_INDEX.md.
      surfaceGate(opts) { return proofSurfaceGate(opts); },
    },
  };

  window.ToriiDebug = api;
  return api;
}
