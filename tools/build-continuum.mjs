// tools/build-continuum.mjs — generate the static Torii Continuum oversight page
// (v0.2.171). Imports the pure, node-safe data module, renders the page + a packaged
// JSON snapshot, and writes both into public/ so Vite copies them verbatim into dist/.
// Run with: node tools/build-continuum.mjs  (or: npm run build:continuum).
//
// Safe by construction: it only READS the curated data module + progress.md/todo.md and
// WRITES two static files under public/. No network, no install, no external writes, no
// game code. As of v0.2.174 it DERIVES the dashboard's list sections from the project
// docs via the pure tools/continuumParse.mjs and merges them over the curated fallback.
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildContinuumModel,
  buildHealthModel,
  buildReadinessModel,
  buildShipModel,
  buildRcStatusModel,
  buildManualValidationModel,
  buildNoBlockerQueueModel,
  buildMvpApprovalModel,
  buildPlaytestResultsCardModel,
  SHIP_NEXT_SAFE_TASK,
  CURRENT_TEST_STATUS,
  testCountLabel,
  HEALTH_LASTKNOWN,
  renderContinuumPage,
  continuumDataJSON,
} from '../src/engine/dashboard/continuumData.js';
import { deriveContinuumData } from './continuumParse.mjs';
import { REQUIRED_FALLBACK_DOCS, checkZoneFallbackReadiness } from './zoneFallbackReadiness.mjs';
import { gatherReleaseReadiness } from './release-readiness.mjs';
import { RELEASE_MANIFEST_REQUIRED, RELEASE_MANIFEST_OPTIONAL } from './releaseManifest.mjs';
import { RC_SNAPSHOT_DOC_REFS, RC_SNAPSHOT_MANUAL_VALIDATION } from './rcSnapshot.mjs';
import { buildApprovalState, summarizeApprovalForState, MVP_APPROVAL_FILE } from './mvpApproval.mjs';
import { summarizePlaytestForState, PLAYTEST_RESULTS_STATE_FILE } from './playtestResultsState.mjs';
import { buildLiveSmokeState, LIVE_SMOKE_FILE, LIVE_SMOKE_RESULTS, summarizeLiveSmokeForState } from './liveSmokeState.mjs';
import { buildDashboardSmokeState, DASHBOARD_SMOKE_FILE, DASHBOARD_SMOKE_RESULTS, summarizeDashboardSmokeForState } from './dashboardSmokeState.mjs';
import { buildHandoffControlPanel, buildHandoffControlPanelCard, HANDOFF_LIVE_URL, HANDOFF_DASHBOARD_URL } from '../src/engine/status/handoffControlPanel.js';
import { buildMvpApprovalGate, buildMvpApprovalGateCard } from '../src/engine/status/mvpApprovalGate.js';
import { buildPlaytestVerdictCard, summarizePlaytestVerdictForState, parsePlaytestVerdict, PLAYTEST_VERDICT_FILE } from '../src/engine/status/playtestVerdict.js';
import {
  PLAYTEST_CHECKLIST_SECTIONS,
  PLAYTEST_SEVERITIES,
  PLAYTEST_CHECKLIST_WRITE_FILENAME,
  playtestItemCount,
} from './playtestChecklist.mjs';
import { PROFILES } from './testProfiles.mjs';
import { VERSION } from '../src/config.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const HTML_OUT = join(PUBLIC, 'continuum.html');
const JSON_OUT = join(PUBLIC, 'continuum-data.json');

// Read the doc sources safely — a missing/unreadable doc degrades to '' and the parser
// records the gap, so the build never fails on a doc hiccup (curated defaults survive).
function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); }
  catch { return ''; }
}

const SOURCES = ['progress.md', 'todo.md'];
const progressMd = readSafe('progress.md');
const todoMd = readSafe('todo.md');
const { overrides, taskTotals, parsed, gaps } = deriveContinuumData({ progressMd, todoMd });

