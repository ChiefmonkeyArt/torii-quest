// tools/handoffSummary.mjs — PURE, node-safe AI-handoff AUTO-SUMMARY assembly + formatting
// (v0.2.190). Folds the local status/readiness inputs a NEXT agent/model needs into ONE
// concise handoff brief — version, git commit, live URL, the current gate verdict, test-profile
// counts, the latest reports, the recommended next SAFE task, the standing key constraints, and
// the exact commands to verify a release — so a fresh handoff can act WITHOUT re-deriving the
// posture from every tool. Build-time only; never imported by the game.
//
// Pure + deterministic: NO fs, NO network, NO child_process, NO process in here. The CLI
// (tools/handoff-summary.mjs) does the fs/git I/O — it runs gatherReleaseReadiness() and reads
// config/package/git — and hands plain inputs to these helpers, so the assembly/formatting is
// unit-testable (tests/handoff-summary.test.js). It consumes the EXISTING release-readiness
// summary rather than re-implementing any check. (node:path is deterministic string math — no
// I/O — so the --write target resolver stays in this pure layer and is unit-tested.)
import { isAbsolute, resolve, relative, sep } from 'node:path';

// The live instance (a Perplexity Space). Display text for the handoff, NOT a fetched URL.
export const HANDOFF_SUMMARY_LIVE_URL = 'https://torii-quest.pplx.app';

// Badge naming the brief as read-only oversight, never a deploy/publish action.
export const HANDOFF_SUMMARY_BADGE = 'AI HANDOFF SUMMARY · LOCAL · READ-ONLY';

// Stable schema id + integer version for the machine-readable mode (mirrors the release-status
// envelope). Bump HANDOFF_SUMMARY_SCHEMA_VERSION on any breaking shape change.
export const HANDOFF_SUMMARY_SCHEMA = 'torii.handoff-summary';
export const HANDOFF_SUMMARY_SCHEMA_VERSION = 1;

// The exact local, network-free commands the next agent runs to confirm green before shipping.
export const VERIFY_COMMANDS = Object.freeze([
  { cmd: 'npm run check', desc: 'static + runtime regression guardrails (must be ALL GREEN)' },
  { cmd: 'npm test', desc: 'full Vitest unit suite (pure helpers + contracts)' },
  { cmd: 'npm run release:status', desc: 'one-glance ship verdict (or release:status:json)' },
  { cmd: 'npm run test:release', desc: 'full gate: build + vitest + check + bundle + handoff' },
]);

// The standing project constraints EVERY deploy must honour (mirrors the work-order block).
export const KEY_CONSTRAINTS = Object.freeze([
  'version bump every deploy',
  'godMode false',
  'no new setTimeout (except allowed historical exceptions)',
  'no new Vector3/Matrix4 in hot paths',
  "comments use 'nostrich'",
  'Chiefmonkey spelling',
  'debug tools ship unconditionally',
  'ESC pause + panel-click fire safety intact',
]);

// The recommended next SAFE slice when none is supplied — keep cadence on no-blocker
// infrastructure/tooling/docs; live runtime/Nostr writes stay gated behind SEC-1/2/3.
export const DEFAULT_NEXT_SAFE_TASK =
  'Continue safe no-blocker infrastructure/tooling/docs (extend handoff/readiness/dashboard ' +
  'visibility). Do NOT touch gameplay/portal/physics/shooting/controls or live Nostr writes — ' +
  'those stay gated behind SEC-1/2/3.';

// Default in-repo filename for the opt-in --write markdown brief.
export const DEFAULT_WRITE_FILENAME = 'handoff-summary.md';

// resolveHandoffWritePath(raw, root) → { ok, path?, error? }. Confines the --write target to
// INSIDE `root` (the repo). Security boundary (WARN-3, v0.2.190): a developer-tool write must
// not be able to clobber an arbitrary absolute path or escape the repo via `..`. Rejects:
//   - a non-string/empty root            → error 'no-root'
//   - an absolute path                   → error 'absolute-path-not-allowed'
//   - a relative path that escapes root  → error 'outside-repo' (incl. resolving to root itself)
// Pure string math (no fs); never throws. An empty/blank raw falls back to DEFAULT_WRITE_FILENAME.
export function resolveHandoffWritePath(raw, root) {
  if (typeof root !== 'string' || !root) return { ok: false, error: 'no-root' };
  const rel = (typeof raw === 'string' && raw.trim()) ? raw.trim() : DEFAULT_WRITE_FILENAME;
  if (isAbsolute(rel)) return { ok: false, error: 'absolute-path-not-allowed' };
  const abs = resolve(root, rel);
  const within = relative(root, abs);
  if (within === '' || within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
    return { ok: false, error: 'outside-repo' };
  }
  return { ok: true, path: abs };
}

