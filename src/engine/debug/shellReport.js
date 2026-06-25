// engine/debug/shellReport.js — read-only DEBUG reports over the v0.2.136 VIEW
// shells (gateway portal, product panel, leaderboard). Gives a human/AI handoff a
// one-call way to inspect what those shells produce, with safe demo fixtures so
// `ToriiDebug.shells.report()` works out-of-the-box.
//
// Pure + node-safe: NO Three/Rapier/DOM, NO window/location navigation, NO relay
// I/O, NO signing, NO publish. Every helper only reads the shells' pure return
// values; the shells themselves already forbid commerce/navigation/signing, so
// these reports are read-only by construction. Builders take default fixtures and
// accept overrides so they stay unit-testable.

import { gatewayPortalView } from '../gateway/gatewayPortal.js';
import { gatewayPreviewBlock } from '../gateway/gatewayPreview.js';
import { productPanelShell } from '../components/productPanelShell.js';
import { productPreviewBlock } from '../components/productPreview.js';
import { rankScores } from '../nostr/leaderboardView.js';
import { leaderboardPreviewBlock } from '../nostr/leaderboardPreview.js';
import { readLeaderboardEvents } from '../nostr/leaderboardRelayRead.js';
import { readProfiles } from '../nostr/profileRead.js';
import { CONSENT_ACTIONS, evaluateConsent, summariseConsent } from '../consent/consentGate.js';
import { consentPromptRows } from '../consent/consentView.js';
import { prepareSubmitIntent, DEMO_SUBMIT_INPUT } from '../leaderboard/submitIntent.js';
import { readGateways, DEMO_GATEWAY_EVENTS } from '../gateway/gatewayRead.js';
import { prepareTravelIntent, DEMO_TRAVEL_INPUT } from '../gateway/travelConfirm.js';
import { planHandoff, DEMO_HANDOFF_INPUT } from '../gateway/handoffPlan.js';
import { executeHandoff } from '../gateway/handoffExecute.js';
import { createRecordingHost, createHostTransport, HOST_TRANSPORT_BADGE } from '../gateway/hostTransport.js';
import { activateGatewayHandoff, DEMO_ACTIVATION_OPTS } from '../gateway/gatewayActivation.js';
import { activatePortalHandoff, createGatewayPortalBoundary, DEMO_PORTAL_CONTEXT } from '../gateway/gatewayPortalActivation.js';
import { createPortalTrigger, PORTAL_PROMPT_TEXT } from '../gateway/portalTrigger.js';
import { parseZoneRoute, describeZoneRoute, ZONE_ROUTE_BADGE, DEMO_ZONE_ROUTE } from '../gateway/zoneRoute.js';
import { buildPortalMeshPlan, describePortalMeshPlan, PORTAL_MESH_BADGE, DEMO_PORTAL_MESH_OPTS } from '../gateway/portalMeshPlan.js';
import { portalPromptLabel, enteredZoneLabel, ZONE_LABEL_BADGE, DEMO_ZONE_LABEL_OPTS } from '../gateway/zoneLabel.js';
import { updatePreviewBlock } from '../update/updatePreview.js';
import { updateStatusPanel } from '../update/updateStatus.js';
import { mvpLoopSummary } from '../mvpLoop.js';
import { createToriiGateway } from '../components/toriiGateway.js';

// An ARMED demo gateway (has a `target`, so the travel plan validates) — lets the
// gateway report show a non-trivial ready/armed view without touching the wire.
export const DEMO_GATEWAY = createToriiGateway({
  npub: 'npub1demo0gateway0report0fixture0traveller0xxxxxxxxxxxxxx',
  relay: 'wss://relay.example.com',
  target: 'plebeian-market-bazaar',
  position: { x: 20, y: 0, z: 0 },
});

// A valid demo product (https url + npub-shaped seller) for the panel report.
export const DEMO_PRODUCT = Object.freeze({
  title: 'Sticker Gun Skin',
  sellerNpub: 'npub1demo0seller0report0fixture0pleb0market0xxxxxxxxxxxx',
  priceSats: 2100,
  url: 'https://plebeian.market/listing/sticker-gun',
  image: 'https://plebeian.market/img/sticker-gun.png',
  reward: 'Sticker Gun skin',
});

// A handful of demo run scores (all headshots <= kills, accuracy in [0,1]) so the
// leaderboard report can show a deterministic ranked table.
export const DEMO_SCORES = Object.freeze([
  { runId: 'run-a', score: 120, kills: 12, headshots: 5, accuracy: 0.62 },
  { runId: 'run-b', score: 240, kills: 20, headshots: 11, accuracy: 0.71 },
  { runId: 'run-c', score: 90, kills: 9, headshots: 2, accuracy: 0.5 },
]);

// A deterministic LOCAL sample of kind-30000 leaderboard score events — the shape
// a read-only relay transport WOULD return — so the leaderboard relay-read report
// can prove the READ→rank path without ever touching a relay. Includes a superseded
// duplicate (same pubkey+run, older created_at) and one malformed entry so the
// report exercises dedupe + skip. Display-only; no network, no signing, no publish.
export const DEMO_RELAY_SCORE_EVENTS = Object.freeze([
  {
    id: '1'.repeat(64), pubkey: 'a'.repeat(64), created_at: 1000, kind: 30000,
    tags: [['d', 'run-a'], ['t', 'torii-quest']],
    content: JSON.stringify({ runId: 'run-a', score: 120, kills: 12, headshots: 5, accuracy: 0.62, version: 'v0.2.160-alpha' }),
    sig: 'f'.repeat(128),
  },
  {
    id: '2'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1500, kind: 30000,
    tags: [['d', 'run-b'], ['t', 'torii-quest']],
    content: JSON.stringify({ runId: 'run-b', score: 240, kills: 20, headshots: 11, accuracy: 0.71, version: 'v0.2.160-alpha' }),
    sig: 'e'.repeat(128),
  },
  {
    // Superseded older run for pubkey a / run-a — dedupe should drop this one.
    id: '3'.repeat(64), pubkey: 'a'.repeat(64), created_at: 500, kind: 30000,
    tags: [['d', 'run-a'], ['t', 'torii-quest']],
    content: JSON.stringify({ runId: 'run-a', score: 60, kills: 6, headshots: 1, accuracy: 0.4, version: 'v0.2.160-alpha' }),
    sig: 'd'.repeat(128),
  },
  {
    // Malformed (headshots > kills) — extraction should skip it.
    id: '4'.repeat(64), pubkey: 'c'.repeat(64), created_at: 1200, kind: 30000,
    tags: [['d', 'run-c'], ['t', 'torii-quest']],
    content: JSON.stringify({ runId: 'run-c', score: 90, kills: 2, headshots: 9, accuracy: 0.5, version: 'v0.2.160-alpha' }),
    sig: 'c'.repeat(128),
  },
]);

