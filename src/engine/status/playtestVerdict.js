// src/engine/status/playtestVerdict.js — PURE, browser+node-safe MVP PLAYTEST VERDICT capture
// (v0.2.235). Companion to the verbose 17-item intake (tools/playtestResults.mjs) and the
// approval-requires-explicit-OK rubric ([[mvp-approval-gate]]). Those answer "what did each
// checklist item say?" and "what does approval require?"; this slice answers the tester's most
// practical question — "I just played the live build; how do I report the result in ONE line?".
//
// The capture surface is a terse, hand-edited verdict file (MVP_PLAYTEST_VERDICT.md). Chiefmonkey
// (or the user) writes exactly ONE of:
//     Verdict: MVP OK
//     Verdict: blockers: <comma/semicolon list of what is broken>
// and this module parses that line into a structured { verdict, blockers[] } the dashboard and the
// next-action state can render — keeping every reported blocker VISIBLE in the oversight surfaces.
//
// HARD INVARIANT (mirrors playtestResultsState.mjs): approvalImplied is pinned false in EVERY
// branch. A tester reporting "MVP OK" means "I found no blockers" — it is NECESSARY but NOT
// SUFFICIENT for MVP approval. The explicit user sign-off recorded in MVP_APPROVAL_STATE.json
// (approved + approver + timestamp, see tools/mvpApproval.mjs) is a separate, deliberate gate this
// verdict can never stand in for. nostrich, not ostrich.
//
// PURE + browser+node-safe: NO fs, NO network, NO child_process, NO process, NO THREE/DOM, no
// tools/ imports. The CLI (tools/playtest-verdict.mjs) does the read-only fs I/O and stamps
// version/commit, so this assembly stays unit-testable (tests/playtest-verdict.test.js). The
// dashboard (toriiQuestData.js) and the next-action state (tools/nextActionState.mjs) import it
// directly so the verdict vocabulary can never drift between the page and the CLI. Null/garbled
// input degrades to an honest `pending`; never throws.
import { MVP_PLAYTEST_FOCUS } from './mvpApprovalGate.js';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump on a breaking
// shape change.
export const PLAYTEST_VERDICT_SCHEMA = 'torii.playtest-verdict';
export const PLAYTEST_VERDICT_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only one-line verdict capture — never an automated
// run, never a deploy/publish action, and explicitly NOT an approval.
export const PLAYTEST_VERDICT_BADGE =
  'MVP PLAYTEST VERDICT · LOCAL · READ-ONLY · TESTER VERDICT ≠ MVP APPROVAL';

// The canonical, source-controlled capture file a tester fills in by hand. Ships BLANK, so a fresh
// checkout reads as `pending`.
export const PLAYTEST_VERDICT_FILE = 'MVP_PLAYTEST_VERDICT.md';

// Recognised verdicts, frozen so consumers can rely on the vocabulary:
//   pending — no recognised verdict line yet (the shipped default; tester has not reported)
//   ok      — tester reports NO blockers ("MVP OK" / "no blockers" / "all pass")
//   blocked — tester reports one or more blockers ("blockers: a, b, c")
export const PLAYTEST_VERDICTS = Object.freeze({ PENDING: 'pending', OK: 'ok', BLOCKED: 'blocked' });

// The exact one-liners a tester can use, surfaced verbatim in the capture file + dashboard so the
// "how do I report?" answer is unambiguous.
export const PLAYTEST_VERDICT_HOWTO = Object.freeze([
  'Report MVP OK (no blockers found): write a line `Verdict: MVP OK`.',
  'Report blockers: write a line `Verdict: blockers: <comma- or semicolon-separated list>`.',
  'Reporting a verdict NEVER approves the MVP — approval is the separate explicit step recorded in MVP_APPROVAL_STATE.json.',
]);

export const PLAYTEST_VERDICT_REQUIRED_KEYS = Object.freeze([
  'schema', 'schemaVersion', 'badge', 'verdict', 'blockers', 'blockerCount',
  'reported', 'reportedBy', 'reportedAt', 'approvalImplied', 'safety',
]);

// _str(x) → trimmed non-empty string or null. _arr → cleaned string array. Pure; never throw.
function _str(x) { return typeof x === 'string' && x.trim() ? x.trim() : null; }
function _arr(x) { return Array.isArray(x) ? x.filter((s) => _str(s)).map((s) => s.trim()) : []; }