// buildHandoffSummary(inputs) → a plain, JSON-serialisable handoff brief. All inputs are plain
// data supplied by the CLI:
//   version        config.js VERSION (e.g. 'v0.2.190-alpha')
//   packageVersion package.json version (semver, no leading 'v')
//   gitCommit      short commit string, or null
//   liveUrl        override for HANDOFF_SUMMARY_LIVE_URL (optional)
//   release        a buildReleaseReadiness() summary, or null/garbled → honest 'unknown' gate
//   nextSafeTask   recommended next safe task string (defaults to DEFAULT_NEXT_SAFE_TASK)
//   constraints    string[] of key constraints (defaults to KEY_CONSTRAINTS)
//   verifyCommands [{cmd,desc}] verification commands (defaults to VERIFY_COMMANDS)
//   latestReports  string[] of recent report names (defaults to release.latestReports)
//   generatedAt    OPTIONAL ISO stamp — the ONLY non-deterministic field; omit (null) for
//                  reproducible tests; the CLI passes a real stamp at print time.
export function buildHandoffSummary({
  version, packageVersion, gitCommit = null, liveUrl = HANDOFF_SUMMARY_LIVE_URL,
  release = null, nextSafeTask = DEFAULT_NEXT_SAFE_TASK,
  constraints = KEY_CONSTRAINTS, verifyCommands = VERIFY_COMMANDS,
  latestReports = null, generatedAt = null,
} = {}) {
  const stamp = typeof generatedAt === 'string' && generatedAt ? generatedAt : null;
  const rel = release && typeof release === 'object' && !Array.isArray(release) ? release : null;
  const sig = (rel && rel.signals && typeof rel.signals === 'object') ? rel.signals : {};

  const reg = sig.regression || {};
  const tst = sig.tests || {};

  const gate = {
    status: rel ? (rel.status ?? 'unknown') : 'unknown',
    statusLabel: rel ? (rel.statusLabel ?? 'UNKNOWN') : 'NO RELEASE SUMMARY',
    ready: !!(rel && rel.ready),
    gateCommand: rel ? (rel.gateCommand ?? 'npm run test:release') : 'npm run test:release',
    blockers: rel && Array.isArray(rel.blockers) ? rel.blockers.slice() : [],
    unknowns: rel && Array.isArray(rel.unknowns) ? rel.unknowns.slice() : [],
    regression: {
      count: Number.isInteger(reg.count) ? reg.count : null,
      expected: Number.isInteger(reg.expected) ? reg.expected : null,
    },
    testProfiles: {
      fast: Number.isInteger(tst.fast) ? tst.fast : null,
      foundation: Number.isInteger(tst.foundation) ? tst.foundation : null,
    },
  };

  const reports = Array.isArray(latestReports)
    ? latestReports.slice()
    : (rel && Array.isArray(rel.latestReports) ? rel.latestReports.slice() : []);

  return {
    schema: HANDOFF_SUMMARY_SCHEMA,
    schemaVersion: HANDOFF_SUMMARY_SCHEMA_VERSION,
    generatedAt: stamp,
    badge: HANDOFF_SUMMARY_BADGE,
    version: version || null,
    packageVersion: packageVersion || null,
    gitCommit: gitCommit || null,
    liveUrl: liveUrl || HANDOFF_SUMMARY_LIVE_URL,
    gate,
    nextSafeTask: typeof nextSafeTask === 'string' && nextSafeTask ? nextSafeTask : DEFAULT_NEXT_SAFE_TASK,
    constraints: Array.isArray(constraints) ? constraints.slice() : KEY_CONSTRAINTS.slice(),
    verifyCommands: Array.isArray(verifyCommands)
      ? verifyCommands.map((c) => ({ cmd: c.cmd, desc: c.desc })) : [],
    latestReports: reports,
  };
}

