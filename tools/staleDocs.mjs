// tools/staleDocs.mjs — PURE, node-safe STALE-DOC DETECTOR (v0.2.191).
// Catches docs/status/version drift earlier and more clearly than the basic docConsistency
// guard: precise version-HEADER drift, a missing newest-report pointer, a report that lags the
// current version, and disagreeing test counts across the continuity docs. Build-time only —
// never imported by the game; NO fs/network/child_process/THREE/DOM in here (the CLI
// tools/stale-docs.mjs does the fs reads and hands plain {name → content} strings + a report
// filename list to these helpers). Deterministic + plain-data so the logic is unit-testable
// (tests/stale-docs.test.js).
//
// ADVISORY, not gated — see tools/stale-docs.mjs for why. The HARD gate stays the
// docConsistency check [14] (current-version drift in continuity docs / missing core doc);
// this detector adds finer, higher-recall signals that are better surfaced than enforced.
//
// It REUSES the proven docConsistency primitives (CONTINUITY_DOCS / findVersionMarkers /
// versionInText) rather than re-deriving them.
import { CONTINUITY_DOCS, findVersionMarkers, versionInText } from './docConsistency.mjs';

export { CONTINUITY_DOCS };

export const STALE_DOCS_BADGE = 'STALE-DOC DETECTOR · LOCAL · READ-ONLY · ADVISORY';

