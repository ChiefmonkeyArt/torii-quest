// tools/rcSnapshot.mjs — PURE, node-safe MVP RC SNAPSHOT / FREEZE-CANDIDATE assembly + formatting
// (v0.2.210). Produces ONE freeze-candidate summary that captures the current release-candidate
// state in a single document: the exact version + commit + live URL, the RC-gate verdict, the MVP
// readiness rollup pct/status, the test/release-profile counts, the GitHub release DRY-RUN verdict
// (prerequisites + missing items), which RC package docs exist on disk, the known non-blocking
// advisories, what STILL needs manual user validation (the live-browser things local gates cannot
// prove), and what would be required to turn this into a real GitHub release/tag later.
//
// It re-derives no check — it only ASSEMBLES a snapshot from plain verdicts the CLI gathers by
// composing the already-pure helpers (buildMvpRcGate, runMvpReadiness, buildGithubReleaseDryRunModel,
// gatherReleaseReadiness). SNAPSHOT ONLY: it creates NO GitHub release, NO git tag, NO public
// announcement, and reaches NO network/server. Pure + deterministic: NO fs, NO network, NO
// child_process, NO process in here. The CLI (tools/rc-snapshot.mjs) does the fs/git I/O — including
// stat-ing each referenced doc for a `present` map — and hands plain data to these helpers, so the
// assembly/formatting is unit-testable (tests/rc-snapshot.test.js). Null/garbled inputs degrade to
// honest UNKNOWNs; never throws.

// Shared, non-misleading wording for the stamped source commit (this snapshot is generated before
// its own commit — see tools/commitStamp.mjs).
import { sourceCommitInline } from './commitStamp.mjs';

// Stable schema id + integer version for the machine-readable (--json) mode. Bump
// RC_SNAPSHOT_SCHEMA_VERSION on any breaking shape change.
export const RC_SNAPSHOT_SCHEMA = 'torii.rc-snapshot';
export const RC_SNAPSHOT_SCHEMA_VERSION = 1;

// Badge naming the artifact as a local, read-only freeze-candidate SNAPSHOT — never a
// release/tag/publish action.
export const RC_SNAPSHOT_BADGE = 'MVP RC SNAPSHOT · FREEZE CANDIDATE · LOCAL · READ-ONLY';

// Default in-repo filename for the opt-in --write markdown snapshot.
export const RC_SNAPSHOT_WRITE_FILENAME = 'MVP_RC_SNAPSHOT.md';

// The product title shown atop the snapshot.
export const RC_SNAPSHOT_TITLE = 'Torii Quest — MVP RC Snapshot';

// The three coarse freeze-candidate verdicts (never over-claims):
//   FREEZE-CANDIDATE — local gates green (RC gate is a candidate AND the dry-run is not blocked);
//                      still pending the manual validation + user-approved release steps below
//   NEAR            — one short / something not checked this pass, nothing hard-blocking
//   BLOCKED         — a real blocker (RC gate blocked, or the dry-run blocked)
export const RC_SNAPSHOT_STATES = Object.freeze(['FREEZE-CANDIDATE', 'NEAR', 'BLOCKED']);

// RC_SNAPSHOT_DOC_REFS — the package docs this snapshot points at, each { key, file, label }.
// Frozen so a consumer can rely on the order. `key` is the stable id the CLI uses to inject a
// present/missing flag (it stat-s `file` relative to the repo root). The unit test asserts every
// file here actually exists in the repo, so the snapshot can never reference a doc that was renamed
// or removed without the test catching it.
export const RC_SNAPSHOT_DOC_REFS = Object.freeze([
  Object.freeze({ key: 'release-notes', file: 'RELEASE_NOTES_DRAFT.md', label: 'MVP release notes (DRAFT)' }),
  Object.freeze({ key: 'release-package', file: 'MVP_RELEASE_PACKAGE.md', label: 'MVP release package index' }),
  Object.freeze({ key: 'github-dry-run', file: 'GITHUB_RELEASE_DRY_RUN.md', label: 'GitHub release dry-run' }),
  Object.freeze({ key: 'playtest-checklist', file: 'MVP_PLAYTEST_CHECKLIST.md', label: 'MVP playtest checklist' }),
  Object.freeze({ key: 'playtest-results', file: 'MVP_PLAYTEST_RESULTS_TEMPLATE.md', label: 'MVP playtest results template' }),
  Object.freeze({ key: 'handoff', file: 'HANDOFF.md', label: 'Handoff narrative (source of truth)' }),
  Object.freeze({ key: 'vps-install', file: 'VPS_INSTALL.md', label: 'VPS install / manual deploy notes' }),
]);

