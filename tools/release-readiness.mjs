// tools/release-readiness.mjs — local, read-only RELEASE-READINESS summary CLI (v0.2.187).
// Run with: node tools/release-readiness.mjs  (or: npm run release:status).
// Add --json (npm run release:status:json) to emit the machine-readable status envelope
// instead of the human block — for dashboard/handoff/updater/agent consumption (v0.2.189).
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
//
// gatherReleaseReadiness(root) is exported (v0.2.188) so other build-time tooling — e.g.
// build-torii-quest-dashboard.mjs, which surfaces the verdict on the Torii Quest dashboard — can fold
// the SAME live signals without duplicating the fs/git gathering. The CLI behaviour is
// unchanged: when this file is run directly it still prints the formatted block and exits 0.
import { readFileSync, readdirSync, existsSync, statSync, realpathSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildReleaseReadiness, formatReleaseReadiness, buildReleaseStatusJson } from './releaseReadiness.mjs';
import { summarizeBundle, DEFAULT_WARN_LIMIT } from './bundleSizes.mjs';
import { checkZoneFallbackReadiness, REQUIRED_FALLBACK_DOCS } from './zoneFallbackReadiness.mjs';
import { checkDocConsistency, CONTINUITY_DOCS, ADVISORY_DOCS } from './docConsistency.mjs';
import { TESTS_DIR } from './testProfiles.mjs';

// gatherReleaseReadiness(root) — do the local, read-only fs/git I/O and fold the existing
// pure checks into a buildReleaseReadiness() summary. NO network/writes; git is best-effort
// (never throws). Pure-ish: same inputs → same output (modulo the git commit + on-disk state).
export function gatherReleaseReadiness(root = process.cwd()) {
  const DIST = join(root, 'dist');
  const ASSETS = join(DIST, 'assets');

  const readSafe = (rel) => {
    try { return readFileSync(join(root, rel), 'utf8'); } catch { return null; }
  };

  const configVersion = () => {
    const m = (readSafe('src/config.js') || '').match(/VERSION\s*=\s*['"]([^'"]+)['"]/);
    return m ? m[1] : null;
  };

  const packageVersion = () => {
    try { return JSON.parse(readSafe('package.json') || '{}').version || null; } catch { return null; }
  };

  const gitCommit = () => {
    try {
      return execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
        .toString().trim() || null;
    } catch { return null; }
  };

  // All existing test files as `tests/<file>` paths (for validateProfiles — stale-entry guard).
  const existingTests = () => {
    try {
      return readdirSync(join(root, TESTS_DIR))
        .filter((n) => n.endsWith('.test.js'))
        .map((n) => `${TESTS_DIR}/${n}`);
    } catch { return []; }
  };

  // Read-only count of the [N] checks in regression-check.mjs (the gate's presence + size).
  const regressionCount = () => {
    const src = readSafe('tools/regression-check.mjs');
    if (typeof src !== 'string') return null;
    const m = src.match(/console\.log\(['"`]\[\d+\]/g);
    return m ? m.length : null;
  };

  const latestReports = (limit = 4) => {
    try {
      return readdirSync(root)
        .filter((n) => /^torii-.*report\.md$/.test(n))
        .map((n) => ({ n, mt: statSync(join(root, n)).mtimeMs }))
        .sort((a, b) => b.mt - a.mt)
        .slice(0, limit)
        .map((e) => e.n);
    } catch { return []; }
  };

  // Recursively list dist/ paths relative to dist/ (forward slashes); null when no build.
  const distPaths = () => {
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
  };

  const bundleSummary = () => {
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
  };

  // Zone /zone/* fallback verdict from the required docs + the built route shape.
  const zoneFallbackVerdict = () => {
    const docs = {};
    for (const name of REQUIRED_FALLBACK_DOCS) {
      const text = readSafe(name);
      if (typeof text === 'string') docs[name] = text;
    }
    const paths = distPaths();
    return checkZoneFallbackReadiness({ docs, dist: paths ? { paths } : {} });
  };

  // Docs/status consistency verdict for the current VERSION.
  const docConsistencyVerdict = (version) => {
    const files = {};
    const present = {};
    for (const name of [...CONTINUITY_DOCS, ...ADVISORY_DOCS]) {
      const text = readSafe(name);
      present[name] = typeof text === 'string';
      if (typeof text === 'string') files[name] = text;
    }
    return checkDocConsistency({ version, files, present });
  };

  const version = configVersion();
  return buildReleaseReadiness({
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
}

// CLI run-guard — print the formatted block + exit 0 ONLY when this file is the entry point
// (npm run release:status / node tools/release-readiness.mjs). Imported by another tool, it
// stays silent and side-effect-free (it just exposes gatherReleaseReadiness).
const invokedDirectly = (() => {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url); }
  catch { return false; }
})();

if (invokedDirectly) {
  const summary = gatherReleaseReadiness(process.cwd());
  // --json (or: npm run release:status:json) emits the machine-readable status envelope on
  // stdout so a dashboard/handoff/updater/agent can consume the verdict WITHOUT parsing the
  // human block. generatedAt is the only non-deterministic field (a real ISO stamp here).
  if (process.argv.slice(2).includes('--json')) {
    const json = buildReleaseStatusJson(summary, { generatedAt: new Date().toISOString() });
    process.stdout.write(JSON.stringify(json, null, 2) + '\n');
    process.exit(0);
  }
  console.log('');
  console.log(formatReleaseReadiness(summary));
  console.log('');
  process.exit(0);
}
