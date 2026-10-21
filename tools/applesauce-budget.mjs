#!/usr/bin/env node
// ADR-0140 size budget (adopted v0.2.911), ENFORCED in test:release:
//   1. the lazy Applesauce chunks (applesauceTransport-*.js + every chunk it
//      statically imports, except the entry) total ≤ 55 KB gzip;
//   2. the entry chunk carries NO Applesauce library code;
//   3. the entry-side gateway transport module (src/engine/gateway/
//      gatewayTransport.js, minified) is ≤ 1 KB gzip, so Applesauce's whole
//      footprint in the entry stays within +1 KB (wiring included).
// Usage: node tools/applesauce-budget.mjs  (after `vite build`). Exit 1 on breach.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

export const LAZY_MAX_GZIP = 55 * 1024;
export const ENTRY_SIDE_MAX_GZIP = 1024;
// Strings that only exist in applesauce-relay / RxJS internals.
export const LIBRARY_MARKERS = ['RelayConnectionError', 'completeAfterIdle', 'ObjectUnsubscribedError'];

const gz = (buf) => gzipSync(buf, { level: 9 }).length;

/** Pure: assets = Map<name, Buffer>. → { ok, lazyGzip, lazyFiles, errors[] } */
export function checkApplesauceBudget({ assets, entryName, entrySideGzip }) {
  const errors = [];
  const names = [...assets.keys()];
  const transport = names.find((n) => /^applesauceTransport-[\w-]+\.js$/.test(n));
  if (!transport) errors.push('no applesauceTransport-*.js chunk (Applesauce must be a lazy chunk)');
  // Chunks the entry already loads statically (shared runtime etc.) are not lazy cost.
  const eager = new Set();
  const visitEager = (n) => {
    if (!n || eager.has(n) || !assets.has(n)) return;
    eager.add(n);
    for (const m of assets.get(n).toString('utf8').matchAll(/(?:from\s*|import\s*)["']\.\/([\w.-]+\.js)["']/g)) visitEager(m[1]);
  };
  visitEager(entryName);
  const lazy = new Set();
  const visit = (n) => {
    if (!n || lazy.has(n) || eager.has(n) || !assets.has(n)) return;
    lazy.add(n);
    const src = assets.get(n).toString('utf8');
    for (const m of src.matchAll(/(?:from\s*|import\(\s*)["'`]\.\/([\w.-]+\.js)["'`]/g)) visit(m[1]);
  };
  visit(transport);
  let lazyGzip = 0;
  for (const n of lazy) lazyGzip += gz(assets.get(n));
  if (lazyGzip > LAZY_MAX_GZIP) errors.push(`lazy Applesauce chunks ${lazyGzip} B gzip > budget ${LAZY_MAX_GZIP} B`);
  const entry = entryName && assets.get(entryName);
  if (!entry) errors.push('entry chunk not found');
  else {
    const e = entry.toString('utf8');
    for (const k of LIBRARY_MARKERS) if (e.includes(k)) errors.push(`entry contains Applesauce/RxJS library code (${k})`);
  }
  if (!(entrySideGzip <= ENTRY_SIDE_MAX_GZIP)) errors.push(`entry-side gatewayTransport.js ${entrySideGzip} B gzip > budget ${ENTRY_SIDE_MAX_GZIP} B`);
  return { ok: errors.length === 0, lazyGzip, lazyFiles: [...lazy], entrySideGzip, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const dir = join(root, 'dist', 'assets');
  if (!existsSync(dir)) { console.error('[applesauce-budget] no dist/ — run vite build first'); process.exit(1); }
  const assets = new Map(readdirSync(dir).filter((n) => n.endsWith('.js')).map((n) => [n, readFileSync(join(dir, n))]));
  const html = readFileSync(join(root, 'dist', 'index.html'), 'utf8');
  const entryName = (html.match(/assets\/(torii-entry-[\w-]+\.js)/) || [])[1];
  const { transform } = await import('esbuild');
  const min = await transform(readFileSync(join(root, 'src/engine/gateway/gatewayTransport.js'), 'utf8'), { minify: true, format: 'esm', loader: 'js' });
  const r = checkApplesauceBudget({ assets, entryName, entrySideGzip: gz(Buffer.from(min.code)) });
  console.log(`[applesauce-budget] lazy ${(r.lazyGzip / 1024).toFixed(1)} KB gzip / ${LAZY_MAX_GZIP / 1024} KB (${r.lazyFiles.join(', ')}); entry-side ${r.entrySideGzip} B / ${ENTRY_SIDE_MAX_GZIP} B`);
  for (const e of r.errors) console.error('  ✗ ' + e);
  console.log(r.ok ? '[applesauce-budget] PASS' : '[applesauce-budget] FAIL');
  process.exit(r.ok ? 0 : 1);
}
