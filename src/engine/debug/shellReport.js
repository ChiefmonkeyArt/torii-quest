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
import { updatePreviewBlock } from '../update/updatePreview.js';
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
// actionable:false so the no-navigation guarantee is explicit in the report.
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
    release = DEMO_RELEASE,
  } = inputs;
  return {
    gateway: gatewayReport(gateway, gatewayContext, gatewayOpts),
    gatewayPreview: gatewayPreviewReport(gateway, gatewayContext, gatewayOpts),
    product: productReport(product),
    productPreview: productPreviewReport(product),
    leaderboard: leaderboardReport(scores, { mode }),
    leaderboardPreview: leaderboardPreviewReport(scores),
    updatePreview: updatePreviewReport(release),
  };
}
