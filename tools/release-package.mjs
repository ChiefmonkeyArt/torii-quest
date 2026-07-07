// tools/release-package.mjs — local, read-only MVP RELEASE-PACKAGE INDEX CLI.
// Run with: node tools/release-package.mjs  (or: npm run release:package).
// Produces a single discoverability INDEX for the MVP proof-of-concept candidate: one document
// that points humans and future agents at every relevant file (release notes draft, playtest
// checklist + results template, handoff briefs, progress/todo, update/VPS/zone-fallback
// readiness) PLUS the current version / commit / test-count / live URL, the known advisories,
// and the recommended next safe action. It stat-s each indexed file (present/missing) and folds
// the curated index + plain version/commit/test data in releasePackage.mjs (unit-tested). This
// file only does the fs/git I/O and re-derives nothing.
//
// Modes:
//   (default)        human-readable text block on stdout
//   --json           machine-readable JSON envelope on stdout
//   --markdown/--md  markdown index on stdout
//   --write[=path]   ALSO write the markdown index to a file (default MVP_RELEASE_PACKAGE.md).
//                    This is the ONLY thing that writes — without --write the tool is read-only.
//                    The path is CONFINED inside the repo (resolveHandoffWritePath): an absolute
//                    path or a `..` escape is rejected.
//
// INDEX ONLY: NO GitHub release, NO git tag, NO public announcement, NO network, NO server,
// NO deploy, NO publish. NO secrets, NO install, NO build, and NO writes unless --write is given.
// git is best-effort (falls back to null). Always exits 0 — this is a VISIBILITY index, not a gate.
import { readFileSync, writeFileSync, existsSync, realpathSync, readdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectRecentReports } from './releaseManifest.mjs';
import { resolveHandoffWritePath, HANDOFF_SUMMARY_LIVE_URL } from './handoffSummary.mjs';
import { CURRENT_TEST_STATUS } from '../src/engine/dashboard/toriiQuestDashboardData.js';
import {
  buildReleasePackageModel, formatReleasePackage, formatReleasePackageMarkdown,
  RELEASE_PACKAGE_ENTRIES, RELEASE_PACKAGE_WRITE_FILENAME,
} from './releasePackage.mjs';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function configVersion() {
  const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

function gitCommit() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim() || null;
  } catch { return null; }
}

// presentMap() → { key: boolean } — stat each indexed file (relative to ROOT) for a present flag.
function presentMap() {
  const out = {};
  for (const e of RELEASE_PACKAGE_ENTRIES) {
    try { out[e.key] = existsSync(join(ROOT, e.file)); } catch { out[e.key] = false; }
  }
  return out;
}

// recentReports() → recent torii-v*-report.md filenames (best-effort, newest-ish last), capped.
// Reads the repo root with fs.readdirSync and filters/sorts in JS (the shared pure
// selectRecentReports) — no shell glob, no child_process.
function recentReports() {
  try {
    return selectRecentReports(readdirSync(ROOT));
  } catch { return []; }
}

// Parse --write / --write=path → { write, path?, error? }. Default file is MVP_RELEASE_PACKAGE.md.
// The target is CONFINED inside the repo via the shared, pure resolveHandoffWritePath: an
// absolute path or a `..` escape is REJECTED. Without --write the tool stays read-only.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : RELEASE_PACKAGE_WRITE_FILENAME;
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

  const model = buildReleasePackageModel({
    version: configVersion(),
    gitCommit: gitCommit(),
    liveUrl: HANDOFF_SUMMARY_LIVE_URL,
    testStatus: {
      passing: CURRENT_TEST_STATUS.passing,
      files: CURRENT_TEST_STATUS.files,
      profile: CURRENT_TEST_STATUS.profile,
    },
    reports: recentReports(),
    present: presentMap(),
    generatedAt: new Date().toISOString(),
  });

  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`release-package: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    writeFileSync(path, formatReleasePackageMarkdown(model), 'utf8');
    process.stderr.write(`release-package: wrote ${path}\n`);
  }

  if (argv.includes('--json')) {
    process.stdout.write(JSON.stringify(model, null, 2) + '\n');
  } else if (argv.includes('--markdown') || argv.includes('--md')) {
    process.stdout.write(formatReleasePackageMarkdown(model));
  } else {
    console.log('');
    console.log(formatReleasePackage(model));
    console.log('');
  }
  process.exit(0);
}
