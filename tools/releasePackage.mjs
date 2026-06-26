// tools/releasePackage.mjs — PURE, node-safe MVP RELEASE-PACKAGE INDEX assembly + formatting.
// Produces a single discoverability INDEX for the MVP proof-of-concept candidate: one document
// that points humans and future agents at every relevant file (release notes draft, playtest
// checklist + results template, handoff briefs, progress/todo source-of-truth docs, update/VPS
// readiness, zone-fallback readiness) PLUS the current version / commit / test-count / live URL,
// the known non-blocking advisories, and the recommended next safe action. It re-derives no
// check — it only ASSEMBLES an index from plain data the CLI gathers.
//
// INDEX ONLY: this assembles text. It creates NO GitHub release, NO git tag, NO public
// announcement, and reaches NO network/server. Pure + deterministic: NO fs, NO network, NO
// child_process, NO process in here. The CLI (tools/release-package.mjs) does the fs/git I/O —
// including stat-ing each indexed file for a `present` map — and hands plain data to these
// helpers, so the assembly/formatting is unit-testable (tests/release-package.test.js).
// Null/garbled inputs degrade to honest UNKNOWNs; never throws.

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// RELEASE_PACKAGE_SCHEMA_VERSION on any breaking shape change.
export const RELEASE_PACKAGE_SCHEMA = 'torii.release-package';
export const RELEASE_PACKAGE_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only INDEX — never a release/tag/publish action.
export const RELEASE_PACKAGE_BADGE = 'MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY';

// Default in-repo filename for the opt-in --write markdown index.
export const RELEASE_PACKAGE_WRITE_FILENAME = 'MVP_RELEASE_PACKAGE.md';

// The product title shown atop the index.
export const RELEASE_PACKAGE_TITLE = 'Torii Quest — MVP Release Package';

// The curated index of relevant files, grouped by category. Frozen so a consumer can rely on
// the order; each entry is { key, file, label, category }. `key` is the stable id the CLI uses
// to inject a present/missing flag (it stat-s `file` relative to the repo root). This list is
// the only narrative the index carries that is NOT folded from a live signal — it is the
// hand-maintained map of the MVP proof package, updated as the package grows.
export const RELEASE_PACKAGE_ENTRIES = Object.freeze([
  Object.freeze({ key: 'release-notes', file: 'RELEASE_NOTES_DRAFT.md', label: 'MVP release notes (DRAFT)', category: 'Release & handoff' }),
  Object.freeze({ key: 'handoff-generated', file: 'HANDOFF.generated.md', label: 'Generated handoff brief (machine-written)', category: 'Release & handoff' }),
  Object.freeze({ key: 'handoff', file: 'HANDOFF.md', label: 'Handoff narrative (hand-maintained)', category: 'Release & handoff' }),
  Object.freeze({ key: 'playtest-checklist', file: 'MVP_PLAYTEST_CHECKLIST.md', label: 'MVP playtest checklist', category: 'Playtest' }),
  Object.freeze({ key: 'playtest-results', file: 'MVP_PLAYTEST_RESULTS_TEMPLATE.md', label: 'MVP playtest results template', category: 'Playtest' }),
  Object.freeze({ key: 'progress', file: 'progress.md', label: 'Progress dashboard (source of truth)', category: 'Status & planning' }),
  Object.freeze({ key: 'todo', file: 'todo.md', label: 'Task list (source of truth)', category: 'Status & planning' }),
  Object.freeze({ key: 'update-check', file: 'UPDATE_CHECK.md', label: 'Update-flow readiness notes', category: 'Ops readiness' }),
  Object.freeze({ key: 'vps-install', file: 'VPS_INSTALL.md', label: 'VPS install / deploy dry-run notes', category: 'Ops readiness' }),
  Object.freeze({ key: 'zone-fallback', file: 'ZONE_FALLBACK_READINESS.md', label: 'Zone (/zone/*) fallback readiness', category: 'Ops readiness' }),
]);

// The known, non-blocking advisories that ride along with the proof (never gate a release).
export const RELEASE_PACKAGE_ADVISORIES = Object.freeze([
  'The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).',
  'SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).',
  'This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.',
]);

