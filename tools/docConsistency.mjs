// tools/docConsistency.mjs — PURE, node-safe docs/status consistency checks (v0.2.155).
// Keeps the continuity docs that AI/dev handoffs rely on (torii-quest-todo.md, torii-quest-progress.md,
// torii-quest-handoff.md, SDK_DEBUG_INDEX.md) from drifting away from the live runtime VERSION. Build-
// time only — never imported by the game; NO fs/network/THREE/DOM in here (the CLI/guard in
// regression-check does the fs I/O and hands plain {name → content} strings to these
// helpers). Deterministic + plain-data so the logic is unit-testable
// (tests/doc-consistency.test.js).
//
// Philosophy (per the v0.2.154 work order): make doc drift VISIBLE without blocking safe
// development unnecessarily. HARD FAIL only for clear current-version drift in the core
// continuity docs or a missing core file; everything else is an ADVISORY warning.

// The continuity docs that MUST carry the current version (hard fail if they drift). These
// are the cross-model handoff source-of-truth files.
export const CONTINUITY_DOCS = ['torii-quest-todo.md', 'torii-quest-progress.md', 'torii-quest-handoff.md'];

// Docs that SHOULD reference the current version but only warn if they lag (lower-churn,
// larger reference files where a one-version lag is not handoff-breaking).
export const ADVISORY_DOCS = ['SDK_DEBUG_INDEX.md', 'CODE_INDEX.md'];

// A version marker like `v0.2.154-alpha` (lowercase tag). Used to detect stale references.
const VERSION_MARKER = /v\d+\.\d+\.\d+-[a-z]+/gi;

// versionInText(version, text) → true iff the exact version string occurs in text. Pure.
export function versionInText(version, text) {
  if (typeof version !== 'string' || !version) return false;
  if (typeof text !== 'string') return false;
  return text.includes(version);
}

// findVersionMarkers(text) → every `vX.Y.Z-tag` marker found, in order (may repeat). Pure.
export function findVersionMarkers(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(VERSION_MARKER)].map((m) => m[0]);
}

// A "live/published/deployed … version <marker>" STATUS assertion — a `version` token
// sitting next to a version marker. Deliberately narrow so prose/task/changelog lines that
// merely mention "live" + a version (e.g. a deploy TODO) are NOT matched — only lines that
// actually assert a live/published version are.
const LIVE_VERSION_ASSERTION = /\bversion\b[^\n]{0,12}?(v\d+\.\d+\.\d+-[a-z]+)/i;

// Explanatory/changelog prose in these docs QUOTES the pattern it is describing — the
// version marker (or the `live/published version: vX` phrase) is wrapped in markdown inline
// code (backticks) or double quotes. A genuine STATUS line states the version plainly. So
// before scanning a line for a live-version assertion we blank out backtick-delimited and
// double-quoted spans: a real `Live published version: v0.2.113-alpha` survives and is
// flagged, while a changelog line that merely *mentions* `` `Live published version: …` ``
// or "live/published version: vX" loses its marker and is correctly ignored. (v0.2.155)
function stripQuotedSpans(line) {
  return line
    .replace(/`[^`]*`/g, ' ') // markdown inline-code spans
    .replace(/"[^"]*"/g, ' '); // double-quoted spans
}

// staleLiveVersionLines(text, version) → lines that ASSERT a "live"/"published"/"deployed"
// version marker that ISN'T the current one (e.g. a leftover `Live published version:
// v0.2.113-alpha`). ADVISORY: the deployed/live version can legitimately lag the dev
// VERSION, so this only warns — it flags lines worth a human glance, never fails. Pure.
export function staleLiveVersionLines(text, version) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!/\b(live|published|deployed)\b/i.test(line)) continue;
    const m = stripQuotedSpans(line).match(LIVE_VERSION_ASSERTION);
    if (m && version && m[1] !== version) out.push({ line, markers: [m[1]] });
  }
  return out;
}

// checkDocConsistency({ version, files, present }) → { ok, version, errors, warnings,
// checked }. Pure — operates only on the plain inputs it is given:
//   version: the current runtime VERSION string (e.g. 'v0.2.154-alpha')
//   files:   { '<docname>': '<file contents>' }  (omit/undefined = file unreadable)
//   present: { '<docname>': boolean }  optional explicit presence map; when a name is
//            absent from `present`, presence is inferred from whether `files[name]` is a
//            string. A core continuity doc that is missing is a HARD FAIL.
// `ok` is true iff there are zero errors. Warnings never affect `ok`.
export function checkDocConsistency({ version, files = {}, present = {} } = {}) {
  const errors = [];
  const warnings = [];
  const checked = [];

  const isPresent = (name) =>
    (name in present) ? !!present[name] : typeof files[name] === 'string';

  if (typeof version !== 'string' || !version) {
    errors.push('no current version provided to doc-consistency check');
    return { ok: false, version: version || null, errors, warnings, checked };
  }

  // 1. Core continuity docs: must exist AND carry the current version (HARD FAIL on drift).
  for (const name of CONTINUITY_DOCS) {
    checked.push(name);
    if (!isPresent(name)) { errors.push(`missing core doc: ${name}`); continue; }
    const text = files[name];
    if (typeof text !== 'string') { errors.push(`unreadable core doc: ${name}`); continue; }
    if (!versionInText(version, text)) {
      errors.push(`${name} does not reference current version ${version} (doc drift)`);
    }
  }

  // 2. Advisory docs: SHOULD reference the current version, but only WARN if they lag.
  for (const name of ADVISORY_DOCS) {
    if (!isPresent(name)) { warnings.push(`advisory doc not found: ${name}`); continue; }
    checked.push(name);
    const text = files[name];
    if (typeof text === 'string' && !versionInText(version, text)) {
      warnings.push(`${name} does not reference current version ${version} (advisory)`);
    }
  }

  // 3. Stale "live/published/deployed version: vX" contradiction lines across all supplied
  //    docs — ADVISORY only (deployed version may legitimately lag dev VERSION).
  for (const [name, text] of Object.entries(files)) {
    for (const { line } of staleLiveVersionLines(text, version)) {
      warnings.push(`${name}: stale live/published version line — "${truncate(line)}"`);
    }
  }

  return { ok: errors.length === 0, version, errors, warnings, checked };
}

function truncate(s, n = 100) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
