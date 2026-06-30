// engine/dashboard/continuumData.js — Torii Continuum project-oversight DASHBOARD
// data + pure renderer (v0.2.171). This is the FIRST slice of a broader project
// oversight surface. It turns the curated state kept in `progress.md` into a small,
// node-safe data model, computes headline totals/percentages, and renders it to a
// self-contained static HTML page string.
//
// Source-of-truth split (preserved, and surfaced on the page itself):
//   - `todo.md`      owns the active TASK queue (task source of truth).
//   - `strategy.md`  owns VISION / decision rules (strategy source of truth).
//   - `progress.md`  is the visual execution DASHBOARD source document — the data
//                    below is curated from it.
//
// Refresh model: the generator (`tools/build-continuum.mjs`) writes BOTH the page
// (`public/continuum.html`) and a packaged data file (`public/continuum-data.json`)
// from this module at build/deploy time, so each deploy — and the page refresh
// after it — shows the latest PACKAGED project state. The page renders fully WITHOUT
// JavaScript; a tiny, optional, same-origin-only refresh script re-reads the packaged
// JSON to update the live totals strip (no external URL, no eval, no timers).
//
// Constrained by construction:
//   - Pure + node-safe: NO THREE/Rapier/DOM/fs/network imports; renders to a STRING.
//   - READ-ONLY oversight: NO live writes, auth, signing, NIP-07, relay publish,
//     payments, or auto-update. Every text value is HTML-escaped; the only link is
//     the project's OWN live URL, shown as plain text (no external redirect). A
//     nostrich could read it from a cold cache and nothing would fire.
//   - Contributors/clankers is a clearly-flagged SEED metric, not live data.
//   - Curated/static data is the FALLBACK; it is isolated in CONTINUUM below. As of
//     v0.2.174 the generator (tools/build-continuum.mjs + tools/continuumParse.mjs)
//     DERIVES the list sections (next-12 / active-now / completed-24h / archive) and a
//     "docs-derived" task-count metric from progress.md + todo.md at build time and
//     passes them to buildContinuumModel(overrides). Anything that fails to parse falls
//     back to the curated values below, so the page never shows an empty/garbled section.

import { runReadHealth } from '../nostr/readHealth.js';
import { buildHandoffControlPanel, buildHandoffControlPanelCard } from '../status/handoffControlPanel.js';
import { buildMvpApprovalGate, buildMvpApprovalGateCard } from '../status/mvpApprovalGate.js';
import { buildPlaytestVerdictCard } from '../status/playtestVerdict.js';

export const CONTINUUM_VERSION = 'v0.2.262-alpha';
export const CONTINUUM_BADGE = 'PROJECT OVERSIGHT · STATIC · READ-ONLY';

// CURRENT_TEST_STATUS (v0.2.200) — the SINGLE curated source of truth for the test-suite
// size, captured from the most recent green `npm run test:release`. BOTH places the page
// shows the count — the "at a glance" Tests metric AND the engineering-health Total tests
// metric — DERIVE from this one object via testCountLabel(), so they can never drift apart
// again (the recurring stale '1180 passing' issue, where HEALTH_LASTKNOWN.totalTests was a
// second hand-maintained copy that fell behind the metrics row). The deterministic test-FILE
// count is still GENERATED from disk at build time (countTestFiles in build-continuum.mjs);
// `files` here is the curated mirror, asserted against the real on-disk count by the unit
// tests so an added/removed test file forces this constant to be bumped. The passing COUNT
// stays a curated capture (running vitest at static-page-build time is out of scope), but it
// now lives in exactly ONE place.
export const CURRENT_TEST_STATUS = Object.freeze({
  passing: 1834,
  files: 108,
  fastProfile: 5,
  foundationProfile: 25,
});

// testCountLabel(status?) — the canonical "<N> passing / <M> files" string both displayed
// surfaces derive from. Pure; safe on a partial/garbled object (falls back to the curated
// status fields). Keeps the count formatting in ONE place.
export function testCountLabel(status = CURRENT_TEST_STATUS) {
  const s = (status && typeof status === 'object') ? status : CURRENT_TEST_STATUS;
  const passing = s.passing != null ? s.passing : CURRENT_TEST_STATUS.passing;
  const files = s.files != null ? s.files : CURRENT_TEST_STATUS.files;
  return `${passing} passing / ${files} files`;
}

// HEALTH_LASTKNOWN (v0.2.175) — the engineering-health values that are NOT cheaply
// derivable at build time without running the gate (full test count, profile timings,
// bundle baseline, last green release). They are captured by hand from the most recent
// green `npm run test:release` and clearly LABELLED "last-known" on the page, so a stale
// number is obvious rather than silently wrong. The deterministic fields (profile file
// counts, parser gaps, version, doc-sync) are GENERATED at build time and override these.
// v0.2.200: totalTests now DERIVES from CURRENT_TEST_STATUS (single source of truth) so it
// can no longer drift behind the "at a glance" Tests metric.
export const HEALTH_LASTKNOWN = Object.freeze({
  totalTests: testCountLabel(),
  timings: 'fast ~1s · foundation ~6s · full suite ~44s',
  bundle: '2.9 MB raw / ~1022 KB gzip (rapier chunk >700 KB, expected)',
  regression: '15 / 15',
  lastGreen: CONTINUUM_VERSION,
});

// buildHealthModel(input) — PURE, browser-safe builder for the Engineering-health
// section (v0.2.175). Takes plain data only (no fs/network/THREE/DOM) so it runs both at
// module load (the curated fallback below) AND at build time (tools/build-continuum.mjs
// passes the freshly GENERATED inputs). Each metric carries a `kind`: 'generated' (derived
// deterministically this build) or 'last-known' (captured from the last green gate run),
// surfaced as a chip on the page so provenance is never ambiguous. Returns { note, metrics,
// rings } — a small, dependency-free model the renderer turns into cards + SVG rings.
export function buildHealthModel(input = {}) {
  const {
    version = CONTINUUM_VERSION,
    profiles = {},
    fullFileCount = null,
    parserGaps = null,
    docsInSync = null,
    lastKnown = HEALTH_LASTKNOWN,
  } = input || {};
  const lk = { ...HEALTH_LASTKNOWN, ...(lastKnown || {}) };
  const fast = profiles.fast != null ? profiles.fast : null;
  const foundation = profiles.foundation != null ? profiles.foundation : null;
  const G = 'generated';
  const L = 'last-known';
  const metrics = [
    { label: 'Build version', kind: G, value: version },
    { label: 'Test files / profiles', kind: G,
      value: `fast ${fast == null ? '—' : fast} · foundation ${foundation == null ? '—' : foundation} · full ${fullFileCount == null ? '—' : fullFileCount}` },
    { label: 'Total tests', kind: L, value: lk.totalTests },
    { label: 'Profile timings', kind: L, value: lk.timings },
    { label: 'Bundle baseline', kind: L, value: lk.bundle },
    { label: 'Parser gaps', kind: G,
      value: parserGaps == null ? '—'
        : parserGaps === 0 ? '0 · dashboard lists fully derived'
        : `${parserGaps} · curated fallback used` },
    { label: 'Release gate', kind: L, value: `${lk.regression} regression checks GREEN · last green ${lk.lastGreen}` },
    { label: 'Source-of-truth docs', kind: G,
      value: docsInSync == null ? 'progress.md · todo.md · strategy.md'
        : docsInSync ? 'progress.md · todo.md · strategy.md carry this version'
        : 'doc/version drift — check the continuity docs' },
  ];
  const coverage = (foundation != null && fullFileCount)
    ? Math.round((foundation / fullFileCount) * 100) : null;
  const rings = [
    { pct: 100, label: 'Tests passing', sub: 'last green' },
    { pct: 100, label: 'Regression checks', sub: lk.regression },
    { pct: coverage, label: 'Foundation coverage',
      sub: (foundation != null && fullFileCount) ? `${foundation}/${fullFileCount} files` : 'profiles' },
  ];
  const note = 'Engineering health — the efficiency/oversight loop: measure · profile · ' +
    'standardise · automate · modularise · document. GENERATED at build time where ' +
    'deterministic (profile sizes, parser gaps, version, doc-sync); LAST-KNOWN where ' +
    'captured from the most recent green release-gate run (total tests, timings, bundle).';
  return { note, metrics, rings };
}

// The curated fallback health model — built from the pure builder at module load with the
// current known counts, so renderContinuumPage() with NO overrides (tests + the no-JS
// fallback) shows a complete, honest Engineering-health section. The build-time generator
// re-runs buildHealthModel with freshly measured inputs and overrides this.
const CURATED_HEALTH = buildHealthModel({
  version: CONTINUUM_VERSION,
  profiles: { fast: 5, foundation: 17 },
  fullFileCount: 60,
  parserGaps: 0,
  docsInSync: true,
});

// SEED_MILESTONES (v0.2.176) — clearly-labelled FUTURE milestones. These are NOT real,
// tracked task sets; they are a seed roadmap so the dashboard can show "total milestones"
// HONESTLY (one real ACTIVE milestone + N SEED/future) without pretending the future ones
// have real task counts. Future parser hook: derive these from strategy.md. Pure data.
export const SEED_MILESTONES = Object.freeze([
  { id: 'M-RELAY', name: 'Live relay I/O + event signing',
    note: 'Gated by SEC-1/2/3 — explicit consent, handoff verification, and URL validation must clear before any wire write or live navigation.' },
  { id: 'M-WORLD', name: 'Open-world NAP-to-NAP federation',
    note: 'Real in-world portals plus a formalised NAP zone registry, beyond the inert travel preview.' },
  { id: 'M-MARKET', name: 'Component / Plebeian market economy',
    note: 'A CMP component marketplace and real Plebeian.Market listings over the read-only product-panel shells.' },
]);

// buildMilestoneModel(input) — PURE, browser-safe (v0.2.176). Folds the 15-hour MVP route
// (the ONE true active milestone — its leanRoute slices ARE its tasks) into task counts +
// a directional % complete, and lists the clearly-labelled SEED future milestones so a
// "total milestones" figure is honest (1 active + N seed). No fs/network/THREE/DOM. Returns
// a small model the renderer turns into a progress card + seed cards. `tasks.done/active/
// pending` are DERIVED from each slice's `state`; `donePct` is done/total; `progressPct` is
// the directional mean of the per-slice `progress` estimates (the same number as the PoC
// ring), labelled as an estimate on the page so it is never mistaken for tasks-done.
export function buildMilestoneModel(input = {}) {
  const {
    leanRoute = CONTINUUM.leanRoute,
    seed = SEED_MILESTONES,
    name = '15-hour proof-of-concept route',
    blurb = 'The one true ACTIVE milestone — the freedom-tech loop: gateway/NAP-to-NAP ' +
      'travel → Plebeian/Nostr product panel → leaderboard → torii.quest update-check.',
  } = input || {};
  const tasks = Array.isArray(leanRoute) ? leanRoute : [];
  const total = tasks.length;
  const done = tasks.filter((t) => t.state === 'done').length;
  const active = tasks.filter((t) => t.state === 'in-progress').length;
  const pending = tasks.filter((t) => t.state === 'pending').length;
  const donePct = total ? Math.round((done / total) * 100) : 0;
  const progressPct = _average(tasks.map((t) => clampPct(t.progress) || 0));
  const activeMilestone = {
    id: 'MVP-15H', kind: 'active', name, blurb,
    tasks: { total, done, active, pending },
    donePct, progressPct,
    // Bullet-ready breakdown (user preference: bullet lists, not comma-separated prose).
    counts: [
      `${total} tasks total`,
      `${done} done`,
      `${active} active`,
      `${pending} pending`,
    ],
  };
  const seedList = (Array.isArray(seed) ? seed : []).map((s) => ({ ...s, kind: 'seed' }));
  return {
    active: activeMilestone,
    seed: seedList,
    counts: { total: 1 + seedList.length, active: 1, seed: seedList.length, done: 0 },
    note: 'One real ACTIVE milestone (its tasks are the 15-hour MVP slices, DERIVED from ' +
      'the route states); the rest are SEED/future milestones — labelled as such, not ' +
      'pretending to carry real task counts yet. Future hook: derive seed milestones from strategy.md.',
  };
}

// READINESS_BADGE (v0.2.186) — names the deployment-readiness section so it can't be
// mistaken for a deploy action. Like the rest of this module, it is read-only oversight.
export const READINESS_BADGE = 'DEPLOY READINESS · STATIC HOST · READ-ONLY';

// buildReadinessModel(input) — PURE, browser-safe builder (v0.2.186) that surfaces the
// torii.quest/VPS static-host DEPLOYMENT READINESS on the dashboard, so project oversight
// shows the VPS/static-host posture at a glance. It folds the plain result of the v0.2.185
// `checkZoneFallbackReadiness({ docs, dist })` guard (passed in as `input.zoneFallback`)
// into a render-ready { badge, status, statusLabel, checks, errors, warnings, note } model.
// NO fs/network/THREE/DOM — the CLI / build-continuum.mjs / regression-check do the fs reads
// and hand the plain verdict here. With no input it degrades to an honest NOT-CHECKED model
// (never throws). Each check's `state` reuses the existing pill vocabulary
// (no-blocker / gated / manual / deferred) so the renderer needs no new CSS. This is an
// INFORMATIONAL surface only: it never deploys, never contacts a server, never auto-updates.
export function buildReadinessModel(input = {}) {
  const zf = input && typeof input === 'object' ? input.zoneFallback : null;
  const has = zf && typeof zf === 'object';
  const docs = has && zf.docs && typeof zf.docs === 'object' ? zf.docs : null;
  const dist = has && zf.dist && typeof zf.dist === 'object' ? zf.dist : null;
  const docsOk = docs ? !!docs.ok : null;
  const distSkipped = dist ? !!dist.skipped : true;
  const distOk = dist ? !!dist.ok : null;
  const overallOk = has ? !!zf.ok : null;

  const checks = [
    {
      item: 'SPA /zone/* fallback documented',
      state: docsOk == null ? 'deferred' : docsOk ? 'no-blocker' : 'gated',
      note: docsOk == null
        ? 'not checked this build — run npm run zones:check'
        : docsOk
          ? 'VPS_INSTALL.md + HANDOFF.md describe serving index.html for /zone/* deep-links'
          : 'a required doc is missing the index.html SPA fallback — run npm run zones:check',
    },
    {
      item: 'Built dist route shape',
      state: distSkipped ? 'deferred' : distOk ? 'no-blocker' : 'gated',
      note: distSkipped
        ? 'no dist/ this build — run npm run build then npm run zones:check'
        : distOk
          ? 'dist/index.html present; no static file under /zone/* shadows the fallback'
          : 'dist route shape cannot rely on the fallback (missing index.html or a /zone/* shadow)',
    },
    {
      item: 'Host SPA fallback configured',
      state: 'manual',
      note: 'serve index.html for unmatched paths on torii.quest — manual maintainer step, outside this repo',
    },
    {
      item: 'Auto-update',
      state: 'manual',
      note: 'none — the update-check is read-only and actionable:false; deploys stay a manual maintainer action',
    },
  ];

  let status; let statusLabel;
  if (overallOk == null) { status = 'unknown'; statusLabel = 'NOT CHECKED'; }
  else if (overallOk && !distSkipped) { status = 'ready'; statusLabel = 'READY'; }
  else if (overallOk && distSkipped) { status = 'docs-ready'; statusLabel = 'DOCS READY · BUILD CHECK PENDING'; }
  else { status = 'blocked'; statusLabel = 'NOT READY'; }

  return {
    badge: READINESS_BADGE,
    status,
    statusLabel,
    checks,
    errors: has && Array.isArray(zf.errors) ? zf.errors.slice() : [],
    warnings: has && Array.isArray(zf.warnings) ? zf.warnings.slice() : [],
    note: 'Static-host deployment readiness for the gateway /zone/* travel feature. The repo-side ' +
      'prerequisites (docs describe the index.html SPA fallback; a built dist/ has index.html with ' +
      'no /zone/* file shadowing it) are verified LOCALLY by npm run zones:check / regression-check [15]. ' +
      'Configuring the real host fallback and deploying stay MANUAL maintainer steps — this surface only INFORMS.',
  };
}

// The curated fallback readiness model — built at module load so renderContinuumPage() with
// NO overrides (tests + the no-JS fallback) shows an honest NOT-CHECKED readiness section.
// The build-time generator re-runs buildReadinessModel with the freshly measured verdict.
const CURATED_READINESS = buildReadinessModel();

// SHIP_BADGE (v0.2.188) — names the ship-readiness section as read-only oversight of the
// LAST local release gate, never a deploy/publish action.
export const SHIP_BADGE = 'SHIP READINESS · LAST GATE · READ-ONLY';

// The read-only, local command whose verdict this section mirrors.
export const SHIP_STATUS_COMMAND = 'npm run release:status';

// SHIP_NEXT_SAFE_TASK (v0.2.188) — the recommended NEXT SAFE task to pick up. Deliberately
// DISTINCT from next12[0] (which is SEC-gated live-relay/runtime work): "safe" here means a
// no-runtime-risk infra/docs/tooling slice that needs no deploy, matching the current
// cadence — so a handoff sees the next move that can ship without unlocking a gate.
// buildShipModel accepts an override. Pure data.
export const SHIP_NEXT_SAFE_TASK = Object.freeze({
  title: 'Continue the read-only oversight loop — next safe infra/dashboard slice',
  why: 'Keep shipping no-runtime-risk tooling/docs that make AI handoff faster and the gate '
    + 'harder to get wrong (e.g. package the release:status verdict as a build artifact, or '
    + 'add a docs-freshness signal). SEC-gated live-relay / world-hop work stays parked behind '
    + 'SEC-1/2/3 and a manual deploy — not a safe pick yet.',
  kind: 'infra',
});

