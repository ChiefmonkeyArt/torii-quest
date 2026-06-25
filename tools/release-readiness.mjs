// tools/release-readiness.mjs — local, read-only RELEASE-READINESS summary CLI (v0.2.187).
// Run with: node tools/release-readiness.mjs  (or: npm run release:status).
//
// Aggregates the local, network-free readiness signals an AI/dev handoff needs before
// shipping — version sync, test-profile counts, the regression-check gate, the advisory
// bundle baseline, the SPA /zone/* fallback verdict, docs/status consistency, and the latest
// reports — into ONE concise block with a single overall verdict. The pure aggregation +
// formatting lives in releaseReadiness.mjs (unit-tested); this file only does the fs/git I/O
// and folds the existing pure checks.
//
// NO network, NO secrets, NO install, NO build, NO writes — it only READS local files and
// asks git for the short commit (best-effort). Always exits 0: this is a VISIBILITY snapshot,
// not a gate. The authoritative gate stays `npm run check` / `npm run test:release`.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { buildReleaseReadiness, formatReleaseReadiness } from './releaseReadiness.mjs';
import { summarizeBundle, DEFAULT_WARN_LIMIT } from './bundleSizes.mjs';
import { checkZoneFallbackReadiness, REQUIRED_FALLBACK_DOCS } from './zoneFallbackReadiness.mjs';
import { checkDocConsistency, CONTINUITY_DOCS, ADVISORY_DOCS } from './docConsistency.mjs';
import { TESTS_DIR } from './testProfiles.mjs';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

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

// All existing test files as `tests/<file>` paths (for validateProfiles — stale-entry guard).
function existingTests() {
  try {
    return readdirSync(join(ROOT, TESTS_DIR))
      .filter((n) => n.endsWith('.test.js'))
      .map((n) => `${TESTS_DIR}/${n}`);
  } catch { return []; }
}

// Read-only count of the [N] checks in regression-check.mjs (the gate's presence + size).
function regressionCount() {
  const src = readSafe('tools/regression-check.mjs');
  if (typeof src !== 'string') return null;
  const m = src.match(/console\.log\(['"`]\[\d+\]/g);
  return m ? m.length : null;
}

function latestReports(limit = 4) {
  try {
    return readdirSync(ROOT)
      .filter((n) => /^torii-.*report\.md$/.test(n))
      .map((n) => ({ n, mt: statSync(join(ROOT, n)).mtimeMs }))
      .sort((a, b) => b.mt - a.mt)
      .slice(0, limit)
      .map((e) => e.n);
  } catch { return []; }
}

// Recursively list dist/ paths relative to dist/ (forward slashes); null when no build.
function distPaths() {
  if (!existsSync(DIST)) return null;
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else out.push(relative(DIST, p).replace(/\\/g, '/'));
    }
  };
  walk(DIST);
  return out;
}

function bundleSummary() {
  if (!existsSync(DIST)) return null;
  const entries = [];
  if (existsSync(ASSETS)) {
    for (const name of readdirSync(ASSETS)) {
      if (!name.endsWith('.js')) continue;
      const p = join(ASSETS, name);
      if (!statSync(p).isFile()) continue;
      const buf = readFileSync(p);
      let gzip = null; try { gzip = gzipSync(buf).length; } catch { gzip = null; }
      entries.push({ name, bytes: buf.length, gzip });
    }
  }
  const htmlPath = join(DIST, 'index.html');
  if (existsSync(htmlPath)) {
    const buf = readFileSync(htmlPath);
    let gzip = null; try { gzip = gzipSync(buf).length; } catch { gzip = null; }
    entries.push({ name: 'index.html', bytes: buf.length, gzip });
  }
  return summarizeBundle(entries, { warnLimit: DEFAULT_WARN_LIMIT });
}

// Zone /zone/* fallback verdict from the required docs + the built route shape.
function zoneFallbackVerdict() {
  const docs = {};
  for (const name of REQUIRED_FALLBACK_DOCS) {
    const text = readSafe(name);
    if (typeof text === 'string') docs[name] = text;
  }
  const paths = distPaths();
  return checkZoneFallbackReadiness({ docs, dist: paths ? { paths } : {} });
}

// Docs/status consistency verdict for the current VERSION.
function docConsistencyVerdict(version) {
  const files = {};
  const present = {};
  for (const name of [...CONTINUITY_DOCS, ...ADVISORY_DOCS]) {
    const text = readSafe(name);
    present[name] = typeof text === 'string';
    if (typeof text === 'string') files[name] = text;
  }
  return checkDocConsistency({ version, files, present });
}

const version = configVersion();
const summary = buildReleaseReadiness({
  version,
  packageVersion: packageVersion(),
  gitCommit: gitCommit(),
  existingTests: existingTests(),
  regression: { count: regressionCount() },
  bundle: bundleSummary(),
  zoneFallback: zoneFallbackVerdict(),
  docs: docConsistencyVerdict(version),
  latestReports: latestReports(),
});

console.log('');
console.log(formatReleaseReadiness(summary));
console.log('');

process.exit(0);