// The recommended next safe action when none is injected — keeps the index actionable for the
// next agent without prescribing a network/deploy step.
export const RELEASE_PACKAGE_DEFAULT_NEXT_ACTION =
  'Run npm run check + npm run test:release to confirm all gates green, then hand the package to the parent agent for security review and deploy.';

// _str(x) → trimmed non-empty string, else null. Pure.
function _str(x) {
  return (typeof x === 'string' && x.trim()) ? x.trim() : null;
}

// _int(x) → integer, else null. Pure.
function _int(x) {
  return Number.isInteger(x) ? x : null;
}

// _obj(x) → a plain object, else null. Pure.
function _obj(x) {
  return (x && typeof x === 'object' && !Array.isArray(x)) ? x : null;
}

// _arr(x) → a shallow copy of an array, else []. Pure.
function _arr(x) {
  return Array.isArray(x) ? x.slice() : [];
}

// buildReleasePackageModel(inputs) → a plain, JSON-serialisable release-package INDEX model. All
// inputs are plain data the CLI gathers:
//   version       config.js VERSION (a 'vX.Y.Z-alpha' marker); or null
//   gitCommit     short commit string, or null
//   liveUrl       display URL for the live instance (NOT fetched)
//   testStatus    OPTIONAL { passing, files, profile } from the curated rollup — drives the
//                 test-count line
//   regression    OPTIONAL { count, expected } from the handoff gate — drives the gate line
//   advisories    OPTIONAL string[] override (defaults to RELEASE_PACKAGE_ADVISORIES)
//   nextAction    OPTIONAL recommended next safe action (defaults to the constant above)
//   reports       OPTIONAL string[] of recent report names (release/security)
//   present       OPTIONAL map { key: boolean } injected by the CLI from fs — marks which indexed
//                 files exist on disk. Absent/garbled → every entry reports present:null (unknown).
//   generatedAt   OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                 reproducible tests; the CLI passes a real stamp at print time.
export function buildReleasePackageModel({
  version = null, gitCommit = null, liveUrl = null,
  testStatus = null, regression = null,
  advisories = null, nextAction = null, reports = null,
  present = null, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const presentMap = _obj(present) || {};

  const entries = RELEASE_PACKAGE_ENTRIES.map((e) => {
    const has = Object.prototype.hasOwnProperty.call(presentMap, e.key)
      ? presentMap[e.key] === true
      : null;
    return { key: e.key, file: e.file, label: e.label, category: e.category, present: has };
  });

  const ts = _obj(testStatus);
  const tests = ts ? {
    passing: _int(ts.passing),
    files: _int(ts.files),
    profile: _str(ts.profile),
  } : null;

  const rg = _obj(regression);
  const reg = rg ? {
    count: _int(rg.count),
    expected: _int(rg.expected),
  } : null;

  const advList = _arr(advisories).map(String).filter(Boolean);
  const resolvedAdvisories = advList.length ? advList : RELEASE_PACKAGE_ADVISORIES.slice();

  const resolvedReports = _arr(reports).map(String).filter(Boolean);

  return {
    schema: RELEASE_PACKAGE_SCHEMA,
    schemaVersion: RELEASE_PACKAGE_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: RELEASE_PACKAGE_BADGE,
    title: RELEASE_PACKAGE_TITLE,
    index: true,
    version: _str(version),
    gitCommit: _str(gitCommit),
    liveUrl: _str(liveUrl),
    tests,
    regression: reg,
    entries,
    advisories: resolvedAdvisories,
    latestReports: resolvedReports,
    nextAction: _str(nextAction) || RELEASE_PACKAGE_DEFAULT_NEXT_ACTION,
    // Observed safety posture — all false in every run (the index only ASSEMBLES text; it
    // releases/tags/publishes/announces/serves/navigates/writes/networks nothing).
    safety: {
      released: false, tagged: false, published: false, announced: false,
      served: false, navigated: false, wrote: false, network: false,
    },
    rendered: false,
    actionable: false,
  };
}

// _presentMark(p) → a short status token for a present/missing/unknown flag. Pure.
function _presentMark(p) {
  if (p === true) return 'present';
  if (p === false) return 'MISSING';
  return 'unknown';
}

// _groupByCategory(entries) → ordered [ [category, entries[]], ... ] preserving first-seen order.
function _groupByCategory(entries) {
  const order = [];
  const map = new Map();
  for (const e of entries) {
    if (!map.has(e.category)) { map.set(e.category, []); order.push(e.category); }
    map.get(e.category).push(e);
  }
  return order.map((c) => [c, map.get(c)]);
}

// formatReleasePackage(model) → a concise multi-line text block for the terminal. Pure; null-safe.
export function formatReleasePackage(model) {
  const m = _obj(model);
  if (!m) return 'release-package: (no index)';
  const L = [];
  L.push(`${m.title} — release package index`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`version: ${m.version ?? '(unknown)'}${m.gitCommit ? ` @ ${m.gitCommit}` : ''}`);
  if (m.liveUrl) L.push(`live: ${m.liveUrl}`);
  if (m.tests) {
    L.push(`tests: ${m.tests.passing ?? '?'} passing / ${m.tests.files ?? '?'} files${m.tests.profile ? ` (${m.tests.profile})` : ''}`);
  }
  if (m.regression && (m.regression.count != null || m.regression.expected != null)) {
    L.push(`regression checks: ${m.regression.count ?? '?'} / ${m.regression.expected ?? '?'}`);
  }
  L.push('');
  L.push('Package files:');
  for (const [cat, items] of _groupByCategory(Array.isArray(m.entries) ? m.entries : [])) {
    L.push(`  ${cat}:`);
    for (const e of items) L.push(`    • ${e.file} — ${e.label} [${_presentMark(e.present)}]`);
  }
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('');
    L.push('Recent reports:');
    for (const r of m.latestReports) L.push(`  • ${r}`);
  }
  L.push('');
  L.push('Known non-blocking advisories:');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`  • ${a}`);
  L.push('');
  L.push(`Recommended next action: ${m.nextAction}`);
  L.push('');
  L.push('INDEX ONLY — no GitHub release, no tag, no announcement, no network.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatReleasePackageMarkdown(model) → a markdown index suitable for MVP_RELEASE_PACKAGE.md.
// Pure; null-safe.
export function formatReleasePackageMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# Release package (index)\n\n_(no index)_\n';
  const L = [];
  L.push(`# ${m.title} — Release Package Index`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Version:** ${m.version ?? '(unknown)'}${m.gitCommit ? ` @ ${m.gitCommit}` : ''}`);
  if (m.liveUrl) L.push(`- **Live:** ${m.liveUrl}`);
  if (m.tests) {
    L.push(`- **Tests:** ${m.tests.passing ?? '?'} passing / ${m.tests.files ?? '?'} files${m.tests.profile ? ` (${m.tests.profile})` : ''}`);
  }
  if (m.regression && (m.regression.count != null || m.regression.expected != null)) {
    L.push(`- **Regression checks:** ${m.regression.count ?? '?'} / ${m.regression.expected ?? '?'}`);
  }
  L.push('');
  L.push('## Package files');
  L.push('');
  for (const [cat, items] of _groupByCategory(Array.isArray(m.entries) ? m.entries : [])) {
    L.push(`### ${cat}`);
    L.push('');
    for (const e of items) L.push(`- \`${e.file}\` — ${e.label} _(${_presentMark(e.present)})_`);
    L.push('');
  }
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('## Recent reports');
    L.push('');
    for (const r of m.latestReports) L.push(`- \`${r}\``);
    L.push('');
  }
  L.push('## Known non-blocking advisories');
  L.push('');
  for (const a of (Array.isArray(m.advisories) ? m.advisories : [])) L.push(`- ${a}`);
  L.push('');
  L.push('## Recommended next action');
  L.push('');
  L.push(m.nextAction);
  L.push('');
  L.push('---');
  L.push('');
  L.push('_INDEX ONLY — this document creates no GitHub release, no git tag, no public ' +
    'announcement, and reaches no network. The parent agent owns security review, deploy, ' +
    'publish, push, and Space upload._');
  L.push('');
  return L.join('\n');
}