// Map a release-readiness SIGNAL_STATE (ok/blocked/advisory/skipped/unknown) onto the
// dashboard's EXISTING pill vocabulary so the renderer needs no new CSS.
const SHIP_SIGNAL_PILL = Object.freeze({
  ok: 'no-blocker', blocked: 'gated', advisory: 'manual', skipped: 'deferred', unknown: 'deferred',
});

// SHIP_LASTKNOWN (v0.2.188) — the last green `npm run release:status` verdict, captured by
// hand and clearly LABELLED last-known on the page, so a stale snapshot is obvious rather
// than silently wrong. The build-time generator (build-continuum.mjs) overrides this with the
// LIVE verdict folded from tools/releaseReadiness.buildReleaseReadiness at packaging time.
export const SHIP_LASTKNOWN = Object.freeze({
  status: 'ready',
  statusLabel: 'READY',
  version: CONTINUUM_VERSION,
  signals: Object.freeze([
    { key: 'versionSync', label: 'Version sync', state: 'ok', detail: 'config + package.json agree' },
    { key: 'tests', label: 'Test profiles', state: 'ok', detail: 'fast 5 · foundation 25 file(s)' },
    { key: 'regression', label: 'Regression gate', state: 'ok', detail: '15 / 15 checks' },
    { key: 'bundle', label: 'Bundle baseline', state: 'advisory', detail: 'advisory — rapier chunk over limit (tracked)' },
    { key: 'zoneFallback', label: '/zone/* fallback', state: 'ok', detail: 'docs + dist ok' },
    { key: 'docs', label: 'Docs consistency', state: 'ok', detail: 'continuity docs carry current version' },
  ].map((s) => Object.freeze(s))),
});

// _shipSignalRows(signals) — turn a release-readiness summary's `signals` object into an
// ordered, render-ready row list (label + state + pill + one-line detail). Pure; null-safe.
function _shipSignalRows(signals) {
  if (!signals || typeof signals !== 'object') return [];
  const rows = [];
  const push = (key, label, sig, detail) => {
    if (!sig || typeof sig !== 'object' || typeof sig.state !== 'string') return;
    rows.push({ key, label, state: sig.state, pill: SHIP_SIGNAL_PILL[sig.state] || 'deferred', detail: detail || '' });
  };
  const vs = signals.versionSync;
  push('versionSync', 'Version sync', vs, vs && `config ${vs.configVersion ?? '?'} / pkg ${vs.packageVersion ?? '?'}`);
  const t = signals.tests;
  push('tests', 'Test profiles', t, t && `fast ${t.fast} · foundation ${t.foundation} file(s)`);
  const r = signals.regression;
  push('regression', 'Regression gate', r, r && `${r.count ?? '?'} / ${r.expected ?? '?'} checks`);
  const b = signals.bundle;
  push('bundle', 'Bundle baseline', b, b && (Array.isArray(b.overLimit) && b.overLimit.length
    ? `advisory — over limit: ${b.overLimit.join(', ')}` : b.state === 'skipped' ? 'no dist/ — build then bundle:report' : 'within advisory limit'));
  const z = signals.zoneFallback;
  push('zoneFallback', '/zone/* fallback', z, z && (z.ok
    ? (z.distSkipped ? 'docs ok · dist check pending' : 'docs + dist ok')
    : ((Array.isArray(z.errors) && z.errors.join('; ')) || 'not checked')));
  const d = signals.docs;
  push('docs', 'Docs consistency', d, d && (d.ok
    ? 'continuity docs carry current version'
    : ((Array.isArray(d.errors) && d.errors.join('; ')) || 'not checked')));
  return rows;
}

// buildShipModel(input) — PURE, browser-safe builder (v0.2.188). Folds a release-readiness
// summary (the plain output of tools/releaseReadiness.buildReleaseReadiness, supplied by
// build-continuum.mjs at packaging time) into a render-ready model so the dashboard surfaces
// the LAST release-readiness verdict AND the NEXT SAFE task at a glance:
//   { badge, statusCommand, gateCommand, kind, status, statusLabel, ready, version,
//     gitCommit, signals[], blockers[], unknowns[], nextTask, note }.
// `kind` is 'generated' (a live summary was supplied this build) or 'last-known' (the curated
// SHIP_LASTKNOWN fallback). With no summary it degrades to the honest last-known snapshot and
// NEVER throws. NO fs/network/THREE/DOM — it only reuses the existing pill vocabulary (no new
// CSS) and adds NO script (the continuum CSP/script-hash stay intact). INFORMATIONAL only: it
// never runs the gate, deploys, publishes, or contacts a server.
export function buildShipModel(input = {}) {
  const rd = input && typeof input === 'object' ? input.readiness : null;
  const hasLive = rd && typeof rd === 'object' && rd.signals && typeof rd.signals === 'object';
  const src = (input && input.nextTask) || SHIP_NEXT_SAFE_TASK;
  const nextTask = { title: src.title, why: src.why, kind: src.kind || 'infra' };
  const note = 'The last local release-readiness verdict (run: ' + SHIP_STATUS_COMMAND + ') plus the '
    + 'recommended next SAFE task. Read-only oversight — it mirrors the gate, never runs a '
    + 'deploy/publish. GENERATED at packaging time from the live signals; LAST-KNOWN (last green '
    + 'gate) when not regenerated this build. The regression gate stays the authority.';

  if (hasLive) {
    return {
      badge: SHIP_BADGE,
      statusCommand: SHIP_STATUS_COMMAND,
      gateCommand: rd.gateCommand || 'npm run test:release',
      kind: 'generated',
      status: rd.status || 'unknown',
      statusLabel: rd.statusLabel || 'NOT CHECKED',
      ready: !!rd.ready,
      version: rd.version || null,
      gitCommit: rd.gitCommit || null,
      signals: _shipSignalRows(rd.signals),
      blockers: Array.isArray(rd.blockers) ? rd.blockers.slice() : [],
      unknowns: Array.isArray(rd.unknowns) ? rd.unknowns.slice() : [],
      nextTask,
      note,
    };
  }

  const lk = SHIP_LASTKNOWN;
  return {
    badge: SHIP_BADGE,
    statusCommand: SHIP_STATUS_COMMAND,
    gateCommand: 'npm run test:release',
    kind: 'last-known',
    status: lk.status,
    statusLabel: lk.statusLabel,
    ready: lk.status === 'ready',
    version: lk.version,
    gitCommit: null,
    signals: lk.signals.map((s) => ({ key: s.key, label: s.label, state: s.state, pill: SHIP_SIGNAL_PILL[s.state] || 'deferred', detail: s.detail })),
    blockers: [],
    unknowns: [],
    nextTask,
    note,
  };
}

// The curated fallback ship model — built at module load so renderContinuumPage() with NO
// overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN ship-readiness section.
// build-continuum.mjs re-runs buildShipModel with the freshly gathered live verdict.
const CURATED_SHIP = buildShipModel();

// READHEALTH_BADGE (v0.2.194) — the badge shown on the Nostr read-path health panel.
export const READHEALTH_BADGE = 'NOSTR READ-PATH · READ-ONLY';

// buildReadHealthModel(input) — PURE, node-safe builder for the Nostr read-path HEALTH
// panel (v0.2.194). Folds the pure read-only health model (engine/nostr/readHealth.js)
// — which only EXERCISES the already-pure read helpers over deterministic LOCAL sample
// events and reads the consent registry — into a render-ready panel. It performs NO relay
// I/O, NO signing, NO publishing, NO key handling, NO network: it surfaces, as static
// local metadata, that every Nostr path is READ-ONLY at the MVP stage and that the
// live-write tier (NIP-07 signer + relay publish, SEC-1) stays consent-gated + deferred.
// Each signal maps onto the existing pill vocabulary (ok→no-blocker, fail→gated) so the
// renderer needs NO new CSS and NO new script → the CSP/refresh-script hash is untouched.
// Never throws on null/degraded input (runReadHealth is itself inert + safe).
export function buildReadHealthModel(input) {
  const r = runReadHealth(input);
  const signals = r.signals.map((s) => ({
    label: s.label,
    state: s.status,
    detail: s.detail,
    pill: s.status === 'ok' ? 'no-blocker' : 'gated',
  }));
  return {
    badge: READHEALTH_BADGE,
    statusLabel: r.ok ? 'READ-ONLY OK' : 'ATTENTION',
    ok: r.ok,
    signals,
    summary: r.summary,
    signed: r.signed,
    published: r.published,
    readOnly: r.readOnly,
    note: 'Nostr surface is read-only at the MVP stage; the live-write path (NIP-07 signer + relay publish, SEC-1) stays consent-gated and deferred.',
  };
}

// The curated fallback read-health model — built at module load from the deterministic
// LOCAL samples so renderContinuumPage() with NO overrides (tests + the no-JS fallback)
// shows an honest all-green READ-ONLY panel. No relay/network is ever touched.
const CURATED_READHEALTH = buildReadHealthModel();

// RCSTATUS_BADGE (v0.2.214) — names the RC / release-manifest oversight card as a local,
// read-only summary of the release-candidate artifact posture — never a release/tag/publish.
export const RCSTATUS_BADGE = 'RC / RELEASE MANIFEST · LOCAL · READ-ONLY';

// RCSTATUS_LASTKNOWN (v0.2.214) — the curated fallback RC/release-manifest posture, captured by
// hand and clearly LABELLED last-known on the page so a stale snapshot is obvious rather than
// silently wrong. The build-time generator (build-continuum.mjs) overrides this with the LIVE
// artifact presence (the release-manifest REQUIRED/OPTIONAL refs + RC package docs stat-ed on
// disk), the curated test count, the manual-validation-remaining count, and the last release-gate
// verdict — so the card tracks the real on-disk RC posture each deploy.
export const RCSTATUS_LASTKNOWN = Object.freeze({
  version: CONTINUUM_VERSION,
  manifestStatus: 'COMPLETE',
  manifestRequiredPresent: 6,
  manifestRequired: 6,
  manifestOptionalPresent: 6,
  manifestOptional: 6,
  rcDocsPresent: 7,
  rcDocsTotal: 7,
  testLabel: testCountLabel(),
  profileSummary: `fast ~${CURRENT_TEST_STATUS.fastProfile} · foundation ~${CURRENT_TEST_STATUS.foundationProfile} · full`,
  manualValidationRemaining: 7,
  gateStatusLabel: 'READY',
});

// buildRcStatusModel(input) — PURE, browser-safe builder (v0.2.214). Folds the LOCAL
// release-candidate artifact posture into a render-ready card so project oversight sees, at a
// glance: the current version, the release-artifact MANIFEST verdict (required/optional present),
// the RC package-doc coverage, the curated test count + profile summary, how much MANUAL
// (live-browser) validation is still outstanding, the last release-gate verdict, and ONE coarse
// readiness BAND tying them together. Inputs are plain data the generator gathers cheaply
// (file-presence counts + curated constants + the already-gathered ship verdict) — NO fs/network/
// THREE/DOM/child_process here, and it imports NO tools/ module so the browser bundle stays clean.
// With no input it degrades to the honest LAST-KNOWN snapshot and NEVER throws. It reuses the
// existing pill vocabulary + .metric markup (no new CSS) and adds NO script → the continuum
// CSP/refresh-script hash stay intact. INFORMATIONAL only: it releases/tags/publishes/deploys
// NOTHING — manual live-browser validation and explicit user approval stay REQUIRED.
export function buildRcStatusModel(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const lk = RCSTATUS_LASTKNOWN;
  const m = (i.manifest && typeof i.manifest === 'object' && !Array.isArray(i.manifest)) ? i.manifest : null;
  const rd = (i.rcDocs && typeof i.rcDocs === 'object' && !Array.isArray(i.rcDocs)) ? i.rcDocs : null;
  const live = !!(m || rd || i.gateStatusLabel);

  const _int = (x, d) => (Number.isInteger(x) ? x : d);
  const _str = (x, d) => (typeof x === 'string' && x.trim() ? x.trim() : d);

  const version = _str(i.version, lk.version);
  const manifestStatus = m ? _str(m.status, 'INCOMPLETE') : lk.manifestStatus;
  const requiredPresent = m ? _int(m.requiredPresent, 0) : lk.manifestRequiredPresent;
  const required = m ? _int(m.required, lk.manifestRequired) : lk.manifestRequired;
  const optionalPresent = m ? _int(m.optionalPresent, 0) : lk.manifestOptionalPresent;
  const optional = m ? _int(m.optional, lk.manifestOptional) : lk.manifestOptional;
  const rcDocsPresent = rd ? _int(rd.present, 0) : lk.rcDocsPresent;
  const rcDocsTotal = rd ? _int(rd.total, lk.rcDocsTotal) : lk.rcDocsTotal;
  const testLabel = _str(i.testLabel, lk.testLabel);
  const profileSummary = _str(i.profileSummary, lk.profileSummary);
  const manualValidationRemaining = _int(i.manualValidationRemaining, lk.manualValidationRemaining);
  const gateStatusLabel = _str(i.gateStatusLabel, lk.gateStatusLabel);

  // Coarse, honest band — never over-claims a release. Manifest COMPLETE + every RC doc present
  // + the last local gate READY → the artifacts are in place but MANUAL validation + explicit
  // user approval are still pending (the live-browser things local gates can't prove). A missing
  // required artifact or RC doc → ARTIFACTS INCOMPLETE (a future release would be blocked).
  const artifactsComplete = manifestStatus === 'COMPLETE' && rcDocsPresent >= rcDocsTotal;
  const gateReady = /^READY/i.test(gateStatusLabel);
  let band; let bandLabel; let bandPill;
  if (!artifactsComplete) {
    band = 'artifacts-incomplete'; bandLabel = 'ARTIFACTS INCOMPLETE'; bandPill = 'gated';
  } else if (gateReady) {
    band = 'gates-green'; bandLabel = 'LOCAL GATES GREEN · MANUAL VALIDATION + APPROVAL PENDING'; bandPill = 'manual';
  } else {
    band = 'near'; bandLabel = 'NEAR · LOCAL GATES'; bandPill = 'manual';
  }

  const metrics = [
    { label: 'Source version', value: version },
    { label: 'Release manifest', value: `${manifestStatus} · ${requiredPresent}/${required} required present · ${optionalPresent}/${optional} optional present` },
    { label: 'RC package docs', value: `${rcDocsPresent}/${rcDocsTotal} present` },
    { label: 'Tests', value: testLabel },
    { label: 'Test profiles', value: profileSummary },
    { label: 'Manual validation remaining', value: `${manualValidationRemaining} live-browser checks pending` },
    { label: 'Last release gate', value: gateStatusLabel },
  ];

  return {
    badge: RCSTATUS_BADGE,
    kind: live ? 'generated' : 'last-known',
    band,
    statusLabel: bandLabel,
    pill: bandPill,
    version,
    manifestStatus,
    manifestRequiredPresent: requiredPresent,
    manifestRequired: required,
    manifestOptionalPresent: optionalPresent,
    manifestOptional: optional,
    rcDocsPresent,
    rcDocsTotal,
    testLabel,
    profileSummary,
    manualValidationRemaining,
    gateStatusLabel,
    metrics,
    note: 'Release-candidate artifact posture — the release-artifact MANIFEST (required/optional '
      + 'present) and RC package-doc coverage, the curated test count, the manual validation still '
      + 'outstanding, and the last local release-gate verdict, folded into one read-only band. '
      + 'GENERATED at packaging time from on-disk artifact presence; LAST-KNOWN when not regenerated '
      + 'this build. It releases/tags/publishes/deploys NOTHING — manual live-browser validation and '
      + 'explicit user approval stay required (run: npm run rc:snapshot / npm run release:manifest).',
  };
}

// The curated fallback RC-status model — built at module load so renderContinuumPage() with NO
// overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN RC/release-manifest section.
// build-continuum.mjs re-runs buildRcStatusModel with the freshly gathered artifact presence.
const CURATED_RCSTATUS = buildRcStatusModel();

// MANUALVALIDATION_BADGE (v0.2.215) — names the manual-validation / playtest-readiness oversight
// card as a local, read-only summary that the LOCAL automated gates are green but the MANUAL
// (live-browser) MVP playtest + explicit user approval are still pending. It is never a release.
export const MANUALVALIDATION_BADGE = 'MANUAL VALIDATION · MVP PLAYTEST · READ-ONLY';

// MANUALVALIDATION_LASTKNOWN (v0.2.215) — curated fallback playtest-readiness posture, captured by
// hand and clearly LABELLED last-known on the page so a stale snapshot is obvious rather than
// silently wrong. The build-time generator (build-continuum.mjs) overrides this with the LIVE
// playtest-checklist section/item counts + blocker/major/minor severity tallies (from
// tools/playtestChecklist.mjs), the on-disk presence of the checklist + results-template docs, the
// count of highest-level manual live-browser validation areas, and the already-gathered last
// local gate verdict — so the card tracks the real manual-validation backlog each deploy.
export const MANUALVALIDATION_LASTKNOWN = Object.freeze({
  sections: 13,
  items: 17,
  blocker: 4,
  major: 5,
  minor: 8,
  validationAreas: 7,
  checklistDocPresent: true,
  resultsTemplatePresent: true,
  gateStatusLabel: 'READY',
  areas: [
    'Launch / title screen',
    'Shooter loop',
    'Movement / footsteps',
    'Aim / hit feedback / headshots / body shots',
    'Reload feel',
    'Gun / reflection / mirror sanity',
    'Continuum dashboard + release/update prompt + Nostr read + gateway shell',
  ],
});