// RC_SNAPSHOT_MANUAL_VALIDATION — what STILL needs manual user validation before MVP-proof sign-off.
// These are the live-browser behaviours the local, network-free gates cannot prove; they are always
// shown as pending (a green local gate does NOT mean these have been run).
export const RC_SNAPSHOT_MANUAL_VALIDATION = Object.freeze([
  'Launch the live build and confirm the title screen shows the current version with no blocking console errors.',
  'Run the core shooter loop (shoot → hit → respawn); confirm ESC pauses instantly and a panel-locked cursor click never fires the weapon.',
  'Cross the torii gate into the NAP zone and confirm the weapon disables (peace) and bots do not follow across the gate.',
  'Open the read-only Nostr surfaces (read health / profile / leaderboard) and confirm they load with NO signing or publishing path exposed.',
  'Activate the gateway portal and confirm a travel-confirm shell appears (not a silent jump); confirm a malformed /zone/<slug> falls back safely.',
  'Open /dashboard.html and /release-metadata.json on the live build; confirm version + test counts match the title screen and the update prompt is read-only.',
  'Walk through MVP_PLAYTEST_CHECKLIST.md and record results in MVP_PLAYTEST_RESULTS_TEMPLATE.md — any open blocker stops MVP-proof sign-off.',
]);

// RC_SNAPSHOT_RELEASE_STEPS — what would be required to turn this snapshot into a real GitHub
// release/tag LATER. Every git/release/deploy step is gated on explicit user approval and NONE run
// here; the suggested commands live in GITHUB_RELEASE_DRY_RUN.md as inert text.
export const RC_SNAPSHOT_RELEASE_STEPS = Object.freeze([
  'Confirm the release commit is committed and pushed to origin (the parent agent owns the push).',
  'Run `npm run test:release` and confirm the full gate is green.',
  'Complete the manual playtest validation above with no open blocker.',
  'With explicit user approval, cut the annotated tag (`git tag -a vX.Y.Z-alpha …`) — TEXT ONLY here, not run.',
  'With explicit user approval, push the tag and create the GitHub release from RELEASE_NOTES_DRAFT.md — TEXT ONLY here, not run.',
  'Deploy the built dist/ to the live host via the manual VPS flow (VPS_INSTALL.md) — no auto-update, no DNS/SSH from this repo tooling.',
]);

// The known, non-blocking advisories that ride along with the proof (never gate a release).
export const RC_SNAPSHOT_ADVISORIES = Object.freeze([
  'The rapier-*.js chunk exceeds the 700 KB bundle advisory (standing, never gated).',
  'SDK_DEBUG_INDEX.md is an advisory doc (WARN-only in the docs-consistency gate).',
  'This is an alpha proof-of-concept: live runtime / Nostr write paths stay gated behind SEC review.',
]);

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

// _strList(x, fallback) → a cleaned string[] (non-empty), or the frozen fallback sliced. Pure.
function _strList(x, fallback) {
  const list = _arr(x).map(String).map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback.slice();
}

// rcSnapshotVersionConsistency(inputs) → a PURE check that the version markers the snapshot folds
// all agree. Returns { ok, version, sources:{ config, package, rcGate, mvpReadiness, dryRun },
// mismatches:[ 'source=value' ] }. `ok` is true iff every PRESENT source equals the resolved
// version (a null/absent source is simply not compared — it is not a mismatch). Used by the CLI +
// the unit test to prove the snapshot stamps a single, consistent version. Never throws.
export function rcSnapshotVersionConsistency({
  version = null, packageVersion = null, rcGate = null, mvpReadiness = null, dryRun = null,
} = {}) {
  const sources = {
    config: _str(version),
    package: _str(packageVersion) ? `v${_str(packageVersion).replace(/^v/, '')}` : null,
    rcGate: _str(_obj(rcGate) ? rcGate.version : null),
    mvpReadiness: _str(_obj(mvpReadiness) ? mvpReadiness.currentVersion : null),
    dryRun: _str(_obj(dryRun) ? dryRun.version : null),
  };
  const resolved = sources.config || sources.rcGate || sources.mvpReadiness || sources.dryRun || null;
  const mismatches = [];
  if (resolved) {
    for (const [k, v] of Object.entries(sources)) {
      if (v && v !== resolved) mismatches.push(`${k}=${v}`);
    }
  }
  return { ok: !!resolved && mismatches.length === 0, version: resolved, sources, mismatches };
}