// Engineering-health: GENERATE the deterministic fields at build time (profile file
// counts from the test-profile registry, the full test-file count on disk, the parser-gap
// count from this run, and a real version/doc-sync check), then let buildHealthModel layer
// the LAST-KNOWN values (total tests, timings, bundle baseline, last green gate) under
// clear provenance chips. Falls back to the curated CONTINUUM.health if anything is absent.
function countTestFiles() {
  try { return readdirSync(join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js')).length; }
  catch { return null; }
}
const docsInSync = [progressMd, todoMd].every((d) => d.includes(VERSION));
const health = buildHealthModel({
  version: VERSION,
  profiles: { fast: PROFILES.fast.length, foundation: PROFILES.foundation.length },
  fullFileCount: countTestFiles(),
  parserGaps: gaps.length,
  docsInSync,
  lastKnown: HEALTH_LASTKNOWN,
});

// Deployment readiness (v0.2.186) — run the v0.2.185 read-only zone-fallback guard over the
// required docs + the dist/ present AT PACKAGING TIME (build:continuum runs before vite
// build, so dist/ may be the previous build or absent — the verdict is honest either way:
// no dist → "build check pending"). The authoritative dist check is regression-check [15].
function readDocSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}
function distPathsAtPackaging() {
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) return null; // null → dist check SKIPPED (no build yet)
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(distDir, p).replace(/\\/g, '/'));
    }
  };
  walk(distDir);
  return out;
}
const readinessDocs = {};
for (const name of REQUIRED_FALLBACK_DOCS) {
  const text = readDocSafe(name);
  if (typeof text === 'string') readinessDocs[name] = text;
}
const distPaths = distPathsAtPackaging();
// Read index.html + any /zone/<slug>/index.html directory-index shell bodies so the guard
// can verify the intentional v0.2.243 shells are byte-identical to index.html (not treated
// as fallback shadows). Only the HTML entry + zone shells are read — not every asset.
function distShellContents(paths) {
  if (!Array.isArray(paths)) return undefined;
  const distDir = join(ROOT, 'dist');
  const out = {};
  for (const rel of paths) {
    const norm = rel.replace(/\\/g, '/');
    if (norm === 'index.html' || /^zone\/[a-z0-9]+(?:-[a-z0-9]+)*\/index\.html$/.test(norm)) {
      try { out[`/${norm}`] = readFileSync(join(distDir, norm), 'utf8'); } catch { /* skip unreadable */ }
    }
  }
  return out;
}
const zoneFallback = checkZoneFallbackReadiness({
  docs: readinessDocs,
  dist: distPaths ? { paths: distPaths, contents: distShellContents(distPaths) } : {},
});
const readiness = buildReadinessModel({ zoneFallback });

// Ship readiness (v0.2.188) — fold the LIVE release-readiness verdict (the same signals
// `npm run release:status` shows: version sync, test profiles, the regression gate, advisory
// bundle, /zone/* fallback, docs consistency) into the dashboard's ship-readiness section so
// project oversight shows the last gate posture + the next safe task at a glance. The gather
// is read-only/network-free (git is best-effort); on any failure we degrade to the curated
// LAST-KNOWN snapshot rather than break the build.
let ship;
try {
  ship = buildShipModel({ readiness: gatherReleaseReadiness(ROOT) });
} catch (e) {
  ship = buildShipModel(); // honest LAST-KNOWN fallback
  console.log(`[continuum] ship readiness: live gather unavailable (${e.message}) — using last-known`);
}

// RC / release-manifest status (v0.2.214) — surface the LOCAL release-candidate artifact posture
// on the dashboard, DERIVED (not re-gated) from existing helpers/constants: stat each release-
// manifest REQUIRED/OPTIONAL ref + RC package-doc ref on disk for a present count, fold in the
// curated test count + profile summary, the always-pending manual-validation count, and the last
// local release-gate verdict (the ship model gathered above). Cheap file-presence only — no
// crypto, no git, no network — and it reuses the frozen ref lists so it can never drift from the
// release-manifest / rc-snapshot CLIs. On any failure we degrade to the curated LAST-KNOWN card.
let rcStatus;
try {
  const presentCount = (refs) => refs.filter((r) => existsSync(join(ROOT, r.file))).length;
  const reqPresent = presentCount(RELEASE_MANIFEST_REQUIRED);
  const optPresent = presentCount(RELEASE_MANIFEST_OPTIONAL);
  const rcDocsPresent = presentCount(RC_SNAPSHOT_DOC_REFS);
  const manifestStatus = reqPresent === RELEASE_MANIFEST_REQUIRED.length ? 'COMPLETE' : 'INCOMPLETE';
  rcStatus = buildRcStatusModel({
    version: VERSION,
    testLabel: testCountLabel(CURRENT_TEST_STATUS),
    profileSummary: `fast ~${CURRENT_TEST_STATUS.fastProfile} · foundation ~${CURRENT_TEST_STATUS.foundationProfile} · full`,
    manifest: {
      status: manifestStatus,
      requiredPresent: reqPresent,
      required: RELEASE_MANIFEST_REQUIRED.length,
      optionalPresent: optPresent,
      optional: RELEASE_MANIFEST_OPTIONAL.length,
    },
    rcDocs: { present: rcDocsPresent, total: RC_SNAPSHOT_DOC_REFS.length },
    manualValidationRemaining: RC_SNAPSHOT_MANUAL_VALIDATION.length,
    gateStatusLabel: ship.statusLabel,
  });
} catch (e) {
  rcStatus = buildRcStatusModel(); // honest LAST-KNOWN fallback
  console.log(`[continuum] rc status: live gather unavailable (${e.message}) — using last-known`);
}

