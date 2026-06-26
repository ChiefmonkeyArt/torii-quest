// tools/playtestResultsState.mjs — PURE, node-safe MVP PLAYTEST RESULTS STATE summary (v0.2.222).
// Companion to the v0.2.204 results parser/summarizer (playtestResults.mjs): where that folds a
// COMPLETED results markdown into pass/fail/blank counts + a coarse verdict, this slice maps that
// summary into ONE compact, pipeline-friendly STATE a dashboard / next-action export can read to
// answer a single question — "has the human MVP playtest actually been recorded, and what did it
// say?" — WITHOUT scattering notes or guessing.
//
// The canonical recording file is MVP_PLAYTEST_RESULTS.md (source-controlled, hand-edited by the
// tester). It ships BLANK, so a fresh checkout reads as `not-run` — the safe default. Crucially,
// this state NEVER implies approval: `approvalImplied` is pinned false in every branch. A fully
// PASS playtest is NECESSARY but NOT SUFFICIENT for MVP approval — the explicit user "MVP approved"
// (recorded in MVP_APPROVAL_STATE.json, see mvpApproval.mjs) is a separate, deliberate gate.
//
// PURE + node-safe: NO fs, NO network, NO child_process, NO process, NO THREE/DOM here. The CLI
// (tools/playtest-results-status.mjs) does the fs I/O and stamps version/commit, so this assembly
// stays unit-testable (tests/playtest-results-state.test.js). Null/garbled inputs degrade to an
// honest `unknown`; never throws.
import { summarizePlaytestResults } from './playtestResults.mjs';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump on a breaking
// shape change.
export const PLAYTEST_RESULTS_STATE_SCHEMA = 'torii.playtest-results-state';
export const PLAYTEST_RESULTS_STATE_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only manual-results state — never an automated run,
// never a deploy/publish action, and explicitly NOT an approval.
export const PLAYTEST_RESULTS_STATE_BADGE =
  'MVP PLAYTEST RESULTS · LOCAL · READ-ONLY · NOT RUN UNTIL TESTER RECORDS · NOT AN APPROVAL';

// The canonical, source-controlled recording file a tester fills in by hand. Distinct from the
// regenerated MVP_PLAYTEST_RESULTS_TEMPLATE.md: this one is committed and persists tester edits.
export const PLAYTEST_RESULTS_STATE_FILE = 'MVP_PLAYTEST_RESULTS.md';

