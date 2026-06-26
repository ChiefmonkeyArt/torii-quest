// tools/github-release-dry-run.mjs — local, read-only GITHUB MVP RELEASE DRY-RUN CLI.
// Run with: node tools/github-release-dry-run.mjs  (or: npm run release:dry-run).
// Folds the local, network-free prerequisites that WOULD need to be true before a human cuts a
// future GitHub MVP-proof release — version stamped + synced, clean working tree, HEAD pushed,
// release-notes draft present, release-package index present, the tests/RC gate green, a public
// live URL, and non-actionable (no autoUpdate) release metadata — into ONE verdict
// (READY / NEAR / BLOCKED) with missing items and the suggested FUTURE manual commands as TEXT.
// It reads local files + runs read-only `git` (rev-parse / status) only; it folds the plain data
// in githubReleaseDryRun.mjs (unit-tested) and re-derives nothing.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout
//   --markdown/--md  markdown dry-run on stdout
//   --write[=path]   ALSO write the markdown dry-run to a file (default GITHUB_RELEASE_DRY_RUN.md).
//                    This is the ONLY thing that writes — without --write the tool is read-only.
//                    The path is CONFINED inside the repo (resolveHandoffWritePath): an absolute
//                    path or a `..` escape is rejected.
//
// DRY-RUN ONLY: NO git tag, NO GitHub release, NO push, NO deploy, NO publish, NO network, NO
// server. Every suggested command is INERT TEXT carrying an explicit "do not run without user
// approval". git is best-effort and READ-ONLY (rev-parse / status --porcelain; falls back to
// null/unknown). Always exits 0 — this is a VISIBILITY dry-run, not a gate.
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHandoffWritePath, HANDOFF_SUMMARY_LIVE_URL } from './handoffSummary.mjs';
import {
  buildGithubReleaseDryRunModel, formatGithubReleaseDryRun, formatGithubReleaseDryRunMarkdown,
  GITHUB_RELEASE_DRY_RUN_WRITE_FILENAME,
} from './githubReleaseDryRun.mjs';

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
    const out = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString();
    return out.trim().length === 0;
  } catch { return null; }
}

// pushed() → true if HEAD equals its upstream (read-only rev-parse, no fetch), false if it differs,
// null when there is no upstream / not a repo. Never reaches the network.
function pushed() {
  try {
    const head = execSync('git rev-parse HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    const up = execSync('git rev-parse @{u}', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
    if (!head || !up) return null;
    return head === up;
  } catch { return null; }
}

// autoUpdateActionable() → true if public/release-metadata.json declares an actionable / autoUpdate
// posture (a release blocker), false if it is explicitly non-actionable, null if not readable.
function autoUpdateActionable() {
  try {
    const meta = JSON.parse(readSafe('public/release-metadata.json') || 'null');
    const u = meta && typeof meta === 'object' ? meta.update : null;
    if (!u || typeof u !== 'object') return null;
    return u.autoUpdate === true || u.actionable === true;
  } catch { return null; }
}

// Parse --write / --write=path → { write, path?, error? }. Default file is GITHUB_RELEASE_DRY_RUN.md.
// The target is CONFINED inside the repo via the shared, pure resolveHandoffWritePath: an absolute
// path or a `..` escape is REJECTED. Without --write the tool stays read-only.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : GITHUB_RELEASE_DRY_RUN_WRITE_FILENAME;
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

  const model = buildGithubReleaseDryRunModel({
    version: configVersion(),
    packageVersion: packageVersion(),
    gitCommit: gitCommit(),
    cleanTree: cleanTree(),
    pushed: pushed(),
    releaseNotesPresent: existsSync(join(ROOT, 'RELEASE_NOTES_DRAFT.md')),
    releasePackagePresent: existsSync(join(ROOT, 'MVP_RELEASE_PACKAGE.md')),
    // gateReady is left unknown — the dry-run does NOT run the full gate; it points the human at
    // `npm run test:release`. Confirming it would mean running a build, which this tool never does.
    gateReady: null,
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    autoUpdateActionable: autoUpdateActionable(),
    generatedAt: new Date().toISOString(),
  });

  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`github-release-dry-run: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    writeFileSync(path, formatGithubReleaseDryRunMarkdown(model), 'utf8');
    process.stderr.write(`github-release-dry-run: wrote ${path}\n`);
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(model, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatGithubReleaseDryRunMarkdown(model));
  } else {
    console.log('');
    console.log(formatGithubReleaseDryRun(model));
    console.log('');
  }
  process.exit(0);
}