// A deterministic LOCAL sample of kind:0 profile events — the shape a read-only
// relay transport WOULD return — so the profile-read report can prove the kind:0
// READ→sanitise path without ever touching a relay. Includes a superseded older
// profile (same pubkey, older created_at), a profile with an UNSAFE picture URL
// (must sanitise to null), and a malformed-JSON content (must degrade safely).
// Display-only; no network, no signing, no publish, no DOM <img src> assignment.
export const DEMO_PROFILE_EVENTS = Object.freeze([
  {
    id: '1'.repeat(64), pubkey: 'a'.repeat(64), created_at: 2000, kind: 0,
    tags: [],
    content: JSON.stringify({ name: 'satoshi', display_name: 'Satoshi N', about: 'freedom tech', picture: 'https://example.com/sat.png', nip05: 'satoshi@example.com', lud16: 'satoshi@wos.com', website: 'https://example.com' }),
    sig: 'f'.repeat(128),
  },
  {
    // Superseded older profile for pubkey a — newest-per-author should drop this.
    id: '2'.repeat(64), pubkey: 'a'.repeat(64), created_at: 1000, kind: 0,
    tags: [],
    content: JSON.stringify({ name: 'satoshi-old', display_name: 'Old Name' }),
    sig: 'e'.repeat(128),
  },
  {
    // Unsafe picture URL (javascript:) — must sanitise to null, profile still valid.
    id: '3'.repeat(64), pubkey: 'b'.repeat(64), created_at: 1500, kind: 0,
    tags: [],
    content: JSON.stringify({ name: 'nostrich', picture: 'javascript:alert(1)', website: 'http://no.tls' }),
    sig: 'd'.repeat(128),
  },
  {
    // Malformed JSON content — must degrade to an empty-but-valid profile.
    id: '4'.repeat(64), pubkey: 'c'.repeat(64), created_at: 1200, kind: 0,
    tags: [],
    content: 'not json{',
    sig: 'c'.repeat(128),
  },
]);

// A deterministic LOCAL sample GitHub release (newer than the current runtime) so
// the update-check report shows a non-trivial "update available" view WITHOUT ever
// fetching the wire. Display-only; the real read-only fetch is a deferred host step.
export const DEMO_RELEASE = Object.freeze({
  tag_name: 'v0.2.999-alpha',
  name: 'Torii Quest v0.2.999-alpha',
  html_url: 'https://github.com/torii-quest/torii-quest/releases/tag/v0.2.999-alpha',
  body: 'Sample release notes (local fixture) — bigger arena, nostrich skins, Chiefmonkey balance.',
  draft: false,
  prerelease: true,
  published_at: '2026-06-24T00:00:00Z',
});

// gatewayReport(component, context, opts) → a compact, JSON-serialisable summary
// of the gateway portal VIEW shell. Display-only fields; never navigates.
export function gatewayReport(component = DEMO_GATEWAY, context = {}, opts = {}) {
  const v = gatewayPortalView(component, context, opts);
  return {
    status: v.status,
    isGateway: v.isGateway,
    armed: v.armed,
    destinationLabel: v.destinationLabel,
    relay: v.relay,
    prompt: v.prompt,
    urlPreview: v.urlPreview,
    errors: v.errors,
  };
}

// gatewayPreviewReport(component, context, opts) → the visible-but-inert gateway
// PREVIEW block (LEAN-2) a title/HUD card would draw. Read-only; pins
// readOnly:true + actionable:false so the no-navigation guarantee is explicit in
// the report and symmetric with the other three proof surfaces.
export function gatewayPreviewReport(component = DEMO_GATEWAY, context = {}, opts = {}) {
  const b = gatewayPreviewBlock(component, context, opts);
  return {
    title: b.title,
    status: b.status,
    statusLabel: b.statusLabel,
    armed: b.armed,
    destination: b.destination,
    relay: b.relay,
    intent: b.intent,
    urlPreview: b.urlPreview,
    badge: b.badge,
    lines: b.lines,
    readOnly: b.readOnly,
    actionable: b.actionable,
  };
}

// productReport(product) → a compact summary of the product panel RENDER shell,
// surfacing that it is read-only (no actions, non-actionable footer).
export function productReport(product = DEMO_PRODUCT) {
  const { ok, errors, panel } = productPanelShell(product);
  if (!ok) return { ok: false, errors, title: null, lineCount: 0, lines: [], footer: null, actionable: false, actionCount: 0, readOnly: true };
  return {
    ok: true,
    errors: [],
    title: panel.title,
    lineCount: panel.lines.length,
    lines: panel.lines,
    footer: panel.footer,
    actionable: panel.footer.actionable,
    actionCount: panel.actions.length,
    readOnly: panel.readOnly,
  };
}

// productPreviewReport(product, opts) → the visible-but-inert Plebeian/Nostr
// product/market PREVIEW block (LEAN-3) a title/HUD card would draw. Read-only;
// pins actionable:false + readOnly so the no-checkout guarantee is explicit.
export function productPreviewReport(product = DEMO_PRODUCT, opts = {}) {
  const b = productPreviewBlock(product, opts);
  return {
    title: b.title,
    ok: b.ok,
    seller: b.seller,
    sellerFull: b.sellerFull,
    marketplace: b.marketplace,
    badge: b.badge,
    lines: b.lines,
    readOnly: b.readOnly,
    actionable: b.actionable,
    errors: b.errors,
  };
}

// leaderboardReport(statsList, { mode }) → a compact ranked summary. Uses
// rankScores (pure, no signer/publisher), and pins signed/published to false to
// make the no-transmit guarantee explicit in the report itself.
export function leaderboardReport(statsList = DEMO_SCORES, { mode = 'build' } = {}) {
  const { rows, skipped } = rankScores(statsList);
  return {
    mode,
    count: rows.length,
    skipped: skipped.length,
    rows,
    signed: false,
    published: false,
  };
}