// Recognised status values, frozen so consumers can rely on the vocabulary:
//   unknown    — no file / no recognised items (nothing to summarise)
//   not-run    — every item is blank (the shipped default; tester has not recorded anything)
//   incomplete — some items recorded, but at least one is still blank/unrecognised
//   attention  — every item recorded, but at least one FAIL (feed fails back into todo/progress)
//   complete   — every item recorded PASS or N/A with no failures (playtest itself is clean)
export const PLAYTEST_RESULTS_STATUSES = Object.freeze({
  UNKNOWN: 'unknown', NOT_RUN: 'not-run', INCOMPLETE: 'incomplete',
  ATTENTION: 'attention', COMPLETE: 'complete',
});

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// summarizePlaytestForState(input) → a compact, JSON-serialisable playtest-results state.
// `input` may be:
//   - a string of results markdown (parsed + summarised here), or
//   - a summarizePlaytestResults() result ({ counts, fails, verdict, total }), or
//   - null/garbled → degrades to `unknown`.
// Returns:
//   {
//     schema, schemaVersion, status, verdict,
//     ran, complete, pending, approvalImplied:false,
//     total, counts:{total,pass,fail,na,blank,other}, fails:[ids]
//   }
// `pending` is true unless the playtest is fully recorded clean (status 'complete'). `approvalImplied`
// is ALWAYS false — this state can never, by construction, stand in for an explicit MVP approval.
export function summarizePlaytestForState(input) {
  const summary = (typeof input === 'string')
    ? summarizePlaytestResults(input)
    : _obj(input);

  const counts = (summary && _obj(summary.counts)) ? summary.counts : null;
  const total = counts ? (Number.isInteger(counts.total) ? counts.total : 0) : 0;
  const c = {
    total,
    pass: counts && Number.isInteger(counts.pass) ? counts.pass : 0,
    fail: counts && Number.isInteger(counts.fail) ? counts.fail : 0,
    na: counts && Number.isInteger(counts.na) ? counts.na : 0,
    blank: counts && Number.isInteger(counts.blank) ? counts.blank : 0,
    other: counts && Number.isInteger(counts.other) ? counts.other : 0,
  };
  const fails = (summary && Array.isArray(summary.fails))
    ? summary.fails.filter((f) => typeof f === 'string' && f.trim()).map((f) => f.trim())
    : [];

  let status;
  if (!summary || total === 0) status = PLAYTEST_RESULTS_STATUSES.UNKNOWN;
  else if (c.blank === total) status = PLAYTEST_RESULTS_STATUSES.NOT_RUN;
  else if (c.fail > 0) status = PLAYTEST_RESULTS_STATUSES.ATTENTION;
  else if (c.blank > 0 || c.other > 0) status = PLAYTEST_RESULTS_STATUSES.INCOMPLETE;
  else status = PLAYTEST_RESULTS_STATUSES.COMPLETE;

  const complete = status === PLAYTEST_RESULTS_STATUSES.COMPLETE;
  const ran = status !== PLAYTEST_RESULTS_STATUSES.UNKNOWN
    && status !== PLAYTEST_RESULTS_STATUSES.NOT_RUN;

  return {
    schema: PLAYTEST_RESULTS_STATE_SCHEMA,
    schemaVersion: PLAYTEST_RESULTS_STATE_SCHEMA_VERSION,
    status,
    verdict: (summary && typeof summary.verdict === 'string') ? summary.verdict : 'EMPTY',
    ran,
    complete,
    pending: !complete,
    // HARD INVARIANT: the playtest result, whatever it says, NEVER implies MVP approval. Approval
    // is a separate explicit user gate (MVP_APPROVAL_STATE.json). Pinned false in every branch.
    approvalImplied: false,
    total,
    counts: c,
    fails,
  };
}

// _statusLabel(status) → a short human label for the coarse status. Pure.
function _statusLabel(status) {
  switch (status) {
    case PLAYTEST_RESULTS_STATUSES.NOT_RUN: return 'NOT RUN — tester has not recorded results yet';
    case PLAYTEST_RESULTS_STATUSES.INCOMPLETE: return 'INCOMPLETE — some items still blank';
    case PLAYTEST_RESULTS_STATUSES.ATTENTION: return 'ATTENTION — one or more FAIL recorded';
    case PLAYTEST_RESULTS_STATUSES.COMPLETE: return 'COMPLETE — all items PASS / N/A (still not an approval)';
    default: return 'UNKNOWN — nothing to summarise';
  }
}

// formatPlaytestResultsState(state) → a concise multi-line text block for a terminal / log.
// Pure; null-safe.
export function formatPlaytestResultsState(state) {
  const s = _obj(state);
  if (!s) return 'playtest-results-state: (no state)';
  const c = _obj(s.counts) || {};
  const L = [];
  L.push('Torii Quest — MVP playtest results state');
  L.push('─'.repeat(60));
  L.push(`${PLAYTEST_RESULTS_STATE_BADGE}`);
  L.push(`status: ${s.status}  ·  ${_statusLabel(s.status)}`);
  L.push(`pending: ${s.pending ? 'YES' : 'no'}  ·  ran: ${s.ran ? 'yes' : 'no'}  ·  implies approval: NO`);
  L.push(`items: ${s.total}  ·  pass ${c.pass || 0} · fail ${c.fail || 0} · n/a ${c.na || 0} · blank ${c.blank || 0}${c.other ? ` · other ${c.other}` : ''}`);
  if (Array.isArray(s.fails) && s.fails.length) {
    L.push(`failing items (feed into todo/progress): ${s.fails.join(', ')}`);
  }
  L.push('A recorded playtest is necessary but NOT sufficient — explicit user "MVP approved" is a separate gate.');
  L.push('─'.repeat(60));
  return L.join('\n');
}
