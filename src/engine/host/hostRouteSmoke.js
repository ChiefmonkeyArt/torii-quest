// engine/host/hostRouteSmoke.js — pure, node-safe HOST ROUTE + ASSET SMOKE HARNESS
// (VPS / static-host readiness for torii.quest, v0.2.197, LEAN-1/LEAN-2 support). It
// folds the already-pure static-hosting contracts into ONE fail-fast smoke report so
// future VPS/static-host work can be regression-checked locally without a server,
// shell, DNS, SSH, or network:
//
//   1. root index present        — the SPA entry / fallback document index.html ships
//   2. expected artifacts present — DIST_SPEC.expectedArtifacts (index.html + assets/) ship
//   3. dashboard asset present    — the continuum.html dashboard + its data JSON ship
//   4. update asset present+safe  — release-metadata.json ships AND validates manual-only
//   5. required files documented  — releaseMeta REQUIRED_FILES are accounted for
//   6. zone fallback documented   — VPS_INSTALL.md/torii-quest-handoff.md describe the index.html fallback
//   7. no zone shadow             — no built file under /zone/* would shadow the fallback
//   8. unknown zone → index       — an unknown /zone/<slug> is NOT a built file, so the host
//                                    must serve index.html (and the parser keeps the slug safe)
//   9. zone slug kept safe        — the app route parser classes a good slug ZONE and every
//                                    hostile path INVALID (no navigation, same-origin only)
//  10. no host-side action        — read-only plain data; every report pins
//                                    served/deployed/navigated/performed/external/network=false
//
// A single `ok` answers "do the static-host route/asset readiness contracts still
// hold?" so a test (and a future regression check) can fail fast with a concrete
// `reasons` list instead of a maintainer discovering a 404 on a cold deep-link after
// publishing dist/ to torii.quest.
//
// Constrained by construction — this harness adds NO new capability:
//   - PURE + node-safe: no THREE/Rapier/DOM/window/fs/child_process/network imports. It
//     inspects DETERMINISTIC LOCAL fixtures (a built-path list + doc text strings) only;
//     it never reads the filesystem and never contacts a server.
//   - It composes plain-data outputs of the shipped pure helpers (zoneFallbackReadiness,
//     zoneRoute, releaseMeta); it renders and acts on nothing, exposes NO
//     serve/deploy/fetch/write/navigate surface, and never throws (every check is wrapped;
//     malformed input degrades to a fail).
//   - This is NOT a VPS deployment. It touches no real server, DNS, SSH, or remote command;
//     the §2 host config blocks in VPS_INSTALL.md remain EXAMPLES a maintainer applies by hand.

import { VERSION } from '../../config.js';
import {
  checkFallbackDocs, checkDistRoutes, zonePathsInDist,
  ZONE_ROUTE_PREFIX, REQUIRED_FALLBACK_DOCS,
} from '../../../tools/zoneFallbackReadiness.mjs';
import {
  parseZoneRoute, isValidZoneSlug, ZONE_ROUTE_KIND, DEMO_ZONE_ROUTE,
} from '../gateway/zoneRoute.js';
import {
  buildReleaseMeta, validateReleaseMeta, DIST_SPEC, REQUIRED_FILES, RELEASE_META_FILE,
} from '../../../tools/releaseMeta.mjs';

// HOST_ROUTE_SMOKE_VERSION — bumped when the smoke report shape changes.
export const HOST_ROUTE_SMOKE_VERSION = 1;

// Badge stamped on the report: this exercises host readiness, but read-only + no deploy.
export const HOST_ROUTE_SMOKE_BADGE = 'HOST ROUTE SMOKE · READ-ONLY · NO DEPLOY';