// formatHandoffSummary(summary) → a concise multi-line text block for the terminal. Pure.
export function formatHandoffSummary(summary) {
  if (!summary || typeof summary !== 'object') return 'handoff-summary: (no summary)';
  const g = summary.gate || {};
  const L = [];
  L.push('Torii Quest — AI handoff auto-summary');
  L.push('─'.repeat(60));
  L.push(`${summary.badge}`);
  if (summary.generatedAt) L.push(`generated: ${summary.generatedAt}`);
  L.push(`version:   ${summary.version ?? '(unknown)'}  (pkg ${summary.packageVersion ?? '?'})  @ ${summary.gitCommit ?? 'no-git'}`);
  L.push(`live (manual deploy): ${summary.liveUrl}`);
  L.push('');
  L.push(`gate verdict: ${g.statusLabel ?? 'UNKNOWN'}${g.ready ? '  ✓ READY' : ''}`);
  if (g.blockers && g.blockers.length) L.push(`  blockers: ${g.blockers.join(', ')}`);
  if (g.unknowns && g.unknowns.length) L.push(`  not checked: ${g.unknowns.join(', ')}`);
  const reg = g.regression || {};
  L.push(`  regression: ${reg.count ?? '?'}/${reg.expected ?? '?'} checks`);
  const tp = g.testProfiles || {};
  L.push(`  test profiles: fast ${tp.fast ?? '?'} · foundation ${tp.foundation ?? '?'} file(s)`);
  L.push('');
  L.push(`next safe task: ${summary.nextSafeTask}`);
  L.push('');
  L.push('key constraints:');
  for (const c of summary.constraints ?? []) L.push(`  • ${c}`);
  L.push('');
  L.push('verify before ship (local, no network):');
  for (const c of summary.verifyCommands ?? []) L.push(`  ${c.cmd.padEnd(22)} ${c.desc}`);
  L.push('');
  L.push(summary.latestReports && summary.latestReports.length
    ? `latest reports: ${summary.latestReports.join(', ')}`
    : 'latest reports: (none found)');
  L.push('─'.repeat(60));
  return L.join('\n');
}

// formatHandoffSummaryMarkdown(summary) → a markdown brief suitable for a handoff doc. Pure.
export function formatHandoffSummaryMarkdown(summary) {
  if (!summary || typeof summary !== 'object') return '# Handoff summary\n\n_(no summary)_\n';
  const g = summary.gate || {};
  const reg = g.regression || {};
  const tp = g.testProfiles || {};
  const L = [];
  L.push('# Torii Quest — AI handoff auto-summary');
  L.push('');
  L.push(`> ${summary.badge}`);
  if (summary.generatedAt) L.push(`> generated: ${summary.generatedAt}`);
  L.push('');
  L.push(`- **Version:** ${summary.version ?? '(unknown)'} (pkg ${summary.packageVersion ?? '?'})`);
  L.push(`- **Git commit:** ${summary.gitCommit ?? '(unavailable)'}`);
  L.push(`- **Live (manual deploy):** ${summary.liveUrl}`);
  L.push(`- **Gate verdict:** ${g.statusLabel ?? 'UNKNOWN'}${g.ready ? ' (READY)' : ''}`);
  if (g.blockers && g.blockers.length) L.push(`  - blockers: ${g.blockers.join(', ')}`);
  if (g.unknowns && g.unknowns.length) L.push(`  - not checked: ${g.unknowns.join(', ')}`);
  L.push(`- **Regression:** ${reg.count ?? '?'} / ${reg.expected ?? '?'} checks`);
  L.push(`- **Test profiles:** fast ${tp.fast ?? '?'} · foundation ${tp.foundation ?? '?'} file(s)`);
  L.push('');
  L.push('## Next safe task');
  L.push('');
  L.push(summary.nextSafeTask);
  L.push('');
  L.push('## Key constraints');
  L.push('');
  for (const c of summary.constraints ?? []) L.push(`- ${c}`);
  L.push('');
  L.push('## Verify before ship (local, no network)');
  L.push('');
  for (const c of summary.verifyCommands ?? []) L.push(`- \`${c.cmd}\` — ${c.desc}`);
  L.push('');
  L.push('## Latest reports');
  L.push('');
  if (summary.latestReports && summary.latestReports.length) {
    for (const r of summary.latestReports) L.push(`- ${r}`);
  } else {
    L.push('_(none found)_');
  }
  L.push('');
  return L.join('\n');
}