// buildRcSnapshotModel(inputs) → a plain, JSON-serialisable RC freeze-candidate SNAPSHOT model.
// All inputs are plain verdicts the CLI gathers from the already-pure helpers:
//   version       config.js VERSION (a 'vX.Y.Z-alpha' marker); or null
//   packageVersion package.json version; or null (used for the version-consistency line)
//   gitCommit     short commit string, or null (the SOURCE commit — precedes this file's commit)
//   liveUrl       display URL for the live instance (NOT fetched)
//   rcGate        a buildMvpRcGate() verdict { status, isCandidate, pct, reasons[], nextTasks[], ... }
//   mvpReadiness  a runMvpReadiness() rollup { ok, mvpPct, status, summary, reasons[], ... }
//   dryRun        a buildGithubReleaseDryRunModel() model { status, ready, missing[], approvalGate,
//                 approvalRequired, futureCommands[], ... }
//   testStatus    OPTIONAL { passing, files, profile } from the curated rollup — the test-count line
//   regression    OPTIONAL { count, expected } — the regression-gate line
//   present       OPTIONAL map { key: boolean } injected by the CLI from fs — which RC docs exist
//   advisories / manualValidation / releaseSteps   OPTIONAL string[] overrides (defaults frozen above)
//   reports       OPTIONAL string[] of recent report names
//   generatedAt   OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                 reproducible tests; the CLI passes a real stamp at print time.
export function buildRcSnapshotModel({
  version = null, packageVersion = null, gitCommit = null, liveUrl = null,
  rcGate = null, mvpReadiness = null, dryRun = null,
  testStatus = null, regression = null,
  present = null, advisories = null, manualValidation = null, releaseSteps = null,
  reports = null, generatedAt = null,
} = {}) {
  const stamp = _str(generatedAt);
  const rc = _obj(rcGate);
  const mvp = _obj(mvpReadiness);
  const dr = _obj(dryRun);
  const presentMap = _obj(present) || {};

  const consistency = rcSnapshotVersionConsistency({ version, packageVersion, rcGate: rc, mvpReadiness: mvp, dryRun: dr });
  const resolvedVersion = consistency.version || _str(version);

  // --- RC-gate verdict extraction (honest UNKNOWN when absent) ---
  const rcStatus = rc ? (_str(rc.status) || 'UNKNOWN') : 'UNKNOWN';
  const rcCandidate = rc ? rc.isCandidate === true : false;
  const rcPct = rc ? _int(rc.pct) : null;
  const rcReasons = rc ? _arr(rc.reasons).map(String) : [];
  const rcNextTasks = rc ? _arr(rc.nextTasks).map(String) : [];

  // --- MVP readiness rollup extraction ---
  const mvpStatus = mvp ? (_str(mvp.status) || 'UNKNOWN') : 'UNKNOWN';
  const mvpOk = mvp ? mvp.ok === true : false;
  const mvpPct = mvp ? _int(mvp.mvpPct) : null;
  const mvpSummary = _obj(mvp ? mvp.summary : null);

  // --- GitHub release dry-run extraction ---
  const drStatus = dr ? (_str(dr.status) || 'unknown') : 'unknown';
  const drReady = dr ? dr.ready === true : false;
  const drMissing = dr ? _arr(dr.missing).map((m) => (_obj(m) ? (_str(m.label) || _str(m.key) || '') : String(m))).filter(Boolean) : [];
  const drApprovalGate = dr ? _str(dr.approvalGate) : null;

  // --- Freeze-candidate verdict (never over-claims) ---
  const anyBlocked = rcStatus === 'BLOCKED' || drStatus === 'blocked';
  const localGatesGreen = rcCandidate && drStatus !== 'blocked';
  let status;
  if (anyBlocked) status = 'BLOCKED';
  else if (localGatesGreen) status = 'FREEZE-CANDIDATE';
  else status = 'NEAR';

  const docs = RC_SNAPSHOT_DOC_REFS.map((d) => {
    const has = Object.prototype.hasOwnProperty.call(presentMap, d.key) ? presentMap[d.key] === true : null;
    return { key: d.key, file: d.file, label: d.label, present: has };
  });

  const ts = _obj(testStatus);
  const tests = ts ? { passing: _int(ts.passing), files: _int(ts.files), profile: _str(ts.profile) } : null;

  const rg = _obj(regression);
  const reg = rg ? { count: _int(rg.count), expected: _int(rg.expected) } : null;

  return {
    schema: RC_SNAPSHOT_SCHEMA,
    schemaVersion: RC_SNAPSHOT_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: RC_SNAPSHOT_BADGE,
    title: RC_SNAPSHOT_TITLE,
    snapshot: true,
    status,
    freezeCandidate: status === 'FREEZE-CANDIDATE',
    version: resolvedVersion,
    packageVersion: _str(packageVersion),
    gitCommit: _str(gitCommit),
    liveUrl: _str(liveUrl),
    versionConsistency: consistency,
    rcGate: { present: !!rc, status: rcStatus, isCandidate: rcCandidate, pct: rcPct, reasons: rcReasons, nextTasks: rcNextTasks },
    mvpReadiness: { present: !!mvp, status: mvpStatus, ok: mvpOk, pct: mvpPct, summary: mvpSummary },
    releaseDryRun: { present: !!dr, status: drStatus, ready: drReady, missing: drMissing, approvalGate: drApprovalGate },
    tests,
    regression: reg,
    docs,
    advisories: _strList(advisories, RC_SNAPSHOT_ADVISORIES),
    manualValidation: _strList(manualValidation, RC_SNAPSHOT_MANUAL_VALIDATION),
    releaseSteps: _strList(releaseSteps, RC_SNAPSHOT_RELEASE_STEPS),
    latestReports: _arr(reports).map(String).filter(Boolean),
    // Observed safety posture — all false in every run (the snapshot only ASSEMBLES text; it
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

// formatRcSnapshot(model) → a concise multi-line text block for the terminal. Pure; null-safe.
export function formatRcSnapshot(model) {
  const m = _obj(model);
  if (!m) return 'rc-snapshot: (no snapshot)';
  const L = [];
  L.push(`${m.title} — RC freeze-candidate snapshot`);
  L.push('─'.repeat(60));
  L.push(`${m.badge}`);
  if (m.generatedAt) L.push(`generated: ${m.generatedAt}`);
  L.push(`status: ${m.status}`);
  L.push(`version: ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`live (manual deploy): ${m.liveUrl}`);
  if (m.versionConsistency && !m.versionConsistency.ok && m.versionConsistency.mismatches.length) {
    L.push(`version consistency: MISMATCH (${m.versionConsistency.mismatches.join(', ')})`);
  } else {
    L.push('version consistency: ok');
  }
  L.push('');
  L.push('RC gate:');
  L.push(`  status: ${m.rcGate.status}${m.rcGate.pct != null ? ` (${m.rcGate.pct}%)` : ''}  ·  candidate: ${m.rcGate.isCandidate ? 'yes' : 'no'}`);
  for (const r of m.rcGate.reasons) L.push(`  • ${r}`);
  L.push('');
  L.push('MVP readiness:');
  L.push(`  ${m.mvpReadiness.pct != null ? `${m.mvpReadiness.pct}%` : '?'} · ${m.mvpReadiness.status}${m.mvpReadiness.summary ? `  (${m.mvpReadiness.summary.ok ?? '?'}/${m.mvpReadiness.summary.total ?? '?'} signals)` : ''}`);
  if (m.tests) L.push(`  tests: ${m.tests.passing ?? '?'} passing / ${m.tests.files ?? '?'} files${m.tests.profile ? ` (${m.tests.profile})` : ''}`);
  if (m.regression && (m.regression.count != null || m.regression.expected != null)) {
    L.push(`  regression: ${m.regression.count ?? '?'} / ${m.regression.expected ?? '?'} checks`);
  }
  L.push('');
  L.push('GitHub release dry-run:');
  L.push(`  status: ${m.releaseDryRun.status}  ·  ready: ${m.releaseDryRun.ready ? 'yes' : 'no'}`);
  for (const x of m.releaseDryRun.missing) L.push(`  • missing: ${x}`);
  L.push('');
  L.push('RC package docs:');
  for (const d of m.docs) L.push(`  • ${d.file} — ${d.label} [${_presentMark(d.present)}]`);
  L.push('');
  L.push('Still needs manual user validation:');
  for (const x of m.manualValidation) L.push(`  • ${x}`);
  L.push('');
  L.push('To turn this into a real GitHub release/tag (all user-approved, none run here):');
  for (const x of m.releaseSteps) L.push(`  • ${x}`);
  if (m.releaseDryRun.approvalGate) {
    L.push('');
    L.push(`APPROVAL GATE: ${m.releaseDryRun.approvalGate}`);
  }
  L.push('');
  L.push('Known non-blocking advisories:');
  for (const a of m.advisories) L.push(`  • ${a}`);
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('');
    L.push('Recent reports:');
    for (const r of m.latestReports) L.push(`  • ${r}`);
  }
  L.push('');
  L.push('SNAPSHOT ONLY — no GitHub release, no tag, no announcement, no network.');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatRcSnapshotMarkdown(model) → a markdown snapshot suitable for MVP_RC_SNAPSHOT.md. Pure; null-safe.
export function formatRcSnapshotMarkdown(model) {
  const m = _obj(model);
  if (!m) return '# MVP RC snapshot\n\n_(no snapshot)_\n';
  const L = [];
  L.push(`# ${m.title} — RC Freeze-Candidate Snapshot`);
  L.push('');
  L.push(`> ${m.badge}`);
  if (m.generatedAt) L.push(`> generated: ${m.generatedAt}`);
  L.push('');
  L.push(`- **Status:** ${m.status}`);
  L.push(`- **Version:** ${m.version ?? '(unknown)'}${sourceCommitInline(m.gitCommit)}`);
  if (m.liveUrl) L.push(`- **Live (manual deploy):** ${m.liveUrl}`);
  L.push(`- **Version consistency:** ${m.versionConsistency && m.versionConsistency.ok ? 'ok' : `MISMATCH (${(m.versionConsistency ? m.versionConsistency.mismatches : []).join(', ')})`}`);
  L.push('');
  L.push('## RC gate');
  L.push('');
  L.push(`- **Status:** ${m.rcGate.status}${m.rcGate.pct != null ? ` (${m.rcGate.pct}%)` : ''}`);
  L.push(`- **Candidate:** ${m.rcGate.isCandidate ? 'yes' : 'no'}`);
  for (const r of m.rcGate.reasons) L.push(`- _reason:_ ${r}`);
  L.push('');
  L.push('## MVP readiness');
  L.push('');
  L.push(`- **Readiness:** ${m.mvpReadiness.pct != null ? `${m.mvpReadiness.pct}%` : '?'} · ${m.mvpReadiness.status}${m.mvpReadiness.summary ? ` (${m.mvpReadiness.summary.ok ?? '?'}/${m.mvpReadiness.summary.total ?? '?'} signals)` : ''}`);
  if (m.tests) L.push(`- **Tests:** ${m.tests.passing ?? '?'} passing / ${m.tests.files ?? '?'} files${m.tests.profile ? ` (${m.tests.profile})` : ''}`);
  if (m.regression && (m.regression.count != null || m.regression.expected != null)) {
    L.push(`- **Regression:** ${m.regression.count ?? '?'} / ${m.regression.expected ?? '?'} checks`);
  }
  L.push('');
  L.push('## GitHub release dry-run');
  L.push('');
  L.push(`- **Status:** ${m.releaseDryRun.status}`);
  L.push(`- **Ready:** ${m.releaseDryRun.ready ? 'yes' : 'no'}`);
  for (const x of m.releaseDryRun.missing) L.push(`- _missing:_ ${x}`);
  L.push('');
  L.push('## RC package docs');
  L.push('');
  for (const d of m.docs) L.push(`- \`${d.file}\` — ${d.label} _(${_presentMark(d.present)})_`);
  L.push('');
  L.push('## Still needs manual user validation');
  L.push('');
  for (const x of m.manualValidation) L.push(`- [ ] ${x}`);
  L.push('');
  L.push('## To turn this into a real GitHub release/tag');
  L.push('');
  L.push('_All git/release/deploy steps below are gated on explicit user approval and NONE run here._');
  L.push('');
  for (const x of m.releaseSteps) L.push(`- ${x}`);
  if (m.releaseDryRun.approvalGate) {
    L.push('');
    L.push(`> **APPROVAL GATE:** ${m.releaseDryRun.approvalGate}`);
  }
  L.push('');
  L.push('## Known non-blocking advisories');
  L.push('');
  for (const a of m.advisories) L.push(`- ${a}`);
  if (Array.isArray(m.latestReports) && m.latestReports.length) {
    L.push('');
    L.push('## Recent reports');
    L.push('');
    for (const r of m.latestReports) L.push(`- \`${r}\``);
  }
  L.push('');
  L.push('---');
  L.push('');
  L.push('_SNAPSHOT ONLY — this document creates no GitHub release, no git tag, no public ' +
    'announcement, and reaches no network. The parent agent owns security review, deploy, ' +
    'publish, push, and Space upload._');
  L.push('');
  return L.join('\n');
}
