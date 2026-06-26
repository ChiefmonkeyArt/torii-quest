// tools/playtest-capture.mjs — local, read-only MVP PLAYTEST NOTE-CAPTURE explainer CLI (v0.2.224).
// Run with: node tools/playtest-capture.mjs  (or: npm run playtest:capture).
// Reads the canonical, source-controlled recording file MVP_PLAYTEST_RESULTS.md (the hand-edited
// file a tester fills in) and EXPLAINS what is still blank and how rough notes map onto
// PASS / FAIL / N/A and the blocker/major/minor severities. The shipped file is BLANK, so a fresh
// checkout reports `not-run` with every item awaiting a result — and this explainer NEVER implies
// MVP approval (approvalImplied is pinned false).
//
// Modes:
//   (default)        human-readable explainer block on stdout
//   --json           machine-readable JSON explainer on stdout
//   --file=path      read a different in-repo results file (default MVP_PLAYTEST_RESULTS.md)
//
// STRICTLY READ-ONLY: NO --write, NO browser automation, NO network, NO server, NO deploy, NO
// publish, NO git tag/release, NO approval. Always exits 0 (rejected --file path → exit 2).
import { readFileSync, realpathSync } from 'node:fs';
import { join, isAbsolute, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { explainPlaytestCapture, formatPlaytestCaptureExplain } from './playtestNoteCapture.mjs';
import { PLAYTEST_RESULTS_STATE_FILE } from './playtestResultsState.mjs';

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

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const argv = process.argv.slice(2);
  const wantJson = argv.includes('--json');

  const { rel, error: readErr } = readTarget(argv);
  if (!rel) {
    process.stderr.write(`playtest-capture: refusing --file (${readErr}); the target must be inside the repo.\n`);
    process.exit(2);
  }
  const text = readSafe(rel);
  const explain = explainPlaytestCapture(text == null ? '' : text);

  if (wantJson) {
    process.stdout.write(JSON.stringify(explain, null, 2) + '\n');
  } else {
    console.log('');
    if (text == null) console.log(`(no ${rel} found — reporting an empty/unknown capture)`);
    console.log(formatPlaytestCaptureExplain(explain));
    console.log('');
  }
  process.exit(0);
}
