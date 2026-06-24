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
