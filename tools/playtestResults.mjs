// tools/playtestResults.mjs — PURE, node-safe MVP MANUAL PLAYTEST RESULTS INTAKE assembly +
// formatting + a tolerant results-markdown parser/summary (v0.2.204). Companion to the v0.2.203
// playtest CHECKLIST (playtestChecklist.mjs): where the checklist says WHAT to test, this slice
// produces a structured BLANK RESULTS TEMPLATE a tester fills in — build/version, tester, date,
// environment, PASS/FAIL/N-A per checklist item, observed severity, repro notes, screenshot/video
// refs, and a recommended next action — plus a read-only parser/summary that folds a COMPLETED
// results markdown back into counts (pass/fail/blank) + the list of failing item ids, so failures
// can be fed into todo/progress/handoff without ambiguity.
//
// The template's item list is DERIVED from PLAYTEST_CHECKLIST_SECTIONS so the two stay in
// lock-step (single source of truth — add a checklist item and the results template grows).
//
// This is NOT a gameplay change and NOT a live browser test: pure + deterministic, NO fs, NO
// network, NO child_process, NO process, NO browser automation in here. The CLI
// (tools/playtest-results.mjs) does the fs/git I/O and stamps version/commit, so the assembly,
// formatting, and parsing stay unit-testable (tests/playtest-results.test.js). Null/garbled
// inputs degrade to honest defaults; never throws — the parser tolerates blanks by design.
import { PLAYTEST_CHECKLIST_SECTIONS, PLAYTEST_SEVERITIES } from './playtestChecklist.mjs';

// Stable schema ids + integer versions for the machine-readable (--json) modes. Bump the
// matching *_SCHEMA_VERSION on any breaking shape change.
export const PLAYTEST_RESULTS_SCHEMA = 'torii.playtest-results';
export const PLAYTEST_RESULTS_SCHEMA_VERSION = 1;
export const PLAYTEST_RESULTS_SUMMARY_SCHEMA = 'torii.playtest-results-summary';

// Badge naming the artifact as a local, read-only manual intake template — never an automated
// run, never a deploy/publish action.
export const PLAYTEST_RESULTS_BADGE = 'MVP PLAYTEST RESULTS INTAKE · LOCAL · READ-ONLY';

// Default in-repo filename for the opt-in --write blank template.
export const PLAYTEST_RESULTS_WRITE_FILENAME = 'MVP_PLAYTEST_RESULTS_TEMPLATE.md';

// The title shown atop the template.
export const PLAYTEST_RESULTS_TITLE = 'Torii Quest — MVP Manual Playtest Results';

// The recognised result values a tester records per item. Frozen so consumers can rely on order.
export const PLAYTEST_RESULT_VALUES = Object.freeze(['PASS', 'FAIL', 'N/A']);

// Header fields for the build/session block. Each { key, label, hint, prefill? }.
//   prefill: which model field (if any) pre-populates the value cell so the tester need not retype
//            the known build facts. Fields without a prefill are left blank for the tester.
export const PLAYTEST_RESULTS_META_FIELDS = Object.freeze([
  Object.freeze({ key: 'build', label: 'Build / version', hint: 'the version label shown on the title screen', prefill: 'version' }),
  Object.freeze({ key: 'commit', label: 'Commit', hint: 'short git commit, if known', prefill: 'gitCommit' }),
  Object.freeze({ key: 'liveUrl', label: 'Live URL', hint: 'the instance you tested', prefill: 'liveUrl' }),
  Object.freeze({ key: 'tester', label: 'Tester', hint: 'who ran the playtest', prefill: null }),
  Object.freeze({ key: 'date', label: 'Date', hint: 'when the playtest was run', prefill: null }),
  Object.freeze({ key: 'environment', label: 'Environment (browser / OS)', hint: 'e.g. Firefox 128 / Linux', prefill: null }),
  Object.freeze({ key: 'overall', label: 'Overall notes', hint: 'session-level observations', prefill: null }),
]);

// Per-item fields a tester fills for every checklist item. Each { key, label, hint }.
export const PLAYTEST_RESULTS_ITEM_FIELDS = Object.freeze([
  Object.freeze({ key: 'result', label: 'Result (PASS / FAIL / N/A)', hint: 'the recorded outcome' }),
  Object.freeze({ key: 'severity', label: 'Observed severity (if FAIL)', hint: 'blocker / major / minor' }),
  Object.freeze({ key: 'repro', label: 'Repro notes', hint: 'what actually happened + console' }),
  Object.freeze({ key: 'media', label: 'Screenshots / video', hint: 'file names or links' }),
  Object.freeze({ key: 'nextAction', label: 'Recommended next action', hint: 'what to do about it' }),
]);