// The static assets a published torii.quest build must serve from its web root. These
// are display-only PATH STRINGS — the harness asserts their presence in a built-path
// fixture, never fetches or serves them.
export const REQUIRED_ASSETS = Object.freeze([
  'index.html',          // SPA entry + the /zone/* fallback document
  'dashboard.html',       // the oversight dashboard (static, same-origin)
  'continuum-data.json', // the dashboard data the page reads (same-origin relative fetch)
  RELEASE_META_FILE.replace(/^public\//, ''), // 'release-metadata.json' at the web root
]);

// Safety flags every host-route report MUST pin false. A flipped flag would mean the
// no-deploy / no-serve / read-only contract is broken.
const SAFETY_FLAGS = Object.freeze([
  'served', 'deployed', 'navigated', 'performed',
  'external', 'network', 'wrote', 'fetched',
]);

// Method/identifier names that would imply the ability to ACT on the host — serve a
// file, run a deploy, reach the wire, or mutate state. The read-only outputs must
// expose NONE of these as a callable.
const FORBIDDEN_METHODS = Object.freeze([
  'serve', 'deploy', 'publish', 'upload', 'fetch', 'write',
  'navigate', 'exec', 'spawn', 'run', 'ssh', 'connect',
]);

// A deterministic LOCAL built-path fixture mirroring a normal Vite `dist/` (paths
// relative to the web root). The newest real build emits this shape; nothing sits
// under /zone/*, so the SPA fallback is unshadowed. Frozen for reproducibility.
export const SAMPLE_DIST_PATHS = Object.freeze([
  'index.html',
  'assets/index-abc123.js',
  'assets/three-vendor-def456.js',
  'assets/rapier-ghi789.js',
  'assets/rolldown-runtime-jkl012.js',
  'dashboard.html',
  'continuum-data.json',
  'release-metadata.json',
  'sw.js',
  'torii-gate.glb',
  'bitcoin-b.png',
]);

// A deterministic LOCAL doc fixture carrying the SPA-fallback directive + the /zone/
// prefix, exactly what checkFallbackDocs() requires of the REAL docs. Used so the
// harness proves the CONTRACT independent of the live doc text; the regression check
// [15] still guards the real files. Frozen.
export const SAMPLE_FALLBACK_DOCS = Object.freeze({
  'VPS_INSTALL.md':
    'Serve the SPA: nginx `try_files $uri $uri/ /index.html;` so any /zone/<slug> '
    + 'deep-link falls back to index.html (Caddy: `try_files {path} /index.html`).',
  'torii-quest-handoff.md':
    'Static host must serve index.html for any unmatched /zone/* path (SPA fallback) '
    + 'so a cold deep-link to /zone/<slug> loads the app, not a host 404.',
});

// The sample zone slug a cold deep-link would hit (the route the v0.2.181 portal
// pushes). Display-only — never navigated.
export const SAMPLE_ZONE_SLUG = 'plebeian-market-bazaar';

// Hostile / malformed path strings the app route parser MUST reject as INVALID so a
// crafted deep-link can never navigate off-origin or escape the zone grammar. Frozen.
export const HOSTILE_ZONE_PATHS = Object.freeze([
  'https://evil.example/zone/x',  // absolute scheme / off-origin
  '//evil.example/zone/x',        // protocol-relative
  '/zone/../secret',              // dot-dot traversal
  '/zone/a/b',                    // sub-path (not exactly one segment)
  '/zone/Bad_Slug',               // uppercase + underscore (fails strict slug)
  '/zone/',                       // empty slug
  '/zone/%2e%2e',                 // percent-encoding
  'javascript:alert(1)',          // js scheme
]);

// _normalize(p) → leading-slash, forward-slash path (mirrors the tool's helper). PURE.
function _normalize(p) {
  if (typeof p !== 'string' || p === '') return '';
  const f = p.replace(/\\/g, '/').replace(/^\.\//, '');
  return f.startsWith('/') ? f : `/${f}`;
}

// _hasAsset(paths, asset) → true iff the built-path list contains the asset (compared
// as a web-root path). PURE.
function _hasAsset(paths, asset) {
  const want = _normalize(asset);
  return paths.some((p) => _normalize(p) === want);
}

// _flagsAllFalse(report) → true iff every SAFETY_FLAG present on the report is false. A
// missing flag is treated as safe (false); a flag exactly `true` fails.
function _flagsAllFalse(report) {
  if (!report || typeof report !== 'object') return true;
  for (const f of SAFETY_FLAGS) {
    if (report[f] === true) return false;
  }
  return true;
}

// _noForbiddenMethods(obj) → true iff `obj` exposes none of FORBIDDEN_METHODS as a
// callable. A forbidden name that is a non-function value is allowed; only a callable
// would imply the ability to act. PURE.
function _noForbiddenMethods(obj) {
  if (!obj || typeof obj !== 'object') return true;
  for (const name of FORBIDDEN_METHODS) {
    if (typeof obj[name] === 'function') return false;
  }
  return true;
}

// _signal(key, label, ok, detail) → a plain-data smoke signal row.
function _signal(key, label, ok, detail) {
  return { key, label, status: ok ? 'ok' : 'fail', detail: String(detail || '') };
}

// runHostRouteSmoke(opts?) → a JSON-serialisable, read-only smoke report:
//   {
//     version, badge, ok,
//     signals: [ { key, label, status:'ok'|'fail', detail } ],
//     summary: { total, ok, fail },
//     safety:  { served:false, deployed:false, navigated:false, ... },  // contract
//     reasons: [ ... ],   // failing signal keys + details (empty iff ok)
//     rendered: false, actionable: false,
//   }
// `ok` is true iff ALL signals pass AND no exercised report flipped a safety flag.
// Fixtures may be injected via opts (distPaths / fallbackDocs / zoneSlug / hostile) so a
// test can drive a deliberately-broken layout and prove the harness catches it. Pure —
// never throws, never reads the filesystem, never contacts a server.
export function runHostRouteSmoke(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const distPaths = Array.isArray(o.distPaths) ? o.distPaths : SAMPLE_DIST_PATHS;
  const fallbackDocs = (o.fallbackDocs && typeof o.fallbackDocs === 'object') ? o.fallbackDocs : SAMPLE_FALLBACK_DOCS;
  const zoneSlug = typeof o.zoneSlug === 'string' ? o.zoneSlug : SAMPLE_ZONE_SLUG;
  const hostile = Array.isArray(o.hostile) ? o.hostile : HOSTILE_ZONE_PATHS;

  const signals = [];
  let safetyClean = true;
  const _watch = (report) => { if (!_flagsAllFalse(report)) safetyClean = false; return report; };

  // 1. Root index present — the SPA entry / fallback document ships at the web root.
  try {
    const ok = _hasAsset(distPaths, 'index.html');
    signals.push(_signal('root-index-present', 'Root index.html present', ok, ok ? 'index.html at web root' : 'no index.html in built paths'));
  } catch (e) {
    signals.push(_signal('root-index-present', 'Root index.html present', false, `threw: ${e.message}`));
  }

  // 2. Expected artifacts present — DIST_SPEC.expectedArtifacts all accounted for (the
  // `assets` dir is matched by any built path under assets/).
  try {
    const missing = [];
    for (const art of DIST_SPEC.expectedArtifacts) {
      const present = art === 'assets'
        ? distPaths.some((p) => _normalize(p).startsWith('/assets/'))
        : _hasAsset(distPaths, art);
      if (!present) missing.push(art);
    }
    signals.push(_signal(
      'expected-artifacts-present',
      'DIST_SPEC artifacts present',
      missing.length === 0,
      missing.length === 0 ? `all present: ${DIST_SPEC.expectedArtifacts.join(', ')}` : `missing: ${missing.join(', ')}`,
    ));
  } catch (e) {
    signals.push(_signal('expected-artifacts-present', 'DIST_SPEC artifacts present', false, `threw: ${e.message}`));
  }

  // 3. Dashboard asset present — the continuum dashboard page + its data JSON ship as
  // same-origin static assets.
  try {
    const page = _hasAsset(distPaths, 'dashboard.html');
    const data = _hasAsset(distPaths, 'continuum-data.json');
    signals.push(_signal(
      'dashboard-asset-present',
      'Continuum dashboard asset present',
      page && data,
      `dashboard.html=${page}, continuum-data.json=${data}`,
    ));
  } catch (e) {
    signals.push(_signal('dashboard-asset-present', 'Continuum dashboard asset present', false, `threw: ${e.message}`));
  }

  // 4. Update asset present + safe — release-metadata.json ships at the web root AND the
  // metadata it carries validates as manual-only / non-actionable (no-auto-update floor).
  try {
    const assetName = RELEASE_META_FILE.replace(/^public\//, '');
    const present = _hasAsset(distPaths, assetName);
    const meta = buildReleaseMeta({ version: VERSION });
    const v = validateReleaseMeta(meta);
    const safe = v.ok === true && meta.update.autoUpdate === false && meta.update.actionable === false;
    signals.push(_signal(
      'update-asset-present',
      'Release metadata asset present + manual-only',
      present && safe,
      `present=${present}, valid=${v.ok}, autoUpdate=${meta.update.autoUpdate}, actionable=${meta.update.actionable}`,
    ));
  } catch (e) {
    signals.push(_signal('update-asset-present', 'Release metadata asset present + manual-only', false, `threw: ${e.message}`));
  }

  // 5. Required files documented — every releaseMeta REQUIRED_FILE is a named release
  // floor entry (the publish contract a future checker enforces). index.html must also
  // be a served asset (it is both a repo file and the web-root entry).
  try {
    const missing = REQUIRED_FILES.filter((f) => typeof f !== 'string' || f === '');
    const indexServed = _hasAsset(distPaths, 'index.html');
    signals.push(_signal(
      'required-files-documented',
      'Release REQUIRED_FILES floor intact',
      missing.length === 0 && REQUIRED_FILES.includes('index.html') && indexServed,
      `floor=[${REQUIRED_FILES.join(', ')}], index.html served=${indexServed}`,
    ));
  } catch (e) {
    signals.push(_signal('required-files-documented', 'Release REQUIRED_FILES floor intact', false, `threw: ${e.message}`));
  }

  // 6. Zone fallback documented — the required docs describe the index.html SPA fallback
  // for /zone/* (the one outstanding hosting prerequisite). Exercised over the fixture.
  try {
    const docResult = checkFallbackDocs(fallbackDocs);
    signals.push(_signal(
      'zone-fallback-documented',
      'SPA /zone/* fallback documented',
      docResult.ok === true,
      docResult.ok ? `documented in ${REQUIRED_FALLBACK_DOCS.join(', ')}` : docResult.errors.join('; '),
    ));
  } catch (e) {
    signals.push(_signal('zone-fallback-documented', 'SPA /zone/* fallback documented', false, `threw: ${e.message}`));
  }

  // 7. No zone shadow — no built file sits under /zone/* (a real file there would be
  // served instead of index.html, defeating the fallback). dist must also have index.html.
  try {
    const distResult = checkDistRoutes({ paths: distPaths });
    const shadows = zonePathsInDist(distPaths);
    signals.push(_signal(
      'no-zone-shadow',
      'No built file shadows /zone/* fallback',
      distResult.ok === true && shadows.length === 0,
      shadows.length === 0 ? `no file under ${ZONE_ROUTE_PREFIX}*` : `shadows: ${shadows.join(', ')}`,
    ));
  } catch (e) {
    signals.push(_signal('no-zone-shadow', 'No built file shadows /zone/* fallback', false, `threw: ${e.message}`));
  }

  // 8. Unknown zone → index — a cold deep-link /zone/<slug> is NOT a built file, so the
  // host's SPA fallback must serve index.html; the app parser then resolves the slug as a
  // (valid) zone. Proves the deep-link path end-to-end without a server.
  try {
    const route = `${ZONE_ROUTE_PREFIX}${zoneSlug}`;
    const isBuiltFile = SAMPLE_DIST_PATHS.length >= 0 && _hasAsset(distPaths, route.replace(/^\//, ''));
    const parsed = _watch(parseZoneRoute(route));
    const ok = isBuiltFile === false && parsed.kind === ZONE_ROUTE_KIND.ZONE && parsed.ok === true
      && parsed.navigated === false;
    signals.push(_signal(
      'unknown-zone-served-index',
      'Unknown /zone/<slug> falls back to index.html',
      ok,
      `builtFile=${isBuiltFile} (→ host serves index.html), parser kind=${parsed.kind}, navigated=${parsed.navigated}`,
    ));
  } catch (e) {
    signals.push(_signal('unknown-zone-served-index', 'Unknown /zone/<slug> falls back to index.html', false, `threw: ${e.message}`));
  }

  // 9. Zone slug kept safe — the route parser classes a good slug ZONE and every hostile
  // path INVALID, never navigating and never leaving the origin.
  try {
    const good = _watch(parseZoneRoute(DEMO_ZONE_ROUTE));
    const goodOk = good.kind === ZONE_ROUTE_KIND.ZONE && isValidZoneSlug(good.slug);
    const leaked = [];
    for (const p of hostile) {
      const r = _watch(parseZoneRoute(p));
      if (r.kind !== ZONE_ROUTE_KIND.INVALID || r.navigated !== false || r.external !== false) {
        leaked.push(p);
      }
    }
    signals.push(_signal(
      'zone-slug-kept-safe',
      'Parser keeps slug safe (good ZONE, hostile INVALID)',
      goodOk && leaked.length === 0,
      leaked.length === 0 ? `good slug ok; all ${hostile.length} hostile paths rejected` : `leaked: ${leaked.join(', ')}`,
    ));
  } catch (e) {
    signals.push(_signal('zone-slug-kept-safe', 'Parser keeps slug safe (good ZONE, hostile INVALID)', false, `threw: ${e.message}`));
  }

  // 10. No host-side action — every exercised report kept all safety flags false, and the
  // readiness path is synchronous plain data (never a Promise → never an awaited fetch/serve).
  try {
    const parsed = parseZoneRoute(DEMO_ZONE_ROUTE);
    const synchronous = typeof parsed.then !== 'function';
    const noSurface = _noForbiddenMethods(parsed) && _noForbiddenMethods(buildReleaseMeta({ version: VERSION }));
    signals.push(_signal(
      'no-host-side-action',
      'No serve / deploy / fetch action',
      safetyClean === true && synchronous && noSurface,
      safetyClean && synchronous && noSurface
        ? 'all reports pinned served/deployed/navigated/performed/external/network=false; no serve/deploy/fetch surface; synchronous'
        : (!noSurface ? 'an output exposed a serve/deploy/fetch callable' : (synchronous ? 'a report flipped a safety flag' : 'readiness path returned a thenable')),
    ));
  } catch (e) {
    signals.push(_signal('no-host-side-action', 'No serve / deploy / fetch action', false, `threw: ${e.message}`));
  }

  const failed = signals.filter((s) => s.status !== 'ok');
  const reasons = failed.map((s) => `${s.key}: ${s.detail}`);

  return {
    version: HOST_ROUTE_SMOKE_VERSION,
    badge: HOST_ROUTE_SMOKE_BADGE,
    ok: failed.length === 0,
    signals,
    summary: { total: signals.length, ok: signals.length - failed.length, fail: failed.length },
    // Observed safety posture — all false in a clean run (mirrors the contract).
    safety: {
      served: false, deployed: false, navigated: false, performed: false,
      external: false, network: false, wrote: false, fetched: false,
    },
    reasons,
    // A smoke harness, not a deploy tool — never renders or acts.
    rendered: false,
    actionable: false,
  };
}

// formatHostRouteSmoke(result) → a stable, human-readable text block for a debug shell
// / audit log. Pure, never throws, safe on null.
export function formatHostRouteSmoke(result) {
  const r = (result && typeof result === 'object') ? result : runHostRouteSmoke();
  const lines = [];
  lines.push(r.badge || HOST_ROUTE_SMOKE_BADGE);
  const s = r.summary || { total: 0, ok: 0, fail: 0 };
  lines.push(`verdict: ${r.ok ? 'OK' : 'FAIL'}  (${s.ok}/${s.total} signals)`);
  for (const sig of (Array.isArray(r.signals) ? r.signals : [])) {
    lines.push(`  ${sig.status === 'ok' ? '✓' : '✗'} ${sig.label} — ${sig.detail}`);
  }
  if (Array.isArray(r.reasons) && r.reasons.length) {
    lines.push(`reasons: ${r.reasons.join('; ')}`);
  }
  return lines.join('\n');
}
