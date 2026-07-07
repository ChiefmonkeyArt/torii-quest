// tools/nextActionState.mjs — PURE, node-safe NEXT-ACTION STATE assembly + formatting
// (v0.2.217). Flattens the EXISTING agent-handoff export (tools/agentHandoff.mjs) — which
// already composes the handoff-summary brief + the MVP-readiness rollup — plus the
// manual-validation card and the curated test count into ONE compact, machine-readable
// next-action state a fresh agent (GPT / Claude / DeepSeek / other) can read in a single
// glance to pick up the safe pipeline WITHOUT re-deriving the posture from every tool:
// current version, source commit, live URL, the next SAFE no-blocker task, the manual-blocker
// flag, the last-known test count, release readiness, and the docs pointers.
//
// This is NOT a second task list: every field is FOLDED from an existing source the CLI
// already gathers (buildAgentHandoff + buildManualValidationModel + CURRENT_TEST_STATUS), so
// it can never drift into a parallel source of truth. Build-time only; never imported by the
// game.
//
// Pure + deterministic: NO fs, NO network, NO child_process, NO process in here. The CLI
// (tools/next-action-state.mjs) does the fs/git I/O and hands plain inputs to these helpers, so
// the assembly/formatting is fully unit-testable (tests/next-action-state.*.test.js). The --write
// target confinement reuses resolveHandoffWritePath() from handoffSummary.mjs (no second
// boundary).

import { sourceCommitLabel } from './commitStamp.mjs';
import { summarizeApprovalForState } from './mvpApproval.mjs';
import { summarizePlaytestForState } from './playtestResultsState.mjs';
import { summarizeLiveSmokeForState } from './liveSmokeState.mjs';
import { summarizeDashboardSmokeForState } from './dashboardSmokeState.mjs';
import { summarizeHandoffControlPanelForState, WORKFLOW_INVARIANTS } from '../src/engine/status/handoffControlPanel.js';
import { summarizeMvpApprovalGateForState } from '../src/engine/status/mvpApprovalGate.js';
import { summarizePlaytestVerdictForState } from '../src/engine/status/playtestVerdict.js';

// Badge naming the export as read-only oversight, never a deploy/publish/upload action.
export const NEXT_ACTION_STATE_BADGE = 'NEXT-ACTION STATE · LOCAL · READ-ONLY';

// Stable schema id + integer version for the machine-readable artifact. Bump on a breaking
// shape change.
export const NEXT_ACTION_STATE_SCHEMA = 'torii.next-action-state';
export const NEXT_ACTION_STATE_SCHEMA_VERSION = 1;

// Default in-repo filename for the opt-in --write export — a standalone JSON artifact that sits
// beside the curated docs so a fresh agent can act immediately.
export const NEXT_ACTION_STATE_WRITE_FILENAME = 'NEXT_ACTION_STATE.json';

// _str(x) → trimmed string or null. _int(x) → integer or null. _bool(x) → strict boolean.
// Defensive helpers; never throw.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function _int(x) { return Number.isInteger(x) ? x : null; }
function _bool(x) { return x === true; }