// leaderboardPreviewReport(statsList, opts) → the visible-but-inert local/mock
// leaderboard PREVIEW block (LEAN-4) a title/HUD card would draw. Read-only;
// pins signed/published/actionable false so the no-publish guarantee is explicit.
export function leaderboardPreviewReport(statsList = DEMO_SCORES, opts = {}) {
  const b = leaderboardPreviewBlock(statsList, opts);
  return {
    title: b.title,
    mode: b.mode,
    modeLabel: b.modeLabel,
    badge: b.badge,
    signed: b.signed,
    published: b.published,
    signer: b.signer,
    count: b.count,
    shown: b.shown,
    skipped: b.skipped,
    proof: b.proof,
    rows: b.rows,
    lines: b.lines,
    readOnly: b.readOnly,
    actionable: b.actionable,
  };
}

// leaderboardRelayReadReport(events, opts) → the READ-ONLY leaderboard relay-read
// PROOF (NOSTR-READ / LB-1, v0.2.160) over a deterministic LOCAL sample of relay
// score events. Proves the READ→extract→dedupe→rank path WITHOUT any relay I/O:
// defaults to DEMO_RELAY_SCORE_EVENTS (which includes a superseded duplicate and a
// malformed entry). Pins signed/published false + readOnly true so the no-publish,
// no-network guarantee is explicit in the report.
export function leaderboardRelayReadReport(events = DEMO_RELAY_SCORE_EVENTS, opts = {}) {
  const r = readLeaderboardEvents(events, opts);
  return {
    ok: r.ok,
    filter: r.filter,
    count: r.count,
    rows: r.rows,
    skipped: r.skipped.length,
    duplicates: r.duplicates,
    signed: r.signed,
    published: r.published,
    readOnly: r.readOnly,
    errors: r.errors,
  };
}

// profileReadReport(events, opts) → the READ-ONLY Nostr identity/profile PROOF
// (NOSTR-READ / IDENTITY, v0.2.161) over a deterministic LOCAL sample of kind:0
// events. Proves the READ→parse→sanitise→newest-per-author path WITHOUT any relay
// I/O: defaults to DEMO_PROFILE_EVENTS (incl. a superseded duplicate, an unsafe
// picture URL, and malformed JSON). Pins signed/published false + readOnly true so
// the no-publish, no-network guarantee is explicit; avatar/website URLs are inert
// https-only data strings (never assigned to a DOM <img src> here).
export function profileReadReport(events = DEMO_PROFILE_EVENTS, opts = {}) {
  const r = readProfiles(events, opts);
  return {
    ok: r.ok,
    filter: r.filter,
    count: r.count,
    profiles: r.profiles,
    skipped: r.skipped.length,
    duplicates: r.duplicates,
    signed: r.signed,
    published: r.published,
    readOnly: r.readOnly,
    errors: r.errors,
  };
}

// consentGateReport(opts) → the READ-ONLY CONSENT-GATE foundation map (CONSENT-1,
// v0.2.162). Walks the known-action registry and, for each action, shows its
// write/sign/danger facts, the default (NO-grant) decision, and a one-line summary
// — proving read-only actions are allowed while write/sign/publish/update/travel
// actions are blocked until an explicit grant arrives. Pure + inert: this NEVER
// signs/publishes/acts; `performed:false` is pinned on every row. The optional
// `grants` map ({ actionId: true|{granted,...} }) lets a caller preview what WOULD
// be allowed under a given set of consents — still without performing anything.
export function consentGateReport(opts = {}) {
  const grants = (opts && typeof opts.grants === 'object' && opts.grants) || {};
  const actions = Object.keys(CONSENT_ACTIONS).map((id) => {
    const d = evaluateConsent(id, grants[id] ?? null);
    return {
      action: id,
      kind: d.kind ?? CONSENT_ACTIONS[id].kind,
      write: d.write,
      signed: d.signed,
      requiresConsent: d.requiresConsent,
      danger: d.danger,
      allowed: d.allowed,
      blocked: d.blocked,
      reason: d.reason,
      performed: d.performed,
      summary: summariseConsent(id),
    };
  });
  return {
    title: 'CONSENT GATE',
    badge: 'FOUNDATION · INERT · NO WRITE/SIGN/PUBLISH',
    count: actions.length,
    writeActions: actions.filter((a) => a.requiresConsent).length,
    allowedByDefault: actions.filter((a) => a.allowed).length,
    actions,
    readOnly: true,
    performed: false,
  };
}

// consentPromptReport(opts) → the CONSENT UX VIEW-MODEL preview map (CONSENT-2,
// v0.2.166). Shows the user-facing PROMPT copy a future confirm dialog WOULD draw for
// every known action — headline, action/cancel labels, severity, allowed/blocked +
// reason — blocked-by-default for writes. DISPLAY-ONLY: every row pins
// actionable:false; this NEVER confirms/signs/publishes/navigates. The optional
// `grants` map ({ actionId: true|{granted,...} }) previews what copy WOULD show under
// a given set of consents — still without performing anything.
export function consentPromptReport(opts = {}) {
  const grants = (opts && typeof opts.grants === 'object' && opts.grants) || {};
  const rows = consentPromptRows(grants);
  return {
    title: 'CONSENT PROMPT PREVIEW',
    badge: 'CONSENT · PREVIEW · NO ACTION',
    count: rows.length,
    writeActions: rows.filter((r) => r.requiresExplicitConsent).length,
    allowedByDefault: rows.filter((r) => r.allowed).length,
    rows,
    readOnly: true,
    actionable: false,
    performed: false,
  };
}

