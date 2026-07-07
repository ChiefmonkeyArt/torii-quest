// tools/handoffStatus.mjs — PURE, node-safe AI-handoff status assembly + formatting
// (v0.2.156). Gives any future AI/dev handoff a one-glance snapshot — current VERSION,
// package version, git short commit, live URL, the checks that exist, which core docs are
// present, the latest source/report docs, and the advisory bundle baseline — WITHOUT them
// having to read every file. Build-time only; never imported by the game.
//
// Pure + deterministic: NO fs, NO network, NO child_process, NO process in here. The CLI
// (`tools/handoff-status.mjs`) does the fs/git I/O and hands plain inputs to these helpers,
// so the assembly/formatting logic is unit-testable (tests/handoff-status.test.js). Reuses
// the pure byte formatter from bundleSizes.mjs.
import { formatBytes } from './bundleSizes.mjs';

// The live instance (a Perplexity Space). Deploy is a separate manual maintainer step — this
// is display text for the handoff, NOT a fetched/navigated URL.
export const LIVE_URL = 'https://torii-quest.pplx.app';

// The cross-model handoff / source-of-truth docs a new agent should read first. Presence is
// reported so a handoff immediately sees if one is missing.
export const CORE_DOCS = [
  'README.md', 'torii-quest-todo.md', 'torii-quest-progress.md', 'torii-quest-handoff.md', 'torii-quest-strategy.md',
  'CODE_INDEX.md', 'SDK_DEBUG_INDEX.md',
];

// The local, network-free checks available to verify a change is "green".
export const CHECK_COMMANDS = [
  { cmd: 'npm test', desc: 'Vitest unit suite (pure helpers + contracts)' },
  { cmd: 'npm run check', desc: 'static + runtime regression guardrails (must be ALL GREEN)' },
  { cmd: 'npm run bundle:report', desc: 'advisory built-bundle size baseline (needs dist/)' },
  { cmd: 'npm run handoff:status', desc: 'this snapshot' },
];

// stripV('v0.2.156-alpha') → '0.2.156-alpha'. Pure.
export function stripV(version) {
  return typeof version === 'string' ? version.replace(/^v/, '') : '';
}

// versionAgreement(configVersion, packageVersion) → { ok, configVersion, packageVersion,
// expectedPackage }. package.json `version` must be the config VERSION with the leading 'v'
// stripped (the same tie regression-check [5] enforces). Pure.
export function versionAgreement(configVersion, packageVersion) {
  const expectedPackage = stripV(configVersion);
  return {
    ok: typeof configVersion === 'string' && !!configVersion && packageVersion === expectedPackage,
    configVersion: configVersion || null,
    packageVersion: packageVersion || null,
    expectedPackage,
  };
}

// buildHandoffStatus(inputs) → a plain, JSON-serialisable status object. All inputs are
// plain data supplied by the CLI:
//   version        config.js VERSION (e.g. 'v0.2.156-alpha')
//   packageVersion package.json version (semver, no leading 'v')
//   gitCommit      short commit string, or null if unavailable (never throws)
//   docsPresent    { '<doc>': boolean } presence map (defaults: inferred absent)
//   latestReports  string[] of the most recent torii-*-report.md names (already sorted)
//   bundle         a summarizeBundle() report, or null when no dist/ has been built
//   liveUrl        override for LIVE_URL (optional)
export function buildHandoffStatus({
  version, packageVersion, gitCommit = null,
  docsPresent = {}, latestReports = [], bundle = null, liveUrl = LIVE_URL,
} = {}) {
  const present = [];
  const missing = [];
  for (const name of CORE_DOCS) (docsPresent[name] ? present : missing).push(name);

  return {
    badge: 'torii-handoff-status',
    version: version || null,
    packageVersion: packageVersion || null,
    versionMatch: versionAgreement(version, packageVersion).ok,
    gitCommit: gitCommit || null,
    liveUrl,
    checks: CHECK_COMMANDS.map((c) => ({ ...c })),
    docs: { present, missing },
    latestReports: Array.isArray(latestReports) ? latestReports.slice() : [],
    bundle: bundle ? {
      totalJsBytes: bundle.totals?.jsBytes ?? null,
      totalJsGzip: bundle.totals?.jsGzip ?? null,
      categories: {
        app: bundle.categories?.app ?? 0,
        three: bundle.categories?.three ?? 0,
        rapier: bundle.categories?.rapier ?? 0,
      },
      overLimit: Array.isArray(bundle.warnings) ? bundle.warnings.slice() : [],
    } : null,
  };
}

// formatHandoffStatus(status) → a concise multi-line text block for the terminal. Pure.
export function formatHandoffStatus(status) {
  if (!status || typeof status !== 'object') return 'handoff-status: (no status)';
  const L = [];
  L.push('Torii Quest — AI handoff status');
  L.push('─'.repeat(60));
  L.push(`VERSION (config.js): ${status.version ?? '(unknown)'}`);
  L.push(`package.json:        ${status.packageVersion ?? '(unknown)'}` +
    (status.versionMatch ? '  ✓ in sync' : '  ✗ DRIFT (run npm run check)'));
  L.push(`git commit:          ${status.gitCommit ?? '(unavailable)'}`);
  L.push(`live (manual deploy): ${status.liveUrl}`);
  L.push('');
  L.push('checks (local, no network):');
  for (const c of status.checks ?? []) L.push(`  ${c.cmd.padEnd(22)} ${c.desc}`);
  L.push('');
  const present = status.docs?.present ?? [];
  const missing = status.docs?.missing ?? [];
  L.push(`core docs present (${present.length}/${present.length + missing.length}): ${present.join(', ') || '(none)'}`);
  if (missing.length) L.push(`  ⚠ MISSING: ${missing.join(', ')}`);
  if ((status.latestReports ?? []).length) {
    L.push(`latest reports: ${status.latestReports.join(', ')}`);
  }
  L.push('');
  if (status.bundle) {
    const b = status.bundle;
    L.push(`bundle baseline (advisory): total JS ${formatBytes(b.totalJsBytes)} raw / ${formatBytes(b.totalJsGzip)} gzip ` +
      `(app ${formatBytes(b.categories.app)}, three ${formatBytes(b.categories.three)}, rapier ${formatBytes(b.categories.rapier)})`);
    if (b.overLimit.length) L.push(`  advisory: over warn limit — ${b.overLimit.join(', ')} (tracked, not gated)`);
  } else {
    L.push('bundle baseline: no dist/ — run `npm run build` then `npm run bundle:report`');
  }
  L.push('─'.repeat(60));
  return L.join('\n');
}
