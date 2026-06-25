// tools/stale-docs.mjs — local, read-only STALE-DOC DETECTOR CLI (v0.2.191).
// Run with: node tools/stale-docs.mjs  (or: npm run docs:stale).
// Catches docs/status/version drift earlier and more clearly than the basic docConsistency
// guard — precise version-HEADER drift in each continuity doc, a continuity doc that never
// mentions the current version, a newest report nobody links to, a newest report that lags
// the current version, and disagreeing test counts across the continuity docs. The pure
// detection/formatting lives in staleDocs.mjs (unit-tested); this file only does the fs I/O.
//
// ADVISORY, NOT a gate. The HARD gate stays `npm run check` [14] docConsistency (current-
// version drift in continuity docs / a missing core doc). This detector adds finer, higher-
// recall signals that are better surfaced than enforced — so it always exits 0 even on drift.
//
// Modes:
//   (default)  human-readable text block on stdout
//   --json     machine-readable detector report on stdout
//
// NO network, NO secrets, NO install, NO build, NO writes — it only READS local files.
import { readFileSync, readdirSync, statSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { detectStaleDocs, formatStaleDocs, CONTINUITY_DOCS } from './staleDocs.mjs';

const ROOT = process.cwd();

function readSafe(rel) {
  try { return readFileSync(join(ROOT, rel), 'utf8'); } catch { return null; }
}

function configVersion() {
  const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
  return m ? m[1] : null;
}

// Continuity-doc contents as { name → content }; an unreadable doc is simply omitted so the
// detector can flag it as 'doc-unavailable'.
function readContinuityDocs() {
  const docs = {};
  for (const name of CONTINUITY_DOCS) {
    const text = readSafe(name);
    if (typeof text === 'string') docs[name] = text;
  }
  return docs;
}

// torii-*report.md filenames at the repo root, NEWEST FIRST (mtime-sorted).
function reportsNewestFirst() {
  try {
    return readdirSync(ROOT)
      .filter((n) => /^torii-.*report\.md$/.test(n))
      .map((n) => ({ n, mt: statSync(join(ROOT, n)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt)
      .map((e) => e.n);
  } catch { return []; }
}

const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const report = detectStaleDocs({
    version: configVersion(),
    docs: readContinuityDocs(),
    reports: reportsNewestFirst(),
  });

  if (process.argv.slice(2).includes('--json')) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    process.exit(0);
  }
  console.log('');
  console.log(formatStaleDocs(report));
  console.log('');
  process.exit(0);
}