// Manual-validation / MVP-playtest readiness (v0.2.215) — surface the one thing the LOCAL
// automated gates can NOT prove: that a human must still run the live-browser MVP playtest and
// explicitly approve. DERIVED (not re-gated) from existing helpers/constants: the playtest-
// checklist section/item counts + severity tallies (tools/playtestChecklist.mjs), the on-disk
// presence of the checklist + results-template docs, the highest-level manual validation areas
// (the RC-snapshot live-browser steps), and the already-gathered last local gate verdict. Cheap
// file-presence only — no crypto, no git, no network — and it reuses the frozen lists so it can
// never drift from the playtest-checklist CLI. On any failure we degrade to the curated card.
let manualValidation;
try {
  const sectionList = PLAYTEST_CHECKLIST_SECTIONS;
  const allItems = sectionList.flatMap((s) => s.items || []);
  const sevCount = (sev) => allItems.filter((it) => it.severity === sev).length;
  manualValidation = buildManualValidationModel({
    sections: sectionList.length,
    items: playtestItemCount(),
    blocker: sevCount('blocker'),
    major: sevCount('major'),
    minor: sevCount('minor'),
    validationAreas: RC_SNAPSHOT_MANUAL_VALIDATION.length,
    checklistDocPresent: existsSync(join(ROOT, PLAYTEST_CHECKLIST_WRITE_FILENAME)),
    resultsTemplatePresent: existsSync(join(ROOT, 'MVP_PLAYTEST_RESULTS_TEMPLATE.md')),
    gateStatusLabel: ship.statusLabel,
  });
} catch (e) {
  manualValidation = buildManualValidationModel(); // honest LAST-KNOWN fallback
  console.log(`[continuum] manual validation: live gather unavailable (${e.message}) — using last-known`);
}

// No-blocker queue (v0.2.216): the safe next move an AI agent can pick up with NO user input vs the
// one item parked on the human. DERIVED from the SAME parsed todo.md/progress.md taskTotals the rest
// of the dashboard already uses (no second source of truth) plus the curated next SAFE task and a
// manual-pending flag read off the manual-validation card. Pure data — no fs/crypto/git/network here
// beyond what taskTotals already gathered. On any failure we degrade to the curated card.
let noBlockerQueue;
try {
  noBlockerQueue = buildNoBlockerQueueModel({
    nextSafeTitle: SHIP_NEXT_SAFE_TASK.title,
    nextSafeWhy: SHIP_NEXT_SAFE_TASK.why,
    nextSafeKind: SHIP_NEXT_SAFE_TASK.kind,
    activeNow: taskTotals.activeNow,
    nextUp: taskTotals.next12,
    archiveClusters: taskTotals.archiveClusters,
    completed24h: taskTotals.completed24h,
    todoCompletedMarkers: taskTotals.todoCompletedMarkers,
    manualPending: manualValidation.pill !== 'no-blocker',
  });
} catch (e) {
  noBlockerQueue = buildNoBlockerQueueModel(); // honest LAST-KNOWN fallback
  console.log(`[continuum] no-blocker queue: live gather unavailable (${e.message}) — using last-known`);
}

