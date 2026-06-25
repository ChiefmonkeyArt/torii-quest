// tools/zoneFallbackReadiness.mjs — PURE, node-safe SPA `/zone/*` fallback READINESS
// checks (v0.2.185). Makes the OUTSTANDING torii.quest/VPS static-host requirement —
// "serve index.html for any /zone/<slug> path" (HANDOFF.md §7, GATEWAY_PROTOCOL.md,
// documented since the v0.2.182 client-side route parser) — operationally EXPLICIT and
// CHECKABLE, without touching app runtime behaviour or contacting any server.
//
// This module is a documentation/deployment-readiness guard, NOT a deploy step. It
// changes NO navigation: the v0.2.181 proximity ARMs / KeyF CONFIRMs / same-origin
// `/zone/` model is untouched. It only inspects plain inputs (doc text + a list of
// built file paths) and reports whether the hosting prerequisites are documented and
// whether a built bundle's route shape matches the SPA-fallback expectation.
//
// Constrained by construction (mirrors tools/docConsistency.mjs):
//   - PURE + node-safe: NO fs / network / child_process / THREE / DOM here. The CLI
//     (tools/zone-fallback-check.mjs) and regression-check [15] do the fs reads and hand
//     plain { name → content } strings + a path array to these helpers. Deterministic +
//     plain-data so the logic is unit-testable (tests/zone-fallback-readiness.test.js).
//   - READ-ONLY: never writes a file, never emits a server config, never implies a
//     deploy happened. It only verifies that the documented fallback exists and that a
//     dist/ route shape is consistent with relying on it.

// The same-origin route prefix the v0.2.181 portal hop pushes and the v0.2.182 parser
// reads. A static host must map any path under this prefix back to index.html.
export const ZONE_ROUTE_PREFIX = '/zone/';

// Badge for the readiness report — names the contract so it can't be mistaken for a deploy.
export const ZONE_FALLBACK_BADGE = 'ZONE FALLBACK · DOCS+DIST CHECK · LOCAL READ-ONLY';

// The docs that MUST carry the SPA-fallback requirement so a future host operator can't
// miss it. VPS_INSTALL.md must show the concrete server directive (the EXAMPLE config);
// HANDOFF.md must document the requirement in the deploy section.
export const REQUIRED_FALLBACK_DOCS = ['VPS_INSTALL.md', 'HANDOFF.md'];

// The SPA entry document a fallback must resolve unmatched paths to.
const INDEX_DOC = 'index.html';

// fallbackEvidence(text) → which fallback signals a doc contains. PURE.
//   zonePath:    references the `/zone/` route prefix at all.
//   indexFallback: shows an `index.html` SPA-fallback directive of some recognised form
//                  (nginx `try_files … /index.html`, Caddy `try_files {path} /index.html`,
//                  or an explicit "fallback document … index.html" / "404 … index.html"
//                  phrasing). This is the actual host-config requirement.
export function fallbackEvidence(text) {
  if (typeof text !== 'string' || text === '') {
    return { zonePath: false, indexFallback: false, tryFiles: false };
  }
  const zonePath = text.includes(ZONE_ROUTE_PREFIX);
  // nginx: try_files $uri $uri/ /index.html;  |  Caddy: try_files {path} /index.html
  const tryFiles = /try_files[^;\n]*\/index\.html/i.test(text);
  // Generic "fallback/404/rewrite … index.html" prose or CDN fallback-document config.
  const proseFallback =
    /(fallback|404|rewrite|spa)[^\n]{0,80}\/?index\.html/i.test(text) ||
    /index\.html[^\n]{0,40}(fallback|for any|unmatched|404)/i.test(text);
  return { zonePath, indexFallback: tryFiles || proseFallback, tryFiles };
}

