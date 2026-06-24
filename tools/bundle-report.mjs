// tools/bundle-report.mjs — local bundle-size report over the built dist artifacts
// (v0.2.153). Reads dist/assets/*.js + dist/index.html, computes raw + gzip sizes
// locally (node:zlib), and prints a per-asset + per-category baseline plus an advisory
// flag for any chunk over the warn limit. Run with: node tools/bundle-report.mjs
// (or: npm run bundle:report). ADVISORY — exit 0 even when chunks are large; this is a
// visibility/baseline tool, not a gate. The pure formatting/classification lives in
// bundleSizes.mjs (unit-tested); this file only does the fs/zlib I/O + printing.
//
// No network, no install, no build — it only READS already-built files. If dist/ is
// absent it prints a hint and exits 0 (run `npm run build` first).
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { formatBytes, summarizeBundle, DEFAULT_WARN_LIMIT } from './bundleSizes.mjs';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

function gzipLen(buf) {
  try { return gzipSync(buf).length; } catch { return null; }
}

if (!existsSync(DIST)) {
  console.log('bundle-report: no dist/ — run `npm run build` first. (advisory; nothing to measure)');
  process.exit(0);
}

const entries = [];

// All JS assets (content-hashed) under dist/assets/.
if (existsSync(ASSETS)) {
  for (const name of readdirSync(ASSETS)) {
    if (!name.endsWith('.js')) continue;
    const p = join(ASSETS, name);
    if (!statSync(p).isFile()) continue;
    const buf = readFileSync(p);
    entries.push({ name, bytes: buf.length, gzip: gzipLen(buf) });
  }
}

// The HTML entry document.
const htmlPath = join(DIST, 'index.html');
if (existsSync(htmlPath)) {
  const buf = readFileSync(htmlPath);
  entries.push({ name: 'index.html', bytes: buf.length, gzip: gzipLen(buf) });
}

const report = summarizeBundle(entries, { warnLimit: DEFAULT_WARN_LIMIT });

const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log(`\nTorii Quest — bundle size report (advisory; warn limit ${formatBytes(report.warnLimit)})`);
console.log('─'.repeat(72));
console.log(`${pad('asset', 34)}${pad('category', 9)}${padL('raw', 11)}${padL('gzip', 11)}  flag`);
console.log('─'.repeat(72));
for (const a of report.assets) {
  const flag = a.severity === 'warn' ? '⚠ over' : '';
  const gz = a.gzip != null ? formatBytes(a.gzip) : '—';
  console.log(`${pad(a.name, 34)}${pad(a.category, 9)}${padL(formatBytes(a.bytes), 11)}${padL(gz, 11)}  ${flag}`);
}
console.log('─'.repeat(72));

const c = report.categories;
console.log('by category (raw):');
for (const k of ['app', 'three', 'rapier', 'runtime', 'other', 'html']) {
  if (c[k]) console.log(`  ${pad(k, 10)}${padL(formatBytes(c[k]), 12)}`);
}
console.log('─'.repeat(72));
console.log(`total JS:    ${formatBytes(report.totals.jsBytes)} raw / ${formatBytes(report.totals.jsGzip)} gzip  (${report.totals.count} asset(s))`);
console.log(`index.html:  ${formatBytes(report.totals.htmlBytes)}`);
console.log(`all listed:  ${formatBytes(report.totals.allBytes)}`);

if (report.warnings.length > 0) {
  console.log('─'.repeat(72));
  console.log(`advisory: ${report.warnings.length} chunk(s) over ${formatBytes(report.warnLimit)}: ${report.warnings.join(', ')}`);
  console.log('(expected for the three-vendor + lazy rapier chunks; tracked, not gated — see HANDOFF.md)');
}
console.log('');

process.exit(0);
