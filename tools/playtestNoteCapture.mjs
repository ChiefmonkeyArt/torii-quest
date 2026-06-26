// tools/playtestNoteCapture.mjs — PURE, node-safe MVP PLAYTEST NOTE-CAPTURE explainer (v0.2.224).
// Companion to the v0.2.204 results parser/summary (playtestResults.mjs) and the v0.2.222 state
// summary (playtestResultsState.mjs). Those answer "what did the playtest say?"; this slice answers
// the tester's next practical question — "I have rough notes; what is still blank and how do my
// notes map onto PASS / FAIL / N/A and the blocker/major/minor severities?" — WITHOUT guessing,
// fabricating results, or implying approval.
//
// It re-uses the canonical tolerant parser (parsePlaytestResults → per-item Result classification)
// and the canonical state summary (summarizePlaytestForState → status / counts / fails) so the
// vocabulary stays in lock-step, then layers a FIELD-COMPLETENESS pass on top: per item it reports
// which recommended follow-up fields (severity / repro / next action) are still blank, and it reads
// the Build/session header to flag missing build/tester/date/etc. The result is a concrete
// "what to fill in next" explainer a tester (or a later note-to-results conversion) can act on.
//
// PURE + node-safe: NO fs, NO network, NO child_process, NO process, NO THREE/DOM here. The CLI
// (tools/playtest-capture.mjs) does the read-only fs I/O and stamps version/commit, so this
// assembly stays unit-testable (tests/playtest-note-capture.test.js). Null/garbled inputs degrade
// to an honest empty explainer; never throws.
//
// HARD INVARIANT: approvalImplied is pinned false in every branch. A fully-recorded, all-PASS
// playtest is necessary but NOT sufficient for MVP approval — the explicit user "MVP approved"
// (MVP_APPROVAL_STATE.json) is a separate, deliberate gate. This explainer can never stand in for
// it. nostrich, not ostrich.
import {
  parsePlaytestResults, summarizePlaytestResults,
  PLAYTEST_RESULTS_META_FIELDS, PLAYTEST_RESULTS_ITEM_FIELDS,
} from './playtestResults.mjs';
import { summarizePlaytestForState } from './playtestResultsState.mjs';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump on a breaking
// shape change.
export const PLAYTEST_NOTE_CAPTURE_SCHEMA = 'torii.playtest-note-capture';
export const PLAYTEST_NOTE_CAPTURE_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only capture EXPLAINER — never an automated run, never
// a deploy/publish action, and explicitly NOT an approval.
export const PLAYTEST_NOTE_CAPTURE_BADGE =
  'MVP PLAYTEST NOTE CAPTURE · LOCAL · READ-ONLY · EXPLAINER ONLY · NOT AN APPROVAL';

// Per-item follow-up fields a FAIL should carry so the failure is actionable when fed back into
// todo/progress. `media` is genuinely optional, so it is NOT in the required-on-fail set.
export const CAPTURE_FOLLOWUP_FIELDS = Object.freeze(['severity', 'repro', 'nextAction']);
const CAPTURE_REQUIRED_ON_FAIL = Object.freeze(['severity', 'nextAction']);