// leaderboardSubmitReport(input, grant) → the READ-ONLY leaderboard SUBMIT INTENT
// map (LB-SUBMIT, v0.2.163). Shows the inert submit DRAFT a host WOULD sign+publish
// for a run, and the consent-gate decision for it. With no grant (default) the
// decision is BLOCKED (consent-required); an optional `grant` previews what WOULD be
// allowed — still without performing anything (`performed:false` pinned, the draft is
// never signed/published). Defaults to deterministic DEMO sample data.
export function leaderboardSubmitReport(input = DEMO_SUBMIT_INPUT, grant = null) {
  const r = prepareSubmitIntent(input, grant);
  return {
    title: 'LEADERBOARD SUBMIT INTENT',
    badge: 'PREVIEW · INERT · NO SIGN/PUBLISH',
    action: r.action,
    ok: r.ok,
    allowed: r.consent.allowed,
    blocked: r.consent.blocked,
    reason: r.consent.reason,
    kind: r.draft ? r.draft.kind : null,
    identity: r.draft ? r.draft.identity : null,
    tags: r.draft ? r.draft.event.tags : null,
    summary: r.summary,
    signed: r.signed,
    published: r.published,
    performed: r.performed,
    readOnly: r.readOnly,
    errors: r.errors,
  };
}

// gatewayReadReport(input) → the READ-ONLY gateway destination relay-read map
// (GATEWAY / NAP-zone handoff, v0.2.164). Shows the sanitised travel-preview records
// a host's read-only transport WOULD return for the torii-gateway topic, deduped to
// the newest record per addressable zone. INERT: never navigates/signs/publishes
// (`navigated`/`signed`/`published`/`performed:false` pinned). Defaults to the
// deterministic DEMO sample (no network).
export function gatewayReadReport(input = DEMO_GATEWAY_EVENTS) {
  const r = readGateways(input);
  return {
    title: 'GATEWAY DESTINATION READ',
    badge: 'PREVIEW · INERT · NO NAVIGATION',
    ok: r.ok,
    count: r.count,
    duplicates: r.duplicates,
    filter: r.filter,
    gateways: r.gateways,
    skipped: r.skipped.length,
    navigated: r.navigated,
    signed: r.signed,
    published: r.published,
    performed: r.performed,
    readOnly: r.readOnly,
    errors: r.errors,
  };
}

// gatewayTravelReport(input, grant) → the READ-ONLY gateway TRAVEL CONFIRMATION /
// INTENT map (GATEWAY / NAP-zone handoff, v0.2.165). Shows the sanitised destination a
// host WOULD travel to and the consent-gate decision for it. With no grant (default)
// the decision is BLOCKED (consent-required); an optional `grant` previews what WOULD
// be allowed — still without navigating/performing (`navigated`/`performed:false`
// pinned). Defaults to the deterministic DEMO sample.
export function gatewayTravelReport(input = DEMO_TRAVEL_INPUT, grant = null) {
  const r = prepareTravelIntent(input, grant);
  return {
    title: 'GATEWAY TRAVEL INTENT',
    badge: 'PREVIEW · INERT · NO NAVIGATION',
    action: r.action,
    ok: r.ok,
    allowed: r.consent.allowed,
    blocked: r.consent.blocked,
    reason: r.consent.reason,
    destination: r.destination,
    summary: r.summary,
    navigated: r.navigated,
    performed: r.performed,
    signed: r.signed,
    published: r.published,
    readOnly: r.readOnly,
    errors: r.errors,
  };
}

// handoffPlanReport(input, grant, hostContext) → the READ-ONLY host TRAVEL HANDOFF
// PLAN map (GATEWAY / NAP-zone handoff, v0.2.167). Shows the INERT dry-run plan a
// host executor WOULD run for an allowed gateway:travel intent — target zone/route/
// url, preflight checks, the ordered future command names, and the rollback route —
// plus its status/reason. With no grant (default) the plan is BLOCKED; an optional
// `grant` previews a READY plan — still WITHOUT navigating/unloading/performing
// (`dryRun:true`/`navigated:false`/`performed:false` pinned). Defaults to the
// deterministic DEMO sample.
export function handoffPlanReport(input = DEMO_HANDOFF_INPUT, grant = null, hostContext = null) {
  const p = planHandoff(input, grant, hostContext);
  return {
    title: 'GATEWAY HANDOFF PLAN',
    badge: p.badge,
    action: p.action,
    status: p.status,
    ok: p.ok,
    reason: p.reason,
    targetZoneId: p.targetZoneId,
    targetRoute: p.targetRoute,
    targetUrl: p.targetUrl,
    currentRoute: p.currentRoute,
    rollbackRoute: p.rollbackRoute,
    preflight: p.preflight,
    commands: p.commands,
    summary: p.summary,
    dryRun: p.dryRun,
    navigated: p.navigated,
    worldReloaded: p.worldReloaded,
    performed: p.performed,
    signed: p.signed,
    published: p.published,
    readOnly: p.readOnly,
    errors: p.errors,
  };
}

// handoffExecuteReport(input, grant, transport, opts) → the SAME-ORIGIN travel
// EXECUTOR report (GATEWAY / NAP-zone handoff, v0.2.168). Builds the v0.2.167 READY
// handoff plan from the demo intent and runs the executor over it. By DEFAULT no
// host transport is injected, so this is a NO-OP (navigated:false/performed:false) —
// the debug shell never navigates the live app. Pass a fake `transport`
// ({ navigate, snapshot?, rollback?, log? }) to preview an acting run; the external
// targetUrl is never executed and all network/sign/publish/world flags stay false.
export function handoffExecuteReport(input = DEMO_HANDOFF_INPUT, grant = true, transport = null, opts = {}) {
  const hostContext = opts && opts.hostContext ? opts.hostContext : { currentRoute: '/title', rollbackRoute: '/title' };
  const plan = planHandoff(input, grant, hostContext);
  const r = executeHandoff(plan, transport, opts);
  return {
    title: 'GATEWAY TRAVEL EXECUTE',
    badge: r.badge,
    action: r.action,
    status: r.status,
    ok: r.ok,
    reason: r.reason,
    targetRoute: r.targetRoute,
    fromRoute: r.fromRoute,
    rollbackRoute: r.rollbackRoute,
    steps: r.steps,
    rollback: r.rollback,
    rolledBack: r.rolledBack,
    navigated: r.navigated,
    performed: r.performed,
    external: r.external,
    worldReloaded: r.worldReloaded,
    signed: r.signed,
    published: r.published,
    network: r.network,
    errors: r.errors,
  };
}