// buildManualValidationModel(input) — PURE, browser-safe builder (v0.2.215). Folds the LOCAL
// manual-validation / MVP-playtest readiness posture into a render-ready card so project oversight
// sees, at a glance, the one thing the automated gates can NOT prove: that a human still has to run
// the live-browser playtest and explicitly approve. It clearly SEPARATES "local automated gates
// ready" from "user manual test still pending", and lists the highest-level manual validation
// AREAS (counts + a short list) WITHOUT flooding the dashboard with all checklist items. Inputs are
// plain data the generator gathers cheaply (checklist section/item/severity counts + doc-presence
// booleans + the already-gathered last gate verdict) — NO fs/network/THREE/DOM/child_process here,
// and it imports NO tools/ module so the browser bundle stays clean. With no input it degrades to
// the honest LAST-KNOWN snapshot and NEVER throws. It reuses the existing pill vocabulary + .metric
// markup (no new CSS/script) → the continuum CSP/refresh-script hash stay intact. INFORMATIONAL
// only: it releases/tags/publishes/deploys NOTHING — manual playtest + explicit approval REQUIRED.
export function buildManualValidationModel(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const lk = MANUALVALIDATION_LASTKNOWN;
  const live = !!(Number.isInteger(i.sections) || Number.isInteger(i.items) || i.gateStatusLabel
    || typeof i.checklistDocPresent === 'boolean' || typeof i.resultsTemplatePresent === 'boolean');

  const _int = (x, d) => (Number.isInteger(x) && x >= 0 ? x : d);
  const _bool = (x, d) => (typeof x === 'boolean' ? x : d);
  const _str = (x, d) => (typeof x === 'string' && x.trim() ? x.trim() : d);

  const sections = _int(i.sections, lk.sections);
  const items = _int(i.items, lk.items);
  const blocker = _int(i.blocker, lk.blocker);
  const major = _int(i.major, lk.major);
  const minor = _int(i.minor, lk.minor);
  const validationAreas = _int(i.validationAreas, lk.validationAreas);
  const checklistDocPresent = _bool(i.checklistDocPresent, lk.checklistDocPresent);
  const resultsTemplatePresent = _bool(i.resultsTemplatePresent, lk.resultsTemplatePresent);
  const gateStatusLabel = _str(i.gateStatusLabel, lk.gateStatusLabel);
  const areas = (Array.isArray(i.areas) && i.areas.length
    && i.areas.every((a) => typeof a === 'string' && a.trim()))
    ? i.areas.map((a) => a.trim())
    : lk.areas;

  // Coarse, honest band that SEPARATES the automated posture from the manual posture. Both
  // playtest docs present + the last local gate READY → the automated gates are green and the
  // ONLY thing outstanding is the human live-browser playtest + explicit approval. A missing
  // checklist/results-template doc → the manual-validation scaffolding itself is incomplete. Any
  // non-READY gate → manual validation is still outstanding behind a not-yet-green local gate.
  const docsReady = checklistDocPresent && resultsTemplatePresent;
  const gateReady = /^READY/i.test(gateStatusLabel);
  let band; let bandLabel; let bandPill;
  if (!docsReady) {
    band = 'docs-incomplete'; bandLabel = 'PLAYTEST DOCS INCOMPLETE'; bandPill = 'gated';
  } else if (gateReady) {
    band = 'gates-green'; bandLabel = 'LOCAL GATES GREEN · MANUAL PLAYTEST + APPROVAL PENDING'; bandPill = 'manual';
  } else {
    band = 'manual-outstanding'; bandLabel = 'MANUAL VALIDATION OUTSTANDING'; bandPill = 'manual';
  }

  const metrics = [
    { label: 'Local automated gates', value: gateReady ? `${gateStatusLabel} · 15/15 local checks green` : gateStatusLabel },
    { label: 'Manual playtest', value: 'PENDING · live-browser run + explicit user approval required' },
    { label: 'Playtest checklist', value: `${sections} sections · ${items} items` },
    { label: 'Severity coverage', value: `${blocker} blocker · ${major} major · ${minor} minor` },
    { label: 'Playtest docs', value: `checklist ${checklistDocPresent ? 'present' : 'MISSING'} · results template ${resultsTemplatePresent ? 'present' : 'MISSING'}` },
    { label: 'Manual validation areas', value: areas.join(' · ') },
  ];

  return {
    badge: MANUALVALIDATION_BADGE,
    kind: live ? 'generated' : 'last-known',
    band,
    statusLabel: bandLabel,
    pill: bandPill,
    sections,
    items,
    blocker,
    major,
    minor,
    validationAreas,
    checklistDocPresent,
    resultsTemplatePresent,
    gateStatusLabel,
    areas,
    metrics,
    note: 'Manual-validation / MVP-playtest readiness — the one thing the local automated gates can '
      + 'NOT prove. Local checks are green, but a human must still run the live-browser playtest '
      + '(see the highest-level areas above) and explicitly approve before any release. GENERATED at '
      + 'packaging time from the playtest-checklist section/item/severity counts + on-disk doc '
      + 'presence; LAST-KNOWN when not regenerated this build. It releases/tags/publishes/deploys '
      + 'NOTHING (run: npm run playtest:checklist / npm run playtest:results to refresh the docs).',
  };
}

// The curated fallback manual-validation model — built at module load so renderContinuumPage() with
// NO overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN playtest-readiness section.
// build-continuum.mjs re-runs buildManualValidationModel with the freshly gathered checklist counts.
const CURATED_MANUALVALIDATION = buildManualValidationModel();

export const NOBLOCKERQUEUE_BADGE = 'NO-BLOCKER QUEUE · SAFE NEXT WORK · READ-ONLY';

// NOBLOCKERQUEUE_LASTKNOWN (v0.2.216) — curated fallback no-blocker-queue posture, captured by hand
// and clearly LABELLED last-known on the page so a stale snapshot is obvious rather than silently
// wrong. The build-time generator (build-continuum.mjs) overrides this with the LIVE counts derived
// from the SAME parsed todo.md/progress.md taskTotals the dashboard already uses (NO second source of
// truth) plus the recommended next SAFE task and whether manual playtest/approval is still pending —
// so the card tracks the real "what can an agent do next without user input" queue each deploy.
export const NOBLOCKERQUEUE_LASTKNOWN = Object.freeze({
  nextSafeTitle: SHIP_NEXT_SAFE_TASK.title,
  nextSafeWhy: SHIP_NEXT_SAFE_TASK.why,
  nextSafeKind: SHIP_NEXT_SAFE_TASK.kind,
  activeNow: 42,
  nextUp: 12,
  archiveClusters: 11,
  completed24h: 27,
  todoCompletedMarkers: 12,
  manualPending: true,
});

// buildNoBlockerQueueModel(input) — PURE, browser-safe builder (v0.2.216). Folds the LOCAL
// no-blocker-queue posture into a render-ready card so project oversight sees, at a glance, what an
// AI agent can pick up NEXT without any user input vs what is parked waiting on the human. It
// clearly SEPARATES the no-blocker infra/docs/tooling queue (the safe next task + the active/next/
// archive counts an agent can keep working through) from the one user-gated item (the MVP playtest +
// explicit approval). Inputs are plain data the generator gathers cheaply from the SAME parsed
// todo.md/progress.md taskTotals the dashboard already derives (NO second source of truth) plus the
// recommended next SAFE task and a manual-pending flag — NO fs/network/THREE/DOM/child_process here,
// and it imports NO tools/ module so the browser bundle stays clean. With no input it degrades to the
// honest LAST-KNOWN snapshot and NEVER throws. It reuses the existing pill vocabulary + .metric
// markup (no new CSS/script) → the continuum CSP/refresh-script hash stay intact. INFORMATIONAL
// only: it queues/runs/deploys NOTHING — it just makes the safe next move unambiguous.
export function buildNoBlockerQueueModel(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const lk = NOBLOCKERQUEUE_LASTKNOWN;
  const live = !!(Number.isInteger(i.activeNow) || Number.isInteger(i.nextUp)
    || Number.isInteger(i.archiveClusters) || Number.isInteger(i.completed24h)
    || (typeof i.nextSafeTitle === 'string' && i.nextSafeTitle.trim()));

  const _int = (x, d) => (Number.isInteger(x) && x >= 0 ? x : d);
  const _bool = (x, d) => (typeof x === 'boolean' ? x : d);
  const _str = (x, d) => (typeof x === 'string' && x.trim() ? x.trim() : d);

  const nextSafeTitle = _str(i.nextSafeTitle, lk.nextSafeTitle);
  const nextSafeWhy = _str(i.nextSafeWhy, lk.nextSafeWhy);
  const nextSafeKind = _str(i.nextSafeKind, lk.nextSafeKind);
  const activeNow = _int(i.activeNow, lk.activeNow);
  const nextUp = _int(i.nextUp, lk.nextUp);
  const archiveClusters = _int(i.archiveClusters, lk.archiveClusters);
  const completed24h = _int(i.completed24h, lk.completed24h);
  const todoCompletedMarkers = _int(i.todoCompletedMarkers, lk.todoCompletedMarkers);
  const manualPending = _bool(i.manualPending, lk.manualPending);

  // Coarse, honest band. A queued safe task means an agent can keep moving with NO user input — the
  // headline posture. When the only outstanding human gate is the MVP playtest + approval, say so
  // explicitly so the "agent can proceed" and "human must act" postures never blur.
  let band; let bandLabel; const bandPill = 'no-blocker';
  if (manualPending) {
    band = 'safe-available'; bandLabel = 'NO-BLOCKER WORK AVAILABLE · MANUAL PLAYTEST AWAITS USER';
  } else {
    band = 'safe-available-clear'; bandLabel = 'NO-BLOCKER WORK AVAILABLE';
  }

  const metrics = [
    { label: 'Next safe task', value: nextSafeTitle },
    { label: 'Why safe', value: `${nextSafeKind} · no runtime risk · no deploy · no gate to unlock` },
    { label: 'Awaiting user', value: manualPending
      ? 'MVP playtest + explicit approval (manual, live-browser) — the ONLY user-gated item'
      : 'nothing — no manual gate outstanding' },
    { label: 'Active now', value: `${activeNow} in progress` },
    { label: 'Next up', value: `${nextUp} queued · next-12` },
    { label: 'Archive / done', value: `${archiveClusters} landed clusters · ${completed24h} done (24h) · ${todoCompletedMarkers} struck markers` },
  ];

  return {
    badge: NOBLOCKERQUEUE_BADGE,
    kind: live ? 'generated' : 'last-known',
    band,
    statusLabel: bandLabel,
    pill: bandPill,
    nextSafeTitle,
    nextSafeWhy,
    nextSafeKind,
    activeNow,
    nextUp,
    archiveClusters,
    completed24h,
    todoCompletedMarkers,
    manualPending,
    metrics,
    note: 'No-blocker queue — what an AI agent can pick up NEXT without any user input. The next safe '
      + 'task is a no-runtime-risk infra/docs/tooling slice (no deploy, no gate to unlock); the '
      + 'active/next/archive counts are DERIVED from the same parsed todo.md/progress.md the rest of '
      + 'the dashboard uses (no second source of truth). The ONLY thing waiting on a human is the MVP '
      + 'playtest + explicit approval (see the Manual validation card). GENERATED at packaging time; '
      + 'LAST-KNOWN when not regenerated this build. It queues/runs/deploys NOTHING.',
  };
}

// The curated fallback no-blocker-queue model — built at module load so renderContinuumPage() with NO
// overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN no-blocker-queue section.
// build-continuum.mjs re-runs buildNoBlockerQueueModel with the freshly parsed todo/progress counts.
const CURATED_NOBLOCKERQUEUE = buildNoBlockerQueueModel();

// MVPAPPROVAL_BADGE (v0.2.221) — names the MVP-approval-state oversight card. The user MISSED the
// manual-validation card before, so this surfaces the single approval gate (MVP_APPROVAL_STATE.json)
// as its own compact, impossible-to-miss section. READ-ONLY · PENDING until explicit user approval.
export const MVPAPPROVAL_BADGE = 'MVP APPROVAL · LOCAL · READ-ONLY · PENDING UNTIL EXPLICIT USER OK';

// MVPAPPROVAL_LASTKNOWN (v0.2.221) — curated fallback approval posture, captured by hand and clearly
// LABELLED last-known on the page. The build-time generator (build-continuum.mjs) overrides this with
// the LIVE record read from MVP_APPROVAL_STATE.json (re-shaped via tools/mvpApproval.mjs
// summarizeApprovalForState), so the card tracks the real approval state each deploy. Defaults to
// PENDING with no approver — the floor this slice can never silently flip past.
export const MVPAPPROVAL_LASTKNOWN = Object.freeze({
  status: 'pending',
  approved: false,
  version: CONTINUUM_VERSION,
  approvedBy: null,
  approvedAt: null,
});

// buildMvpApprovalModel(input) — PURE, browser-safe builder (v0.2.221). Folds the MVP-approval state
// into a render-ready card so project oversight sees, at a glance, the ONE thing the automated gates
// can NOT prove: that a human ran the live-browser playtest and EXPLICITLY said "MVP approved". Inputs
// are plain data the generator gathers from MVP_APPROVAL_STATE.json (status + approved flag + version +
// approver who/when) — NO fs/network/THREE/DOM/child_process here, and it imports NO tools/ module so
// the browser bundle stays clean. With no input it degrades to the honest LAST-KNOWN pending snapshot
// and NEVER throws. `approved` is treated STRICTLY: only an exact 'approved' status WITH an approved:true
// flag renders as approved, so a partial/garbled record stays PENDING on the page (matching the model's
// isApproved() floor). Reuses the existing pill vocabulary + .metric markup (no new CSS/script) → the
// continuum CSP/refresh-script hash stay intact. INFORMATIONAL only: it approves/releases NOTHING.
export function buildMvpApprovalModel(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const lk = MVPAPPROVAL_LASTKNOWN;
  const live = !!(typeof i.status === 'string' && i.status.trim());

  const _str = (x, d) => (typeof x === 'string' && x.trim() ? x.trim() : d);

  const rawStatus = _str(i.status, lk.status).toLowerCase();
  const status = rawStatus === 'approved' ? 'approved' : (rawStatus === 'pending' ? 'pending' : rawStatus);
  const version = _str(i.version, lk.version);
  const approvedBy = _str(i.approvedBy, lk.approvedBy);
  const approvedAt = _str(i.approvedAt, lk.approvedAt);
  // STRICT: render as approved ONLY when the live record says status 'approved' AND carries the
  // approved:true flag the model's isApproved() gate set — never infer approval from status alone.
  const approved = status === 'approved' && i.approved === true && !!approvedBy && !!approvedAt;

  let band; let bandLabel; let bandPill;
  if (approved) {
    band = 'approved'; bandLabel = 'MVP APPROVED'; bandPill = 'no-blocker';
  } else {
    band = 'pending'; bandLabel = 'MVP APPROVAL PENDING · USER PLAYTEST + EXPLICIT OK REQUIRED'; bandPill = 'manual';
  }

  const metrics = [
    { label: 'Approval status', value: approved ? 'APPROVED' : 'PENDING' },
    { label: 'Version', value: version || '(unset)' },
    { label: 'Approved by', value: approved ? approvedBy : 'no approver yet' },
    { label: 'Approved at', value: approved ? approvedAt : '—' },
    { label: 'Next step', value: approved
      ? 'none — MVP approved'
      : 'User: run the live-browser MVP playtest, then explicitly say "MVP approved"' },
  ];

  return {
    badge: MVPAPPROVAL_BADGE,
    kind: live ? 'generated' : 'last-known',
    band,
    statusLabel: bandLabel,
    pill: bandPill,
    status,
    approved,
    version,
    approvedBy,
    approvedAt,
    metrics,
    note: 'MVP approval state — the single auditable record (MVP_APPROVAL_STATE.json) of whether a '
      + 'human has EXPLICITLY approved the live-browser MVP. Local automated gates are green, but '
      + 'approval is a manual step: the user must run the playtest and say "MVP approved" (which also '
      + 'records approved_by + approved_at). Status stays PENDING until then and can never silently '
      + 'flip — there is no --approve path in the read-only CLI (npm run approval:state). GENERATED at '
      + 'packaging time from the on-disk record; LAST-KNOWN when not regenerated this build. It '
      + 'approves/releases/tags/publishes/deploys NOTHING.',
  };
}

// The curated fallback MVP-approval model — built at module load so renderContinuumPage() with NO
// overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN pending approval section.
// build-continuum.mjs re-runs buildMvpApprovalModel with the freshly read MVP_APPROVAL_STATE.json.
const CURATED_MVPAPPROVAL = buildMvpApprovalModel();

// PLAYTESTRESULTS_BADGE (v0.2.223) — names the MVP-playtest-results-state oversight card. The
// dashboard already shows MVP approval pending and manual-validation pending; this third compact
// card answers the remaining question: have the ACTUAL manual playtest results been recorded yet
// (in MVP_PLAYTEST_RESULTS.md), and what did they say? READ-ONLY · NOT RUN until a tester records ·
// NEVER an approval.
export const PLAYTESTRESULTS_BADGE =
  'MVP PLAYTEST RESULTS · LOCAL · READ-ONLY · NOT RUN UNTIL TESTER RECORDS · NOT AN APPROVAL';