// buildNextActionState(inputs) → a plain, JSON-serialisable next-action state. All inputs are
// plain data supplied by the CLI:
//   agentHandoff      a buildAgentHandoff() export, or null/garbled → degrades to honest nulls
//   manualValidation  a buildManualValidationModel() card, or null → manual blocker 'unknown'
//   testStatus        { passing, files } last-known test count (CURRENT_TEST_STATUS)
//   docs              string[] of docs pointers a next agent should read (defaults to [])
//   mvpApproval       a MVP_APPROVAL_STATE.json record (buildApprovalState shape), or null →
//                     status 'unknown'. Folded so a future approval flips ONE state source.
//   playtestResults   raw results markdown OR a summarizePlaytestResults() summary for the canonical
//                     MVP_PLAYTEST_RESULTS.md, or null → status 'unknown'. Folded via
//                     summarizePlaytestForState so the next agent can see whether the human playtest
//                     has actually been RECORDED — and it can never imply approval.
//   generatedAt       OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                     reproducible tests; the CLI passes a real stamp at print time.
export function buildNextActionState({
  agentHandoff = null, manualValidation = null, testStatus = null,
  docs = null, mvpApproval = null, playtestResults = null, playtestVerdict = null, liveSmoke = null,
  dashboardSmoke = null, handoffControlPanel = null, mvpGate = null,
  workflowInvariants = WORKFLOW_INVARIANTS, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const ah = agentHandoff && typeof agentHandoff === 'object' && !Array.isArray(agentHandoff)
    ? agentHandoff : null;
  const mv = manualValidation && typeof manualValidation === 'object' && !Array.isArray(manualValidation)
    ? manualValidation : null;
  const ts = testStatus && typeof testStatus === 'object' && !Array.isArray(testStatus)
    ? testStatus : null;

  const gate = (ah && ah.gate && typeof ah.gate === 'object') ? ah.gate : {};
  const reg = (gate.regression && typeof gate.regression === 'object') ? gate.regression : {};
  const readiness = (ah && ah.readiness && typeof ah.readiness === 'object') ? ah.readiness : {};
  const task = (ah && ah.nextSafeTask && typeof ah.nextSafeTask === 'object') ? ah.nextSafeTask : {};

  // The manual blocker: the ONE thing local automated gates cannot prove (a human must run the
  // live-browser MVP playtest + approve). Derived from the manual-validation card's pill — the
  // SAME signal the Continuum dashboard uses (manualValidation.pill !== 'no-blocker').
  const manualPill = mv ? _str(mv.pill) : null;
  const manualBlocker = {
    pending: manualPill ? manualPill !== 'no-blocker' : null,
    statusLabel: mv ? (_str(mv.statusLabel) || null) : null,
    pill: manualPill,
  };

  return {
    schema: NEXT_ACTION_STATE_SCHEMA,
    schemaVersion: NEXT_ACTION_STATE_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: NEXT_ACTION_STATE_BADGE,
    version: ah ? _str(ah.version) : null,
    packageVersion: ah ? _str(ah.packageVersion) : null,
    gitCommit: ah ? _str(ah.gitCommit) : null,
    liveUrl: ah ? _str(ah.liveUrl) : null,
    release: {
      ready: _bool(gate.ready),
      gateStatus: _str(gate.statusLabel) || 'UNKNOWN',
      gateCommand: _str(gate.gateCommand) || 'npm run test:release',
      blockers: Array.isArray(gate.blockers) ? gate.blockers.slice() : [],
      regression: {
        count: _int(reg.count),
        expected: _int(reg.expected),
      },
    },
    readiness: {
      pct: _int(readiness.pct),
      status: _str(readiness.status) || 'UNKNOWN',
    },
    tests: {
      passing: ts ? _int(ts.passing) : null,
      files: ts ? _int(ts.files) : null,
    },
    manualBlocker,
    // MVP approval — the single auditable record of whether a human has EXPLICITLY approved the
    // live-browser MVP. Folded from MVP_APPROVAL_STATE.json so a future approval flips one state
    // source, not scattered docs. `approved` is strict (invalid/partial "approved" → false).
    mvpApproval: summarizeApprovalForState(mvpApproval),
    // MVP playtest results — whether the human playtest has actually been RECORDED in the canonical
    // MVP_PLAYTEST_RESULTS.md (not-run / incomplete / attention / complete) + counts. `approvalImplied`
    // is pinned false: a recorded playtest is necessary but NOT sufficient for approval.
    playtestResults: summarizePlaytestForState(playtestResults),
    // MVP playtest verdict — the one-line tester report ("MVP OK" / "blockers: …") read from the
    // canonical MVP_PLAYTEST_VERDICT.md. Folded so every reported blocker stays VISIBLE here.
    // `approvalImplied` is pinned false: a tester verdict is a confidence signal, not approval.
    playtestVerdict: summarizePlaytestVerdictForState(playtestVerdict),
    // Live smoke — the latest cloud-browser smoke of the DEPLOYED site (the posture local gates can
    // never prove). Folded from LIVE_SMOKE_STATE.json so the next agent sees whether production was
    // actually observed green. `impliesApproval` is pinned false: a green smoke is not MVP approval.
    liveSmoke: summarizeLiveSmokeForState(liveSmoke),
    // Dashboard smoke — the latest cloud-browser smoke of the DEPLOYED oversight dashboard
    // (continuum.html): the page loaded and visibly rendered the version, the folded live-smoke
    // evidence, and the active slice. Folded from DASHBOARD_SMOKE_STATE.json so the next agent sees
    // whether the oversight surface itself was observed live. `impliesApproval` and
    // `impliesPlaytestComplete` are pinned false: a green dashboard smoke is neither.
    dashboardSmoke: summarizeDashboardSmokeForState(dashboardSmoke),
    // Handoff control panel — the one-glance pickup posture, folded from the SAME pure module the
    // Continuum dashboard renders ([[handoff-control-panel]]). `green` is true ONLY when the panel
    // carries a current version, both live URLs, passing entry- + dashboard-smoke evidence, an
    // explicit manual-blocker boolean, and non-religious ethics copy. green ≠ MVP approved.
    controlPanel: summarizeHandoffControlPanelForState(handoffControlPanel),
    // MVP approval gate — the rubric that keeps automated green from being mistaken for human game-
    // feel approval, folded from the SAME pure module the Continuum dashboard renders
    // ([[mvp-approval-gate]]). `approved` is true ONLY when the approval record carries an explicit
    // human OK; green confidence signals never flip it. impliesApproval is pinned false.
    mvpGate: summarizeMvpApprovalGateForState(mvpGate),
    // Standing workflow invariants — process rules a future agent/human must honour regardless of
    // release state. The first entry is the do-not-cancel-useful-jobs rule; the rest are its
    // explicit exceptions (explicit user cancel, immediate conflict, safely resumable, stale/hung &
    // already shipped). Carried verbatim from the SAME pure module the dashboard renders
    // ([[handoff-control-panel]]) so the rule text never drifts between page, CLI, and JSON. These
    // are workflow guidance ONLY: they imply no approval, deployment, or runtime behaviour change.
    workflowInvariants: Array.isArray(workflowInvariants)
      ? workflowInvariants.filter((s) => _str(s)).map((s) => s.trim())
      : Array.from(WORKFLOW_INVARIANTS),
    nextSafeTask: {
      title: _str(task.title),
      why: _str(task.why),
      kind: _str(task.kind),
    },
    constraints: ah && Array.isArray(ah.constraints) ? ah.constraints.slice() : [],
    docs: Array.isArray(docs) ? docs.filter((d) => _str(d)).map((d) => d.trim()) : [],
    reports: ah && Array.isArray(ah.latestReports) ? ah.latestReports.slice() : [],
    // Standing safety posture — this artifact is read-only oversight; it NEVER triggers a
    // deploy/publish/push/tag/network/Nostr write, and gameplay godMode stays false. Pinned
    // false so a reviewer can confirm the slice changed no runtime behaviour.
    safety: {
      deploy: false, publish: false, push: false, tag: false,
      networkWrite: false, nostrWrite: false, godMode: false,
    },
  };
}

// NEXT_ACTION_STATE_REQUIRED_KEYS — the keys a consumer (or guard test) can assert are always
// present, regardless of how degraded the inputs are. buildNextActionState never omits these.
export const NEXT_ACTION_STATE_REQUIRED_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'badge', 'version', 'gitCommit', 'liveUrl',
  'release', 'readiness', 'tests', 'manualBlocker', 'mvpApproval', 'playtestResults', 'playtestVerdict',
  'liveSmoke', 'dashboardSmoke', 'controlPanel', 'mvpGate', 'workflowInvariants',
  'nextSafeTask', 'docs', 'reports', 'safety',
]);