// hostTransportReport(input, grant, opts) → the same-site host TRANSPORT ADAPTER
// report (GATEWAY / NAP-zone handoff, v0.2.170). Builds a v0.2.167 READY plan and
// runs the v0.2.168 executor through a REAL host transport — but the host is an
// IN-MEMORY recording host (createRecordingHost), so the route change is captured in
// memory and NO live browser navigation happens. Proves the transport hands the safe
// same-origin route to the host (pushState), snapshots, and can roll back, while every
// network/sign/publish/world/external flag stays false. Pass opts.hostContext to vary
// the from/rollback route; opts.executeOpts is forwarded to the executor.
export function hostTransportReport(input = DEMO_HANDOFF_INPUT, grant = true, opts = {}) {
  const hostContext = opts && opts.hostContext ? opts.hostContext : { currentRoute: '/title', rollbackRoute: '/title' };
  const host = createRecordingHost(hostContext.currentRoute);
  const transport = createHostTransport(host, { home: hostContext.rollbackRoute });
  const plan = planHandoff(input, grant, hostContext);
  const r = executeHandoff(plan, transport, (opts && opts.executeOpts) || {});
  return {
    title: 'GATEWAY HOST TRANSPORT',
    badge: r.badge,
    transportBadge: HOST_TRANSPORT_BADGE,
    action: r.action,
    status: r.status,
    ok: r.ok,
    reason: r.reason,
    targetRoute: r.targetRoute,
    fromRoute: r.fromRoute,
    rollbackRoute: r.rollbackRoute,
    hostRoute: host.route,
    pushStateCalls: host.calls.pushState,
    replaceStateCalls: host.calls.replaceState,
    rollback: r.rollback,
    rolledBack: r.rolledBack,
    navigated: r.navigated,
    performed: r.performed,
    inMemory: true,
    external: r.external,
    worldReloaded: r.worldReloaded,
    signed: r.signed,
    published: r.published,
    network: r.network,
    errors: r.errors,
  };
}

// gatewayActivationReport(input, grant, opts) → the CONFIRMED same-origin gateway
// hop activation report (GATEWAY / NAP-zone handoff, v0.2.178, LEAN-2). Runs the
// live-wire seam through an IN-MEMORY recording host so the debug shell can prove a
// CONFIRMED acting hop (and the no-confirm / blocked / unsafe no-ops) without any
// real browser navigation. By default `confirmed:true` + a `/zone/` allowlist drive
// a recording-host hop; pass `opts.confirmed:false` to see the unconfirmed no-op, or
// omit the host to see the safe no-transport no-op. Every external/world/network/
// sign/publish flag stays false.
export function gatewayActivationReport(input = DEMO_HANDOFF_INPUT, grant = true, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const hostContext = o.hostContext || DEMO_ACTIVATION_OPTS.hostContext;
  const confirmed = o.confirmed === undefined ? true : o.confirmed === true;
  // Default-safe demo: a recording host (NOT a real window) so the shell never
  // navigates the live app. Callers may inject their own transport/window/host.
  const host = o.host !== undefined || o.window !== undefined || o.transport !== undefined
    ? undefined
    : createRecordingHost(hostContext.currentRoute || '/');
  const r = activateGatewayHandoff(input, grant, {
    confirmed,
    host: host !== undefined ? host : o.host,
    window: o.window,
    transport: o.transport,
    hostContext,
    home: hostContext.rollbackRoute || '/',
    routeAllowlist: o.routeAllowlist || DEMO_ACTIVATION_OPTS.routeAllowlist,
    dryRun: o.dryRun === true,
  });
  return {
    title: 'GATEWAY ACTIVATION',
    badge: r.badge,
    action: r.action,
    status: r.status,
    ok: r.ok,
    confirmed: r.confirmed,
    live: r.live,
    reason: r.reason,
    transportKind: r.transportKind,
    targetRoute: r.targetRoute,
    fromRoute: r.fromRoute,
    rollbackRoute: r.rollbackRoute,
    hostRoute: host ? host.route : null,
    pushStateCalls: host ? host.calls.pushState : [],
    inMemory: host !== undefined,
    navigated: r.navigated,
    performed: r.performed,
    external: r.external,
    worldReloaded: r.worldReloaded,
    signed: r.signed,
    published: r.published,
    network: r.network,
    errors: r.errors,
  };
}

// gatewayPortalActivationReport(component, context, grant, opts) → the in-world
// GATEWAY PORTAL activation report (GATEWAY / NAP-zone handoff, v0.2.180). Maps the
// demo gateway COMPONENT onto a same-origin activation input and runs it through the
// v0.2.178 live-wire seam over an IN-MEMORY recording host, so the debug shell can
// prove a CONFIRMED acting portal hop (and the no-confirm no-op) without any real
// browser navigation. By default `confirmed:true` drives a recording-host hop to the
// component's `/zone/<target>` route; pass `opts.confirmed:false` for the unconfirmed
// no-op. Every external/world/network/sign/publish flag stays false.
export function gatewayPortalActivationReport(component = DEMO_GATEWAY, context = DEMO_PORTAL_CONTEXT, grant = true, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const confirmed = o.confirmed === undefined ? true : o.confirmed === true;
  // Default-safe demo: a recording host (NOT a real window) so the shell never
  // navigates the live app. Callers may inject their own transport/window/host.
  const host = o.host !== undefined || o.window !== undefined || o.transport !== undefined
    ? undefined
    : createRecordingHost('/');
  const r = activatePortalHandoff(component, context, grant, {
    confirmed,
    host: host !== undefined ? host : o.host,
    window: o.window,
    transport: o.transport,
    hostContext: o.hostContext,
    routeAllowlist: o.routeAllowlist,
    dryRun: o.dryRun === true,
  });
  return {
    title: 'GATEWAY PORTAL ACTIVATION',
    badge: r.badge,
    action: r.action,
    status: r.status,
    ok: r.ok,
    confirmed: r.confirmed,
    live: r.live,
    reason: r.reason,
    transportKind: r.transportKind,
    zoneId: r.zoneId,
    targetRoute: r.targetRoute,
    fromRoute: r.fromRoute,
    rollbackRoute: r.rollbackRoute,
    routeAllowlist: r.routeAllowlist,
    hostRoute: host ? host.route : null,
    pushStateCalls: host ? host.calls.pushState : [],
    inMemory: host !== undefined,
    navigated: r.navigated,
    performed: r.performed,
    external: r.external,
    worldReloaded: r.worldReloaded,
    signed: r.signed,
    published: r.published,
    network: r.network,
    errors: r.errors,
  };
}