// MVP approval (v0.2.221): the single auditable approval gate. Read MVP_APPROVAL_STATE.json,
// re-shape it through buildApprovalState (so a garbled/partial record is coerced to a safe pending
// posture and can never silently render as approved) + summarizeApprovalForState (which uses the
// strict isApproved() floor), and fold it into the dashboard card. Cheap file read only — no crypto,
// no git, no network. On any failure (missing/unparseable file) we degrade to the curated pending card.
let mvpApproval;
try {
  const raw = JSON.parse(readFileSync(join(ROOT, MVP_APPROVAL_FILE), 'utf8'));
  const summary = summarizeApprovalForState(buildApprovalState(raw));
  mvpApproval = buildMvpApprovalModel({
    status: summary.status,
    approved: summary.approved,
    version: summary.version,
    approvedBy: summary.approvedBy,
    approvedAt: summary.approvedAt,
  });
} catch (e) {
  mvpApproval = buildMvpApprovalModel(); // honest LAST-KNOWN pending fallback
  console.log(`[continuum] mvp approval: live gather unavailable (${e.message}) — using last-known`);
}

// MVP playtest results state (v0.2.223): whether the actual manual playtest results have been
// recorded (MVP_PLAYTEST_RESULTS.md) and what they said. Read the source-controlled recording file,
// summarise it through the pure summarizePlaytestForState (which defaults to not-run on a blank/
// garbled file and pins approvalImplied false), and fold it into the dashboard card. Cheap file read
// only — no crypto, no git, no network. On any failure (missing/unreadable file) we degrade to the
// curated NOT-RUN card. This card can never imply approval — that stays the separate MVP-approval gate.
let playtestResults;
try {
  const text = readFileSync(join(ROOT, PLAYTEST_RESULTS_STATE_FILE), 'utf8');
  const summary = summarizePlaytestForState(text);
  playtestResults = buildPlaytestResultsCardModel({
    status: summary.status,
    ran: summary.ran,
    total: summary.total,
    pass: summary.counts.pass,
    fail: summary.counts.fail,
    na: summary.counts.na,
    blank: summary.counts.blank,
    other: summary.counts.other,
    fails: summary.fails,
  });
} catch (e) {
  playtestResults = buildPlaytestResultsCardModel(); // honest LAST-KNOWN not-run fallback
  console.log(`[continuum] playtest results: live gather unavailable (${e.message}) — using last-known`);
}

// Handoff / release control panel (v0.2.233) — the ONE read-only surface a fresh agent or human reads
// first to pick up the project safely. Built from the SAME pure module the next-action-state CLI uses
// (src/engine/status/handoffControlPanel.js), folding already-gathered signals: the committed app-entry
// + oversight-dashboard cloud smokes (LIVE_SMOKE_STATE.json / DASHBOARD_SMOKE_STATE.json, re-shaped so a
// hand-edited file is normalised), the manual-validation card's blocker pill, the MVP-approval posture,
// and the curated next safe task. GREEN-REQUIRES-EVIDENCE + non-religious-ethics floors live in the pure
// module. Cheap file reads only — no crypto, no git, no network. On any failure we degrade to the curated
// LAST-KNOWN card baked into continuumData.js.
let handoffPanel;
try {
  const liveSmokeRaw = readDocSafe(LIVE_SMOKE_FILE);
  const dashSmokeRaw = readDocSafe(DASHBOARD_SMOKE_FILE);
  const parse = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const ls = parse(liveSmokeRaw);
  const ds = parse(dashSmokeRaw);
  const liveSmokeState = ls
    ? buildLiveSmokeState({ result: ls.result, version: ls.version, commit: ls.commit, liveUrl: ls.liveUrl, smokedAt: ls.smokedAt, smokedBy: ls.smokedBy, checks: ls.checks, notes: ls.notes })
    : buildLiveSmokeState({ result: LIVE_SMOKE_RESULTS.UNKNOWN, version: VERSION });
  const dashSmokeState = ds
    ? buildDashboardSmokeState({ result: ds.result, version: ds.version, commit: ds.commit, dashboardUrl: ds.dashboardUrl, surface: ds.surface, smokedAt: ds.smokedAt, smokedBy: ds.smokedBy, checks: ds.checks, notes: ds.notes })
    : buildDashboardSmokeState({ result: DASHBOARD_SMOKE_RESULTS.UNKNOWN, version: VERSION });
  const panel = buildHandoffControlPanel({
    version: VERSION,
    liveUrl: HANDOFF_LIVE_URL,
    dashboardUrl: HANDOFF_DASHBOARD_URL,
    entrySmoke: summarizeLiveSmokeForState(liveSmokeState),
    dashboardSmoke: summarizeDashboardSmokeForState(dashSmokeState),
    manualBlocker: { pending: manualValidation.pill !== 'no-blocker', statusLabel: manualValidation.statusLabel, pill: manualValidation.pill },
    mvpApproval: { approved: mvpApproval.approved === true, status: mvpApproval.status },
    nextSafeTask: SHIP_NEXT_SAFE_TASK,
  });
  handoffPanel = buildHandoffControlPanelCard(panel);
} catch (e) {
  handoffPanel = undefined; // fall back to the curated CURATED_HANDOFF_PANEL in continuumData.js
  console.log(`[continuum] handoff panel: live gather unavailable (${e.message}) — using last-known`);
}