// PLAYTESTRESULTS_LASTKNOWN (v0.2.223) — curated fallback results posture, clearly LABELLED
// last-known on the page. The build-time generator (build-continuum.mjs) overrides this with the
// LIVE state read from MVP_PLAYTEST_RESULTS.md (re-shaped via tools/playtestResultsState.mjs
// summarizePlaytestForState), so the card tracks the real recording state each deploy. Defaults to
// NOT-RUN with no recorded results — the safe floor this card can never silently flip past, and it
// can NEVER imply approval (approvalImplied is pinned false here and in every model branch).
export const PLAYTESTRESULTS_LASTKNOWN = Object.freeze({
  status: 'not-run',
  ran: false,
  total: 0,
  pass: 0,
  fail: 0,
  na: 0,
  blank: 0,
  other: 0,
  fails: Object.freeze([]),
});

// buildPlaytestResultsCardModel(input) — PURE, browser-safe builder (v0.2.223). Folds the
// playtest-results STATE into a render-ready card so oversight sees, at a glance, whether the human
// MVP playtest has actually been RECORDED and what it said — distinct from the MVP-approval card
// (was the build approved?) and the manual-validation card (what must still be checked?). Inputs are
// plain data the generator gathers from MVP_PLAYTEST_RESULTS.md via summarizePlaytestForState
// (status + recorded flag + pass/fail/blank counts + failing item ids) — NO fs/network/THREE/DOM/
// child_process here, and it imports NO tools/ module so the browser bundle stays clean. With no
// input it degrades to the honest LAST-KNOWN not-run snapshot and NEVER throws. CRITICAL: this card
// can NEVER imply approval — `approvalImplied` is pinned false in every branch, and a fully-complete
// (all PASS/N-A) result still renders "NOT AN APPROVAL · explicit user OK required". Reuses the
// existing pill vocabulary + .metric markup (no new CSS/script) → the continuum CSP/refresh-script
// hash stay intact. INFORMATIONAL only: it approves/releases NOTHING.
export function buildPlaytestResultsCardModel(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const lk = PLAYTESTRESULTS_LASTKNOWN;
  const live = !!(typeof i.status === 'string' && i.status.trim());

  const _int = (x, d) => (Number.isInteger(x) && x >= 0 ? x : d);
  const known = new Set(['unknown', 'not-run', 'incomplete', 'attention', 'complete']);
  const rawStatus = (typeof i.status === 'string' && i.status.trim()) ? i.status.trim().toLowerCase() : lk.status;
  const status = known.has(rawStatus) ? rawStatus : 'unknown';

  const total = _int(i.total, lk.total);
  const pass = _int(i.pass, lk.pass);
  const fail = _int(i.fail, lk.fail);
  const na = _int(i.na, lk.na);
  const blank = _int(i.blank, lk.blank);
  const other = _int(i.other, lk.other);
  const fails = Array.isArray(i.fails)
    ? i.fails.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
    : [];
  // `ran` is true once anything is recorded (status past unknown/not-run); never inferred otherwise.
  const ran = (typeof i.ran === 'boolean') ? i.ran : (status !== 'unknown' && status !== 'not-run');
  const complete = status === 'complete';

  let band; let bandLabel; let bandPill; let nextStep;
  switch (status) {
    case 'attention':
      band = 'attention';
      bandLabel = 'PLAYTEST ATTENTION · FAILURE(S) RECORDED';
      bandPill = 'open-edge';
      nextStep = 'Feed the failing items back into todo/progress, fix, then re-test';
      break;
    case 'incomplete':
      band = 'incomplete';
      bandLabel = 'PLAYTEST INCOMPLETE · SOME ITEMS STILL BLANK';
      bandPill = 'manual';
      nextStep = 'Finish recording the remaining blank items in MVP_PLAYTEST_RESULTS.md';
      break;
    case 'complete':
      band = 'complete';
      bandLabel = 'PLAYTEST COMPLETE · ALL PASS / N-A (NOT AN APPROVAL)';
      bandPill = 'no-blocker';
      nextStep = 'Results clean — still requires the explicit user "MVP approved" (separate gate)';
      break;
    case 'not-run':
      band = 'not-run';
      bandLabel = 'PLAYTEST NOT RUN · NO RESULTS RECORDED YET';
      bandPill = 'manual';
      nextStep = 'User: run the live-browser playtest, then record results in MVP_PLAYTEST_RESULTS.md';
      break;
    default:
      band = 'unknown';
      bandLabel = 'PLAYTEST STATE UNKNOWN · NOTHING TO SUMMARISE';
      bandPill = 'manual';
      nextStep = 'User: run the live-browser playtest, then record results in MVP_PLAYTEST_RESULTS.md';
  }

  const itemsValue = total > 0
    ? `${pass} pass · ${fail} fail · ${na} n/a · ${blank} blank / ${total}${other ? ` · ${other} other` : ''}`
    : 'none recorded';

  const metrics = [
    { label: 'Results status', value: status.toUpperCase() },
    { label: 'Recorded', value: ran ? 'yes' : 'no — results file still blank' },
    { label: 'Items', value: itemsValue },
    { label: 'Implies approval', value: 'no — approval is a separate explicit user gate' },
    { label: 'Next step', value: nextStep },
  ];
  if (fails.length) {
    metrics.push({ label: 'Failing items', value: fails.join(' · ') });
  }

  return {
    badge: PLAYTESTRESULTS_BADGE,
    kind: live ? 'generated' : 'last-known',
    band,
    statusLabel: bandLabel,
    pill: bandPill,
    status,
    ran,
    complete,
    // HARD INVARIANT: the recorded playtest result, whatever it says, NEVER implies MVP approval.
    // Approval is a separate explicit user gate (MVP_APPROVAL_STATE.json). Pinned false always.
    approvalImplied: false,
    total,
    counts: { total, pass, fail, na, blank, other },
    fails,
    metrics,
    note: 'MVP playtest results state — read from the source-controlled MVP_PLAYTEST_RESULTS.md, the '
      + 'one place a tester records the actual manual live-browser playtest outcomes. It ships BLANK, '
      + 'so a fresh build reads NOT RUN. A recorded result is NECESSARY but NOT SUFFICIENT for MVP '
      + 'approval: even an all-PASS playtest still needs the explicit user "MVP approved" (the separate '
      + 'MVP-approval gate above). This card can never imply approval — approvalImplied is pinned false. '
      + 'GENERATED at packaging time from the on-disk file; LAST-KNOWN when not regenerated this build. '
      + 'It approves/releases/tags/publishes/deploys NOTHING.',
  };
}

// The curated fallback playtest-results model — built at module load so renderContinuumPage() with
// NO overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN not-run section.
// build-continuum.mjs re-runs buildPlaytestResultsCardModel with the freshly read recording file.
const CURATED_PLAYTESTRESULTS = buildPlaytestResultsCardModel();

// Curated LAST-KNOWN smoke evidence for the handoff control panel's fallback card (v0.2.233).
// These mirror the most recent committed LIVE_SMOKE_STATE.json (app-entry, v0.2.230-alpha PASS
// 3/3) and DASHBOARD_SMOKE_STATE.json (oversight dashboard, v0.2.231-alpha PASS 4/4). The smoke
// version LEGITIMATELY lags the build version — a smoke can only observe a deployed build. The
// build-time generator (build-continuum.mjs) overrides this with the freshly read state.
const HANDOFF_LASTKNOWN_ENTRY_SMOKE = Object.freeze({
  result: 'pass', pass: true, version: 'v0.2.230-alpha', checks: 3, passed: 3, failed: 0,
});
const HANDOFF_LASTKNOWN_DASHBOARD_SMOKE = Object.freeze({
  result: 'pass', pass: true, version: 'v0.2.231-alpha', checks: 4, passed: 4, failed: 0,
});

// CURATED_HANDOFF_PANEL — the curated fallback handoff/release control-panel card, built at module
// load so renderContinuumPage() with NO overrides (tests + the no-JS fallback) shows an honest
// LAST-KNOWN handoff surface. build-continuum.mjs re-builds the panel from the freshly gathered
// smoke states + manual-validation card and passes the card as a `handoffPanel` override.
const CURATED_HANDOFF_PANEL = buildHandoffControlPanelCard(buildHandoffControlPanel({
  version: CONTINUUM_VERSION,
  entrySmoke: HANDOFF_LASTKNOWN_ENTRY_SMOKE,
  dashboardSmoke: HANDOFF_LASTKNOWN_DASHBOARD_SMOKE,
  manualBlocker: { pending: true, statusLabel: 'MVP playtest + approval pending', pill: 'manual' },
  mvpApproval: { approved: false, status: 'pending' },
  nextSafeTask: SHIP_NEXT_SAFE_TASK,
}));

// CURATED_MVP_GATE (v0.2.234) — the curated fallback MVP-approval-gate card, built at module load so
// renderContinuumPage() with NO overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN
// gate. The build-time generator (build-continuum.mjs) re-builds it from the freshly gathered release
// readiness + smoke summaries + the approval record. Defaults to confidence-green / approval-pending:
// the automated signals look healthy, but the explicit human OK is the floor the gate can never flip
// past on its own. APPROVAL-REQUIRES-EXPLICIT-OK lives in the pure mvpApprovalGate.js module.
const CURATED_MVP_GATE = buildMvpApprovalGateCard(buildMvpApprovalGate({
  version: CONTINUUM_VERSION,
  releaseReady: true,
  entrySmokePass: HANDOFF_LASTKNOWN_ENTRY_SMOKE.pass,
  dashboardSmokePass: HANDOFF_LASTKNOWN_DASHBOARD_SMOKE.pass,
  tests: { passing: CURRENT_TEST_STATUS.passing, files: CURRENT_TEST_STATUS.files },
  approval: { approved: false, status: 'pending' },
}));

// CURATED_PLAYTEST_VERDICT (v0.2.235) — the curated fallback MVP-playtest-verdict card, built at
// module load so renderContinuumPage() with NO overrides (tests + the no-JS fallback) shows an
// honest LAST-KNOWN `pending` verdict. The build-time generator (build-continuum.mjs) re-builds it
// from the freshly read MVP_PLAYTEST_VERDICT.md. The shipped capture file is BLANK → pending, and a
// verdict NEVER implies approval — approval stays the separate explicit user gate.
const CURATED_PLAYTEST_VERDICT = buildPlaytestVerdictCard('');

// CONTINUUM_REFRESH_SCRIPT (v0.2.172) — the EXACT inline-script body the page ships,
// kept as the single source of that text so its CSP hash can never silently drift.
// It is STATIC (no model interpolation), so its sha256 is stable across deploys: a
// page refresh re-reads the packaged SAME-ORIGIN JSON to update the totals strip.
// No external URL, no eval, no timers — degrades silently on any failure. The page
// renders fully WITHOUT this script; it is pure progressive enhancement.
export const CONTINUUM_REFRESH_SCRIPT = `
  // Best-effort refresh from the packaged SAME-ORIGIN data file. No external URL,
  // no eval, no timers — silently keeps the server-rendered values on any failure.
  (function(){
    try{
      fetch('./continuum-data.json',{cache:'no-store'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
        if(!d||!d.totals)return;
        var map={tasksAhead:d.totals.tasksAhead,activeTasks:d.totals.activeTasks,completedLast24h:d.totals.completedLast24h,archivedClusters:d.totals.archivedClusters,trackCount:d.totals.trackCount,milestones:(d.totals.milestonesAchieved+' / '+d.totals.milestoneCount)};
        Object.keys(map).forEach(function(k){var el=document.querySelector('[data-k="'+k+'"]');if(el&&map[k]!=null)el.textContent=map[k];});
        var g=document.getElementById('generated-at');if(g&&d.generatedAt)g.textContent=d.generatedAt;
      }).catch(function(){});
    }catch(e){}
  })();
  `;

// CONTINUUM_SCRIPT_SHA256 (v0.2.172) — base64 sha256 of CONTINUUM_REFRESH_SCRIPT, in
// the `'sha256-…'` source-expression form a CSP `script-src` consumes. Hardcoded
// (this module stays crypto-free so it remains node- AND browser-bundle-safe, like
// the hash in index.html); `tests/continuum-dashboard.test.js` recomputes it with
// node:crypto and FAILS the build if the script body and this constant ever diverge.
export const CONTINUUM_SCRIPT_SHA256 = "sha256-otKqhP2RYAA6ZkrRVcAQSBm7B1ssPR70QQR5dXePHmw=";

// CONTINUUM_CSP (v0.2.172) — strict Content-Security-Policy for the generated
// dashboard, resolving the prior "inline script with no CSP" WARN:
//   - script-src 'self' + the script hash → NO 'unsafe-inline' for script (the XSS
//     surface is closed); only the one packaged refresh script may run.
//   - style-src 'self' 'unsafe-inline' → the static <style> block AND the data-driven
//     `style="width:N%"` track-bar attributes keep working. Inline STYLE ATTRIBUTES
//     cannot be element-hashed, and adding any style hash would disable 'unsafe-inline'
//     and break the bars; style injection cannot execute script, so this is the
//     maintainable low-risk choice.
//   - connect-src 'self' → ONLY the same-origin continuum-data.json refresh; no relay,
//     no external API.
//   - default-src 'self'; object-src/base-uri/form-action/frame-ancestors locked down
//     → no plugins, no <base> hijack, no form posting, no framing.
export const CONTINUUM_CSP =
  "default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; " +
  "frame-ancestors 'none'; img-src 'self'; connect-src 'self'; " +
  "style-src 'self' 'unsafe-inline'; " +
  `script-src 'self' '${CONTINUUM_SCRIPT_SHA256}'`;