// How-to-use guidance rendered atop the template so a first-time tester knows the protocol.
export const PLAYTEST_RESULTS_HOWTO = Object.freeze([
  'Run the MVP_PLAYTEST_CHECKLIST against the live build, then record each item\'s outcome here.',
  'Fill the Result cell with PASS, FAIL, or N/A (leave blank if not yet run). For a FAIL, record the observed severity, repro notes, any media, and a recommended next action.',
  'Feed every FAIL back into torii-quest-todo.md / torii-quest-progress.md / torii-quest-handoff.md by item id (e.g. AIM-2) so it is tracked unambiguously.',
  'This is a manual intake form — no browser automation is required or implied; nothing here runs or deploys anything.',
]);

// _str(x) → trimmed non-empty string, else null. Pure.
function _str(x) {
  return (typeof x === 'string' && x.trim()) ? x.trim() : null;
}

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// Total number of checklist items across all sections (the count of result rows in the template).
export function playtestResultsItemCount() {
  return PLAYTEST_CHECKLIST_SECTIONS.reduce((n, s) => n + s.items.length, 0);
}

// buildPlaytestResultsTemplate(inputs) → a plain, JSON-serialisable BLANK results template model.
// The item list is derived from PLAYTEST_CHECKLIST_SECTIONS (so it tracks the checklist). Inputs
// are plain data the CLI gathers; none are required:
//   version      config.js VERSION (e.g. 'v0.2.204-alpha'); pre-fills the Build/version field
//   gitCommit    short commit string, or null; pre-fills the Commit field
//   liveUrl      display URL for the live instance (NOT fetched); pre-fills the Live URL field
//   generatedAt  OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                reproducible tests; the CLI passes a real stamp at print time.
export function buildPlaytestResultsTemplate({
  version = null, gitCommit = null, liveUrl = null, generatedAt = null,
} = {}) {
  return {
    schema: PLAYTEST_RESULTS_SCHEMA,
    schemaVersion: PLAYTEST_RESULTS_SCHEMA_VERSION,
    generatedAt: _str(generatedAt),
    badge: PLAYTEST_RESULTS_BADGE,
    title: PLAYTEST_RESULTS_TITLE,
    manual: true,
    version: _str(version),
    gitCommit: _str(gitCommit),
    liveUrl: _str(liveUrl),
    resultValues: PLAYTEST_RESULT_VALUES.slice(),
    severities: PLAYTEST_SEVERITIES.slice(),
    howTo: PLAYTEST_RESULTS_HOWTO.slice(),
    metaFields: PLAYTEST_RESULTS_META_FIELDS.map((f) => ({ ...f })),
    itemFields: PLAYTEST_RESULTS_ITEM_FIELDS.map((f) => ({ ...f })),
    sections: PLAYTEST_CHECKLIST_SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      items: s.items.map((it) => ({
        id: it.id,
        title: it.title,
        severity: it.severity,
        expected: it.expected,
      })),
    })),
    itemCount: playtestResultsItemCount(),
    // Observed safety posture — all false in every run (this only ASSEMBLES a blank form; it runs
    // no automation, navigates nothing, and never serves/deploys/writes/networks).
    safety: {
      automated: false, served: false, navigated: false, deployed: false,
      published: false, wrote: false, network: false,
    },
    rendered: false,
    actionable: false,
  };
}

// Resolve a meta field's pre-filled value from the model, else '' (left blank for the tester).
function metaPrefill(model, field) {
  if (!field || !field.prefill) return '';
  const v = model[field.prefill];
  return _str(v) || '';
}