// MVP approval gate (v0.2.234) — the rubric that keeps an automated green run from being mistaken
// for human game-feel approval. Built from the SAME pure module the next-action-state CLI uses
// (src/engine/status/mvpApprovalGate.js), folding already-gathered signals: the release-readiness
// verdict (ship.ready), the committed app-entry + oversight-dashboard cloud smoke passes, the curated
// test count, and the MVP-approval record. APPROVAL-REQUIRES-EXPLICIT-OK lives in the pure module: the
// gate reads approved ONLY when the approval record carries an explicit human OK. Cheap file reads only
// — no crypto, no git, no network. On any failure we degrade to the curated CURATED_MVP_GATE card.
let mvpGate;
try {
  const lsRaw = readDocSafe(LIVE_SMOKE_FILE);
  const dsRaw = readDocSafe(DASHBOARD_SMOKE_FILE);
  const parseJson = (raw) => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };
  const lsj = parseJson(lsRaw);
  const dsj = parseJson(dsRaw);
  const lsState = lsj
    ? buildLiveSmokeState({ result: lsj.result, version: lsj.version, commit: lsj.commit, liveUrl: lsj.liveUrl, smokedAt: lsj.smokedAt, smokedBy: lsj.smokedBy, checks: lsj.checks, notes: lsj.notes })
    : buildLiveSmokeState({ result: LIVE_SMOKE_RESULTS.UNKNOWN, version: VERSION });
  const dsState = dsj
    ? buildDashboardSmokeState({ result: dsj.result, version: dsj.version, commit: dsj.commit, dashboardUrl: dsj.dashboardUrl, surface: dsj.surface, smokedAt: dsj.smokedAt, smokedBy: dsj.smokedBy, checks: dsj.checks, notes: dsj.notes })
    : buildDashboardSmokeState({ result: DASHBOARD_SMOKE_RESULTS.UNKNOWN, version: VERSION });
  const gate = buildMvpApprovalGate({
    version: VERSION,
    releaseReady: ship.ready === true,
    entrySmokePass: summarizeLiveSmokeForState(lsState).pass === true,
    dashboardSmokePass: summarizeDashboardSmokeForState(dsState).pass === true,
    tests: { passing: CURRENT_TEST_STATUS.passing, files: CURRENT_TEST_STATUS.files },
    approval: { approved: mvpApproval.approved === true, status: mvpApproval.status, approvedBy: mvpApproval.approvedBy, approvedAt: mvpApproval.approvedAt },
  });
  mvpGate = buildMvpApprovalGateCard(gate);
} catch (e) {
  mvpGate = undefined; // fall back to the curated CURATED_MVP_GATE in continuumData.js
  console.log(`[continuum] mvp approval gate: live gather unavailable (${e.message}) — using last-known`);
}

// MVP playtest verdict (v0.2.235) — the one-line tester report ("MVP OK" / "blockers: …"). Read the
// source-controlled MVP_PLAYTEST_VERDICT.md, parse it through the pure summarizePlaytestVerdictForState
// (blank/garbled → pending; approvalImplied pinned false), and fold it into the dashboard card so any
// reported blocker stays visible. Cheap file read only — no crypto, no git, no network. On any failure
// we degrade to the curated CURATED_PLAYTEST_VERDICT card. A verdict NEVER implies approval.
let playtestVerdict;
try {
  const text = readDocSafe(PLAYTEST_VERDICT_FILE);
  playtestVerdict = buildPlaytestVerdictCard(summarizePlaytestVerdictForState(parsePlaytestVerdict(text == null ? '' : text)));
} catch (e) {
  playtestVerdict = undefined; // fall back to the curated CURATED_PLAYTEST_VERDICT in continuumData.js
  console.log(`[continuum] playtest verdict: live gather unavailable (${e.message}) — using last-known`);
}