// checkFallbackDocs(files) → { ok, errors, warnings, checked }. PURE.
//   files: { '<docname>': '<contents>' }  (omit/undefined = file unreadable/missing)
// HARD FAIL when a REQUIRED doc is missing or does not describe the index.html fallback.
// WARN when a required doc shows the fallback but never names the `/zone/` prefix (the
// fallback is still valid SPA-wide, but the link to the zone route is worth stating).
export function checkFallbackDocs(files = {}) {
  const errors = [];
  const warnings = [];
  const checked = [];
  const src = files && typeof files === 'object' ? files : {};

  for (const name of REQUIRED_FALLBACK_DOCS) {
    checked.push(name);
    const text = src[name];
    if (typeof text !== 'string') {
      errors.push(`missing or unreadable doc: ${name} (must document the /zone/* SPA fallback)`);
      continue;
    }
    const ev = fallbackEvidence(text);
    if (!ev.indexFallback) {
      errors.push(`${name} does not describe an ${INDEX_DOC} SPA fallback (serve ${INDEX_DOC} for ${ZONE_ROUTE_PREFIX}* paths)`);
      continue;
    }
    if (!ev.zonePath) {
      warnings.push(`${name} describes an ${INDEX_DOC} fallback but never names the ${ZONE_ROUTE_PREFIX} route it covers`);
    }
  }
  return { ok: errors.length === 0, errors, warnings, checked };
}

// normalizePath(p) → a leading-slash, forward-slash path, or '' for non-strings. PURE.
function normalizePath(p) {
  if (typeof p !== 'string' || p === '') return '';
  const f = p.replace(/\\/g, '/').replace(/^\.\//, '');
  return f.startsWith('/') ? f : `/${f}`;
}

// zonePathsInDist(paths) → the built paths that sit UNDER the `/zone/` prefix. PURE.
// A real static file published there would SHADOW the SPA fallback (the host would serve
// the file instead of index.html), so the parser never runs — exactly the brittle state
// the fallback is meant to avoid. A normal Vite build emits none of these.
export function zonePathsInDist(paths = []) {
  if (!Array.isArray(paths)) return [];
  return paths
    .map(normalizePath)
    .filter((f) => f !== '' && f.toLowerCase().startsWith(ZONE_ROUTE_PREFIX));
}

// checkDistRoutes({ paths }) → { ok, skipped, errors, warnings, indexHtml, zonePaths }. PURE.
//   paths: array of built file paths relative to dist/ (the CLI gathers them). When
//          `paths` is omitted/non-array the check is SKIPPED (ok:true) — e.g. no build yet.
// HARD FAIL when a built bundle has no index.html (nothing for the fallback to serve) or
// when a static file is published under `/zone/*` (it would shadow the fallback).
export function checkDistRoutes({ paths } = {}) {
  if (!Array.isArray(paths)) {
    return { ok: true, skipped: true, errors: [], warnings: [], indexHtml: false, zonePaths: [] };
  }
  const errors = [];
  const warnings = [];
  const normalized = paths.map(normalizePath).filter(Boolean);
  const indexHtml = normalized.some((f) => f === `/${INDEX_DOC}`);
  if (!indexHtml) {
    errors.push(`dist/ has no ${INDEX_DOC} — the SPA fallback has no entry document to serve`);
  }
  const zonePaths = zonePathsInDist(paths);
  for (const z of zonePaths) {
    errors.push(`dist/ publishes a static file under ${ZONE_ROUTE_PREFIX}* (${z}) — it would SHADOW the SPA fallback`);
  }
  return { ok: errors.length === 0, skipped: false, errors, warnings, indexHtml, zonePaths };
}

// checkZoneFallbackReadiness({ docs, dist }) → folded { ok, badge, docs, dist, errors,
// warnings }. PURE. `ok` is true iff both the docs guard and the (possibly skipped) dist
// guard pass. Warnings never affect `ok`.
export function checkZoneFallbackReadiness({ docs = {}, dist } = {}) {
  const docResult = checkFallbackDocs(docs);
  const distResult = checkDistRoutes(dist && typeof dist === 'object' ? dist : {});
  const errors = [...docResult.errors, ...distResult.errors];
  const warnings = [...docResult.warnings, ...distResult.warnings];
  return {
    ok: docResult.ok && distResult.ok,
    badge: ZONE_FALLBACK_BADGE,
    docs: docResult,
    dist: distResult,
    errors,
    warnings,
  };
}
