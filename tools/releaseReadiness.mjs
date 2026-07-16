// tools/releaseReadiness.mjs — PURE, node-safe RELEASE-READINESS aggregation + formatting
// (v0.2.187). Folds the local, network-free readiness signals an AI/dev handoff cares about
// — version sync, test-profile counts, the regression-check gate, the advisory bundle
// baseline, the SPA /zone/* fallback verdict, docs/status consistency, and the latest
// reports — into ONE concise summary with a single overall verdict, so a shipper can see the
// posture at a glance instead of re-reading every tool's output.
//
// Pure + deterministic: NO fs, NO network, NO child_process, NO process in here. The CLI
// (tools/release-readiness.mjs) does the fs/git I/O + runs the underlying pure checks and
// hands their plain verdicts to these helpers, so the aggregation/formatting logic is
// unit-testable (tests/release-readiness.test.js). Reuses the pure helpers it aggregates
// (versionAgreement from handoffStatus, PROFILES/validateProfiles from testProfiles,
// formatBytes from bundleSizes) — it never re-implements them.
import { versionAgreement } from './handoffStatus.mjs';
import { PROFILES, validateProfiles } from './testProfiles.mjs';
import { formatBytes } from './bundleSizes.mjs';

// The number of static/runtime guardrails tools/regression-check.mjs currently runs. The
// summary surfaces the gate's PRESENCE + count read-only; the gate itself is the authority
// (`npm run check`). If a check is added/removed there, bump this so the summary stays honest.
export const REGRESSION_CHECK_COUNT = 20;

// Badge naming the section as read-only oversight, never a deploy/publish action.
export const RELEASE_READINESS_BADGE = 'RELEASE READINESS · LOCAL · READ-ONLY';

// The release gate command this summary previews (the FULL suite + build + check + bundle +
// handoff). The summary never runs it — it only reports whether the local signals are green.
export const RELEASE_GATE_COMMAND = 'npm run test:release';

// A signal is one of these honest states (never over-claims):
//   ok       — present and passing
//   blocked  — present and failing (a real blocker)
//   advisory — present, non-gating (e.g. bundle over the warn limit) — never blocks
//   skipped  — deliberately not run this pass (e.g. no dist/ yet) — never blocks
//   unknown  — no input supplied — does NOT count as ready, but is not a hard blocker
export const SIGNAL_STATES = Object.freeze(['ok', 'blocked', 'advisory', 'skipped', 'unknown']);