// A version HEADER/STATUS assertion: the word `version` immediately followed (within a short
// gap of ONLY separator/markup characters — no letters) by a version marker. This deliberately
// matches header lines like "Current version: **v0.2.191-alpha**" or "Current version: vX"
// while NOT matching changelog prose such as "runtime version drift fixed (v0.2.137)" where
// words sit between `version` and the marker. Mirrors docConsistency's narrow-assertion design.
const VERSION_HEADER_RE = /\bversion\b[\s:*|>#()\-–—]{0,12}(v\d+\.\d+\.\d+-[a-z]+)/i;

// Changelog/explanatory prose QUOTES the pattern it describes (backtick inline-code or double
// quotes). Blank those spans first so a quoted marker isn't mistaken for a live assertion.
function stripQuotedSpans(line) {
  return line.replace(/`[^`]*`/g, ' ').replace(/"[^"]*"/g, ' ');
}

// staleVersionHeaderLines(text, version) → [{ line, markers }] for HEADER lines whose cited
// version marker ISN'T the current one. Pure.
export function staleVersionHeaderLines(text, version) {
  if (typeof text !== 'string' || typeof version !== 'string' || !version) return [];
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const m = stripQuotedSpans(line).match(VERSION_HEADER_RE);
    if (m && m[1] !== version) out.push({ line, markers: [m[1]] });
  }
  return out;
}

// testCountsInText(text) → every "<N> passing" count (3–5 digits), as numbers, in order. Pure.
export function testCountsInText(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(/(\d{3,5})\s+passing\b/gi)].map((m) => Number(m[1]));
}

// reportVersionToken(version) → the version marker with the prerelease tag stripped, e.g.
// 'v0.2.191-alpha' → 'v0.2.191'. This is the token a slice's report filename carries
// (torii-v0.2.191-…-report.md). Returns null on bad input. Pure.
export function reportVersionToken(version) {
  if (typeof version !== 'string') return null;
  const m = version.match(/^v\d+\.\d+\.\d+/);
  return m ? m[0] : null;
}

function truncate(s, n = 110) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// detectStaleDocs({ version, docs, reports }) → { ok, version, badge, issues, counts, summary }.
// Pure — operates only on the plain inputs it is given:
//   version: current runtime VERSION string (e.g. 'v0.2.191-alpha')
//   docs:    { '<docname>': '<file contents>' } — continuity docs to scan
//   reports: string[] of report filenames, NEWEST FIRST (e.g. from mtime-sorted readdir)
// `issues` carry { level:'warn'|'error', doc, kind, detail }. `ok` is true iff there are no
// errors (the only error case is a missing current version); every drift signal is a WARNING,
// because this tool is advisory by design.
export function detectStaleDocs({ version, docs = {}, reports = [] } = {}) {
  const issues = [];
  const add = (level, doc, kind, detail) => issues.push({ level, doc, kind, detail });

  if (typeof version !== 'string' || !version) {
    add('error', null, 'no-version', 'no current version provided to stale-doc detector');
    return { ok: false, version: version || null, badge: STALE_DOCS_BADGE, issues, counts: { error: 1, warn: 0 }, summary: 'no current version' };
  }

  const docMap = docs && typeof docs === 'object' && !Array.isArray(docs) ? docs : {};
  const reportList = Array.isArray(reports) ? reports.filter((r) => typeof r === 'string') : [];

  // A. Version-HEADER drift in each continuity doc (precise — header lines only).
  for (const name of CONTINUITY_DOCS) {
    const text = docMap[name];
    if (typeof text !== 'string') { add('warn', name, 'doc-unavailable', `continuity doc not provided/readable: ${name}`); continue; }
    for (const { line, markers } of staleVersionHeaderLines(text, version)) {
      add('warn', name, 'version-header-drift', `version header cites ${markers.join(', ')}, not current ${version}: "${truncate(line)}"`);
    }
    // Belt-and-braces: a continuity doc that mentions NO current-version marker at all.
    if (!versionInText(version, text)) {
      add('warn', name, 'version-missing', `${name} does not mention current version ${version} anywhere`);
    }
  }

  // B. Newest report should be POINTED TO by a continuity doc (forgot-to-link guard).
  const newest = reportList.length ? reportList[0] : null;
  if (newest) {
    const linked = CONTINUITY_DOCS.some((n) => typeof docMap[n] === 'string' && docMap[n].includes(newest));
    if (!linked) add('warn', null, 'latest-report-unlinked', `newest report ${newest} is not referenced in any continuity doc`);

    // C. Newest report should be FOR the current version (report wasn't produced for this slice).
    const token = reportVersionToken(version);
    if (token && !newest.includes(token)) {
      add('warn', null, 'report-version-lag', `newest report ${newest} is not for current ${version} (expected one containing ${token})`);
    }
  } else {
    add('warn', null, 'no-reports', 'no torii-*report.md files found to cross-check');
  }

  // D. Test-count agreement across continuity docs (drift between dashboard copies).
  const counts = new Set();
  for (const name of CONTINUITY_DOCS) {
    for (const n of testCountsInText(docMap[name])) counts.add(n);
  }
  if (counts.size > 1) {
    add('warn', null, 'test-count-drift', `disagreeing test counts across continuity docs: ${[...counts].sort((a, b) => a - b).join(', ')} passing`);
  }

  const error = issues.filter((i) => i.level === 'error').length;
  const warn = issues.filter((i) => i.level === 'warn').length;
  const summary = warn === 0 && error === 0
    ? `no stale-doc drift detected for ${version}`
    : `${warn} advisory drift signal(s)${error ? `, ${error} error(s)` : ''} for ${version}`;
  return { ok: error === 0, version, badge: STALE_DOCS_BADGE, issues, counts: { error, warn }, summary };
}

// formatStaleDocs(report) → a concise text block for the terminal. Pure; safe on null.
export function formatStaleDocs(report) {
  if (!report || typeof report !== 'object') return 'stale-docs: (no report)';
  const L = [];
  L.push('Torii Quest — stale-doc detector');
  L.push('─'.repeat(60));
  L.push(report.badge || STALE_DOCS_BADGE);
  L.push(`version: ${report.version ?? '(unknown)'}`);
  L.push('');
  const issues = Array.isArray(report.issues) ? report.issues : [];
  if (issues.length === 0) {
    L.push('✓ no drift detected — docs look consistent.');
  } else {
    for (const i of issues) {
      const tag = i.level === 'error' ? '✗' : '·';
      const where = i.doc ? `${i.doc}: ` : '';
      L.push(`  ${tag} [${i.kind}] ${where}${i.detail}`);
    }
  }
  L.push('');
  L.push(report.summary || '');
  L.push('(advisory — does not gate; the hard gate is `npm run check` [14] docConsistency)');
  L.push('─'.repeat(60));
  return L.join('\n');
}