// Curated snapshot of progress.md (the dashboard source document). Keep this the
// ONLY place the curated copy lives so future automation has a single seam.
export const CONTINUUM = Object.freeze({
  version: CONTINUUM_VERSION,
  title: 'Torii Continuum',
  subtitle: 'Project oversight dashboard',
  liveUrl: 'torii-quest.pplx.app',
  focus: '15-hour proof-of-concept route — shooter is maintenance-only unless ' +
    'demo-breaking; the active MVP is the freedom-tech loop (gateway/NAP-to-NAP ' +
    'preview → Plebeian/Nostr product panel → leaderboard preview → torii.quest ' +
    'update-check). Polish comes after PoC validation.',

  // "At a glance" metrics.
  metrics: [
    { label: 'Source version', value: 'v0.2.262-alpha (build truth; live trails — manual deploy)' },
    { label: 'Tests', value: `${testCountLabel()} (profiles: test:fast ~${CURRENT_TEST_STATUS.fastProfile}, test:foundation ~${CURRENT_TEST_STATUS.foundationProfile})` },
    { label: 'Regression check', value: '15 / 15 GREEN' },
    { label: 'Bundle (advisory)', value: '~2.9 MB raw / ~1022 KB gzip (rapier chunk >700 KB, expected)' },
    { label: 'Gates', value: 'SEC-1 / SEC-2 / SEC-3 intact · godMode false · continuum CSP enforced' },
    { label: 'Smoke (entry + dashboard)', value: 'Both cloud smokes consolidated into the Handoff / release control panel at the top of this page — app-entry v0.2.230-alpha PASS 3/3, oversight-dashboard v0.2.231-alpha PASS 4/4. A smoke pass does not imply MVP approval or a completed human playtest.' },
    { label: 'Active slice', value: 'v0.2.244 HOST-SAFE CANONICAL ZONE ROUTE (game slice) — fixes the v0.2.243 follow-up: the live rendered screenshot of /zone/plebeian-market-bazaar/ STILL showed the JSON 404 ("No static asset at /zone/plebeian-market-bazaar"). ROOT CAUSE: the published exact-path static host (torii-quest.pplx.app) has NO SPA rewrite and NO directory index and normalises BOTH /zone/<slug> AND /zone/<slug>/ to an exact static-asset lookup → 404, so EVERY /zone/* PATH strategy fails (v0.2.242 extensionless → octet-stream download; v0.2.243 directory-index shell → 404). Only the root / reliably serves index.html as text/html. FIX (no backend): the canonical zone route is now the URL FRAGMENT /#/zone/<slug> — the fragment is never sent to the server, so the request path is always / and the root shell ALWAYS renders on hard refresh; the client parser reads the fragment. zoneRouteFor + handoffRouteFor build /#/zone/<slug>; the portal allowlists are /#/zone/; main._applyZoneRoute reads the URL hash fragment (+ a hashchange listener) and falls back to the path for a LEGACY /zone/<slug> link, which the parser still resolves client-side (NON-CANONICAL: a cold /zone/* deep-link 404s before the bundle loads, so it is never generated/shared). No per-slug static shell is generated any more (the build step + tools/zoneShells.mjs + tools/generate-zone-shells.mjs were removed); the dist ships NO /zone/* file. Preserves the v0.2.240 service-worker fail-soft precache (HTML is network-first; the root / is always the cache key), the v0.2.238 fail-closed loop, and the v0.2.236 NIP-07 login decoupling; root entry flow + ENTER ARENA + ESC pause unchanged. Prior — v0.2.243 zone renderable trailing-slash shell (404d live, superseded); v0.2.242 zone exact-path extensionless shell (downloaded as octet-stream, superseded); v0.2.241 zone hard-refresh shell; v0.2.240 travel-gateway entry repair. HARD CONSTRAINTS held: godMode false; no new timers (loop uses rAF only); no new hot-path Vector3/Matrix4; nostrich comments; Chiefmonkey exact; debug tools ship unconditionally; non-religious ethics guard + useful-job invariant intact; no Nostr writes/signing beyond the existing login/read; no deploy/publish/push (parent handles those).' },
  ],

  // Engineering-health model (v0.2.175) — the efficiency/oversight loop surfaced on the
  // page as cards + rings. Curated fallback; the build-time generator overrides the
  // GENERATED fields (profile counts, parser gaps, version, doc-sync) with measured values.
  health: CURATED_HEALTH,

  // Contributors / clankers — SEED placeholder, NOT live data. "clankers" are the
  // AI coding agents (Claude / GPT / DeepSeek) the handoff loop is built around.
  contributors: { isSeed: true, humans: 1, clankers: 3, note: 'Seed placeholder — not live Nostr/contributor data.' },

  // Track Overview — percent is directional, not archaeology.
  tracks: [
    { name: 'Foundation / ARS', percent: 71, done: '5 / 7', status: 'ARS-4 (FSM fold) + ARS-6 (CODE_INDEX upkeep) open' },
    { name: 'Combat / Game-feel', percent: 100, done: '30 / 30', status: '1 open edge (travel-time lead on moving targets)' },
    { name: 'Rapier / Physics', percent: 100, done: '5 / ~5 seams', status: 'ARS-3 raycast migration complete' },
    { name: 'SDK / API', percent: 86, done: '18 / ~21', status: 'player boundary lift + BotAgent runtime remain' },
    { name: 'Nostr / Open-world', percent: 15, done: '0 / 5+', status: 'read-paths + consent gate + travel chain + read-path health model proven; relays/signing deferred' },
    { name: 'Deployment / VPS', percent: null, done: '—', status: 'source clean; live behind (manual deploy)' },
  ],

  // 15-Hour Proof-of-Concept Route (MVP loop). `state` drives milestone counts;
  // `progress` is a directional estimate used only for the aggregate PoC ring.
  leanRoute: [
    { id: 'LEAN-1', state: 'pending', progress: 20, slice: 'Torii.quest live (publish green source)', status: 'pending (manual smoke first)' },
    { id: 'LEAN-2', state: 'in-progress', progress: 72, slice: 'Gateway / NAP-to-NAP travel', status: 'in-world PORTAL TRIGGER (181) + pure SPA /zone/<slug> ROUTE PARSER (182): proximity arms the injected boundary + prompt (inert), an explicit KeyF interact performs the confirmed same-origin hop, and the resulting /zone/ URL has a safe client-side read (home/zone/invalid → inert HUD notice). The static-host SPA fallback for hard-refresh deep links is now docs-explicit + locally checkable (v0.2.185 zones:check / regression [15]) and pinned end-to-end by the v0.2.197 host-route smoke (unknown /zone/<slug> → index.html, no built file shadows the fallback, slug kept safe); still needs a dedicated portal MESH and the host fallback configured on torii.quest itself' },
    { id: 'LEAN-3', state: 'in-progress', progress: 45, slice: 'Plebeian/Nostr product panel', status: 'shells + visible preview; needs in-world mesh + real listing' },
    { id: 'LEAN-4', state: 'in-progress', progress: 40, slice: 'Leaderboard (Nostr signed events)', status: 'unsigned helpers + publisher adapter + view + relay-read proof; needs real signer (SEC-1) + relay read' },
    { id: 'LEAN-5', state: 'in-progress', progress: 57, slice: 'torii.quest GitHub update-check', status: 'helper + view-model + release source/status + static release-metadata template/spec (v0.2.192, npm run release:meta) + local install dry-run checklist (v0.2.193, npm run vps:dry-run) + update-flow smoke harness pinning the read-only/no-auto-update/confirmation-gated contracts (v0.2.196, ToriiDebug.shells.updateFlowSmoke); needs read-only releases fetch + prompt mesh' },
  ],

  // Now / Next / Later.
  activeNow: [
    'v0.2.207 — GITHUB MVP RELEASE DRY-RUN (docs/tooling only, no runtime change): a local, read-only dry-run (tools/githubReleaseDryRun.mjs + CLI tools/github-release-dry-run.mjs, npm run release:dry-run) that validates the prerequisites for a FUTURE GitHub MVP-proof release WITHOUT creating one. It folds version stamped + synced, clean working tree, HEAD pushed, release-notes draft present, release-package index present, the tests/RC gate green, a public live URL, and non-actionable (no autoUpdate) release metadata into one READY/NEAR/BLOCKED verdict with the missing list and the suggested FUTURE manual commands (git tag / git push / gh release) as INERT TEXT — each carrying an explicit do-not-run-without-user-approval note — plus the standing manual-approval gate. The CLI reads local files + runs read-only git (rev-parse/status) only and emits text / --json / --markdown, plus an opt-in bounded in-repo --write (default GITHUB_RELEASE_DRY_RUN.md, confined via the shared resolveHandoffWritePath boundary). DRY-RUN ONLY: no git tag, no GitHub release, no push, no announcement, no network, no deploy, no publish. +16 unit tests. NON-GOALS held: read-only except the explicit --write output; no gameplay/physics/shooter/Rapier change; no Nostr signing/publishing/live network write; godMode stays false.',
    'v0.2.206 — MVP RELEASE PACKAGE INDEX (docs/tooling only, no runtime change): a single discoverability INDEX for the MVP proof-of-concept candidate (tools/releasePackage.mjs + CLI tools/release-package.mjs, npm run release:package) so humans and future agents can find every relevant file fast. The curated, frozen index points at the release notes draft, playtest checklist + results template, generated + hand-maintained handoff briefs, the progress/todo source-of-truth docs, and the update/VPS/zone-fallback readiness notes — grouped by category — and folds in the current version/commit, the curated test-count, the live URL, the known non-blocking advisories, and the recommended next safe action. The CLI stat-s each indexed file for a present/missing flag and emits text / --json / --markdown, plus an opt-in bounded in-repo --write (default MVP_RELEASE_PACKAGE.md, confined via the shared resolveHandoffWritePath boundary). INDEX ONLY: no GitHub release, no git tag, no announcement, no network, no deploy, no publish. +12 unit tests. NON-GOALS held: read-only except the explicit --write output; no gameplay/physics/shooter/Rapier change; no Nostr signing/publishing/live network write; godMode stays false.',
    'ARS-4 — finish folding reload/pointer-lock into the guarded FSM.',
  ],

  next12: [
    'Drive gatewayActivation (v0.2.178) from a real host router: inject the app/browser window or host transport at the gateway boundary + a same-origin route allowlist wired to CSP, so a confirmed in-world hop performs the live same-origin navigation.',
    'Gateway portal mesh — actually move the player in-world on a confirmed hop (front-end trigger for the live-wired activation seam).',
    'SEC-2 handoff verification gate — cryptographic checks before acting on live relay travel intents.',
    'Real leaderboard signer/publisher + relay read (SEC-1 explicit NIP-07 consent first).',
    'In-world product panel mesh over productPanelShell + a real Plebeian.Market listing.',
    'SEC-3 product URL validation — URL-object parsing (scheme+host), not regex-only.',
    'Read-only GitHub releases fetch (CSP-scoped) + in-world update-prompt mesh.',
    'LEAN-1 / TQ-MANUAL-113 — manual smoke on real hardware, then publish source-built artifact.',
    'ARS-4 FSM fold close-out.',
    'Player boundary full extraction (movement tick, combat, lifecycle, body-state behind the seam).',
    'BotAgent runtime migration — wire decideActions, migrate stateful tick/shoot/blowback.',
    'Formalise NAP zone registry for the gateway/NAP-to-NAP travel preview.',
  ],

  risks: [
    { item: 'Foundation / docs / tooling slices', state: 'no-blocker', note: 'Pure node-safe, no deploy needed — the current cadence.' },
    { item: 'Gateway-travel chain (read→execute)', state: 'no-blocker', note: 'All PURE & INERT; never navigates/signs/publishes/writes network.' },
    { item: 'Live relay I/O · signing · world hop', state: 'gated', note: 'SEC-1/2/3 must clear before any wire write or live navigation.' },
    { item: 'Live deployment', state: 'manual', note: 'Trails source; needs maintainer smoke + publish (LEAN-1).' },
    { item: 'Travel-time lead on fast targets', state: 'open-edge', note: 'Hitscan-aimed but projectile-flown; long shots on strafing bots can trail.' },
    { item: 'ESBUILD-1 dev-server advisory', state: 'deferred', note: 'npm audit fix pulls a risky rolldown/vite chain; tracked WARN.' },
  ],

  // Completed last 24h — shown struck through, newest first.
  completed24h: [
    'v0.2.206 — MVP RELEASE PACKAGE INDEX (docs/tooling only, no runtime change): a single discoverability INDEX for the MVP proof-of-concept candidate (tools/releasePackage.mjs + CLI tools/release-package.mjs, npm run release:package) so humans and future agents can find every relevant file fast. The curated, frozen index points at the release notes draft, playtest checklist + results template, handoff briefs, the progress/todo source-of-truth docs, and the update/VPS/zone-fallback readiness notes — grouped by category — and folds in the current version/commit, the curated test-count, the live URL, the known non-blocking advisories, and the recommended next safe action. The CLI stat-s each indexed file for a present/missing flag and emits text / --json / --markdown, plus an opt-in bounded in-repo --write (default MVP_RELEASE_PACKAGE.md, confined via the shared resolveHandoffWritePath boundary). INDEX ONLY: no GitHub release, no git tag, no announcement, no network, no deploy, no publish. +12 unit tests. NON-GOALS held: read-only except the explicit --write output; no gameplay/physics/shooter/Rapier change; no Nostr signing/publishing/live network write; godMode stays false.',
    'v0.2.205 — PLAYTEST CHECKLIST DOC WARNING CLEANUP (docs-only, no runtime change): cleared the non-blocking WARN from the v0.2.204 security review where two illustrative v0.2.203-alpha example strings (plus a historical authorship stamp) lingered in tools/playtestChecklist.mjs comments/examples. The LAUNCH-1 expected-result version-label example and the buildPlaytestChecklistModel version-input comment are now version-neutral (a vX.Y.Z-alpha marker) so future security reviews no longer re-flag stale examples, and the file header drops its dated (v0.2.203) authorship stamp. No behavior change and no new test file. NON-GOALS held: docs/comment cleanup only; no gameplay/physics/shooter/Rapier change; no Nostr signing/publishing/live network write; godMode stays false.',
    'v0.2.204 — MVP MANUAL PLAYTEST RESULTS INTAKE TEMPLATE (docs/tooling only, no runtime change): a pure/local way to RECORD manual playtest results from the v0.2.203 checklist and feed failures back into todo/progress/handoff without ambiguity (tools/playtestResults.mjs + CLI tools/playtest-results.mjs, npm run playtest:results). The blank results template DERIVES its 17 items / 13 sections from PLAYTEST_CHECKLIST_SECTIONS so it stays in lock-step with the checklist as single source of truth, carrying build/version, commit, live URL, tester, date, environment + overall fields plus per-item PASS/FAIL/N/A, severity, repro notes, screenshot/video refs, and recommended next action. A tolerant pure parser/summary folds a completed results markdown into counts (pass/fail/na/blank/other) + failing ids + an EMPTY/INCOMPLETE/ATTENTION/COMPLETE verdict, tolerating blanks. Emits text / --json / --markdown, plus an opt-in bounded in-repo --write (default MVP_PLAYTEST_RESULTS_TEMPLATE.md, confined via the shared resolveHandoffWritePath boundary) and a read-only --summarize. RESULTS INTAKE ONLY: no browser automation, no network, no deploy/publish. +16 unit tests. NON-GOALS held: read-only except the explicit --write output; no gameplay/physics/shooter/Rapier change; no Nostr signing/publishing/live network write; godMode stays false.',
    'v0.2.203 — MVP MANUAL PLAYTEST CHECKLIST (docs/tooling only, no runtime change): a pure/local manual QA acceptance checklist (tools/playtestChecklist.mjs + CLI tools/playtest-checklist.mjs, npm run playtest:checklist) a human — or a future AI handoff — runs by hand against the LIVE build. 17 curated items across 13 areas (launch/title, shooter loop, movement/footsteps, aim + hit-feedback + headshots/body-shots, reload feel, gun/reflection, mirror, crates/physics-nudge, NAP monkey, Continuum dashboard, release-metadata/update-prompt, Nostr read surfaces, gateway portal/travel-confirm shell) — each carrying reproduction steps, an expected result, a severity (blocker/major/minor), an "if it fails" action, and Result/Notes fields to fill in. Emits text / --json / --markdown, plus an opt-in bounded in-repo --write (default MVP_PLAYTEST_CHECKLIST.md, confined via the shared resolveHandoffWritePath boundary). MANUAL CHECKLIST ONLY: no browser automation, no network, no deploy/publish. +15 unit tests. NON-GOALS held: read-only; no gameplay/physics/shooter/Rapier change; no Nostr signing/publishing/live network write; godMode stays false.',
  ],

  // Archive clusters, newest first.
  archive: [
    'v0.2.164–167 — gateway travel chain foundation: relay-read proof → travel confirm/intent → consent UX view-model → dry-run handoff plan (all PURE & INERT).',
    'v0.2.159–163 — read-only Nostr foundation: relay-read + leaderboard/profile reads + consent-gate foundation + leaderboard submit intent.',
    'v0.2.147–158 — proof-surface pipeline + update-check source/panel: spec layer → cross-check → anchor→transform contract → first in-world mesh pass → promotion/regression gate; GitHub release-check source + update-status panel.',
    'v0.2.138–146 — MVP loop made visible + docs symmetry: pivot to the 15-hour PoC route; four inert title-screen preview cards; self-hosting guide + debug index + diff checklist.',
    'v0.2.134–137 — lean-MVP foundation: Gateway Protocol draft + travelIntent; product display; leaderboard helpers; registry; view shells; hardening + shellReport.',
    'v0.2.120–133 — SDK + components + test harness: Vitest; event bus + FSM slices; ToriiDebug; pure physics/raycast/combat seams; SDK entrypoint + stability tiers; component contract; first reference component; real GAMEOVER edge.',
    'v0.2.100–119 — reconciliation & game-feel + decoupling: source reconciled by concern; physics SDK seams; regression batches; CSP + avatar-URL hardening; globals moved onto the event bus / module registries.',
  ],

  sourceOfTruth: [
    'todo.md remains the active TASK queue (task source of truth).',
    'strategy.md remains VISION / decision rules (strategy source of truth).',
    'progress.md remains the visual execution DASHBOARD source document — this page is curated from it.',
  ],
});

// ---- pure helpers ---------------------------------------------------------

// escapeHtml(s) — minimal, safe HTML-text escaping so curated strings can never
// inject markup/script into the rendered page. Pure, never throws.
export function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// clampPct(n) — integer 0..100, or null for null/NaN (so an "n/a" track shows).
export function clampPct(n) {
  if (n == null || Number.isNaN(Number(n))) return null;
  const v = Math.round(Number(n));
  return v < 0 ? 0 : v > 100 ? 100 : v;
}

// barCells(percent, width=20) — directional bar split into filled/empty cell counts.
// `percent` null → all-empty (used for the n/a Deployment track). Clamped. Pure.
export function barCells(percent, width = 20) {
  const w = Math.max(1, Math.floor(width));
  const p = clampPct(percent);
  if (p == null) return { filled: 0, empty: w, percent: null };
  const filled = Math.round((p / 100) * w);
  return { filled, empty: w - filled, percent: p };
}

// ringDash(pct, circumference) — stroke-dasharray for an SVG progress ring:
// `${filled} ${rest}`. Pure geometry, no DOM.
export function ringDash(pct, circumference) {
  const p = clampPct(pct) || 0;
  const filled = (circumference * p) / 100;
  return { filled, rest: circumference - filled };
}