// formatPlaytestResultsTemplate(model) → a concise multi-line text block for the terminal.
// Pure; null-safe.
export function formatPlaytestResultsTemplate(model) {
  const m = _obj(model);
  if (!m) return 'playtest-results: (no template)';
  const L = [];
  L.push(`${m.title}`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`version: ${m.version ?? '(unknown)'}${m.gitCommit ? ` @ ${m.gitCommit}` : ''}`);
  if (m.liveUrl) L.push(`live: ${m.liveUrl}`);
  L.push(`items: ${m.itemCount} across ${Array.isArray(m.sections) ? m.sections.length : 0} sections  ·  results: ${(m.resultValues || []).join(' / ')}`);
  L.push('');
  L.push('How to use:');
  for (const h of (Array.isArray(m.howTo) ? m.howTo : [])) L.push(`  • ${h}`);
  L.push('');
  L.push('Build / session:');
  for (const f of (Array.isArray(m.metaFields) ? m.metaFields : [])) {
    const pre = metaPrefill(m, f);
    L.push(`  ${f.label}: ${pre || '____'}`);
  }
  L.push('');
  for (const s of (Array.isArray(m.sections) ? m.sections : [])) {
    L.push(`${s.title}:`);
    for (const it of (Array.isArray(s.items) ? s.items : [])) {
      L.push(`  [ ] ${it.id} (${it.severity}) — ${it.title}`);
      L.push(`        expect: ${it.expected}`);
      for (const f of (Array.isArray(m.itemFields) ? m.itemFields : [])) {
        L.push(`        ${f.label}: ____`);
      }
    }
    L.push('');
  }
  L.push('RESULTS INTAKE TEMPLATE ONLY — fill by hand; no browser automation, no network, no deploy.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatPlaytestResultsTemplateMarkdown(model) → a markdown BLANK results template suitable for
// MVP_PLAYTEST_RESULTS_TEMPLATE.md. Per item emits a heading + Expected + a Field/Value table
// whose Result row the parser can read back. Pure; null-safe.
export function formatPlaytestResultsTemplateMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# Playtest results\n\n_(no template)_\n';
  const L = [];
  L.push(`# ${m.title}`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Items:** ${m.itemCount} across ${Array.isArray(m.sections) ? m.sections.length : 0} sections`);
  L.push(`- **Result values:** ${(m.resultValues || []).join(' / ')}`);
  L.push(`- **Severities:** ${(m.severities || []).join(' / ')}`);
  L.push('');
  L.push('## How to use');
  L.push('');
  for (const h of (Array.isArray(m.howTo) ? m.howTo : [])) L.push(`- ${h}`);
  L.push('');
  L.push('## Build / session');
  L.push('');
  L.push('| Field | Value |');
  L.push('| --- | --- |');
  for (const f of (Array.isArray(m.metaFields) ? m.metaFields : [])) {
    L.push(`| ${f.label} | ${metaPrefill(m, f)} |`);
  }
  L.push('');
  for (const s of (Array.isArray(m.sections) ? m.sections : [])) {
    L.push(`## ${s.title}`);
    L.push('');
    for (const it of (Array.isArray(s.items) ? s.items : [])) {
      L.push(`### [ ] ${it.id} — ${it.title}  _(${it.severity})_`);
      L.push('');
      L.push(`_Expected:_ ${it.expected}`);
      L.push('');
      L.push('| Field | Value |');
      L.push('| --- | --- |');
      for (const f of (Array.isArray(m.itemFields) ? m.itemFields : [])) {
        L.push(`| ${f.label} |  |`);
      }
      L.push('');
    }
  }
  L.push('---');
  L.push('');
  L.push('_RESULTS INTAKE TEMPLATE ONLY — fill this in by hand after running the checklist. It ' +
    'runs no browser automation, reaches no network, and triggers no deploy/publish. Feed every ' +
    'FAIL back into torii-quest-todo.md / torii-quest-progress.md / torii-quest-handoff.md by item id. The parent agent owns security ' +
    'review, deploy, publish, push, and Space upload._');
  L.push('');
  return L.join('\n');
}

// classifyResult(raw) → 'pass' | 'fail' | 'na' | 'blank' | 'other'. Tolerant: strips markdown
// emphasis + a parenthetical hint like "(PASS / FAIL / N/A)" so an unfilled cell reads as blank.
// Pure.
function classifyResult(raw) {
  const s = _str(raw);
  if (!s) return 'blank';
  const cleaned = s
    .replace(/[*_`]/g, '')        // strip markdown emphasis
    .replace(/\([^)]*\)/g, '')    // strip a parenthetical hint
    .toUpperCase()
    .trim();
  if (!cleaned) return 'blank';
  if (/\bFAIL(ED|URE)?\b/.test(cleaned)) return 'fail';
  if (/\bPASS(ED)?\b/.test(cleaned)) return 'pass';
  if (/\bN\s*\/?\s*A\b/.test(cleaned)) return 'na';
  return 'other';
}

// Pull the inner cells of a markdown table row "| a | b |" → ['a','b']. Pure.
function tableCells(line) {
  const parts = line.split('|').map((c) => c.trim());
  // Drop the empty strings produced by leading/trailing pipes.
  if (parts.length && parts[0] === '') parts.shift();
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

// parsePlaytestResults(text) → { schema, items:[{id, result, raw}], total }. Tolerant, read-only,
// never throws. Recognises each item by its "### [ ] <ID> — …" heading and reads the Result row of
// that item's Field/Value table. A missing/blank Result cell classifies as 'blank' (NOT a failure).
export function parsePlaytestResults(text) {
  const t = (typeof text === 'string') ? text : '';
  const lines = t.split(/\r?\n/);
  const items = [];
  const headingRe = /^#{2,6}\s+(?:\[[ xX]?\]\s+)?([A-Z][A-Z0-9]*-\d+)\b/;
  let current = null;
  for (const line of lines) {
    const h = line.match(headingRe);
    if (h) {
      current = { id: h[1], result: 'blank', raw: null };
      items.push(current);
      continue;
    }
    if (!current) continue;
    const trimmed = line.trim();
    if (trimmed.startsWith('|')) {
      const cells = tableCells(trimmed);
      if (cells.length >= 2 && /^result\b/i.test(cells[0])) {
        current.raw = _str(cells[1]);
        current.result = classifyResult(cells[1]);
      }
    }
  }
  return {
    schema: PLAYTEST_RESULTS_SCHEMA,
    items: items.map(({ id, result, raw }) => ({ id, result, raw })),
    total: items.length,
  };
}

// summarizePlaytestResults(parsedOrText) → { schema, total, counts, fails, verdict }. Accepts
// either a parsePlaytestResults() result or raw markdown text. Pure; never throws.
//   counts   { total, pass, fail, na, blank, other }
//   fails    item ids whose result classified as 'fail' (feed these back into todo/progress)
//   verdict  EMPTY (no items) / INCOMPLETE (any blank or unrecognised) / ATTENTION (any fail) /
//            COMPLETE (every item recorded PASS or N/A with no failures)
export function summarizePlaytestResults(parsedOrText) {
  const parsed = (typeof parsedOrText === 'string')
    ? parsePlaytestResults(parsedOrText)
    : _obj(parsedOrText);
  const items = (parsed && Array.isArray(parsed.items)) ? parsed.items : [];
  const counts = { total: items.length, pass: 0, fail: 0, na: 0, blank: 0, other: 0 };
  const fails = [];
  for (const it of items) {
    const r = it && it.result;
    if (r === 'pass') counts.pass += 1;
    else if (r === 'fail') { counts.fail += 1; if (_str(it.id)) fails.push(it.id); }
    else if (r === 'na') counts.na += 1;
    else if (r === 'other') counts.other += 1;
    else counts.blank += 1;
  }
  let verdict;
  if (counts.total === 0) verdict = 'EMPTY';
  else if (counts.blank > 0 || counts.other > 0) verdict = 'INCOMPLETE';
  else if (counts.fail > 0) verdict = 'ATTENTION';
  else verdict = 'COMPLETE';
  return { schema: PLAYTEST_RESULTS_SUMMARY_SCHEMA, total: counts.total, counts, fails, verdict };
}

// formatPlaytestResultsSummary(summary) → a concise multi-line text block. Pure; null-safe.
export function formatPlaytestResultsSummary(summary) {
  const s = _obj(summary);
  if (!s) return 'playtest-results summary: (no summary)';
  const c = _obj(s.counts) || {};
  const L = [];
  L.push('Torii Quest — playtest results summary');
  L.push('─'.repeat(60));
  L.push(`verdict: ${s.verdict}`);
  L.push(`items: ${s.total}  ·  pass ${c.pass || 0} · fail ${c.fail || 0} · n/a ${c.na || 0} · blank ${c.blank || 0}${c.other ? ` · other ${c.other}` : ''}`);
  if (Array.isArray(s.fails) && s.fails.length) {
    L.push(`failing items (feed into todo/progress): ${s.fails.join(', ')}`);
  }
  L.push('─'.repeat(60));
  return L.join('\n');
}