// portalTriggerReport(component, context, opts) → the in-world PROXIMITY → CONFIRM
// trigger report (GATEWAY / NAP-zone handoff, v0.2.181). Drives the pure portalTrigger
// over an IN-MEMORY recording-host boundary so the debug shell can prove the full
// flow without any real browser navigation: a far tick does NOT arm; a near tick ARMS
// (inert, no pushState); an explicit interact() performs the CONFIRMED same-origin hop.
// By default it simulates approach → interact; pass `opts.interact:false` to show the
// armed-but-not-confirmed (no navigation) state. Every external/world/network/sign/
// publish flag stays false.
export function portalTriggerReport(component = DEMO_GATEWAY, context = DEMO_PORTAL_CONTEXT, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const doInteract = o.interact === undefined ? true : o.interact === true;
  const portalPos = (o.portalPos && typeof o.portalPos === 'object') ? o.portalPos : { x: 20, y: 0, z: 0 };
  const range = Number(o.range) > 0 ? Number(o.range) : 3;
  const host = createRecordingHost('/');
  const boundary = createGatewayPortalBoundary({ host, routeAllowlist: ['/zone/'] });
  const promptLog = [];
  const trigger = createPortalTrigger({
    boundary, component, context, portalPos, range,
    onPrompt: (show, text) => promptLog.push({ show, text }),
  });
  // Far → no arm. Near → arm (inert). Then optionally the explicit interact (the
  // ONLY navigating step).
  const farTick = trigger.tick({ x: portalPos.x + range + 50, y: portalPos.y, z: portalPos.z });
  const nearTick = trigger.tick({ x: portalPos.x, y: portalPos.y, z: portalPos.z });
  const armedAfterApproach = trigger.isArmed();
  const pushStateAfterArm = [...host.calls.pushState]; // proves arming is inert
  const rep = doInteract ? trigger.interact(true) : null;
  return {
    title: 'GATEWAY PORTAL TRIGGER',
    badge: rep ? rep.badge : null,
    promptText: PORTAL_PROMPT_TEXT,
    farInRange: farTick.inRange,
    nearInRange: nearTick.inRange,
    armedAfterApproach,
    pushStateAfterArm,           // [] — proximity NEVER navigates
    promptLog,
    interacted: doInteract,
    status: rep ? rep.status : null,
    navigated: rep ? rep.navigated : false,
    confirmed: rep ? rep.confirmed : false,
    live: rep ? rep.live : false,
    zoneId: rep ? rep.zoneId : null,
    targetRoute: rep ? rep.targetRoute : null,
    routeAllowlist: boundary.routeAllowlist(),
    pushStateCalls: host.calls.pushState,
    inMemory: true,
    external: rep ? rep.external : false,
    worldReloaded: rep ? rep.worldReloaded : false,
    signed: rep ? rep.signed : false,
    published: rep ? rep.published : false,
    network: rep ? rep.network : false,
    errors: rep ? rep.errors : [],
  };
}

// zoneRouteReport(path) → the inert SPA `/zone/<slug>` route resolution (v0.2.182).
// Parses the given path plus a battery of hostile/edge paths so a handoff can SEE
// that a valid zone resolves to an inert display state while traversal/percent/
// protocol-relative/malformed paths are rejected as 'invalid' — all with NO
// navigation/network. Read-only by construction.
export function zoneRouteReport(path = DEMO_ZONE_ROUTE) {
  const home = parseZoneRoute('/');
  const valid = parseZoneRoute(path);
  return {
    title: 'ZONE ROUTE',
    badge: ZONE_ROUTE_BADGE,
    sample: path,
    home: { kind: home.kind, ok: home.ok },
    valid: { kind: valid.kind, ok: valid.ok, slug: valid.slug, zoneId: valid.zoneId, route: valid.route, title: valid.title, notice: valid.notice },
    // Each of these MUST classify as 'invalid' (proves the same-origin hardening).
    rejects: {
      traversal:        parseZoneRoute('/zone/../admin').kind,
      percent:          parseZoneRoute('/zone/%2e%2e').kind,
      protocolRelative: parseZoneRoute('//evil.example.com').kind,
      scheme:           parseZoneRoute('javascript:alert(1)').kind,
      subPath:          parseZoneRoute('/zone/a/b').kind,
      malformedSlug:    parseZoneRoute('/zone/Bad Slug!').kind,
      emptySlug:        parseZoneRoute('/zone/').kind,
    },
    summary: describeZoneRoute(path),
    navigated: valid.navigated,
    performed: valid.performed,
    network: valid.network,
    external: valid.external,
    signed: valid.signed,
    published: valid.published,
    inMemory: true,
    errors: valid.errors,
  };
}

// portalMeshPlanReport(opts) → the PURE render plan for the in-world GATEWAY PORTAL
// marker (v0.2.183). Shows that the plan builds inert marker parts whose outer ring
// radius EQUALS the trigger range, that every part + the plan pin the inert flags
// false, and that a bad position degrades to ok:false. Plain data — NO THREE/DOM/nav.
export function portalMeshPlanReport(opts = DEMO_PORTAL_MESH_OPTS) {
  const plan = buildPortalMeshPlan(opts);
  const allPartsInert = plan.parts.every((p) =>
    p.navigated === false && p.performed === false && p.external === false &&
    p.signed === false && p.published === false && p.readOnly === true && p.actionable === false);
  return {
    title: 'PORTAL MESH PLAN',
    badge: PORTAL_MESH_BADGE,
    ok: plan.ok,
    anchor: plan.anchor,
    range: plan.range,
    ringRadius: plan.ringRadius,
    ringMatchesRange: plan.ringRadius === plan.range,
    count: plan.count,
    parts: plan.parts.map((p) => ({ id: p.id, kind: p.kind, role: p.role, spin: p.spin, pulse: p.pulse })),
    allPartsInert,
    summary: describePortalMeshPlan(opts),
    rendered: plan.rendered,
    navigated: plan.navigated,
    performed: plan.performed,
    external: plan.external,
    signed: plan.signed,
    published: plan.published,
    actionable: plan.actionable,
    reasons: plan.reasons,
  };
}