// _str(x) → trimmed non-empty string, else null. Pure.
function _str(x) {
  return (typeof x === 'string' && x.trim()) ? x.trim() : null;
}

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// Normalise a markdown table label cell to a comparable key: strip emphasis + a parenthetical hint,
// lowercase, collapse whitespace. Mirrors the parser's tolerance so labels match the template. Pure.
function normLabel(raw) {
  const s = _str(raw);
  if (!s) return '';
  return s.replace(/[*_`]/g, '').replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// Build a { normalisedLabel → key } lookup from a field definition list. Pure.
function labelLookup(fields) {
  const map = new Map();
  for (const f of fields) map.set(normLabel(f.label), f.key);
  return map;
}
const META_BY_LABEL = labelLookup(PLAYTEST_RESULTS_META_FIELDS);
const ITEM_BY_LABEL = labelLookup(PLAYTEST_RESULTS_ITEM_FIELDS);

// Pull the inner cells of a markdown table row "| a | b |" → ['a','b']. Mirrors the parser. Pure.
function tableCells(line) {
  const parts = line.split('|').map((c) => c.trim());
  if (parts.length && parts[0] === '') parts.shift();
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// captureFields(text) → { meta:{key→filled bool}, items:{ id → {key→filled bool} } }. A tolerant,
// read-only pass that records WHICH labelled Field/Value rows carry a non-blank value. Meta rows are
// those before the first item heading; item rows are attributed to the most recent item heading.
// Never throws. Pure.
function captureFields(text) {
  const t = (typeof text === 'string') ? text : '';
  const lines = t.split(/\r?\n/);
  const headingRe = /^#{2,6}\s+(?:\[[ xX]?\]\s+)?([A-Z][A-Z0-9]*-\d+)\b/;
  const meta = {};
  const items = {};
  let current = null;
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) { current = h[1]; if (!items[current]) items[current] = {}; continue; }
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) continue;
    const cells = tableCells(trimmed);
    if (cells.length < 2) continue;
    const label = normLabel(cells[0]);
    const filled = _str(cells[1]) != null;
    if (current === null) {
      const key = META_BY_LABEL.get(label);
      if (key) meta[key] = filled;
    } else {
      const key = ITEM_BY_LABEL.get(label);
      if (key) items[current][key] = filled;
    }
  }
  return { meta, items };
}

// explainPlaytestCapture(text) → a compact, JSON-serialisable capture explainer. `text` is the
// results markdown (the hand-edited MVP_PLAYTEST_RESULTS.md), or null/garbled → an honest empty
// explainer. Returns:
//   {
//     schema, schemaVersion, badge,
//     status, ran, complete, pending, approvalImplied:false,
//     total, recorded, blank, counts, fails,
//     meta:   { filled:[keys], blank:[keys] },
//     items:  [ { id, result, recorded, missingFields:[keys], needsFollowup } ],
//     followups:[ids],            // FAIL items missing a required-on-fail field
//     nextSteps:[strings],        // concrete, ordered "what to fill in next" guidance
//     note
//   }
export function explainPlaytestCapture(text) {
  const parsed = parsePlaytestResults(typeof text === 'string' ? text : '');
  const summary = summarizePlaytestResults(parsed);
  const state = summarizePlaytestForState(summary);
  const fields = captureFields(text);

  const metaFilled = [];
  const metaBlank = [];
  for (const f of PLAYTEST_RESULTS_META_FIELDS) {
    (fields.meta[f.key] ? metaFilled : metaBlank).push(f.key);
  }

  const items = parsed.items.map((it) => {
    const recorded = it.result !== 'blank';
    const seen = fields.items[it.id] || {};
    let missingFields = [];
    let needsFollowup = false;
    if (it.result === 'fail') {
      missingFields = CAPTURE_FOLLOWUP_FIELDS.filter((k) => !seen[k]);
      needsFollowup = CAPTURE_REQUIRED_ON_FAIL.some((k) => !seen[k]);
    }
    return { id: it.id, result: it.result, recorded, missingFields, needsFollowup };
  });

  const recorded = items.filter((i) => i.recorded).length;
  const blank = items.length - recorded;
  const followups = items.filter((i) => i.needsFollowup).map((i) => i.id);

  const nextSteps = [];
  if (state.status === 'unknown') {
    nextSteps.push('No recognised checklist items found — start from MVP_PLAYTEST_RESULTS.md (or `npm run playtest:status -- --write`).');
  } else if (state.status === 'not-run') {
    nextSteps.push(`Record a Result (PASS / FAIL / N/A) for all ${items.length} items against the live build.`);
  } else {
    const blanks = items.filter((i) => !i.recorded).map((i) => i.id);
    if (blanks.length) nextSteps.push(`Record a Result for the ${blanks.length} unfilled item(s): ${blanks.join(', ')}.`);
    for (const id of followups) {
      const miss = items.find((i) => i.id === id).missingFields;
      nextSteps.push(`${id} FAILed — add the missing follow-up field(s): ${miss.join(', ')}.`);
    }
  }
  if (metaBlank.length) {
    nextSteps.push(`Fill the Build/session header — still blank: ${metaBlank.join(', ')}.`);
  }
  if (state.status === 'complete') {
    nextSteps.push('All items PASS / N/A — playtest is clean, but this is NOT an approval; the explicit user "MVP approved" is a separate gate.');
  }

  return {
    schema: PLAYTEST_NOTE_CAPTURE_SCHEMA,
    schemaVersion: PLAYTEST_NOTE_CAPTURE_SCHEMA_VERSION,
    badge: PLAYTEST_NOTE_CAPTURE_BADGE,
    status: state.status,
    ran: state.ran,
    complete: state.complete,
    pending: state.pending,
    // HARD INVARIANT: this explainer can never imply MVP approval. Pinned false in every branch.
    approvalImplied: false,
    total: items.length,
    recorded,
    blank,
    counts: state.counts,
    fails: state.fails,
    meta: { filled: metaFilled, blank: metaBlank },
    items,
    followups,
    nextSteps,
    note: 'Read-only capture explainer. No browser automation, no network, no deploy/publish, no approval. Feed every FAIL back into todo/progress/HANDOFF by item id.',
  };
}

// formatPlaytestCaptureExplain(explain) → a concise multi-line text block for a terminal / log.
// Pure; null-safe.
export function formatPlaytestCaptureExplain(explain) {
  const e = _obj(explain);
  if (!e) return 'playtest-note-capture: (no explainer)';
  const c = _obj(e.counts) || {};
  const L = [];
  L.push('Torii Quest — MVP playtest note-capture explainer');
  L.push('─'.repeat(60));
  L.push(`${e.badge}`);
  L.push(`status: ${e.status}  ·  pending: ${e.pending ? 'YES' : 'no'}  ·  implies approval: NO`);
  L.push(`items: ${e.total}  ·  recorded ${e.recorded} · blank ${e.blank}  ·  pass ${c.pass || 0} · fail ${c.fail || 0} · n/a ${c.na || 0}${c.other ? ` · other ${c.other}` : ''}`);
  if (Array.isArray(e.fails) && e.fails.length) L.push(`failing items: ${e.fails.join(', ')}`);
  const mb = _obj(e.meta) ? e.meta.blank : [];
  if (Array.isArray(mb) && mb.length) L.push(`build/session still blank: ${mb.join(', ')}`);
  L.push('');
  L.push('Mapping notes → results:');
  L.push('  • "works / good / ok"        → PASS');
  L.push('  • "broken / bug / crash"     → FAIL  (record severity: blocker / major / minor + next action)');
  L.push('  • "not applicable / skipped" → N/A');
  L.push('  • left blank                 → not recorded yet (status stays not-run / incomplete)');
  L.push('  • any FAIL                   → overall status ATTENTION until addressed');
  L.push('');
  if (Array.isArray(e.nextSteps) && e.nextSteps.length) {
    L.push('Next steps:');
    for (const s of e.nextSteps) L.push(`  • ${s}`);
  } else {
    L.push('Next steps: (none)');
  }
  L.push('─'.repeat(60));
  return L.join('\n');
}
