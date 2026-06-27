// tools/next-action-state.mjs — local, read-only NEXT-ACTION STATE export CLI (v0.2.217).
// Run with: node tools/next-action-state.mjs  (or: npm run handoff:next).
// Produces the compact machine-readable next-action state a NEXT agent/model — GPT / Claude /
// DeepSeek / other — reads in one glance to pick up the safe MVP pipeline WITHOUT reading the
// whole repo: version, source commit, live URL, the next SAFE no-blocker task, the manual-blocker
// flag, the last-known test count, release readiness, and the docs pointers. The pure
// assembly/formatting lives in nextActionState.mjs (unit-tested); this file only does the fs/git
// I/O and COMPOSES the EXISTING buildAgentHandoff() + buildManualValidationModel() + the curated
// CURRENT_TEST_STATUS — it re-derives nothing and adds NO second task list.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout (canonical: pipe this; scripted
//                    npm consumers use `npm run --silent handoff:next -- --json`)
//   --markdown/--md  markdown export on stdout
//   --write[=path]   ALSO write the JSON state to a file (default NEXT_ACTION_STATE.json). This is
//                    the ONLY thing that writes — without --write the tool is read-only. The path
//                    is CONFINED inside the repo (resolveHandoffWritePath): an absolute path or a
//                    `..` escape is rejected (exit 2).
//
// NO network, NO secrets, NO install, NO build, and NO writes unless --write is given. git is
// best-effort (falls back to null). Always exits 0 otherwise — a VISIBILITY snapshot, not a gate.
import { readFileSync, writeFileSync, realpathSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatherReleaseReadiness } from './release-readiness.mjs';
import {
  buildHandoffSummary, resolveHandoffWritePath, HANDOFF_SUMMARY_LIVE_URL,
} from './handoffSummary.mjs';
import { buildAgentHandoff } from './agentHandoff.mjs';
import { CORE_DOCS } from './handoffStatus.mjs';
import {
  buildNextActionState, formatNextActionState, formatNextActionStateMarkdown,
  NEXT_ACTION_STATE_WRITE_FILENAME,
} from './nextActionState.mjs';
import {
  PLAYTEST_CHECKLIST_SECTIONS,
  PLAYTEST_CHECKLIST_WRITE_FILENAME,
  playtestItemCount,
} from './playtestChecklist.mjs';
import { RC_SNAPSHOT_MANUAL_VALIDATION } from './rcSnapshot.mjs';
import { buildManualValidationModel, CURRENT_TEST_STATUS } from '../src/engine/dashboard/continuumData.js';
import { runMvpReadiness } from '../src/engine/status/mvpReadiness.js';
import { buildApprovalState, MVP_APPROVAL_FILE, MVP_APPROVAL_STATUSES } from './mvpApproval.mjs';
import { parsePlaytestResults, summarizePlaytestResults } from './playtestResults.mjs';
import { PLAYTEST_RESULTS_STATE_FILE } from './playtestResultsState.mjs';
import { buildLiveSmokeState, LIVE_SMOKE_FILE, LIVE_SMOKE_RESULTS, summarizeLiveSmokeForState } from './liveSmokeState.mjs';
import { buildDashboardSmokeState, DASHBOARD_SMOKE_FILE, DASHBOARD_SMOKE_RESULTS, summarizeDashboardSmokeForState } from './dashboardSmokeState.mjs';
import { SHIP_NEXT_SAFE_TASK } from '../src/engine/dashboard/continuumData.js';
import { buildHandoffControlPanel, HANDOFF_LIVE_URL, HANDOFF_DASHBOARD_URL } from '../src/engine/status/handoffControlPanel.js';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function configVersion() {
  const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function packageVersion() {
  try { return JSON.parse(readSafe('package.json') || '{}').version || null; } catch { return null; }
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch { return null; }
}

// Derive the manual-validation card the SAME way tools/build-continuum.mjs does, so the
// manual-blocker flag can never drift from the Continuum dashboard. Cheap file-presence +
// frozen-constant reads only; degrades to the curated last-known card on any failure.
function gatherManualValidation(shipStatusLabel) {
  try {
    const allItems = PLAYTEST_CHECKLIST_SECTIONS.flatMap((s) => s.items || []);
    const sevCount = (sev) => allItems.filter((it) => it.severity === sev).length;
    return buildManualValidationModel({
      sections: PLAYTEST_CHECKLIST_SECTIONS.length,
      items: playtestItemCount(),
      blocker: sevCount('blocker'),
      major: sevCount('major'),
      minor: sevCount('minor'),
      validationAreas: RC_SNAPSHOT_MANUAL_VALIDATION.length,
      checklistDocPresent: existsSync(join(ROOT, PLAYTEST_CHECKLIST_WRITE_FILENAME)),
      resultsTemplatePresent: existsSync(join(ROOT, 'MVP_PLAYTEST_RESULTS_TEMPLATE.md')),
      gateStatusLabel: shipStatusLabel,
    });
  } catch { return buildManualValidationModel(); }
}

// Load the committed MVP approval state (re-shaped through buildApprovalState so a hand-edited
// file is normalised), or the default PENDING record if the artifact is missing/garbled. The
// state is read-only here — this tool never approves; it only FOLDS the record into the export.
function gatherMvpApproval() {
  const raw = readSafe(MVP_APPROVAL_FILE);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      return buildApprovalState({
        status: p.status, version: p.version, commit: p.commit,
        approved_by: p.approved_by, approved_at: p.approved_at, notes: p.notes,
      });
    } catch { /* fall through */ }
  }
  return buildApprovalState({ status: MVP_APPROVAL_STATUSES.PENDING, version: configVersion() });
}