// Tokens that mean "no blockers / clean" when they FOLLOW the `Verdict:` marker. Matched
// case-insensitively against the trimmed verdict body.
const OK_RE = /^(?:mvp\s+ok|ok|no\s+blockers?|all\s+(?:pass|good|clear)|clean|pass(?:ed)?)\b/i;
// `blocker`/`blockers` marker, optionally with a leading `mvp`, then the list after a colon/dash.
const BLOCKER_RE = /\bblockers?\b\s*[:\-–]?\s*(.*)$/i;

// splitBlockers(s) → a cleaned list from a comma/semicolon/newline/bullet-separated string. Pure.
function splitBlockers(s) {
  return _str(s)
    ? String(s)
        .split(/[;,\n]|(?:\s+[•\-*]\s+)/)
        .map((b) => b.replace(/^[\s•\-*]+/, '').trim())
        .filter((b) => b.length > 0)
    : [];
}

// parsePlaytestVerdict(text) → { schema, verdict, blockers[], reportedBy, reportedAt, raw }.
// Reads the FIRST recognised `Verdict:` line (tolerant of `**Verdict**`, leading `-`/`>` and case)
// plus optional `Reported by:` / `Date:` metadata lines. A blank/garbled file → `pending`. A
// `blockers:`/`blocker:` marker wins over an OK token, so "Verdict: blockers: none" stays blocked
// only if it actually lists something — an empty list degrades to `pending` (nothing reported yet).
// Pure; never throws.
export function parsePlaytestVerdict(text) {
  const t = (typeof text === 'string') ? text : '';
  const lines = t.split(/\r?\n/);
  let verdict = PLAYTEST_VERDICTS.PENDING;
  let blockers = [];
  let raw = null;
  let reportedBy = null;
  let reportedAt = null;

  for (const line of lines) {
    // Strip leading markdown noise (blockquote `>`, list `-`/`*`, and a table-row `|`) so a
    // `Verdict` reported in prose, a bullet, OR a `| Verdict | MVP OK |` table cell all parse.
    const trimmed = line.replace(/^[\s>\-*|]+/, '').trim();
    if (!trimmed) continue;

    const meta = trimmed.match(/^\**\s*(reported\s*by|tester|date)\s*\**\s*[:|]\s*(.+?)\s*\|?\s*$/i);
    if (meta) {
      const key = meta[1].toLowerCase();
      const val = _str(meta[2].replace(/\|/g, ' ').replace(/\*/g, ''));
      if (val) {
        if (key === 'date') reportedAt = reportedAt || val;
        else reportedBy = reportedBy || val;
      }
      continue;
    }

    const vm = trimmed.match(/^\**\s*verdict\s*\**\s*[:|]\s*(.*)$/i);
    if (!vm) continue;
    if (raw) continue; // first recognised Verdict line wins; keep scanning for metadata only
    const body = _str(vm[1].replace(/\|/g, ' ').replace(/\*/g, ''));
    if (!body) continue; // a blank `Verdict:` line is still pending
    raw = body;

    // OK synonyms win first — "no blockers" / "all clear" are clean verdicts even though they
    // contain the word "blockers". Only then does an actual `blockers: <list>` marker apply.
    if (OK_RE.test(body)) {
      verdict = PLAYTEST_VERDICTS.OK; blockers = [];
    } else {
      const bm = body.match(BLOCKER_RE);
      if (bm) {
        const list = splitBlockers(bm[1]);
        if (list.length) { verdict = PLAYTEST_VERDICTS.BLOCKED; blockers = list; }
        // `Verdict: blockers:` with nothing after it = nothing reported yet → stays pending.
      }
    }
  }

  return {
    schema: PLAYTEST_VERDICT_SCHEMA,
    verdict, blockers, raw, reportedBy, reportedAt,
  };
}