// buildReleaseReadiness(inputs) → a plain, JSON-serialisable readiness summary. All inputs
// are plain data supplied by the CLI (which ran the underlying pure checks):
//   version        config.js VERSION (e.g. 'v0.2.187-alpha')
//   packageVersion package.json version (semver, no leading 'v')
//   gitCommit      short commit string, or null
//   existingTests  string[] of `tests/<file>` paths that exist on disk (for validateProfiles)
//   regression     { count } — number of [N] checks found in regression-check.mjs, or null
//   bundle         a summarizeBundle() report, or null when no dist/ has been built
//   zoneFallback   a checkZoneFallbackReadiness() verdict { ok, errors, warnings, dist:{skipped} }, or null
//   docs           a checkDocConsistency() verdict { ok, errors, warnings }, or null
//   latestReports  string[] of the most recent torii-*-report.md names (already sorted)
export function buildReleaseReadiness({
  version, packageVersion, gitCommit = null,
  existingTests = [], regression = null, bundle = null,
  zoneFallback = null, docs = null, latestReports = [],
} = {}) {
  // 1. Version sync — config VERSION ⟷ package.json (the tie regression-check [5] enforces).
  const va = versionAgreement(version, packageVersion);
  const versionSync = {
    state: va.ok ? 'ok' : 'blocked',
    configVersion: va.configVersion,
    packageVersion: va.packageVersion,
    expectedPackage: va.expectedPackage,
    ok: va.ok,
  };

  // 2. Test profiles — fast/foundation file counts + a validity check (no stale entry, nested).
  const vp = validateProfiles(existingTests);
  const tests = {
    state: vp.ok ? 'ok' : 'blocked',
    fast: PROFILES.fast.length,
    foundation: PROFILES.foundation.length,
    ok: vp.ok,
    errors: vp.errors.slice(),
  };

  // 3. Regression gate — surface presence + count read-only (the gate is the authority).
  const rCount = regression && Number.isInteger(regression.count) ? regression.count : null;
  const regressionSig = {
    state: rCount == null ? 'unknown' : (rCount >= REGRESSION_CHECK_COUNT ? 'ok' : 'blocked'),
    count: rCount,
    expected: REGRESSION_CHECK_COUNT,
    ok: rCount != null && rCount >= REGRESSION_CHECK_COUNT,
  };

  // 4. Bundle baseline — ADVISORY only. Over the warn limit never blocks a release.
  const bundleSig = bundle ? {
    state: (bundle.warnings && bundle.warnings.length) ? 'advisory' : 'ok',
    totalJsBytes: bundle.totals?.jsBytes ?? null,
    totalJsGzip: bundle.totals?.jsGzip ?? null,
    overLimit: Array.isArray(bundle.warnings) ? bundle.warnings.slice() : [],
    ok: true, // advisory — informational, never a blocker
  } : { state: 'skipped', totalJsBytes: null, totalJsGzip: null, overLimit: [], ok: true };

  // 5. Zone /zone/* SPA-fallback readiness. dist may be SKIPPED with no build — still ok.
  const zfSkipped = !!(zoneFallback && zoneFallback.dist && zoneFallback.dist.skipped);
  const zoneSig = zoneFallback ? {
    state: zoneFallback.ok ? 'ok' : 'blocked',
    distSkipped: zfSkipped,
    errors: Array.isArray(zoneFallback.errors) ? zoneFallback.errors.slice() : [],
    warnings: Array.isArray(zoneFallback.warnings) ? zoneFallback.warnings.slice() : [],
    ok: !!zoneFallback.ok,
  } : { state: 'unknown', distSkipped: false, errors: [], warnings: [], ok: false };

  // 6. Docs/status consistency (todo/progress/HANDOFF carry current version — HARD on drift).
  const docsSig = docs ? {
    state: docs.ok ? 'ok' : 'blocked',
    errors: Array.isArray(docs.errors) ? docs.errors.slice() : [],
    warnings: Array.isArray(docs.warnings) ? docs.warnings.slice() : [],
    ok: !!docs.ok,
  } : { state: 'unknown', errors: [], warnings: [], ok: false };

  // Overall verdict. Required signals that must be present AND ok for READY:
  //   version sync, test profiles, regression gate, zone fallback, docs consistency.
  // Bundle is advisory (never gates). A 'blocked' signal → NOT READY; a required signal that
  // is merely 'unknown' (no input this pass) → INCOMPLETE (we don't over-claim READY).
  const required = [
    { key: 'versionSync', sig: versionSync },
    { key: 'tests', sig: tests },
    { key: 'regression', sig: regressionSig },
    { key: 'zoneFallback', sig: zoneSig },
    { key: 'docs', sig: docsSig },
  ];
  const blockers = required.filter((r) => r.sig.state === 'blocked').map((r) => r.key);
  const unknowns = required.filter((r) => r.sig.state === 'unknown').map((r) => r.key);

  let status; let statusLabel;
  if (blockers.length) { status = 'not-ready'; statusLabel = 'NOT READY'; }
  else if (unknowns.length) { status = 'incomplete'; statusLabel = 'INCOMPLETE · SIGNALS MISSING'; }
  else { status = 'ready'; statusLabel = 'READY'; }

  return {
    badge: RELEASE_READINESS_BADGE,
    gateCommand: RELEASE_GATE_COMMAND,
    status,
    statusLabel,
    ready: status === 'ready',
    blockers,
    unknowns,
    version: version || null,
    packageVersion: packageVersion || null,
    gitCommit: gitCommit || null,
    signals: {
      versionSync,
      tests,
      regression: regressionSig,
      bundle: bundleSig,
      zoneFallback: zoneSig,
      docs: docsSig,
    },
    latestReports: Array.isArray(latestReports) ? latestReports.slice() : [],
  };
}

// The machine-readable JSON envelope (v0.2.189). A stable schema id + integer version so a
// dashboard/handoff/updater/agent can consume the readiness verdict WITHOUT parsing the human
// terminal block. Bump RELEASE_STATUS_SCHEMA_VERSION on any breaking shape change.
export const RELEASE_STATUS_SCHEMA = 'torii.release-status';
export const RELEASE_STATUS_SCHEMA_VERSION = 1;