// Load + summarise the canonical MVP_PLAYTEST_RESULTS.md so the export shows whether the human
// playtest has actually been recorded. Missing file → null (folds to status 'unknown'); a blank
// committed record folds to 'not-run'. Read-only; this tool never records results or approves.
function gatherPlaytestResults() {
  const text = readSafe(PLAYTEST_RESULTS_STATE_FILE);
  if (text == null) return null;
  return summarizePlaytestResults(parsePlaytestResults(text));
}

// Load the committed live-smoke state (re-shaped through buildLiveSmokeState so a hand-edited file
// is normalised), or the default UNKNOWN record if the artifact is missing/garbled. Read-only here
// — this tool never records a smoke; it only FOLDS the record into the export.
function gatherLiveSmoke() {
  const raw = readSafe(LIVE_SMOKE_FILE);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      return buildLiveSmokeState({
        result: p.result, version: p.version, commit: p.commit, liveUrl: p.liveUrl,
        smokedAt: p.smokedAt, smokedBy: p.smokedBy, checks: p.checks, notes: p.notes,
      });
    } catch { /* fall through */ }
  }
  return buildLiveSmokeState({ result: LIVE_SMOKE_RESULTS.UNKNOWN, version: configVersion() });
}

// Load the committed dashboard-smoke state (re-shaped through buildDashboardSmokeState so a hand-
// edited file is normalised), or the default UNKNOWN record if the artifact is missing/garbled.
// Read-only here — this tool never records a smoke; it only FOLDS the record into the export.
function gatherDashboardSmoke() {
  const raw = readSafe(DASHBOARD_SMOKE_FILE);
  if (raw) {
    try {
      const p = JSON.parse(raw);
      return buildDashboardSmokeState({
        result: p.result, version: p.version, commit: p.commit, dashboardUrl: p.dashboardUrl,
        surface: p.surface, smokedAt: p.smokedAt, smokedBy: p.smokedBy, checks: p.checks, notes: p.notes,
      });
    } catch { /* fall through */ }
  }
  return buildDashboardSmokeState({ result: DASHBOARD_SMOKE_RESULTS.UNKNOWN, version: configVersion() });
}

// docs pointers: the curated core docs that exist on disk + the generated handoff artifact.
function gatherDocs() {
  const out = [];
  for (const d of CORE_DOCS) { if (existsSync(join(ROOT, d))) out.push(d); }
  if (existsSync(join(ROOT, 'HANDOFF.generated.md'))) out.push('HANDOFF.generated.md');
  return out;
}

// Parse --write / --write=path → { write, path?, error? }. Default file is NEXT_ACTION_STATE.json.
// The target is CONFINED inside the repo via the pure resolveHandoffWritePath (shared boundary):
// an absolute path or a `..` escape is REJECTED. Without --write the tool stays read-only.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : NEXT_ACTION_STATE_WRITE_FILENAME;
  const resolved = resolveHandoffWritePath(raw, ROOT);
  if (!resolved.ok) return { write: true, path: null, error: resolved.error };
  return { write: true, path: resolved.path };
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const release = gatherReleaseReadiness(ROOT);
  const summary = buildHandoffSummary({
    version: configVersion(),
    packageVersion: packageVersion(),
    gitCommit: gitCommit(),
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    release,
    generatedAt: null,
  });
  let mvp = null;
  try { mvp = runMvpReadiness(); } catch { mvp = null; }

  const agentHandoff = buildAgentHandoff({ handoffSummary: summary, mvpReadiness: mvp, generatedAt: null });
  const manualValidation = gatherManualValidation(agentHandoff.gate.statusLabel);
  const mvpApproval = gatherMvpApproval();
  const liveSmoke = gatherLiveSmoke();
  const dashboardSmoke = gatherDashboardSmoke();

  // Build the handoff control panel from the SAME pure module the Continuum dashboard renders, so
  // the one-glance pickup posture folded here can never drift from the page. Read-only: it folds
  // already-gathered signals (smoke summaries, the manual-validation card, the next safe task).
  const handoffControlPanel = buildHandoffControlPanel({
    version: configVersion(),
    liveUrl: HANDOFF_LIVE_URL,
    dashboardUrl: HANDOFF_DASHBOARD_URL,
    entrySmoke: summarizeLiveSmokeForState(liveSmoke),
    dashboardSmoke: summarizeDashboardSmokeForState(dashboardSmoke),
    manualBlocker: {
      pending: manualValidation ? manualValidation.pill !== 'no-blocker' : null,
      statusLabel: manualValidation ? manualValidation.statusLabel : null,
      pill: manualValidation ? manualValidation.pill : null,
    },
    mvpApproval: mvpApproval
      ? { approved: mvpApproval.approved === true, status: mvpApproval.status }
      : null,
    nextSafeTask: SHIP_NEXT_SAFE_TASK,
  });

  const state = buildNextActionState({
    agentHandoff,
    manualValidation,
    testStatus: { passing: CURRENT_TEST_STATUS.passing, files: CURRENT_TEST_STATUS.files },
    docs: gatherDocs(),
    mvpApproval,
    playtestResults: gatherPlaytestResults(),
    liveSmoke,
    dashboardSmoke,
    handoffControlPanel,
    generatedAt: new Date().toISOString(),
  });

  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`next-action-state: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    writeFileSync(path, JSON.stringify(state, null, 2) + '\n', 'utf8');
    process.stderr.write(`next-action-state: wrote ${path}\n`);
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatNextActionStateMarkdown(state));
  } else {
    console.log('');
    console.log(formatNextActionState(state));
    console.log('');
  }
  process.exit(0);
}