// zoneLabelReport(opts) → the PURE portal-prompt + entered-zone display labels
// (v0.2.184). Shows the in-range prompt naming the target zone, the generic fallback
// when no zone is known, and the concise entered-zone notice — plus a `safe` flag
// proving the labels carry no markup / dangerous token (hostile input is sanitised).
// Plain strings — NO DOM/nav/network.
export function zoneLabelReport(opts = DEMO_ZONE_LABEL_OPTS) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : DEMO_ZONE_LABEL_OPTS;
  const prompt = portalPromptLabel(o);
  const promptGeneric = portalPromptLabel({});
  const entered = enteredZoneLabel(o.slug || o.route || o.title || '');
  const hostile = enteredZoneLabel('<img src=x onerror=alert(1)>');
  const all = [prompt, promptGeneric, entered, hostile].join(' ');
  const safe = !/[<>"'`]/.test(all) && !/javascript:|data:|on\w+=/i.test(all);
  return {
    title: 'ZONE LABEL',
    badge: ZONE_LABEL_BADGE,
    prompt,
    promptGeneric,
    entered,
    hostileSanitized: hostile, // a hostile string is stripped to safe alnum/space/hyphen
    safe,
    navigated: false,
    performed: false,
    external: false,
    signed: false,
    published: false,
    network: false,
    actionable: false,
  };
}

// updatePreviewReport(release, opts) → the visible-but-inert torii.quest
// update-check PREVIEW block (LEAN-5) a title/HUD card would draw. Read-only;
// pins actionable:false so the no-fetch/no-auto-update guarantee is explicit.
export function updatePreviewReport(release = DEMO_RELEASE, opts = {}) {
  const b = updatePreviewBlock(release, opts);
  return {
    title: b.title,
    badge: b.badge,
    status: b.status,
    statusLabel: b.statusLabel,
    currentVersion: b.currentVersion,
    latestVersion: b.latestVersion,
    updateAvailable: b.updateAvailable,
    prompt: b.prompt,
    source: b.source,
    lines: b.lines,
    readOnly: b.readOnly,
    actionable: b.actionable,
  };
}

// updateStatusReport(payload, opts) → the inert in-game UPDATE-STATUS panel
// (LEAN-5, v0.2.158): the v0.2.157 release source folded with the inert preview
// into one render-ready update-status view (verdict + source diagnostics). Defaults
// to the deterministic LOCAL sample feed (no network). Read-only; pins
// actionable:false so the no-fetch/no-auto-update guarantee is explicit.
export function updateStatusReport(payload, opts = {}) {
  const p = updateStatusPanel(payload, opts);
  return {
    title: p.title,
    badge: p.badge,
    surface: p.surface,
    step: p.step,
    status: p.status,
    statusLabel: p.statusLabel,
    currentVersion: p.currentVersion,
    latestVersion: p.latestVersion,
    updateAvailable: p.updateAvailable,
    prompt: p.prompt,
    source: p.source,
    sourceUrl: p.sourceUrl,
    lines: p.lines,
    readOnly: p.readOnly,
    actionable: p.actionable,
  };
}

// mvpLoopReport(opts) → the inert MVP loop header block (v0.2.143) the title-screen
// card draws to frame the four previews as one Travel→Market→Score→Update loop.
// Read-only; pins actionable:false so the content-only guarantee is explicit.
export function mvpLoopReport(opts = {}) {
  const b = mvpLoopSummary(opts);
  return {
    title: b.title,
    badge: b.badge,
    flow: b.flow,
    note: b.note,
    version: b.version,
    steps: b.steps,
    lines: b.lines,
    readOnly: b.readOnly,
    actionable: b.actionable,
  };
}

// buildShellReport(inputs) → { gateway, product, leaderboard }. One-call composite
// for ToriiDebug; each section overridable via inputs for testing. Read-only.
export function buildShellReport(inputs = {}) {
  const {
    gateway = DEMO_GATEWAY,
    gatewayContext = {},
    gatewayOpts = {},
    product = DEMO_PRODUCT,
    scores = DEMO_SCORES,
    mode = 'build',
    relayScoreEvents = DEMO_RELAY_SCORE_EVENTS,
    profileEvents = DEMO_PROFILE_EVENTS,
    consentGrants = null,
    submitInput = DEMO_SUBMIT_INPUT,
    submitGrant = null,
    gatewayEvents = DEMO_GATEWAY_EVENTS,
    travelInput = DEMO_TRAVEL_INPUT,
    travelGrant = null,
    handoffInput = DEMO_HANDOFF_INPUT,
    handoffGrant = null,
    handoffContext = null,
    executeInput = DEMO_HANDOFF_INPUT,
    executeGrant = true,
    executeTransport = null,
    executeOpts = {},
    hostTransportInput = DEMO_HANDOFF_INPUT,
    hostTransportGrant = true,
    hostTransportOpts = {},
    activationInput = DEMO_HANDOFF_INPUT,
    activationGrant = true,
    activationOpts = {},
    release = DEMO_RELEASE,
    updateFeed,
  } = inputs;
  return {
    gateway: gatewayReport(gateway, gatewayContext, gatewayOpts),
    gatewayPreview: gatewayPreviewReport(gateway, gatewayContext, gatewayOpts),
    product: productReport(product),
    productPreview: productPreviewReport(product),
    leaderboard: leaderboardReport(scores, { mode }),
    leaderboardPreview: leaderboardPreviewReport(scores),
    leaderboardRelayRead: leaderboardRelayReadReport(relayScoreEvents),
    profileRead: profileReadReport(profileEvents),
    consentGate: consentGateReport(consentGrants ? { grants: consentGrants } : {}),
    consentPrompt: consentPromptReport(consentGrants ? { grants: consentGrants } : {}),
    leaderboardSubmit: leaderboardSubmitReport(submitInput, submitGrant),
    gatewayRead: gatewayReadReport(gatewayEvents),
    gatewayTravel: gatewayTravelReport(travelInput, travelGrant),
    handoffPlan: handoffPlanReport(handoffInput, handoffGrant, handoffContext),
    handoffExecute: handoffExecuteReport(executeInput, executeGrant, executeTransport, executeOpts),
    hostTransport: hostTransportReport(hostTransportInput, hostTransportGrant, hostTransportOpts),
    gatewayActivation: gatewayActivationReport(activationInput, activationGrant, activationOpts),
    updatePreview: updatePreviewReport(release),
    updateStatus: updateStatusReport(updateFeed),
    mvpLoop: mvpLoopReport(),
  };
}