// buildReleaseStatusJson(summary, { generatedAt }) → a plain, JSON-serialisable status envelope
// over a buildReleaseReadiness() summary. PURE + deterministic: the ONLY non-deterministic field
// is generatedAt, which is OPTIONAL and isolated — omit it (default null) and the output is fully
// reproducible for tests; the CLI passes a real ISO timestamp at print time. A missing/garbled
// summary degrades to an honest unknown envelope (never throws).
export function buildReleaseStatusJson(summary, { generatedAt = null } = {}) {
  const stamp = typeof generatedAt === 'string' && generatedAt ? generatedAt : null;
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) {
    return {
      schema: RELEASE_STATUS_SCHEMA,
      schemaVersion: RELEASE_STATUS_SCHEMA_VERSION,
      generatedAt: stamp,
      status: 'unknown',
      statusLabel: 'NO SUMMARY',
      ready: false,
      error: 'no-summary',
      badge: RELEASE_READINESS_BADGE,
      gateCommand: RELEASE_GATE_COMMAND,
      blockers: [],
      unknowns: [],
      version: null,
      packageVersion: null,
      gitCommit: null,
      signals: {},
      latestReports: [],
    };
  }
  return {
    schema: RELEASE_STATUS_SCHEMA,
    schemaVersion: RELEASE_STATUS_SCHEMA_VERSION,
    generatedAt: stamp,
    status: summary.status ?? 'unknown',
    statusLabel: summary.statusLabel ?? null,
    ready: !!summary.ready,
    badge: summary.badge ?? RELEASE_READINESS_BADGE,
    gateCommand: summary.gateCommand ?? RELEASE_GATE_COMMAND,
    blockers: Array.isArray(summary.blockers) ? summary.blockers.slice() : [],
    unknowns: Array.isArray(summary.unknowns) ? summary.unknowns.slice() : [],
    version: summary.version ?? null,
    packageVersion: summary.packageVersion ?? null,
    gitCommit: summary.gitCommit ?? null,
    signals: summary.signals && typeof summary.signals === 'object'
      ? JSON.parse(JSON.stringify(summary.signals)) : {},
    latestReports: Array.isArray(summary.latestReports) ? summary.latestReports.slice() : [],
  };
}

// A stable glyph per signal state for the terminal block. Pure.
function mark(state) {
  switch (state) {
    case 'ok': return '✓';
    case 'blocked': return '✗';
    case 'advisory': return '•';
    case 'skipped': return '–';
    default: return '?';
  }
}

// formatReleaseReadiness(summary) → a concise multi-line text block for the terminal. Pure.
export function formatReleaseReadiness(summary) {
  if (!summary || typeof summary !== 'object') return 'release-readiness: (no summary)';
  const s = summary.signals || {};
  const L = [];
  L.push('Torii Quest — release readiness');
  L.push('─'.repeat(60));
  L.push(`${summary.badge}`);
  L.push(`verdict: ${summary.statusLabel}   (${summary.version ?? '(unknown)'}  @ ${summary.gitCommit ?? 'no-git'})`);
  if (summary.blockers && summary.blockers.length) L.push(`  blockers: ${summary.blockers.join(', ')}`);
  if (summary.unknowns && summary.unknowns.length) L.push(`  not checked: ${summary.unknowns.join(', ')}`);
  L.push('');

  const vs = s.versionSync || {};
  L.push(`${mark(vs.state)} version sync       ${vs.configVersion ?? '?'} / pkg ${vs.packageVersion ?? '?'}` +
    (vs.ok ? '' : `  (expected pkg ${vs.expectedPackage})`));

  const t = s.tests || {};
  L.push(`${mark(t.state)} test profiles      fast ${t.fast} · foundation ${t.foundation} file(s)` +
    (t.ok ? '' : `  ${t.errors.join('; ')}`));

  const r = s.regression || {};
  L.push(`${mark(r.state)} regression gate    ${r.count ?? '?'}/${r.expected} checks (run: npm run check)`);

  const b = s.bundle || {};
  if (b.state === 'skipped') {
    L.push(`${mark(b.state)} bundle baseline    no dist/ — run npm run build then npm run bundle:report`);
  } else {
    L.push(`${mark(b.state)} bundle baseline    total JS ${formatBytes(b.totalJsBytes)} raw / ${formatBytes(b.totalJsGzip)} gzip (advisory)` +
      (b.overLimit.length ? `  over-limit: ${b.overLimit.join(', ')}` : ''));
  }

  const z = s.zoneFallback || {};
  L.push(`${mark(z.state)} zone /zone/* fb    ${z.ok ? 'docs+dist ok' : (z.errors.join('; ') || 'not checked')}` +
    (z.distSkipped ? '  (dist check skipped — no build)' : ''));

  const d = s.docs || {};
  L.push(`${mark(d.state)} docs consistency   ${d.ok ? 'continuity docs carry current version' : (d.errors.join('; ') || 'not checked')}`);

  L.push('');
  L.push(summary.latestReports && summary.latestReports.length
    ? `latest reports: ${summary.latestReports.join(', ')}`
    : 'latest reports: (none found)');
  L.push(`release gate (full): ${summary.gateCommand}`);
  L.push('─'.repeat(60));
  return L.join('\n');
}