// formatNextActionState(state) → a concise multi-line text block for the terminal. Pure.
export function formatNextActionState(state) {
  if (!state || typeof state !== 'object') return 'next-action-state: (no state)';
  const r = state.release || {};
  const reg = r.regression || {};
  const rd = state.readiness || {};
  const mb = state.manualBlocker || {};
  const t = state.nextSafeTask || {};
  const L = [];
  L.push('Torii Quest — next-action state');
  L.push('─'.repeat(60));
  L.push(`${state.badge}`);
  if (state.generatedAt) L.push(`generated: ${state.generatedAt}`);
  L.push(`version:   ${state.version ?? '(unknown)'}  (pkg ${state.packageVersion ?? '?'})`);
  L.push(`source commit: ${sourceCommitLabel(state.gitCommit)}`);
  L.push(`live (manual deploy): ${state.liveUrl ?? '(unknown)'}`);
  L.push('');
  L.push(`release: ${r.gateStatus ?? 'UNKNOWN'}${r.ready ? '  ✓ READY' : ''}  (gate: ${r.gateCommand ?? '?'})`);
  if (r.blockers && r.blockers.length) L.push(`  blockers: ${r.blockers.join(', ')}`);
  L.push(`  regression: ${reg.count ?? '?'}/${reg.expected ?? '?'} checks`);
  L.push(`MVP readiness: ${rd.pct ?? '?'}% · ${rd.status ?? 'UNKNOWN'}`);
  L.push(`tests (last known): ${state.tests?.passing ?? '?'} passing / ${state.tests?.files ?? '?'} files`);
  const pendingStr = mb.pending === true ? 'PENDING' : (mb.pending === false ? 'clear' : 'unknown');
  L.push(`manual blocker: ${pendingStr}${mb.statusLabel ? ` (${mb.statusLabel})` : ''}`);
  const ap = state.mvpApproval || {};
  L.push(`MVP approval: ${ap.approved ? 'APPROVED' : (ap.status || 'unknown')}${ap.approvedBy ? ` by ${ap.approvedBy}` : ''}${ap.approvedAt ? ` @ ${ap.approvedAt}` : ''}`);
  const pr = state.playtestResults || {};
  L.push(`MVP playtest: ${pr.status || 'unknown'} (pending ${pr.pending ? 'yes' : 'no'}; implies approval: no)`);
  const pv = state.playtestVerdict || {};
  L.push(`MVP playtest verdict: ${pv.verdict || 'pending'}${pv.blockerCount ? ` — ${pv.blockerCount} blocker(s): ${(pv.blockers || []).join(', ')}` : ''} (implies approval: no)`);
  const ls = state.liveSmoke || {};
  L.push(`live smoke: ${ls.result || 'unknown'}${ls.pass ? ' ✓' : ''}${ls.version ? ` @ ${ls.version}` : ''} (${ls.passed ?? '?'}/${ls.checks ?? '?'} checks; implies approval: no)`);
  const ds = state.dashboardSmoke || {};
  L.push(`dashboard smoke: ${ds.result || 'unknown'}${ds.pass ? ' ✓' : ''}${ds.version ? ` @ ${ds.version}` : ''}${ds.surface ? ` (${ds.surface})` : ''} (${ds.passed ?? '?'}/${ds.checks ?? '?'} checks; implies approval: no)`);
  const cp = state.controlPanel || {};
  L.push(`handoff panel: ${cp.green ? 'COMPLETE ✓' : 'incomplete'} (version ${cp.version || '?'}; blocker ${cp.manualBlockerPending === true ? 'PENDING' : (cp.manualBlockerPending === false ? 'clear' : 'unknown')}; ethics non-religious: ${cp.ethicsNonReligious ? 'yes' : 'no'}; implies approval: no)`);
  const mg = state.mvpGate || {};
  L.push(`MVP approval gate: ${mg.approved ? 'APPROVED' : (mg.verdict || 'unknown')} (confidence ${mg.confidenceGreen ? 'green' : 'incomplete'}; needs explicit human OK; implies approval: no)`);
  const wi = Array.isArray(state.workflowInvariants) ? state.workflowInvariants : [];
  L.push('');
  L.push(`workflow invariants (${wi.length}; guidance only — implies approval/deploy: no):`);
  if (wi.length) { for (const inv of wi) L.push(`  • ${inv}`); }
  else L.push('  (none)');
  L.push('');
  L.push(`next safe task: ${t.title ?? '(none)'}`);
  if (t.why) L.push(`  why: ${t.why}`);
  if (t.kind) L.push(`  kind: ${t.kind}`);
  L.push('');
  L.push(state.docs && state.docs.length ? `docs: ${state.docs.join(', ')}` : 'docs: (none)');
  L.push(state.reports && state.reports.length ? `reports: ${state.reports.join(', ')}` : 'reports: (none found)');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatNextActionStateMarkdown(state) → a markdown export mirroring the JSON state. Pure.
export function formatNextActionStateMarkdown(state) {
  if (!state || typeof state !== 'object') return '# Next-action state\n\n_(no state)_\n';
  const r = state.release || {};
  const reg = r.regression || {};
  const rd = state.readiness || {};
  const mb = state.manualBlocker || {};
  const t = state.nextSafeTask || {};
  const pendingStr = mb.pending === true ? 'PENDING' : (mb.pending === false ? 'clear' : 'unknown');
  const L = [];
  L.push('# Torii Quest — next-action state (generated)');
  L.push('');
  L.push(`> ${state.badge}`);
  L.push('> Generated artifact — do NOT hand-edit. Folded from the agent-handoff export + the');
  L.push('> manual-validation card; the curated `torii-quest-handoff.md` stays the source of truth.');
  if (state.generatedAt) L.push(`> generated: ${state.generatedAt}`);
  L.push('');
  L.push(`- **Version:** ${state.version ?? '(unknown)'} (pkg ${state.packageVersion ?? '?'})`);
  L.push(`- **Source commit:** ${sourceCommitLabel(state.gitCommit)}`);
  L.push(`- **Live (manual deploy):** ${state.liveUrl ?? '(unknown)'}`);
  L.push(`- **Release:** ${r.gateStatus ?? 'UNKNOWN'}${r.ready ? ' (READY)' : ''} — gate \`${r.gateCommand ?? '?'}\``);
  if (r.blockers && r.blockers.length) L.push(`  - blockers: ${r.blockers.join(', ')}`);
  L.push(`- **Regression:** ${reg.count ?? '?'} / ${reg.expected ?? '?'} checks`);
  L.push(`- **MVP readiness:** ${rd.pct ?? '?'}% · ${rd.status ?? 'UNKNOWN'}`);
  L.push(`- **Tests (last known):** ${state.tests?.passing ?? '?'} passing / ${state.tests?.files ?? '?'} files`);
  L.push(`- **Manual blocker:** ${pendingStr}${mb.statusLabel ? ` — ${mb.statusLabel}` : ''}`);
  const ap = state.mvpApproval || {};
  L.push(`- **MVP approval:** ${ap.approved ? 'APPROVED' : (ap.status || 'unknown')}${ap.approvedBy ? ` by ${ap.approvedBy}` : ''}${ap.approvedAt ? ` @ ${ap.approvedAt}` : ''}`);
  const pr = state.playtestResults || {};
  L.push(`- **MVP playtest:** ${pr.status || 'unknown'} (pending ${pr.pending ? 'yes' : 'no'}; implies approval: no)`);
  const ls = state.liveSmoke || {};
  L.push(`- **Live smoke (deployed):** ${ls.result || 'unknown'}${ls.pass ? ' (PASS)' : ''}${ls.version ? ` @ ${ls.version}` : ''} — ${ls.passed ?? '?'}/${ls.checks ?? '?'} checks (implies approval: no)`);
  const ds = state.dashboardSmoke || {};
  L.push(`- **Dashboard smoke (deployed):** ${ds.result || 'unknown'}${ds.pass ? ' (PASS)' : ''}${ds.version ? ` @ ${ds.version}` : ''}${ds.surface ? ` — ${ds.surface}` : ''} — ${ds.passed ?? '?'}/${ds.checks ?? '?'} checks (implies approval: no)`);
  const cp = state.controlPanel || {};
  L.push(`- **Handoff control panel:** ${cp.green ? 'COMPLETE' : 'incomplete'} — version ${cp.version || '?'}; manual blocker ${cp.manualBlockerPending === true ? 'PENDING' : (cp.manualBlockerPending === false ? 'clear' : 'unknown')}; ethics non-religious: ${cp.ethicsNonReligious ? 'yes' : 'no'} (implies approval: no)`);
  const mg = state.mvpGate || {};
  L.push(`- **MVP approval gate:** ${mg.approved ? 'APPROVED' : (mg.verdict || 'unknown')} — confidence ${mg.confidenceGreen ? 'green' : 'incomplete'}; needs an explicit human OK (implies approval: no)`);
  L.push('');
  const wi = Array.isArray(state.workflowInvariants) ? state.workflowInvariants : [];
  L.push('## Workflow invariants');
  L.push('');
  L.push('_Process guidance only — implies no approval, deployment, or runtime change._');
  L.push('');
  if (wi.length) { for (const inv of wi) L.push(`- ${inv}`); }
  else L.push('_(none)_');
  L.push('');
  L.push('## Next safe task');
  L.push('');
  L.push(t.title ?? '_(none)_');
  if (t.why) { L.push(''); L.push(`_Why:_ ${t.why}`); }
  if (t.kind) { L.push(''); L.push(`_Kind:_ ${t.kind}`); }
  L.push('');
  L.push('## Docs pointers');
  L.push('');
  if (state.docs && state.docs.length) { for (const d of state.docs) L.push(`- ${d}`); }
  else L.push('_(none)_');
  L.push('');
  L.push('## Latest reports');
  L.push('');
  if (state.reports && state.reports.length) { for (const rep of state.reports) L.push(`- ${rep}`); }
  else L.push('_(none found)_');
  L.push('');
  return L.join('\n');
}
