// tools/bundleSizes.mjs — PURE, node-safe size formatting + classification for the
// built dist artifacts (v0.2.153). Turns the recurring Vite "large chunk" warnings
// into a measurable, AI-handoff-friendly baseline WITHOUT changing the runtime or the
// bundle splitting. Build-time only — never imported by the game; no fs/zlib in here
// (the CLI `bundle-report.mjs` does the I/O and hands plain entries to these helpers).
//
// Pure + deterministic: NO fs, NO network, NO process — only plain-data transforms, so
// the formatting/classification logic is unit-testable (tests/bundle-sizes.test.js).

export const KIB = 1024;
export const MIB = 1024 * 1024;

// The advisory per-chunk warn threshold. Mirrors vite.config.js
// `build.chunkSizeWarningLimit: 700` (kB) so the report speaks the same language as the
// build warning. ADVISORY only — exceeding it is flagged, never a hard failure here.
export const DEFAULT_WARN_LIMIT = 700 * KIB;

// formatBytes(bytes, digits=1) → a compact human string ('623.8 KB', '2.1 MB', '158 B').
// Bytes are shown without a decimal; KB/MB use `digits` fraction digits. Pure.
export function formatBytes(bytes, digits = 1) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'n/a';
  if (n < KIB) return `${n} B`;
  if (n < MIB) return `${(n / KIB).toFixed(digits)} KB`;
  return `${(n / MIB).toFixed(digits)} MB`;
}

// classifyAsset(name) → a stable category for a dist asset filename. Categories key the
// per-bundle baseline so a reviewer (or future code-splitting work) can track each
// concern independently. Content-hash and separator are ignored — only the stem matters.
//   'app'     — the main app entry chunk (index-*.js)
//   'three'   — the three.js vendor chunk (three-vendor-*.js)
//   'rapier'  — the lazy Rapier physics chunk (rapier-*.js)
//   'runtime' — the tiny rolldown/vite runtime chunk (rolldown-runtime-*.js)
//   'html'    — index.html
//   'other'   — anything else (css, future chunks, etc.)
export function classifyAsset(name) {
  const f = String(name || '').toLowerCase();
  if (f.endsWith('.html')) return 'html';
  if (/(^|\/)rapier-/.test(f) || f.includes('rapier')) return 'rapier';
  if (f.includes('three-vendor') || /(^|\/)three-/.test(f)) return 'three';
  if (f.includes('rolldown-runtime') || f.includes('runtime')) return 'runtime';
  if (/(^|\/)index-.*\.js$/.test(f)) return 'app';
  return 'other';
}

// isJsCategory(category) → true for the categories that count toward "total JS". Pure.
export function isJsCategory(category) {
  return category === 'app' || category === 'three' || category === 'rapier' ||
    category === 'runtime' || category === 'other';
}

// severityFor(bytes, limit=DEFAULT_WARN_LIMIT) → 'warn' when a single asset exceeds the
// advisory limit, else 'ok'. Advisory only — callers decide what to do with it. Pure.
export function severityFor(bytes, limit = DEFAULT_WARN_LIMIT) {
  const n = Number(bytes);
  const l = Number(limit);
  if (!Number.isFinite(n) || !Number.isFinite(l)) return 'ok';
  return n > l ? 'warn' : 'ok';
}

// summarizeBundle(entries, opts?) → a JSON-serialisable bundle baseline.
//   entries: [{ name, bytes, gzip? }]   (gzip optional; bytes required)
//   opts.warnLimit: advisory per-asset threshold (default DEFAULT_WARN_LIMIT)
// Returns:
//   {
//     warnLimit,
//     assets:  [{ name, category, bytes, gzip, severity }],  // sorted desc by bytes
//     totals:  { count, jsBytes, jsGzip, htmlBytes, allBytes },
//     categories: { app, three, rapier, runtime, html, other },  // bytes per category
//     warnings: [ name, ... ],   // assets at/over the advisory limit
//   }
// Pure — allocates only plain objects/arrays; deterministic ordering (bytes desc, then
// name asc) so two runs over the same inputs produce identical reports.
export function summarizeBundle(entries = [], opts = {}) {
  const warnLimit = Number.isFinite(opts.warnLimit) ? opts.warnLimit : DEFAULT_WARN_LIMIT;
  const list = Array.isArray(entries) ? entries : [];

  const assets = list.map((e) => {
    const name = e && e.name != null ? String(e.name) : '(unknown)';
    const bytes = Number(e && e.bytes) || 0;
    const gzip = e && Number.isFinite(Number(e.gzip)) ? Number(e.gzip) : null;
    const category = classifyAsset(name);
    return { name, category, bytes, gzip, severity: severityFor(bytes, warnLimit) };
  });

  assets.sort((a, b) => (b.bytes - a.bytes) || a.name.localeCompare(b.name));

  const categories = { app: 0, three: 0, rapier: 0, runtime: 0, html: 0, other: 0 };
  const totals = { count: assets.length, jsBytes: 0, jsGzip: 0, htmlBytes: 0, allBytes: 0 };
  const warnings = [];

  for (const a of assets) {
    categories[a.category] = (categories[a.category] || 0) + a.bytes;
    totals.allBytes += a.bytes;
    if (isJsCategory(a.category)) {
      totals.jsBytes += a.bytes;
      if (a.gzip != null) totals.jsGzip += a.gzip;
    } else if (a.category === 'html') {
      totals.htmlBytes += a.bytes;
    }
    if (a.severity === 'warn') warnings.push(a.name);
  }

  return { warnLimit, assets, totals, categories, warnings };
}