// Stamp the packaged build time so the page can show when the data was packaged.
const generatedAt = new Date().toISOString();
const model = {
  ...buildContinuumModel({ ...overrides, health, readiness, ship, rcStatus, manualValidation, noBlockerQueue, mvpApproval, mvpGate, playtestResults, playtestVerdict, handoffPanel, taskTotals, derived: { parsed, gaps, sources: SOURCES } }),
  generatedAt,
};

mkdirSync(PUBLIC, { recursive: true });
writeFileSync(HTML_OUT, renderContinuumPage(model), 'utf8');
writeFileSync(JSON_OUT, JSON.stringify(continuumDataJSON(model), null, 2) + '\n', 'utf8');

console.log(`[continuum] wrote ${HTML_OUT}`);
console.log(`[continuum] wrote ${JSON_OUT}`);
console.log(`[continuum] version ${model.version} · packaged ${generatedAt}`);
console.log(`[continuum] derived from ${SOURCES.join(' + ')}: ${parsed.length ? parsed.join(', ') : 'nothing'}`);
console.log(`[continuum] parser gaps (kept curated): ${gaps.length ? gaps.length : 'none'}`);
for (const g of gaps) console.log(`[continuum]   gap: ${g}`);
console.log(`[continuum] health: profiles fast ${PROFILES.fast.length}/foundation ${PROFILES.foundation.length}, full ${countTestFiles()} files, docs ${docsInSync ? 'in sync' : 'DRIFT'}`);
console.log(`[continuum] readiness: ${readiness.statusLabel} (zone-fallback ${zoneFallback.ok ? 'ok' : 'FAIL'}; dist ${distPaths ? 'checked' : 'skipped — no build yet'})`);
console.log(`[continuum] ship readiness: ${ship.statusLabel} (${ship.kind})${ship.blockers && ship.blockers.length ? ` blockers: ${ship.blockers.join(', ')}` : ''}`);
console.log(`[continuum] rc status: ${rcStatus.statusLabel} (${rcStatus.kind}) · manifest ${rcStatus.manifestStatus} ${rcStatus.manifestRequiredPresent}/${rcStatus.manifestRequired} req · rc-docs ${rcStatus.rcDocsPresent}/${rcStatus.rcDocsTotal}`);
console.log(`[continuum] manual validation: ${manualValidation.statusLabel} (${manualValidation.kind}) · checklist ${manualValidation.sections} sections/${manualValidation.items} items · ${manualValidation.blocker}/${manualValidation.major}/${manualValidation.minor} b/M/m · areas ${manualValidation.validationAreas}`);
console.log(`[continuum] no-blocker queue: ${noBlockerQueue.statusLabel} (${noBlockerQueue.kind}) · active ${noBlockerQueue.activeNow} · next ${noBlockerQueue.nextUp} · archive ${noBlockerQueue.archiveClusters} · done24h ${noBlockerQueue.completed24h} · manualPending ${noBlockerQueue.manualPending}`);
console.log(`[continuum] mvp approval: ${mvpApproval.statusLabel} (${mvpApproval.kind}) · status ${mvpApproval.status} · approved ${mvpApproval.approved} · version ${mvpApproval.version}`);
console.log(`[continuum] handoff panel: ${model.handoffPanel.statusLabel} (${model.handoffPanel.kind}) · green ${model.handoffPanel.green} · pill ${model.handoffPanel.pill}`);
console.log(`[continuum] mvp approval gate: ${model.mvpGate.statusLabel} (${model.mvpGate.kind}) · verdict ${model.mvpGate.verdict} · approved ${model.mvpGate.approved} · pill ${model.mvpGate.pill}`);
console.log(`[continuum] playtest results: ${playtestResults.statusLabel} (${playtestResults.kind}) · status ${playtestResults.status} · recorded ${playtestResults.ran} · ${playtestResults.counts.pass}/${playtestResults.counts.fail}/${playtestResults.counts.blank} p/f/b of ${playtestResults.total} · implies approval ${playtestResults.approvalImplied}`);
console.log(`[continuum] playtest verdict: ${model.playtestVerdict.statusLabel} (${model.playtestVerdict.kind}) · verdict ${model.playtestVerdict.verdict} · ${model.playtestVerdict.blockerCount} blocker(s) · pill ${model.playtestVerdict.pill}`);
