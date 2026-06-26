// tools/playtest-results-status.mjs — local, read-only MVP PLAYTEST RESULTS STATE CLI (v0.2.222).
// Run with: node tools/playtest-results-status.mjs  (or: npm run playtest:status).
// Reads the canonical, source-controlled recording file MVP_PLAYTEST_RESULTS.md (the hand-edited
// file a tester fills in — distinct from the regenerated MVP_PLAYTEST_RESULTS_TEMPLATE.md) and
// reports a compact STATE: not-run / incomplete / attention / complete, plus pass/fail/blank counts
// and any failing item ids. The shipped file is BLANK, so a fresh checkout reads `not-run` — and
// this state NEVER implies MVP approval (approvalImplied is pinned false).
//
// Modes:
//   (default)        human-readable state block on stdout
//   --json           machine-readable JSON state on stdout
//   --file=path      read a different in-repo results file (default MVP_PLAYTEST_RESULTS.md)
//   --write[=path]   create the BLANK canonical record IF IT DOES NOT EXIST (no-clobber, so a
//                    tester's recorded results are never destroyed). version/commit left blank for
//                    the tester to fill. Default MVP_PLAYTEST_RESULTS.md; CONFINED inside the repo
//                    (resolveHandoffWritePath): an absolute path or a `..` escape is rejected.
//
// READ-ONLY except the no-clobber --write: NO browser automation, NO network, NO server, NO deploy,
// NO publish, NO git tag/release, NO approval. Always exits 0 (rejected --write path → exit 2).
import { readFileSync, writeFileSync, existsSync, realpathSync } from 'node:fs';
import { join, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveHandoffWritePath } from './handoffSummary.mjs';
import {
  buildPlaytestResultsTemplate, formatPlaytestResultsTemplateMarkdown,
  parsePlaytestResults, summarizePlaytestResults,
} from './playtestResults.mjs';
import {
  summarizePlaytestForState, formatPlaytestResultsState, PLAYTEST_RESULTS_STATE_FILE,
} from './playtestResultsState.mjs';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

// Resolve --file=path → an in-repo relative path (default MVP_PLAYTEST_RESULTS.md). Reject an
// absolute path or a `..` escape so the read stays bounded inside the repo.
function readTarget(argv) {
  const arg = argv.find((a) => a.startsWith('--file='));
  if (!arg) return { rel: PLAYTEST_RESULTS_STATE_FILE };
  const raw = arg.slice('--file='.length);
  if (isAbsolute(raw) || normalize(raw).split(/[\\/]/).includes('..')) {
    return { rel: null, error: 'path must be inside the repo' };
  }
  return { rel: raw };
}

// Parse --write / --write=path → { write, path?, error? }. Default MVP_PLAYTEST_RESULTS.md, CONFINED
// inside the repo via the shared resolveHandoffWritePath.
function writeTarget(argv) {
  const arg = argv.find((a) => a === '--write' || a.startsWith('--write='));
  if (!arg) return { write: false, path: null };
  const eq = arg.indexOf('=');
  const raw = eq >= 0 ? arg.slice(eq + 1) : PLAYTEST_RESULTS_STATE_FILE;
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
  const wantJson = argv.includes('--json');

  // --write: create the BLANK canonical record only if it does not already exist (no-clobber).
  const { write, path, error } = writeTarget(argv);
  if (write && !path) {
    process.stderr.write(`playtest-results-status: refusing --write (${error}); the target must be inside the repo (no absolute path, no '..').\n`);
    process.exit(2);
  }
  if (write) {
    if (existsSync(path)) {
      process.stderr.write(`playtest-results-status: ${path} already exists — leaving it untouched (no-clobber, recorded results are never overwritten).\n`);
    } else {
      // Blank canonical record: version/commit left null so the tester records the build they
      // actually tested (this file is not version-stamped by the build).
      const model = buildPlaytestResultsTemplate({ version: null, gitCommit: null, liveUrl: null, generatedAt: null });
      writeFileSync(path, formatPlaytestResultsTemplateMarkdown(model), 'utf8');
      process.stderr.write(`playtest-results-status: wrote blank canonical record ${path}\n`);
    }
  }

  // Report the state of the canonical (or --file) results markdown.
  const { rel, error: readErr } = readTarget(argv);
  if (!rel) {
    process.stderr.write(`playtest-results-status: refusing --file (${readErr}); the target must be inside the repo.\n`);
    process.exit(2);
  }
  const text = readSafe(rel);
  const state = summarizePlaytestForState(
    text == null ? null : summarizePlaytestResults(parsePlaytestResults(text)),
  );

  if (wantJson) {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
  } else {
    console.log('');
    if (text == null) console.log(`(no ${rel} found — reporting unknown state)`);
    console.log(formatPlaytestResultsState(state));
    console.log('');
  }
  process.exit(0);
}