// shellsSummary(inputs) → a compact, JSON-serialisable map of the four MVP proof
// surfaces (the title-screen preview cards) framed by the MVP loop, intended as a
// one-call DISCOVERABILITY aid for an AI handoff / FOSS dev: "what proof surfaces
// exist, which SDK namespace + ToriiDebug.shells report each maps to, and what
// inert invariants they guarantee." Every invariant is READ from the live report
// output above (not hard-coded), so the summary can never claim an inertness the
// underlying shell does not actually have. Pure + read-only; no network/actions.
export function shellsSummary(inputs = {}) {
  const r = buildShellReport(inputs);

  const surfaces = [
    {
      key: 'gatewayPreview', lean: 'LEAN-2', step: 'TRAVEL',
      sdk: 'gatewayPreview', shell: 'gatewayPreview',
      title: r.gatewayPreview.title,
      invariants: { readOnly: r.gatewayPreview.readOnly, actionable: r.gatewayPreview.actionable },
    },
    {
      key: 'productPreview', lean: 'LEAN-3', step: 'MARKET',
      sdk: 'productPreview', shell: 'productPreview',
      title: r.productPreview.title,
      invariants: { readOnly: r.productPreview.readOnly, actionable: r.productPreview.actionable },
    },
    {
      key: 'leaderboardPreview', lean: 'LEAN-4', step: 'SCORE',
      sdk: 'leaderboardPreview', shell: 'leaderboardPreview',
      title: r.leaderboardPreview.title,
      invariants: {
        readOnly: r.leaderboardPreview.readOnly,
        actionable: r.leaderboardPreview.actionable,
        signed: r.leaderboardPreview.signed,
        published: r.leaderboardPreview.published,
      },
    },
    {
      key: 'updatePreview', lean: 'LEAN-5', step: 'UPDATE',
      sdk: 'updatePreview', shell: 'updatePreview',
      title: r.updatePreview.title,
      invariants: { readOnly: r.updatePreview.readOnly, actionable: r.updatePreview.actionable },
    },
  ];

  const loop = {
    key: 'mvpLoop', sdk: 'mvpLoop', shell: 'mvpLoop',
    title: r.mvpLoop.title,
    flow: r.mvpLoop.flow,
    invariants: { readOnly: r.mvpLoop.readOnly, actionable: r.mvpLoop.actionable },
  };

  // True only if NO surface (or the loop header) is actionable, and nothing claims
  // to be signed/published. This is the single gate a reviewer can assert on.
  const allInert =
    loop.invariants.actionable === false &&
    surfaces.every((s) =>
      s.invariants.actionable === false &&
      s.invariants.signed !== true &&
      s.invariants.published !== true);

  return {
    version: r.mvpLoop.version,
    flow: r.mvpLoop.flow,
    loop,
    surfaces,
    count: surfaces.length,
    allInert,
    // Safety flags that are false BY CONSTRUCTION across every proof surface —
    // these modules never fetch, navigate, sign, publish, or auto-update.
    network: false,
    autoUpdate: false,
  };
}

// The SAFE (inert) value for every invariant/flag the summary tracks. A flip that
// moves an invariant AWAY from its safe value LOOSENS inertness — exactly the kind
// of change a preview→live promotion must make consciously, and the kind a
// reviewer must sign off on. Used by shellsDiff to classify each flip.
const SAFE_VALUE = Object.freeze({
  readOnly: true,
  actionable: false,
  signed: false,
  published: false,
  allInert: true,
  network: false,
  autoUpdate: false,
});

// loosensInert(key, to) → true when setting `key` to `to` moves it to its UNSAFE
// value (e.g. actionable→true, readOnly→false). Untracked keys never loosen. Pure.
function loosensInert(key, to) {
  if (!(key in SAFE_VALUE)) return false;
  return to === !SAFE_VALUE[key];
}

// shellsDiff(a, b) → a pure, JSON-serialisable diff of two shellsSummary outputs
// (a = before/preview, b = after/promoted). It identifies INTENDED invariant flips
// so a preview→live promotion can be reviewed mechanically: which surface changed,
// which invariant flipped, from what to what, and whether that flip loosens the
// inert guarantee. No network/actions/DOM/THREE/Rapier — it only compares the two
// already-computed summaries.
//
//   {
//     changed:     boolean,            // any flip at all
//     safe:        boolean,            // true when NO flip loosens inertness
//     fromVersion, toVersion,          // the two summaries' versions
//     flips:       [{ scope, key, ... from, to, loosens }],
//     loosened:    [...flips where loosens === true],  // the review checklist
//   }
//
// `scope` is 'summary' for top-level safety flags (allInert/network/autoUpdate) or
// 'surface' for a per-surface invariant (key = surface key, invariant = field).
// A surface present in only one side is reported as added/removed.
export function shellsDiff(a = shellsSummary(), b = shellsSummary()) {
  const flips = [];

  // Top-level safety flags.
  for (const key of ['allInert', 'network', 'autoUpdate']) {
    if (a[key] !== b[key]) {
      flips.push({ scope: 'summary', key, from: a[key], to: b[key], loosens: loosensInert(key, b[key]) });
    }
  }

  // Per-surface invariants.
  const aBy = new Map((a.surfaces || []).map((s) => [s.key, s]));
  const bBy = new Map((b.surfaces || []).map((s) => [s.key, s]));
  for (const key of new Set([...aBy.keys(), ...bBy.keys()])) {
    const sa = aBy.get(key);
    const sb = bBy.get(key);
    if (!sa) { flips.push({ scope: 'surface', key, change: 'added', loosens: false }); continue; }
    if (!sb) { flips.push({ scope: 'surface', key, change: 'removed', loosens: false }); continue; }
    const ia = sa.invariants || {};
    const ib = sb.invariants || {};
    for (const inv of new Set([...Object.keys(ia), ...Object.keys(ib)])) {
      if (ia[inv] !== ib[inv]) {
        flips.push({ scope: 'surface', key, invariant: inv, from: ia[inv], to: ib[inv], loosens: loosensInert(inv, ib[inv]) });
      }
    }
  }

  const loosened = flips.filter((f) => f.loosens === true);
  return {
    changed: flips.length > 0,
    safe: loosened.length === 0,
    fromVersion: a.version,
    toVersion: b.version,
    flips,
    loosened,
  };
}