// summarizePlaytestVerdictForState(input) → ONE compact, JSON-serialisable verdict state a
// dashboard / next-action export can read. Accepts raw markdown text OR a parsePlaytestVerdict()
// result. HARD INVARIANT: approvalImplied is pinned false in every branch. Pure; null-safe.
export function summarizePlaytestVerdictForState(input) {
  const parsed = (typeof input === 'string')
    ? parsePlaytestVerdict(input)
    : (input && typeof input === 'object' && !Array.isArray(input) ? input : null);
  const verdict = parsed && typeof parsed.verdict === 'string'
    && Object.values(PLAYTEST_VERDICTS).includes(parsed.verdict)
    ? parsed.verdict : PLAYTEST_VERDICTS.PENDING;
  const blockers = _arr(parsed && parsed.blockers);
  return {
    schema: PLAYTEST_VERDICT_SCHEMA,
    schemaVersion: PLAYTEST_VERDICT_SCHEMA_VERSION,
    badge: PLAYTEST_VERDICT_BADGE,
    verdict,
    blockers,
    blockerCount: blockers.length,
    reported: verdict !== PLAYTEST_VERDICTS.PENDING,
    reportedBy: parsed ? _str(parsed.reportedBy) : null,
    reportedAt: parsed ? _str(parsed.reportedAt) : null,
    // HARD INVARIANT — a tester verdict is never an approval. Even `ok` only means "no blockers
    // found"; the explicit user sign-off in MVP_APPROVAL_STATE.json is the separate gate.
    approvalImplied: false,
    safety: { deploy: false, publish: false, push: false, tag: false, networkWrite: false, nostrWrite: false, godMode: false },
  };
}

// buildPlaytestVerdictCard(input) → a render-ready Continuum dashboard card. Accepts raw markdown,
// a parse result, or a state summary. Blockers render as a visible list with an `open-edge` pill so
// the oversight surface can never hide a reported blocker. Pure; reuses the shared .metric/.pill
// markup → no new script, no CSP-hash change.
export function buildPlaytestVerdictCard(input) {
  const s = (input && typeof input === 'object' && !Array.isArray(input) && 'blockerCount' in input)
    ? input : summarizePlaytestVerdictForState(input);

  let band; let statusLabel; let pill;
  if (s.verdict === PLAYTEST_VERDICTS.BLOCKED) {
    band = 'blocked';
    statusLabel = `BLOCKERS REPORTED (${s.blockerCount}) — TRIAGE BEFORE APPROVAL`;
    pill = 'open-edge';
  } else if (s.verdict === PLAYTEST_VERDICTS.OK) {
    band = 'ok';
    statusLabel = 'TESTER REPORTS MVP OK · EXPLICIT APPROVAL STILL REQUIRED';
    pill = 'manual';
  } else {
    band = 'pending';
    statusLabel = 'NO VERDICT RECORDED YET';
    pill = 'manual';
  }

  const metrics = [
    { label: 'Verdict', value: s.verdict === PLAYTEST_VERDICTS.OK ? 'MVP OK (no blockers reported)'
      : (s.verdict === PLAYTEST_VERDICTS.BLOCKED ? `BLOCKED — ${s.blockerCount} blocker(s)` : 'pending (not reported)') },
    { label: 'Blockers', value: s.blockers.length ? s.blockers.join(' · ') : 'none reported' },
    { label: 'Reported by', value: s.reportedBy ? `${s.reportedBy}${s.reportedAt ? ` @ ${s.reportedAt}` : ''}` : '(not recorded)' },
    { label: 'How to report', value: PLAYTEST_VERDICT_HOWTO.join(' · ') },
    { label: 'Focus to judge', value: Array.from(MVP_PLAYTEST_FOCUS).join(' · ') },
    { label: 'Implies approval', value: 'NO — a tester verdict is a confidence signal; approval is the separate explicit user OK in MVP_APPROVAL_STATE.json' },
  ];

  return {
    badge: PLAYTEST_VERDICT_BADGE,
    kind: s.reported ? 'generated' : 'last-known',
    band,
    statusLabel,
    pill,
    verdict: s.verdict,
    blockers: s.blockers.slice(),
    blockerCount: s.blockerCount,
    metrics,
    note: 'MVP playtest verdict — the one-line capture for the live-browser playtest. Chiefmonkey '
      + '(or the user) edits MVP_PLAYTEST_VERDICT.md to report ONE of "Verdict: MVP OK" or '
      + '"Verdict: blockers: <list>". Every reported blocker stays visible here and in '
      + 'NEXT_ACTION_STATE.json so it can be fed back into todo/progress. A verdict of MVP OK means '
      + 'the tester found no blockers — it is NOT MVP approval: approval is the separate explicit '
      + 'user step (approved + approver + timestamp in MVP_APPROVAL_STATE.json). This card '
      + 'approves/releases/deploys/publishes NOTHING.',
  };
}