function _average(nums) {
  const valid = nums.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  if (!valid.length) return 0;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

// computeTotals(data) — headline counts + percentages derived from the curated
// data. Pure. milestonesAchievedPct counts only state==='done' (honest, can be 0);
// pocProgressPct is the directional mean of milestone progress; buildProgressPct
// is the mean of the numeric (non-null) track percents.
export function computeTotals(data = CONTINUUM) {
  const lean = data.leanRoute || [];
  const tracks = data.tracks || [];
  const milestoneCount = lean.length;
  const milestonesAchieved = lean.filter((l) => l.state === 'done').length;
  const milestonesInProgress = lean.filter((l) => l.state === 'in-progress').length;
  return {
    tasksAhead: (data.next12 || []).length,
    activeTasks: (data.activeNow || []).length,
    completedLast24h: (data.completed24h || []).length,
    archivedClusters: (data.archive || []).length,
    trackCount: tracks.length,
    milestoneCount,
    milestonesAchieved,
    milestonesInProgress,
    milestonesAchievedPct: milestoneCount ? Math.round((milestonesAchieved / milestoneCount) * 100) : 0,
    pocProgressPct: _average(lean.map((l) => clampPct(l.progress) || 0)),
    buildProgressPct: _average(tracks.map((t) => clampPct(t.percent)).filter((v) => v != null)),
  };
}

// CLICKTHROUGH_BADGE (C2) — names the thin read-only MVP-loop click-through mockup
// section. The freedom-tech loop (Gateway to Product to Leaderboard to Update to Console) is
// demonstrated as a static, READ-ONLY walkthrough of mockup screens — NOT live surfaces.
// No navigation, no actions, no live data, no network: every view is a proof/mockup card.
// Live promotion of any view is gated behind SEC-1/2/3 + manual deploy, so this card stays
// MOCKUP until a view is explicitly promoted. Reuses .ms/.metric/.pill markup so no new
// script, no new data-k key, and the CSP/refresh-script hash stay intact. Pure; node-safe.
export const CLICKTHROUGH_BADGE = 'MVP LOOP · CLICK-THROUGH MOCKUP · READ-ONLY · PROOF ONLY';

// CLICKTHROUGH_VIEWS (C2) — the five MVP-loop mockup screens, in walk-through order. Each is a
// frozen plain-data view: id, title, the proof it demonstrates, its mock state, and an honest
// status (proof | mockup). Curated from progress.md / quest-todo.md; frozen so a caller cannot
// mutate the shared model. PURE data — no fs/network/THREE/DOM.
export const CLICKTHROUGH_VIEWS = Object.freeze([
  Object.freeze({
    id: 'gateway',
    title: 'Gateway',
    proofs: 'NAP-to-NAP travel handoff: read, confirm, consent, plan, execute chain (inert, same-origin).',
    mockState: 'Confirmed hop over an injected window/host (v0.2.178) — needs a real same-origin host router + portal mesh to ACT in 3D.',
    status: 'proof',
  }),
  Object.freeze({
    id: 'product',
    title: 'Product',
    proofs: 'Read-only Plebeian/Nostr listing preview: title, price (sats), seller npub, and Plebeian.Market link as TEXT.',
    mockState: 'Shells + visible title-screen preview; needs an in-world mesh + a real listing (no checkout/pay/zap).',
    status: 'proof',
  }),
  Object.freeze({
    id: 'leaderboard',
    title: 'Leaderboard',
    proofs: 'Unsigned score-event helpers + publisher adapter + read-only view + relay-read proof (kind 30000).',
    mockState: 'Needs a real NIP-07 signer (SEC-1 explicit consent first) + relay read. No signing/publishing wired.',
    status: 'proof',
  }),
  Object.freeze({
    id: 'update',
    title: 'Update',
    proofs: 'GitHub update-check helper + view-model + release source/status; read-only, actionable:false, no auto-update.',
    mockState: 'Needs a read-only releases fetch (CSP-scoped) + in-world update-prompt mesh.',
    status: 'proof',
  }),
  Object.freeze({
    id: 'console',
    title: 'Console',
    proofs: 'Read-only oversight continuation of the dashboard surface — no admin actions, no live writes.',
    mockState: 'Mockup only — thin read-only console view; admin actions stay explicitly gated and out of scope.',
    status: 'mockup',
  }),
]);

// buildClickThroughModel(input?) — PURE, browser-safe builder for the click-through mockup
// section (C2). Takes plain data only (an optional `views` array of {id,title,proofs,mockState,status}
// overrides and an optional `note`); with no input it degrades to an honest LAST-KNOWN curated
// mockup built from CLICKTHROUGH_VIEWS (never throws). `kind` is 'generated' when a caller
// supplies view overrides, else 'last-known'. The section is READ-ONLY by construction: it
// carries no URL, no action, no live data; every view pins performed/signed/published/network =
// false (documented invariants, not runtime flags). Pill is 'deferred' because live promotion
// of every view is deferred behind SEC-1/2/3 + manual deploy. Pure; safe on garbled input.
export function buildClickThroughModel(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const baseViews = Array.isArray(CLICKTHROUGH_VIEWS) ? CLICKTHROUGH_VIEWS : [];
  const overrideViews = Array.isArray(i.views) ? i.views : null;
  const live = !!overrideViews;

  const views = (overrideViews || baseViews)
    .filter((v) => v && typeof v === 'object')
    .slice(0, 12)
    .map((v) => ({
      id: typeof v.id === 'string' && v.id.trim() ? v.id.trim() : 'unknown',
      title: typeof v.title === 'string' && v.title.trim() ? v.title.trim() : 'Unknown',
      proofs: typeof v.proofs === 'string' ? v.proofs : '',
      mockState: typeof v.mockState === 'string' ? v.mockState : '',
      status: v.status === 'proof' ? 'proof' : 'mockup',
    }));

  const note = (typeof i.note === 'string' && i.note.trim())
    ? i.note.trim()
    : 'A thin, read-only click-through mockup of the MVP freedom-tech loop (Gateway to Product to '
      + 'Leaderboard to Update to Console). Every screen is a PROOF/MOCKUP card — no navigation, no '
      + 'live data, no actions, no network. Live promotion of any view is gated behind SEC-1/2/3 '
      + 'and a manual deploy, so this section stays MOCKUP until a view is explicitly promoted. '
      + 'GENERATED at packaging time from the curated view set; LAST-KNOWN when not regenerated.';

  const proofCount = views.filter((v) => v.status === 'proof').length;
  const mockupCount = views.filter((v) => v.status === 'mockup').length;

  const metrics = [
    { label: 'Screens', value: `${views.length} mockup views` },
    { label: 'Proof state', value: `${proofCount} proof · ${mockupCount} mockup` },
    { label: 'Live data', value: 'none — read-only mockup, no live surfaces' },
    { label: 'Actions', value: 'none — no navigation, no writes, no signing' },
    { label: 'Promotion gate', value: 'SEC-1 / SEC-2 / SEC-3 + manual deploy (deferred)' },
    { label: 'Next step', value: 'Promote a view to live only behind its SEC gate + explicit approval' },
  ];

  return {
    badge: CLICKTHROUGH_BADGE,
    kind: live ? 'generated' : 'last-known',
    statusLabel: 'MOCKUP · READ-ONLY · PROOF ONLY',
    pill: 'deferred',
    views,
    metrics,
    note,
    // Pinned invariants — this is a mockup; it never acts.
    performed: false,
    signed: false,
    published: false,
    network: false,
  };
}

// The curated fallback click-through model — built at module load so renderContinuumPage() with
// NO overrides (tests + the no-JS fallback) shows an honest LAST-KNOWN mockup section.
const CURATED_CLICKTHROUGH = buildClickThroughModel();

// buildContinuumModel(overrides) — curated data MERGED with optional build-time overrides
// (v0.2.174), plus per-track bar cells + computed totals. Pure (no mutation of CONTINUUM);
// the single entry point the renderer + tests use. `overrides` may carry derived list
// sections (next12/activeNow/completed24h/archive) that REPLACE the curated arrays, plus
// two meta fields pulled out before the merge: `taskTotals` (the docs-derived metric) and
// `derived` (parser provenance). With NO overrides it returns exactly the curated model,
// so the existing tests + the no-JS fallback are unchanged.
export function buildContinuumModel(overrides = {}) {
  const { taskTotals = null, derived = null, ...dataOverrides } = overrides || {};
  const base = { ...CONTINUUM, ...dataOverrides };
  return {
    ...base,
    badge: CONTINUUM_BADGE,
    generatedAt: base.generatedAt || null,
    tracks: (base.tracks || []).map((t) => ({ ...t, bar: barCells(t.percent) })),
    totals: computeTotals(base),
    milestones: base.milestones || buildMilestoneModel({ leanRoute: base.leanRoute }),
    readiness: base.readiness || CURATED_READINESS,
    ship: base.ship || CURATED_SHIP,
    rcStatus: base.rcStatus || CURATED_RCSTATUS,
    manualValidation: base.manualValidation || CURATED_MANUALVALIDATION,
    noBlockerQueue: base.noBlockerQueue || CURATED_NOBLOCKERQUEUE,
    mvpApproval: base.mvpApproval || CURATED_MVPAPPROVAL,
    mvpGate: base.mvpGate || CURATED_MVP_GATE,
    playtestResults: base.playtestResults || CURATED_PLAYTESTRESULTS,
    playtestVerdict: base.playtestVerdict || CURATED_PLAYTEST_VERDICT,
    handoffPanel: base.handoffPanel || CURATED_HANDOFF_PANEL,
    readHealth: base.readHealth || CURATED_READHEALTH,
    clickThrough: base.clickThrough || CURATED_CLICKTHROUGH,
    taskTotals,
    derived,
  };
}

// continuumDataJSON(model) — the packaged, JSON-serialisable snapshot the generator
// writes to public/continuum-data.json. Pure; safe to JSON.stringify.
export function continuumDataJSON(model = buildContinuumModel()) {
  return {
    version: model.version,
    generatedAt: model.generatedAt || null,
    badge: model.badge,
    totals: model.totals,
    contributors: model.contributors || null,
    taskTotals: model.taskTotals || null,
    derived: model.derived || null,
    health: model.health || null,
    milestones: model.milestones || null,
    readiness: model.readiness || null,
    ship: model.ship || null,
    rcStatus: model.rcStatus || null,
    manualValidation: model.manualValidation || null,
    noBlockerQueue: model.noBlockerQueue || null,
    mvpApproval: model.mvpApproval || null,
    mvpGate: model.mvpGate || null,
    playtestResults: model.playtestResults || null,
    playtestVerdict: model.playtestVerdict || null,
    handoffPanel: model.handoffPanel || null,
    readHealth: model.readHealth || null,
    clickThrough: model.clickThrough || null,
  };
}

// ---- HTML render fragments -------------------------------------------------

const _li = (items) => items.map((x) => `        <li>${escapeHtml(x)}</li>`).join('\n');

// _cardValueHtml(value) — render a metric/health card value (v0.2.176). User preference:
// grouped data should be a BULLET LIST, not one dense comma/dot-separated line. A value
// joined with ' · ' of 2+ parts becomes a compact <ul class="mini"> bullet list; a single
// part stays a plain value span. Each part is HTML-escaped; the <ul>/<li>/<span> markup is
// our own static markup. No new script; the CSP/refresh-script hash is untouched. Pure.
// _h2(title, count) — a section heading row (v0.2.177): the heading plus an optional
// item-count chip so each section is scannable at a glance. Server-rendered + escaped.
function _h2(title, count) {
  const chip = count != null ? ` <span class="count">${escapeHtml(count)}</span>` : '';
  return `<div class="h2row"><h2>${escapeHtml(title)}</h2>${chip}</div>`;
}

function _cardValueHtml(value) {
  const raw = String(value == null ? '' : value);
  const parts = raw.split(' · ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return `<ul class="mini">${parts.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`;
  }
  return `<span class="metric-value">${escapeHtml(raw)}</span>`;
}

function _metricRows(metrics) {
  return metrics.map((m) =>
    `        <div class="metric"><span class="metric-label">${escapeHtml(m.label)}</span>${_cardValueHtml(m.value)}</div>`
  ).join('\n');
}

function _totalsStrip(totals) {
  const cells = [
    ['tasks ahead', totals.tasksAhead, 'tasksAhead'],
    ['active', totals.activeTasks, 'activeTasks'],
    ['done (24h)', totals.completedLast24h, 'completedLast24h'],
    ['archive clusters', totals.archivedClusters, 'archivedClusters'],
    ['tracks', totals.trackCount, 'trackCount'],
    ['milestones', `${totals.milestonesAchieved} / ${totals.milestoneCount}`, 'milestones'],
  ];
  return cells.map(([lbl, val, key]) =>
    `        <div class="tot"><span class="tot-v" data-k="${escapeHtml(key)}">${escapeHtml(val)}</span><span class="tot-l">${escapeHtml(lbl)}</span></div>`
  ).join('\n');
}

function _donut(pct, label, sub) {
  const C = 326.726; // 2π·52
  const { filled, rest } = ringDash(pct, C);
  const p = clampPct(pct) || 0;
  return `        <figure class="donut">
          <svg viewBox="0 0 120 120" role="img" aria-label="${escapeHtml(label)} ${p} percent">
            <circle class="donut-track" cx="60" cy="60" r="52"></circle>
            <circle class="donut-val" cx="60" cy="60" r="52" stroke-dasharray="${filled.toFixed(2)} ${rest.toFixed(2)}" transform="rotate(-90 60 60)"></circle>
            <text class="donut-num" x="60" y="58">${p}%</text>
            <text class="donut-lbl" x="60" y="78">${escapeHtml(sub || '')}</text>
          </svg>
          <figcaption>${escapeHtml(label)}</figcaption>
        </figure>`;
}

function _rings(totals) {
  return [
    _donut(totals.pocProgressPct, 'PoC / vision progress', 'estimate'),
    _donut(totals.buildProgressPct, 'Build progress', 'tracks'),
    _donut(totals.milestonesAchievedPct, 'Milestones achieved', `${totals.milestonesAchieved}/${totals.milestoneCount}`),
  ].join('\n');
}

function _trackRows(tracks) {
  return tracks.map((t) => {
    const pctLabel = t.bar.percent == null ? 'n/a' : `${t.bar.percent}%`;
    const fillW = t.bar.percent == null ? 0 : t.bar.percent;
    return `        <div class="track">
          <div class="track-head"><span class="track-name">${escapeHtml(t.name)}</span><span class="track-pct">${escapeHtml(pctLabel)} · ${escapeHtml(t.done)}</span></div>
          <div class="bar"><div class="bar-fill" style="width:${fillW}%"></div></div>
          <div class="track-status">${escapeHtml(t.status)}</div>
        </div>`;
  }).join('\n');
}

function _leanRows(rows) {
  return rows.map((r) =>
    `        <tr><td class="lean-id">${escapeHtml(r.id)}</td><td>${escapeHtml(r.slice)}</td><td>${escapeHtml(r.status)}</td></tr>`
  ).join('\n');
}

function _riskRows(rows) {
  return rows.map((r) =>
    `        <tr><td>${escapeHtml(r.item)}</td><td><span class="pill pill-${escapeHtml(r.state)}">${escapeHtml(r.state)}</span></td><td>${escapeHtml(r.note)}</td></tr>`
  ).join('\n');
}

// _healthChip(kind) — provenance chip markup (our own static markup, not escaped). Only
// the two known kinds emit a chip; anything else renders bare. Pure.
function _healthChip(kind) {
  if (kind === 'generated') return '<span class="hk hk-gen">GENERATED</span>';
  if (kind === 'last-known') return '<span class="hk hk-lk">LAST-KNOWN</span>';
  return '';
}

function _healthCards(metrics) {
  return metrics.map((mtc) =>
    `        <div class="metric"><span class="metric-label">${escapeHtml(mtc.label)} ${_healthChip(mtc.kind)}</span>${_cardValueHtml(mtc.value)}</div>`
  ).join('\n');
}

// _milestoneCard(ms) — the ACTIVE milestone progress card (v0.2.176): name + ACTIVE pill,
// blurb, a directional %-complete progress bar with a "tasks done" sub, and a bullet list
// of the DERIVED task-state counts (total/done/active/pending). Server-rendered + escaped.
function _milestoneCard(ms) {
  const pct = clampPct(ms.progressPct) || 0;
  const counts = (ms.counts || []).map((c) => `          <li>${escapeHtml(c)}</li>`).join('\n');
  return `      <div class="ms ms-active">
        <div class="ms-head"><span class="ms-name">${escapeHtml(ms.name)}</span><span class="pill ms-pill-active">ACTIVE</span></div>
        <div class="ms-blurb">${escapeHtml(ms.blurb)}</div>
        <div class="ms-meta"><span class="ms-pct">${pct}% complete <span class="ms-sub">(directional estimate)</span></span><span class="ms-sub">${escapeHtml(ms.tasks.done)} / ${escapeHtml(ms.tasks.total)} tasks done</span></div>
        <div class="bar"><div class="bar-fill" style="width:${pct}%"></div></div>
        <ul class="mini ms-counts">
${counts}
        </ul>
      </div>`;
}

// _seedMilestoneCards(seed) — the SEED/future milestones, each with a clear SEED chip so
// they are never mistaken for real tracked task sets. Server-rendered + escaped.
function _seedMilestoneCards(seed) {
  return (seed || []).map((s) =>
    `      <div class="ms ms-seed">
        <div class="ms-head"><span class="ms-name">${escapeHtml(s.name)}</span><span class="seed">SEED · future</span></div>
        <div class="ms-blurb">${escapeHtml(s.note)}</div>
      </div>`
  ).join('\n');
}

// _milestonesSection(ms) — the Milestones section (v0.2.176): an honest total
// (1 active + N seed), the active milestone progress card, the seed/future cards, and a
// provenance note. Empty string when absent so a legacy model omits the section. Pure.
function _milestonesSection(ms) {
  if (!ms || !ms.active) return '';
  const c = ms.counts || {};
  const note = ms.note ? `      <div class="focus">${escapeHtml(ms.note)}</div>` : '';
  return `
    <section>
      ${_h2('Milestones', c.total)}
      <div class="lead">The one true ACTIVE milestone vs. clearly-labelled SEED/future roadmap.</div>
      <div class="ms-totals">Total milestones: <b>${escapeHtml(c.total)}</b> — <b>${escapeHtml(c.active)}</b> active, <b>${escapeHtml(c.seed)}</b> seed/future <span class="seed">SEED · not yet tracked</span></div>
${_milestoneCard(ms.active)}
      <div class="ms-grid">
${_seedMilestoneCards(ms.seed)}
      </div>
${note}
    </section>`;
}

// _healthSection(health) — the Engineering-health section (v0.2.175): provenance-chipped
// metric cards + reused SVG rings + the efficiency-loop note. Empty string when absent, so
// an override-free legacy model simply omits the section. Server-rendered + escaped; no
// new script, no new data-k key → CSP/refresh-script hash untouched.
function _healthSection(health) {
  if (!health || !Array.isArray(health.metrics) || !health.metrics.length) return '';
  const rings = Array.isArray(health.rings) && health.rings.length
    ? `      <div class="rings">\n${health.rings.map((r) => _donut(r.pct, r.label, r.sub)).join('\n')}\n      </div>`
    : '';
  const note = health.note ? `      <div class="focus">${escapeHtml(health.note)}</div>` : '';
  return `
    <section>
      ${_h2('Engineering health', health.metrics.length)}
      <div class="lead">The efficiency loop in numbers — each card chipped GENERATED or LAST-KNOWN.</div>
      <div class="grid">
${_healthCards(health.metrics)}
      </div>
${rings}
${note}
    </section>`;
}

// _readinessSection(readiness) — the Deployment-readiness section (v0.2.186): an overall
// status pill plus a per-check table (item / state / note) reusing the existing pill
// vocabulary + risk-table markup, and the read-only/manual note. Empty string when absent
// so an override-free legacy model omits the section. Server-rendered + escaped; no new
// script, no new data-k key → CSP/refresh-script hash untouched. Pure.
function _readinessSection(readiness) {
  if (!readiness || !Array.isArray(readiness.checks) || !readiness.checks.length) return '';
  // Map the overall status onto the existing pill classes (no new CSS): ready→no-blocker,
  // docs-ready→manual, blocked→gated, unknown→deferred.
  const pillState = readiness.status === 'ready' ? 'no-blocker'
    : readiness.status === 'docs-ready' ? 'manual'
    : readiness.status === 'blocked' ? 'gated'
    : 'deferred';
  const rows = readiness.checks.map((c) =>
    `        <tr><td>${escapeHtml(c.item)}</td><td><span class="pill pill-${escapeHtml(c.state)}">${escapeHtml(c.state)}</span></td><td>${escapeHtml(c.note)}</td></tr>`
  ).join('\n');
  const errs = (readiness.errors || []).length
    ? `      <div class="focus"><b>Blocking:</b><ul class="mini">${readiness.errors.map((e) => `<li>${escapeHtml(e)}</li>`).join('')}</ul></div>`
    : '';
  const warns = (readiness.warnings || []).length
    ? `      <div class="focus"><b>Advisory:</b><ul class="mini">${readiness.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul></div>`
    : '';
  const note = readiness.note ? `      <div class="focus">${escapeHtml(readiness.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>Deployment readiness</h2> <span class="pill pill-${pillState}">${escapeHtml(readiness.statusLabel)}</span> <span class="badge">${escapeHtml(readiness.badge)}</span></div>
      <div class="lead">Static-host posture for the gateway /zone/* travel feature — repo-side prerequisites are checked locally; configuring the host + deploying stay manual.</div>
      <table>
        <thead><tr><th>Check</th><th>State</th><th>Note</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
${errs}${warns}${note}
    </section>`;
}

// _shipSection(ship) — the Ship-readiness section (v0.2.188): an overall verdict pill +
// provenance chip + badge, the recommended NEXT SAFE task highlighted, and a per-signal
// table (signal / state / detail) reusing the existing pill vocabulary + risk-table markup.
// Empty string when absent so an override-free legacy model omits it. Server-rendered +
// escaped; no new script, no new data-k key → CSP/refresh-script hash untouched. Pure.
function _shipSection(ship) {
  if (!ship || !Array.isArray(ship.signals) || !ship.signals.length) return '';
  // Map the overall ship status onto the existing pill classes (no new CSS): ready→no-blocker,
  // not-ready/blocked→gated, incomplete→manual, anything else→deferred.
  const pillState = ship.status === 'ready' ? 'no-blocker'
    : (ship.status === 'not-ready' || ship.status === 'blocked') ? 'gated'
    : ship.status === 'incomplete' ? 'manual'
    : 'deferred';
  const rows = ship.signals.map((s) =>
    `        <tr><td>${escapeHtml(s.label)}</td><td><span class="pill pill-${escapeHtml(s.pill)}">${escapeHtml(s.state)}</span></td><td>${escapeHtml(s.detail || '')}</td></tr>`
  ).join('\n');
  const blockers = (ship.blockers || []).length
    ? `      <div class="focus"><b>Blockers:</b> ${escapeHtml(ship.blockers.join(', '))}</div>` : '';
  const unknowns = (ship.unknowns || []).length
    ? `      <div class="focus"><b>Not checked this pass:</b> ${escapeHtml(ship.unknowns.join(', '))}</div>` : '';
  const nt = ship.nextTask || {};
  const nextTask = nt.title
    ? `      <div class="focus"><b>Next safe task ▸</b> ${escapeHtml(nt.title)}${nt.why ? `<div class="ms-sub">${escapeHtml(nt.why)}</div>` : ''}</div>` : '';
  const verdictLine = `      <div class="focus">${escapeHtml(ship.note)} Verdict for <b>${escapeHtml(ship.version || '?')}</b>${ship.gitCommit ? ` @ ${escapeHtml(ship.gitCommit)}` : ''}. Full gate: <b>${escapeHtml(ship.gateCommand)}</b>.</div>`;
  return `
    <section>
      <div class="h2row"><h2>Ship readiness</h2> <span class="pill pill-${pillState}">${escapeHtml(ship.statusLabel)}</span> ${_healthChip(ship.kind)} <span class="badge">${escapeHtml(ship.badge)}</span></div>
      <div class="lead">The last local release-readiness verdict (${escapeHtml(ship.statusCommand)}) and the next safe task to pick up — read-only; the gate stays the authority.</div>
${nextTask}
      <table>
        <thead><tr><th>Signal</th><th>State</th><th>Detail</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
${blockers}${unknowns}${verdictLine}
    </section>`;
}

// _readHealthSection(readHealth) — the Nostr read-path HEALTH section (v0.2.194): an overall
// READ-ONLY verdict pill + badge, the read-only invariants (signed/published/readOnly), and a
// per-signal table (signal / state / detail) reusing the existing pill vocabulary + risk-table
// markup. Empty string when absent so an override-free legacy model omits it. Server-rendered +
// escaped; no new script, no new data-k key → CSP/refresh-script hash untouched. Pure.
function _readHealthSection(readHealth) {
  if (!readHealth || !Array.isArray(readHealth.signals) || !readHealth.signals.length) return '';
  const pillState = readHealth.ok ? 'no-blocker' : 'gated';
  const rows = readHealth.signals.map((s) =>
    `        <tr><td>${escapeHtml(s.label)}</td><td><span class="pill pill-${escapeHtml(s.pill)}">${escapeHtml(s.state)}</span></td><td>${escapeHtml(s.detail || '')}</td></tr>`
  ).join('\n');
  const sum = readHealth.summary || { total: 0, ok: 0, fail: 0 };
  const invariants = `      <div class="focus"><b>Read-only invariants:</b> signed:${escapeHtml(String(readHealth.signed))} · published:${escapeHtml(String(readHealth.published))} · readOnly:${escapeHtml(String(readHealth.readOnly))} — ${escapeHtml(sum.ok)}/${escapeHtml(sum.total)} signals ok.</div>`;
  const note = readHealth.note ? `      <div class="focus">${escapeHtml(readHealth.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>Nostr read-path health</h2> <span class="pill pill-${pillState}">${escapeHtml(readHealth.statusLabel)}</span> <span class="badge">${escapeHtml(readHealth.badge)}</span></div>
      <div class="lead">Static, local proof that every Nostr path is read-only at the MVP stage and the live-write tier stays consent-gated — derived from the pure read helpers, no relay call.</div>
      <table>
        <thead><tr><th>Signal</th><th>State</th><th>Detail</th></tr></thead>
        <tbody>
${rows}
        </tbody>
      </table>
${invariants}${note}
    </section>`;
}

// _rcStatusSection(rc) — the RC / release-manifest status section (v0.2.214): an overall
// readiness-band pill + provenance chip + badge, a small grid of metric cards (version, manifest
// verdict, RC-doc coverage, tests, profiles, manual validation remaining, last gate), and a
// read-only note. Empty string when absent so an override-free legacy model omits it. Server-
// rendered + escaped; reuses the .metric/.pill markup → no new script, no new data-k key, the
// CSP/refresh-script hash stay intact. Pure.
function _rcStatusSection(rc) {
  if (!rc || !Array.isArray(rc.metrics) || !rc.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(rc.pill) ? rc.pill : 'deferred';
  const note = rc.note ? `      <div class="focus">${escapeHtml(rc.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>RC / release manifest</h2> <span class="pill pill-${pillState}">${escapeHtml(rc.statusLabel)}</span> ${_healthChip(rc.kind)} <span class="badge">${escapeHtml(rc.badge)}</span></div>
      <div class="lead">Release-candidate artifact posture — manifest + RC-doc coverage, test count, and the manual validation still outstanding. Read-only; release/tag/publish stay manual + user-approved.</div>
      <div class="grid">
${_metricRows(rc.metrics)}
      </div>
${note}
    </section>`;
}

// _manualValidationSection(mv) — the manual-validation / MVP-playtest readiness section (v0.2.215):
// an overall band pill + provenance chip + badge, a small grid of metric cards that SEPARATE the
// green local automated gates from the still-PENDING human live-browser playtest (checklist
// section/item/severity counts, doc presence, and the highest-level validation areas), and a
// read-only note. Empty string when absent so an override-free legacy model omits it. Server-
// rendered + escaped; reuses the .metric/.pill markup → no new script, no new data-k key, the
// CSP/refresh-script hash stay intact. Pure.
function _manualValidationSection(mv) {
  if (!mv || !Array.isArray(mv.metrics) || !mv.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(mv.pill) ? mv.pill : 'manual';
  const note = mv.note ? `      <div class="focus">${escapeHtml(mv.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>Manual validation</h2> <span class="pill pill-${pillState}">${escapeHtml(mv.statusLabel)}</span> ${_healthChip(mv.kind)} <span class="badge">${escapeHtml(mv.badge)}</span></div>
      <div class="lead">Local automated gates are green, but the MVP playtest is a human, live-browser task. This separates what is no-blocker (local gates) from what still needs manual input (the playtest + explicit approval). Read-only.</div>
      <div class="grid">
${_metricRows(mv.metrics)}
      </div>
${note}
    </section>`;
}

// _noBlockerQueueSection(nb) — the no-blocker-queue section (v0.2.216): an overall band pill +
// provenance chip + badge, a small grid of metric cards that SEPARATE the safe next work an agent can
// pick up with no user input (the next safe task + active/next/archive counts) from the one user-
// gated item (the MVP playtest + approval), and a read-only note. Empty string when absent so an
// override-free legacy model omits it. Server-rendered + escaped; reuses the .metric/.pill markup →
// no new script, no new data-k key, the CSP/refresh-script hash stay intact. Pure.
function _noBlockerQueueSection(nb) {
  if (!nb || !Array.isArray(nb.metrics) || !nb.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(nb.pill) ? nb.pill : 'no-blocker';
  const note = nb.note ? `      <div class="focus">${escapeHtml(nb.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>No-blocker queue</h2> <span class="pill pill-${pillState}">${escapeHtml(nb.statusLabel)}</span> ${_healthChip(nb.kind)} <span class="badge">${escapeHtml(nb.badge)}</span></div>
      <div class="lead">What an AI agent can pick up next WITHOUT user input — the next safe no-runtime-risk slice plus the active/next/archive queue, separated from the one item parked on the human (the MVP playtest + approval). Read-only.</div>
      <div class="grid">
${_metricRows(nb.metrics)}
      </div>
${note}
    </section>`;
}

// _handoffControlPanelSection(hp) — the handoff / release control-panel section (v0.2.233): the
// ONE surface a fresh agent or human reads first to pick up the project safely. An overall band
// pill + provenance chip + badge, a compact grid of metric cards (version + live URLs, the entry-
// and dashboard-smoke evidence, the manual blocker, MVP approval, the next safe task, the do-not
// list, and the project's practical non-religious operating principles), and a read-only note.
// Placed FIRST in <main> after Active focus so the pickup posture is impossible to miss. Empty
// string when absent so an override-free legacy model omits it. Server-rendered + escaped; reuses
// the .metric/.pill markup → no new script, no new data-k key, the CSP/refresh-script hash stay
// intact. Pure.
function _handoffControlPanelSection(hp) {
  if (!hp || !Array.isArray(hp.metrics) || !hp.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(hp.pill) ? hp.pill : 'manual';
  const note = hp.note ? `      <div class="focus">${escapeHtml(hp.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>Handoff / release control panel</h2> <span class="pill pill-${pillState}">${escapeHtml(hp.statusLabel)}</span> ${_healthChip(hp.kind)} <span class="badge">${escapeHtml(hp.badge)}</span></div>
      <div class="lead">Read this FIRST. One read-only surface to pick up the project safely: current version + live URLs, the latest app-entry and oversight-dashboard cloud smokes, the one manual blocker (user runs the live-browser MVP playtest + explicitly approves), the next safe no-blocker task, the actions NOT to take without user input, and the project's practical operating principles. GREEN here means the handoff surface is complete — NOT that the MVP is approved.</div>
      <div class="grid">
${_metricRows(hp.metrics)}
      </div>
${note}
    </section>`;
}

// _mvpApprovalSection(mv) — the MVP-approval-state section (v0.2.221): an overall band pill +
// provenance chip + badge, a compact grid of metric cards (status / version / approver who+when /
// the clear next step), and a read-only note. Placed as its OWN section so the pending approval is
// impossible to miss. Empty string when absent so an override-free legacy model omits it. Server-
// rendered + escaped; reuses the .metric/.pill markup → no new script, no new data-k key, the
// CSP/refresh-script hash stay intact. Pure.
function _mvpApprovalSection(mv) {
  if (!mv || !Array.isArray(mv.metrics) || !mv.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(mv.pill) ? mv.pill : 'manual';
  const note = mv.note ? `      <div class="focus">${escapeHtml(mv.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>MVP approval</h2> <span class="pill pill-${pillState}">${escapeHtml(mv.statusLabel)}</span> ${_healthChip(mv.kind)} <span class="badge">${escapeHtml(mv.badge)}</span></div>
      <div class="lead">The single auditable approval gate (MVP_APPROVAL_STATE.json). Local gates are green, but the MVP is NOT approved until a human runs the live-browser playtest and explicitly says "MVP approved". Read-only.</div>
      <div class="grid">
${_metricRows(mv.metrics)}
      </div>
${note}
    </section>`;
}

// _mvpApprovalGateSection(mg) — the MVP-approval-gate section (v0.2.234): the rubric that keeps an
// automated green run from being mistaken for human game-feel approval. An overall band pill +
// provenance chip + badge, a compact grid of metric cards (the gate verdict, each automated
// CONFIDENCE signal labelled "confidence only, not approval", the explicit-approval row, how
// approval works, and the manual playtest focus), and a read-only note. Placed right after the MVP
// approval card so oversight reads the current approval STATE then the rubric for what approval
// REQUIRES. Empty string when absent so an override-free legacy model omits it. Server-rendered +
// escaped; reuses the .metric/.pill markup → no new script, no new data-k key, the CSP/refresh-script
// hash stay intact. Pure.
function _mvpApprovalGateSection(mg) {
  if (!mg || !Array.isArray(mg.metrics) || !mg.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(mg.pill) ? mg.pill : 'manual';
  const note = mg.note ? `      <div class="focus">${escapeHtml(mg.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>MVP approval gate</h2> <span class="pill pill-${pillState}">${escapeHtml(mg.statusLabel)}</span> ${_healthChip(mg.kind)} <span class="badge">${escapeHtml(mg.badge)}</span></div>
      <div class="lead">The rubric for sign-off. Automated tests, the release gate, and the cloud smokes are CONFIDENCE signals — green means the code and deployed surfaces look healthy, NOT that the MVP is approved. Approval is a separate explicit step: a human runs the live-browser playtest and says "MVP approved". Read-only.</div>
      <div class="grid">
${_metricRows(mg.metrics)}
      </div>
${note}
    </section>`;
}

// _playtestResultsSection(pr) — the MVP-playtest-results-state section (v0.2.223): an overall band
// pill + provenance chip + badge, a compact grid of metric cards (results status / recorded? /
// pass-fail-blank counts / the pinned "implies approval: no" / the clear next step / any failing item
// ids), and a read-only note. Placed right after the MVP-approval card so oversight reads
// approval-state then results-state together. Empty string when absent so an override-free legacy
// model omits it. Server-rendered + escaped; reuses the .metric/.pill markup → no new script, no new
// data-k key, the CSP/refresh-script hash stay intact. Pure.
function _playtestResultsSection(pr) {
  if (!pr || !Array.isArray(pr.metrics) || !pr.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(pr.pill) ? pr.pill : 'manual';
  const note = pr.note ? `      <div class="focus">${escapeHtml(pr.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>Playtest results</h2> <span class="pill pill-${pillState}">${escapeHtml(pr.statusLabel)}</span> ${_healthChip(pr.kind)} <span class="badge">${escapeHtml(pr.badge)}</span></div>
      <div class="lead">Whether the actual manual playtest results have been recorded (MVP_PLAYTEST_RESULTS.md), and what they said. Ships blank → NOT RUN. A recorded result never implies approval — that stays a separate explicit user gate. Read-only.</div>
      <div class="grid">
${_metricRows(pr.metrics)}
      </div>
${note}
    </section>`;
}

// _playtestVerdictSection(pv) — the MVP-playtest-verdict section (v0.2.235): the one-line tester
// report. An overall band pill (open-edge when blockers are reported, so they can never be hidden)
// + provenance chip + badge, a compact grid of metric cards (the verdict, the visible blocker list,
// who reported, the one-line how-to, the focus to judge, and the pinned "implies approval: NO"),
// and a read-only note. Placed right after the playtest-results section. Empty string when absent so
// an override-free legacy model omits it. Server-rendered + escaped; reuses the .metric/.pill markup
// → no new script, no new data-k key, the CSP/refresh-script hash stay intact. Pure.
function _playtestVerdictSection(pv) {
  if (!pv || !Array.isArray(pv.metrics) || !pv.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(pv.pill) ? pv.pill : 'manual';
  const note = pv.note ? `      <div class="focus">${escapeHtml(pv.note)}</div>` : '';
  return `
    <section>
      <div class="h2row"><h2>Playtest verdict</h2> <span class="pill pill-${pillState}">${escapeHtml(pv.statusLabel)}</span> ${_healthChip(pv.kind)} <span class="badge">${escapeHtml(pv.badge)}</span></div>
      <div class="lead">The one-line live-browser verdict: Chiefmonkey reports "MVP OK" or "blockers: …" in MVP_PLAYTEST_VERDICT.md. Every reported blocker stays visible here. A tester verdict is a confidence signal — it NEVER approves the MVP; approval is the separate explicit user step. Read-only.</div>
      <div class="grid">
${_metricRows(pv.metrics)}
      </div>
${note}
    </section>`;
}

// _clickThroughSection(ct) — the MVP-loop click-through mockup section (C2): a read-only
// walkthrough of the five mockup screens (Gateway, Product, Leaderboard, Update, Console).
// An overall band pill + provenance chip + badge, a compact grid of metric cards (screen count /
// proof state / live data / actions / promotion gate / next step), then one .ms card per view
// showing what it proofs and its honest mock state. Empty string when absent so an override-free
// legacy model omits it. Server-rendered + escaped; reuses .ms/.metric/.pill markup so NO new
// script, NO new data-k key, and the CSP/refresh-script hash stay intact. Pure.
function _clickThroughSection(ct) {
  if (!ct || !Array.isArray(ct.metrics) || !ct.metrics.length) return '';
  const allowed = new Set(['no-blocker', 'gated', 'manual', 'deferred', 'open-edge']);
  const pillState = allowed.has(ct.pill) ? ct.pill : 'manual';
  const note = ct.note ? `      <div class="focus">${escapeHtml(ct.note)}</div>` : '';
  const views = Array.isArray(ct.views) ? ct.views : [];
  const viewCards = views.map((v, idx) => {
    const step = `${idx + 1}/${views.length}`;
    const stPill = v.status === 'proof' ? '<span class="pill pill-deferred">proof</span>' : '<span class="pill pill-manual">mockup</span>';
    return `      <div class="ms">
        <div class="ms-head"><span class="ms-name">${escapeHtml(step)} · ${escapeHtml(v.title)}</span>${stPill}</div>
        <div class="ms-blurb">${escapeHtml(v.proofs)}</div>
        <div class="ms-meta"><span class="ms-sub">${escapeHtml(v.mockState)}</span></div>
      </div>`;
  }).join('\n');
  return `
    <section>
      <div class="h2row"><h2>MVP loop click-through</h2> <span class="pill pill-${pillState}">${escapeHtml(ct.statusLabel)}</span> ${_healthChip(ct.kind)} <span class="badge">${escapeHtml(ct.badge)}</span></div>
      <div class="lead">A thin, read-only mockup of the freedom-tech loop (Gateway → Product → Leaderboard → Update → Console). Every screen is a PROOF/MOCKUP card — no navigation, no live data, no actions. Live promotion is gated behind SEC-1/2/3 + manual deploy.</div>
      <div class="grid">
${_metricRows(ct.metrics)}
      </div>
${viewCards}
${note}
    </section>`;
}

// renderContinuumPage(model) — full self-contained static HTML document string.
// Dark Torii/nostrich/cyberpunk feel via inline CSS only; CSS bars + SVG rings.
// The page renders fully WITHOUT JavaScript. A tiny, optional, same-origin-only
// script re-reads ./continuum-data.json to refresh the totals strip (no external
// URL, no eval, no timers; degrades silently). Pure; safe to write to a file.
export function renderContinuumPage(model = buildContinuumModel()) {
  const m = model;
  const t = m.totals;
  const contrib = m.contributors
    ? `        <div class="metric"><span class="metric-label">Contributors <span class="seed">SEED · not live</span></span><span class="metric-value">${escapeHtml(m.contributors.humans)} human · ${escapeHtml(m.contributors.clankers)} clankers</span></div>`
    : '';
  const tt = m.taskTotals;
  const derivedRow = tt
    ? `        <div class="metric"><span class="metric-label">Docs-derived <span class="seed">DERIVED · build-time</span></span>${_cardValueHtml(
        [
          tt.todoCompletedMarkers != null ? `${tt.todoCompletedMarkers} completed task markers (todo.md)` : null,
          t.tasksAhead != null ? `${t.tasksAhead} next-12` : null,
          t.archivedClusters != null ? `${t.archivedClusters} archive clusters` : null,
        ].filter(Boolean).join(' · ')
      )}</div>`
    : '';
  const derivedNote = m.derived && Array.isArray(m.derived.parsed)
    ? `    Dashboard lists generated from <b>${escapeHtml((m.derived.sources || []).join(' + ') || 'project docs')}</b> at build time — parsed: ${escapeHtml(m.derived.parsed.join(', ') || 'none')}${m.derived.gaps && m.derived.gaps.length ? `; fell back to curated for: ${escapeHtml(String(m.derived.gaps.length))} section(s)` : '; no parser gaps'}.`
    : '';
  const next12 = m.next12.map((x, i) =>
    `        <li><span class="num">${i + 1}</span>${escapeHtml(x)}</li>`
  ).join('\n');
  const done24 = m.completed24h.map((x) => `        <li class="done">${escapeHtml(x)}</li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${CONTINUUM_CSP}" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(m.title)} · ${escapeHtml(m.version)}</title>
<style>
  :root{
    --bg:#070a12; --panel:#0d1320; --panel2:#111a2b; --edge:#1d2a44;
    --ink:#dbe4f3; --muted:#8b97b0; --hot:#ff5a4d; --accent:#36e0c8;
    --gold:#e8b84b; --good:#46d17a; --warn:#e8b84b; --bad:#ff5a4d;
  }
  *{box-sizing:border-box;}
  body{margin:0;background:radial-gradient(1200px 600px at 70% -10%, #16213a 0%, var(--bg) 60%);
    color:var(--ink);font:14px/1.55 ui-monospace,Menlo,Consolas,monospace;padding:0 0 64px;}
  header{padding:28px 22px 16px;border-bottom:1px solid var(--edge);
    background:linear-gradient(180deg,rgba(54,224,200,.06),transparent);}
  .gate{color:var(--hot);letter-spacing:3px;font-size:12px;}
  h1{margin:6px 0 2px;font-size:26px;letter-spacing:2px;}
  h1 .v{color:var(--accent);font-size:15px;letter-spacing:1px;}
  .sub{color:var(--muted);letter-spacing:1px;}
  .badge{display:inline-block;margin-top:10px;padding:3px 10px;border:1px solid var(--edge);
    border-radius:3px;color:var(--accent);font-size:11px;letter-spacing:2px;}
  .live{color:var(--muted);font-size:12px;margin-top:6px;}
  main{max-width:1080px;margin:0 auto;padding:0 16px;}
  section{margin-top:34px;}
  .h2row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin:0 0 4px;}
  h2{font-size:13px;letter-spacing:3px;color:var(--gold);text-transform:uppercase;
    border-left:3px solid var(--hot);padding-left:10px;margin:0;}
  .count{color:var(--accent);font-size:11px;letter-spacing:1px;
    border:1px solid var(--edge);border-radius:10px;padding:0 8px;}
  .lead{color:var(--muted);font-size:12px;letter-spacing:.4px;margin:0 0 12px;padding-left:13px;}
  .focus{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:12px 14px;color:var(--muted);margin-top:14px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;}
  .metric{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:10px 12px;display:flex;flex-direction:column;gap:3px;transition:border-color .15s;}
  .metric:hover,.ms:hover,.track:hover,.tot:hover{border-color:var(--accent);}
  .metric-label{color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase;}
  .metric-value{color:var(--ink);}
  .seed{color:var(--gold);font-size:9px;border:1px solid var(--gold);border-radius:4px;padding:0 4px;letter-spacing:1px;}
  .hk{font-size:9px;border:1px solid;border-radius:4px;padding:0 4px;letter-spacing:1px;}
  .hk-gen{color:var(--accent);border-color:var(--accent);}
  .hk-lk{color:var(--muted);border-color:var(--muted);}
  ul.mini{list-style:none;margin:2px 0 0;padding:0;}
  ul.mini li{position:relative;padding:1px 0 1px 14px;color:var(--ink);font-size:13px;}
  ul.mini li::before{content:"▹";position:absolute;left:0;color:var(--accent);}
  .ms{background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:12px 14px;margin-bottom:10px;}
  .ms-active{border-left:3px solid var(--accent);}
  .ms-seed{border-left:3px solid var(--gold);opacity:.92;}
  .ms-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;}
  .ms-name{letter-spacing:1px;color:var(--ink);}
  .ms-pill-active{color:var(--accent);border-color:var(--accent);}
  .ms-blurb{color:var(--muted);font-size:12px;margin:6px 0 8px;}
  .ms-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12px;}
  .ms-pct{color:var(--accent);}
  .ms-sub{color:var(--muted);font-size:11px;}
  .ms-counts{margin-top:8px;}
  .ms-totals{color:var(--muted);margin-bottom:12px;}
  .ms-totals b{color:var(--ink);}
  .ms-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;}
  .totals{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-top:12px;}
  .tot{text-align:center;background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:12px 6px;}
  .tot-v{display:block;font-size:24px;color:var(--accent);}
  .tot-l{font-size:10px;color:var(--muted);letter-spacing:1px;text-transform:uppercase;}
  .rings{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:10px;margin-top:12px;}
  .donut{margin:0;text-align:center;background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:8px 4px;}
  .donut svg{width:130px;height:130px;}
  .donut-track{fill:none;stroke:#16213a;stroke-width:10;}
  .donut-val{fill:none;stroke:var(--accent);stroke-width:10;stroke-linecap:round;}
  .donut-num{fill:var(--ink);font-size:22px;text-anchor:middle;font-family:inherit;}
  .donut-lbl{fill:var(--muted);font-size:8px;text-anchor:middle;letter-spacing:1px;font-family:inherit;}
  .donut figcaption{color:var(--muted);font-size:11px;letter-spacing:1px;margin-top:2px;}
  .track{background:var(--panel);border:1px solid var(--edge);border-radius:6px;padding:10px 12px;margin-bottom:8px;}
  .track-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;}
  .track-name{letter-spacing:1px;}
  .track-pct{color:var(--accent);font-size:12px;}
  .track-status{color:var(--muted);font-size:12px;margin-top:4px;}
  .bar{height:10px;background:var(--panel2);border:1px solid var(--edge);border-radius:5px;
    overflow:hidden;margin-top:7px;}
  .bar-fill{height:100%;background:linear-gradient(90deg,var(--hot),var(--gold) 60%,var(--accent));}
  table{width:100%;border-collapse:collapse;background:var(--panel);
    border:1px solid var(--edge);border-radius:6px;overflow:hidden;}
  th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--edge);vertical-align:top;font-size:13px;}
  th{color:var(--muted);font-size:11px;letter-spacing:2px;text-transform:uppercase;}
  tr:last-child td{border-bottom:none;}
  .lean-id{color:var(--accent);white-space:nowrap;}
  .pill{display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;letter-spacing:1px;border:1px solid var(--edge);}
  .pill-no-blocker{color:var(--good);border-color:var(--good);}
  .pill-gated,.pill-manual{color:var(--warn);border-color:var(--warn);}
  .pill-open-edge,.pill-deferred{color:var(--muted);}
  ul{list-style:none;padding:0;margin:0;}
  ul.bullets li{background:var(--panel);border:1px solid var(--edge);border-radius:6px;
    padding:8px 11px;margin-bottom:7px;}
  ol.next li,ul.next li{position:relative;background:var(--panel);border:1px solid var(--edge);
    border-radius:6px;padding:8px 11px 8px 40px;margin-bottom:6px;}
  .num{position:absolute;left:10px;top:8px;color:var(--accent);font-size:12px;}
  li.done{background:var(--panel);border:1px dashed var(--edge);border-radius:6px;
    padding:8px 11px;margin-bottom:6px;color:var(--muted);text-decoration:line-through;}
  .cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px;align-items:start;}
  .cols h3{font-size:12px;letter-spacing:2px;color:var(--accent);margin:0 0 8px;
    display:flex;align-items:baseline;gap:8px;}
  .cols h3 .count{color:var(--muted);}
  footer{max-width:1080px;margin:38px auto 0;padding:14px 16px;color:var(--muted);
    border-top:1px solid var(--edge);font-size:12px;}
  footer b{color:var(--ink);}
  @media(max-width:760px){h1{font-size:21px;}}
</style>
</head>
<body>
  <header>
    <div class="gate">⛩ TORII CONTINUUM</div>
    <h1>${escapeHtml(m.title)} <span class="v">${escapeHtml(m.version)}</span></h1>
    <div class="sub">${escapeHtml(m.subtitle)}</div>
    <div class="badge">${escapeHtml(m.badge)}</div>
    <div class="live">Live: ${escapeHtml(m.liveUrl)} · godMode false · build truth (live trails — manual deploy)${m.generatedAt ? ` · packaged: <span id="generated-at">${escapeHtml(m.generatedAt)}</span>` : ''}</div>
  </header>
  <main>
    <section>
      ${_h2('Active focus')}
      <div class="lead">What the project is pointed at right now — read this first.</div>
      <div class="focus">${escapeHtml(m.focus)}</div>
    </section>
${_handoffControlPanelSection(m.handoffPanel)}
${_shipSection(m.ship)}
${_rcStatusSection(m.rcStatus)}
${_mvpApprovalSection(m.mvpApproval)}
${_mvpApprovalGateSection(m.mvpGate)}
${_playtestResultsSection(m.playtestResults)}
${_playtestVerdictSection(m.playtestVerdict)}
${_manualValidationSection(m.manualValidation)}
${_noBlockerQueueSection(m.noBlockerQueue)}
${_milestonesSection(m.milestones)}
${_clickThroughSection(m.clickThrough)}

    <section>
      ${_h2('At a glance', m.metrics.length)}
      <div class="lead">Build truth: source version, test/gate status, and the headline progress rings.</div>
      <div class="grid">
${_metricRows(m.metrics)}
${contrib}
${derivedRow}
      </div>
      <div class="totals">
${_totalsStrip(t)}
      </div>
      <div class="rings">
${_rings(t)}
      </div>
    </section>
${_healthSection(m.health)}
${_readinessSection(m.readiness)}
${_readHealthSection(m.readHealth)}

    <section>
      ${_h2('Track overview', m.tracks.length)}
      <div class="lead">Directional per-track completion — momentum, not archaeology.</div>
${_trackRows(m.tracks)}
    </section>

    <section>
      ${_h2('15-hour proof-of-concept route', m.leanRoute.length)}
      <div class="lead">The active milestone's slices (LEAN-1..5) and what each still needs to ACT.</div>
      <table>
        <thead><tr><th>#</th><th>Slice</th><th>Status</th></tr></thead>
        <tbody>
${_leanRows(m.leanRoute)}
        </tbody>
      </table>
    </section>

    <section>
      ${_h2('Now · Next · Later')}
      <div class="lead">Active work, the archive of landed clusters, and what shipped in the last day.</div>
      <div class="cols">
        <div>
          <h3>NOW · Active <span class="count">${m.activeNow.length}</span></h3>
          <ul class="bullets">
${_li(m.activeNow)}
          </ul>
        </div>
        <div>
          <h3>LATER · Archive <span class="count">${m.archive.length}</span></h3>
          <ul class="bullets">
${_li(m.archive)}
          </ul>
        </div>
        <div>
          <h3>DONE · Last 24h <span class="count">${m.completed24h.length}</span></h3>
          <ul>
${done24}
          </ul>
        </div>
      </div>
    </section>

    <section>
      ${_h2('Next 12 tasks', m.next12.length)}
      <div class="lead">The ordered queue — top of the list is the next thing to pick up.</div>
      <ol class="next">
${next12}
      </ol>
    </section>

    <section>
      ${_h2('Risk / blocked / no-blocker', m.risks.length)}
      <div class="lead">What can move freely vs. what is gated, manual, or a tracked open edge.</div>
      <table>
        <thead><tr><th>Item</th><th>State</th><th>Note</th></tr></thead>
        <tbody>
${_riskRows(m.risks)}
        </tbody>
      </table>
    </section>
  </main>
  <footer>
    <b>Source of truth.</b>
    <ul>
${_li(m.sourceOfTruth)}
    </ul>
    Static, read-only oversight surface — generated from packaged project data each deploy; a page refresh shows the latest packaged state. No live writes, signing, relay publishing, or admin actions. Regenerate with <b>npm run build:continuum</b>.
${derivedNote}
  </footer>
  <script>${CONTINUUM_REFRESH_SCRIPT}</script>
</body>
</html>
`;
}
