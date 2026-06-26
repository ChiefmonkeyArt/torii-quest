// tools/rc-snapshot.mjs — local, read-only MVP RC SNAPSHOT / FREEZE-CANDIDATE CLI (v0.2.210).
// Run with: node tools/rc-snapshot.mjs  (or: npm run rc:snapshot).
// Captures the current release-candidate state in ONE freeze-candidate document by COMPOSING the
// already-pure local verdicts — runMvpReadiness() (the MVP rollup) + gatherReleaseReadiness() (the
// release-readiness summary) + buildMvpRcGate() (the RC verdict) + buildGithubReleaseDryRunModel()
// (the GitHub release prerequisites) — plus the curated test-count capture, the present/missing
// state of every RC package doc, the known advisories, what STILL needs manual user validation, and
// what would be required to cut a real GitHub release/tag later. The pure assembly/formatting lives
// in rcSnapshot.mjs (unit-tested); this file only does the fs/git I/O and re-derives nothing.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout
//   --markdown/--md  markdown snapshot on stdout
//   --write[=path]   ALSO write the markdown snapshot to a file (default MVP_RC_SNAPSHOT.md).
//                    This is the ONLY thing that writes — without --write the tool is read-only.
//                    The path is CONFINED inside the repo (resolveHandoffWritePath): an absolute
//                    path or a `..` escape is rejected.
//
// SNAPSHOT ONLY: NO GitHub release, NO git tag, NO push, NO deploy, NO publish, NO announcement, NO
// network, NO server, NO secrets, NO install, NO build, and NO writes unless --write is given. git
// is best-effort and READ-ONLY (rev-parse / status --porcelain; falls back to null/unknown). Always
// exits 0 — this is a VISIBILITY snapshot, not a gate. The authority stays `npm run test:release`.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gatherReleaseReadiness } from './release-readiness.mjs';
import { resolveHandoffWritePath, buildHandoffSummary, HANDOFF_SUMMARY_LIVE_URL } from './handoffSummary.mjs';
import { buildMvpRcGate } from './mvpRcGate.mjs';
import { buildGithubReleaseDryRunModel } from './githubReleaseDryRun.mjs';
import { runMvpReadiness } from '../src/engine/status/mvpReadiness.js';
import { CURRENT_TEST_STATUS } from '../src/engine/dashboard/continuumData.js';
import {
  buildRcSnapshotModel, formatRcSnapshot, formatRcSnapshotMarkdown,
  RC_SNAPSHOT_DOC_REFS, RC_SNAPSHOT_WRITE_FILENAME,
} from './rcSnapshot.mjs';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function configVersion() {
  const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function packageVersion() {
  try { return JSON.parse(readSafe('package.json') || '{}').version || null; } catch { return null; }
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch { return null; }
}

// cleanTree() → true if `git status --porcelain` is empty, false if it has output, null on error.
function cleanTree() {
  try {
    return execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim().length === 0;
  } catch { return null; }
}

// pushed() → true if HEAD equals its upstream (read-only rev-parse, no fetch), false if it differs,
// null when there is no upstream / not a repo. Never reaches the network.
function pushed() {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const up = execSync('git rev-parse @{u}', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    if (!head || !up) return null;
    return head === up;
  } catch { return null; }
}

// autoUpdateActionable() → true if public/release-metadata.json declares an actionable / autoUpdate
// posture (a release blocker), false if explicitly non-actionable, null if not readable.
function autoUpdateActionable() {
  try {
    const meta = JSON.parse(readSafe('public/release-metadata.json') || 'null');
    const u = meta && typeof meta === 'object' ? meta.update : null;
    if (!u || typeof u !== 'object') return null;
    return u.autoUpdate === true || u.actionable === true;
  } catch { return null; }
}

// presentMap() → { key: boolean } — stat each referenced RC doc (relative to ROOT) for a present flag.
function presentMap() {
  const out = {};
  for (const d of RC_SNAPSHOT_DOC_REFS) {
    try { out[d.key] = existsSync(join(ROOT, d.file)); } catch { out[d.key] = false; }
  }
  return out;
}

// recentReports() → recent torii-v*-report.md filenames (best-effort, newest-ish last), capped.
function recentReports() {
  try {
    const out = execSync('ls torii-v*-report.md 2>/dev/null', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (!out) return [];
    return out.split('\n').map((s) => s.trim()).filter(Boolean).slice(-6);
  } catch { return []; }
}

// Parse --write / --write=path → { write, path?, error? }. Default file is MVP_RC_SNAPSHOT.md.
// The target is CONFINED inside the repo via the shared, pure resolveHandoffWritePath: an absolute
// path or a `..` escape is REJECTED. Without --write the tool stays read-only.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : RC_SNAPSHOT_WRITE_FILENAME;
  const resolved = resolveHandoffWritePath(raw, ROOT);
  if (!resolved.ok) return { write: true, path: null, error: resolved.error };
  return { write: true, path: resolved.path };
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);

  const cfgVersion = configVersion();
  const pkgVersion = packageVersion();
  const commit = gitCommit();

  const release = gatherReleaseReadiness(ROOT);
  let mvp = null;
  try { mvp = runMvpReadiness(); } catch { mvp = null; }
  const handoff = buildHandoffSummary({
    version: cfgVersion, packageVersion: pkgVersion, gitCommit: commit,
    liveUrl: HANDOFF_SUMMARY_LIVE_URL, release, generatedAt: null,
  });
  const rcGate = buildMvpRcGate({ mvpReadiness: mvp, releaseReadiness: release, handoff, generatedAt: null });
  const dryRun = buildGithubReleaseDryRunModel({
    version: cfgVersion, packageVersion: pkgVersion, gitCommit: commit,
    cleanTree: cleanTree(), pushed: pushed(),
    releaseNotesPresent: existsSync(join(ROOT, 'RELEASE_NOTES_DRAFT.md')),
    releasePackagePresent: existsSync(join(ROOT, 'MVP_RELEASE_PACKAGE.md')),
    gateReady: null,
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    autoUpdateActionable: autoUpdateActionable(),
    generatedAt: null,
  });

  const regression = release && release.signals && release.signals.regression ? {
    count: release.signals.regression.count, expected: release.signals.regression.expected,
  } : null;

  const model = buildRcSnapshotModel({
    version: cfgVersion, packageVersion: pkgVersion, gitCommit: commit,
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    rcGate, mvpReadiness: mvp, dryRun,
    testStatus: { passing: CURRENT_TEST_STATUS.passing, files: CURRENT_TEST_STATUS.files, profile: 'full' },
    regression,
    present: presentMap(),
    reports: recentReports(),
    generatedAt: new Date().toISOString(),
  });

  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`rc-snapshot: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    writeFileSync(path, formatRcSnapshotMarkdown(model), 'utf8');
    process.stderr.write(`rc-snapshot: wrote ${path}\n`);
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(model, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatRcSnapshotMarkdown(model));
  } else {
    console.log('');
    console.log(formatRcSnapshot(model));
    console.log('');
  }
  process.exit(0);
}
