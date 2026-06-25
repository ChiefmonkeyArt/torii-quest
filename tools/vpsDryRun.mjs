// tools/vpsDryRun.mjs — PURE, node-safe VPS/static-host INSTALL DRY-RUN checklist (v0.2.193).
// Validates the LOCAL repo/build/docs readiness an operator needs BEFORE deploying torii.quest
// to a VPS or static host — WITHOUT SSH, network, DNS, or any server change. It only inspects
// plain inputs (doc text + a list of built file paths + the parsed release-metadata object) and
// reports a clear per-item pass/fail/warn/skip checklist. It is a readiness GUARD, not a deploy
// step: nothing here connects anywhere, writes anything, or implies an install happened.
//
// Constrained by construction (mirrors tools/zoneFallbackReadiness.mjs + tools/releaseMeta.mjs):
//   - PURE + node-safe: NO fs / network / child_process / SSH / THREE / DOM here. The CLI
//     (tools/vps-dry-run.mjs) does the fs reads and hands plain { name → content } strings, a
//     dist path array, and the parsed release-metadata object to these helpers. Deterministic +
//     plain-data so the logic is unit-testable (tests/vps-dry-run.test.js).
//   - READ-ONLY: never writes a file, never emits a server config, never contacts a host.
//
// Reuses the already-shipped pure guards so the dry-run stays consistent with the gate:
//   - validateReleaseMeta() (releaseMeta.mjs) — the manual/no-auto-update safety floor.
//   - fallbackEvidence()   (zoneFallbackReadiness.mjs) — the /zone/* SPA-fallback signal.
import { validateReleaseMeta, DEFAULT_SOURCE } from './releaseMeta.mjs';
import { fallbackEvidence } from './zoneFallbackReadiness.mjs';

export const VPS_DRY_RUN_BADGE = 'VPS INSTALL DRY-RUN · LOCAL · READ-ONLY · NO SSH/NETWORK/DNS';

// The docs an operator must have in order before a deploy. Missing any is a hard fail.
export const REQUIRED_DOCS = Object.freeze(['VPS_INSTALL.md', 'UPDATE_CHECK.md', 'HANDOFF.md']);

// Section anchors VPS_INSTALL.md must carry so the manual install/update/rollback story is
// complete. Matched case-insensitively as substrings of a heading line.
export const REQUIRED_VPS_SECTIONS = Object.freeze([
  'build',            // get-the-code / build / place the bundle
  'manual update',    // the deliberate human-run update sequence
  'rollback',         // re-point the symlink at a prior release
  'security',         // the no-auto-update / least-privilege notes
]);

// The build/verify commands a deploy doc must spell out so an operator can reproduce a release.
export const REQUIRED_BUILD_COMMANDS = Object.freeze(['npm run build', 'npm run check']);

// The real GitHub repo the metadata + docs must reference (NOT the legacy placeholder).
export const REAL_REPO_SLUG = `${DEFAULT_SOURCE.owner}/${DEFAULT_SOURCE.repo}`;

// The live deploy targets that should be unambiguous in the handoff docs.
export const LIVE_URLS = Object.freeze(['torii.quest', 'torii-quest.pplx.app']);

const PASS = 'pass';
const FAIL = 'fail';
const WARN = 'warn';
const SKIP = 'skip';

function check(id, label, status, detail) {
  return { id, label, status, detail };
}

// hasText(s) → true for a non-empty string. PURE.
function hasText(s) {
  return typeof s === 'string' && s.length > 0;
}

// containsCI(text, needle) → case-insensitive substring test. PURE; safe on non-strings.
function containsCI(text, needle) {
  if (!hasText(text) || !hasText(needle)) return false;
  return text.toLowerCase().includes(needle.toLowerCase());
}

// --- individual checks (each PURE, returns one checklist row) ----------------------------------

// dist/ readiness. SKIPPED when there is no build yet (paths omitted/non-array) — a dry-run is
// useful before a build too. When a build IS present it must carry index.html.
export function checkDistBundle(dist) {
  const paths = dist && Array.isArray(dist.paths) ? dist.paths : null;
  if (!paths) {
    return check('dist-bundle', 'dist/ built with index.html', SKIP,
      'no dist/ — run `npm run build` before deploying (skipped, not a failure)');
  }
  const norm = paths.filter((p) => typeof p === 'string').map((p) => p.replace(/\\/g, '/').replace(/^\.?\//, ''));
  const hasIndex = norm.includes('index.html');
  const hasMeta = norm.includes('release-metadata.json');
  if (!hasIndex) {
    return check('dist-bundle', 'dist/ built with index.html', FAIL,
      'dist/ has no index.html — the static host has no entry document to serve');
  }
  const note = hasMeta
    ? 'index.html present; release-metadata.json copied into dist/'
    : 'index.html present (release-metadata.json not yet in dist/ — rebuild to copy public/)';
  return check('dist-bundle', 'dist/ built with index.html', hasMeta ? PASS : WARN, note);
}

// release-metadata.json present + parseable. The in-repo copy is intentionally UNSTAMPED
// (commit/generatedAt null) so re-running `npm run release:meta -- --write` never churns the
// working tree; the DEPLOYED copy bakes provenance via `--write --stamp` at deploy time. Either
// state PASSes — the detail just reports which one this is so the operator's expectation is honest.
export function checkReleaseMetaPresent(releaseMeta) {
  if (!releaseMeta || typeof releaseMeta !== 'object' || Array.isArray(releaseMeta)) {
    return check('release-meta-present', 'release-metadata.json present + parseable', FAIL,
      'public/release-metadata.json missing or unparseable — run `npm run release:meta -- --write`');
  }
  const stamped = hasText(releaseMeta.commit) && hasText(releaseMeta.generatedAt);
  const stampNote = stamped
    ? `stamped (commit ${releaseMeta.commit}, generatedAt ${releaseMeta.generatedAt})`
    : 'unstamped in-repo template (commit/generatedAt null by design; deploy bakes provenance via `npm run release:meta -- --write --stamp`)';
  return check('release-meta-present', 'release-metadata.json present + parseable', PASS,
    `version ${releaseMeta.version ?? '(unknown)'} / channel ${releaseMeta.channel ?? '(unknown)'} — ${stampNote}`);
}

// release metadata enforces the manual/no-auto-update safety floor (reuses validateReleaseMeta).
export function checkReleaseMetaManualOnly(releaseMeta) {
  const { ok, errors } = validateReleaseMeta(releaseMeta);
  const upd = releaseMeta && typeof releaseMeta === 'object' ? releaseMeta.update : null;
  const manualOnly = !!upd && upd.manual === true && upd.autoUpdate === false && upd.actionable === false;
  if (!manualOnly) {
    return check('release-meta-manual-only', 'metadata is manual-only / non-actionable', FAIL,
      'update.manual must be true and update.autoUpdate/actionable must be false');
  }
  if (!ok) {
    return check('release-meta-manual-only', 'metadata is manual-only / non-actionable', WARN,
      `manual-only contract holds, but metadata has other validation errors: ${errors.join('; ')}`);
  }
  return check('release-meta-manual-only', 'metadata is manual-only / non-actionable', PASS,
    'manual=true, autoUpdate=false, actionable=false (validated)');
}

// metadata + UPDATE_CHECK.md reference the REAL repo, not the legacy placeholder.
export function checkRealRepoMetadata(releaseMeta, updateCheckDoc) {
  const src = releaseMeta && typeof releaseMeta === 'object' ? releaseMeta.source : null;
  const metaSlug = src && hasText(src.owner) && hasText(src.repo) ? `${src.owner}/${src.repo}` : null;
  const metaOk = metaSlug === REAL_REPO_SLUG;
  const docOk = containsCI(updateCheckDoc, REAL_REPO_SLUG);
  if (!metaOk) {
    return check('real-repo-metadata', `metadata points at ${REAL_REPO_SLUG}`, FAIL,
      `release-metadata source is ${metaSlug ?? '(missing)'} — expected ${REAL_REPO_SLUG}`);
  }
  if (!docOk) {
    return check('real-repo-metadata', `metadata points at ${REAL_REPO_SLUG}`, WARN,
      `metadata is correct but UPDATE_CHECK.md does not mention ${REAL_REPO_SLUG}`);
  }
  return check('real-repo-metadata', `metadata points at ${REAL_REPO_SLUG}`, PASS,
    `metadata + UPDATE_CHECK.md both reference ${REAL_REPO_SLUG}`);
}

// VPS_INSTALL.md + HANDOFF.md document the SPA /zone/* → index.html fallback (reuse the guard).
export function checkZoneFallbackDocs(vpsDoc, handoffDoc) {
  const vps = fallbackEvidence(vpsDoc);
  const handoff = fallbackEvidence(handoffDoc);
  const vpsOk = vps.indexFallback && vps.zonePath;
  if (!vps.indexFallback) {
    return check('zone-fallback-docs', '/zone/* SPA fallback documented', FAIL,
      'VPS_INSTALL.md does not show an index.html SPA fallback (serve index.html for /zone/* paths)');
  }
  if (!vpsOk || !handoff.indexFallback) {
    return check('zone-fallback-docs', '/zone/* SPA fallback documented', WARN,
      'VPS_INSTALL.md shows the index.html fallback but the /zone/ route link is thin in VPS_INSTALL.md/HANDOFF.md');
  }
  return check('zone-fallback-docs', '/zone/* SPA fallback documented', PASS,
    'VPS_INSTALL.md + HANDOFF.md describe the /zone/* → index.html fallback');
}

// VPS_INSTALL.md carries the required install/update/rollback/security sections.
export function checkVpsSections(vpsDoc) {
  if (!hasText(vpsDoc)) {
    return check('vps-sections', 'VPS_INSTALL.md required sections present', FAIL,
      'VPS_INSTALL.md missing or unreadable');
  }
  const missing = REQUIRED_VPS_SECTIONS.filter((s) => !containsCI(vpsDoc, s));
  if (missing.length) {
    return check('vps-sections', 'VPS_INSTALL.md required sections present', FAIL,
      `VPS_INSTALL.md is missing section(s): ${missing.join(', ')}`);
  }
  return check('vps-sections', 'VPS_INSTALL.md required sections present', PASS,
    `all required sections present: ${REQUIRED_VPS_SECTIONS.join(', ')}`);
}

// build/verify commands are spelled out in the deploy docs (VPS_INSTALL.md or HANDOFF.md).
export function checkBuildCommands(vpsDoc, handoffDoc) {
  const corpus = `${vpsDoc || ''}\n${handoffDoc || ''}`;
  const missing = REQUIRED_BUILD_COMMANDS.filter((c) => !containsCI(corpus, c));
  if (missing.length) {
    return check('build-commands', 'build/verify commands documented', FAIL,
      `deploy docs do not document: ${missing.join(', ')}`);
  }
  return check('build-commands', 'build/verify commands documented', PASS,
    `documented: ${REQUIRED_BUILD_COMMANDS.join(', ')}`);
}

// rollback + manual/no-auto-update safety wording present in VPS_INSTALL.md.
export function checkRollbackSafety(vpsDoc) {
  const hasRollback = containsCI(vpsDoc, 'rollback') && containsCI(vpsDoc, 'symlink');
  const hasManual = containsCI(vpsDoc, 'no auto-update') || containsCI(vpsDoc, 'no-auto-update') ||
    containsCI(vpsDoc, 'manual') ;
  if (!hasRollback) {
    return check('rollback-safety', 'rollback + manual-update safety wording', FAIL,
      'VPS_INSTALL.md does not describe the symlink rollback model');
  }
  if (!hasManual) {
    return check('rollback-safety', 'rollback + manual-update safety wording', WARN,
      'rollback documented but the manual / no-auto-update wording is thin');
  }
  return check('rollback-safety', 'rollback + manual-update safety wording', PASS,
    'symlink rollback + manual/no-auto-update wording present');
}

// service-worker cache-busting documented. torii DOES ship a same-origin service worker
// (public/sw.js, registered from index.html: cache-first for static assets, network-first for
// HTML/JS/CSS). So an atomic symlink-flip alone is NOT enough — precached static assets persist
// on clients until sw.js's CACHE_VERSION is bumped. An operator must be told this, so the doc has
// to spell out cache-busting / update hygiene, not merely mention "service worker" in passing.
const SW_CACHE_TERMS = Object.freeze([
  'cache-bust', 'cache bust', 'cache_version', 'cache version', 'cache-version', 'cache invalidation',
]);
export function checkServiceWorkerCaveat(vpsDoc) {
  const mentionsSW = containsCI(vpsDoc, 'service worker') || containsCI(vpsDoc, 'service-worker');
  if (!mentionsSW) {
    return check('service-worker-cache-busting', 'service-worker cache-busting documented', FAIL,
      'VPS_INSTALL.md does not document the service worker (the app ships public/sw.js, registered from index.html)');
  }
  const mentionsCacheBust = SW_CACHE_TERMS.some((t) => containsCI(vpsDoc, t));
  if (!mentionsCacheBust) {
    return check('service-worker-cache-busting', 'service-worker cache-busting documented', FAIL,
      'service worker mentioned but cache-busting / update hygiene is not documented (bump sw.js CACHE_VERSION when precached assets change)');
  }
  return check('service-worker-cache-busting', 'service-worker cache-busting documented', PASS,
    'app ships sw.js — cache-busting / update hygiene documented (bump CACHE_VERSION when precached assets change)');
}

// live URL references are clear in the handoff docs.
export function checkLiveUrls(handoffDoc) {
  const missing = LIVE_URLS.filter((u) => !containsCI(handoffDoc, u));
  if (missing.length === LIVE_URLS.length) {
    return check('live-urls', 'live URL references clear', FAIL,
      `HANDOFF.md references none of: ${LIVE_URLS.join(', ')}`);
  }
  if (missing.length) {
    return check('live-urls', 'live URL references clear', WARN,
      `HANDOFF.md does not mention: ${missing.join(', ')}`);
  }
  return check('live-urls', 'live URL references clear', PASS,
    `HANDOFF.md references: ${LIVE_URLS.join(', ')}`);
}

// runVpsDryRun({ docs, dist, releaseMeta }) → folded checklist. PURE; never throws.
//   docs:        { 'VPS_INSTALL.md': str, 'UPDATE_CHECK.md': str, 'HANDOFF.md': str, ... }
//   dist:        { paths: [..] } or omitted (no build → the dist row is SKIPPED)
//   releaseMeta: parsed public/release-metadata.json object, or null when missing/unparseable
// `ok` is true iff NO check failed. warn/skip never flip `ok`.
export function runVpsDryRun(input) {
  const { docs = {}, dist, releaseMeta = null } = (input && typeof input === 'object') ? input : {};
  const d = docs && typeof docs === 'object' ? docs : {};
  const vpsDoc = d['VPS_INSTALL.md'];
  const updateCheckDoc = d['UPDATE_CHECK.md'];
  const handoffDoc = d['HANDOFF.md'];

  const checks = [];

  // Required docs must be readable at all before the content checks mean anything.
  const missingDocs = REQUIRED_DOCS.filter((name) => !hasText(d[name]));
  checks.push(missingDocs.length
    ? check('required-docs', 'required deploy docs present', FAIL, `missing/unreadable: ${missingDocs.join(', ')}`)
    : check('required-docs', 'required deploy docs present', PASS, REQUIRED_DOCS.join(', ')));

  checks.push(checkDistBundle(dist));
  checks.push(checkReleaseMetaPresent(releaseMeta));
  checks.push(checkReleaseMetaManualOnly(releaseMeta));
  checks.push(checkRealRepoMetadata(releaseMeta, updateCheckDoc));
  checks.push(checkZoneFallbackDocs(vpsDoc, handoffDoc));
  checks.push(checkVpsSections(vpsDoc));
  checks.push(checkBuildCommands(vpsDoc, handoffDoc));
  checks.push(checkRollbackSafety(vpsDoc));
  checks.push(checkServiceWorkerCaveat(vpsDoc));
  checks.push(checkLiveUrls(handoffDoc));

  const summary = { pass: 0, fail: 0, warn: 0, skip: 0, total: checks.length };
  for (const c of checks) {
    if (c.status === PASS) summary.pass++;
    else if (c.status === FAIL) summary.fail++;
    else if (c.status === WARN) summary.warn++;
    else if (c.status === SKIP) summary.skip++;
  }

  return {
    ok: summary.fail === 0,
    badge: VPS_DRY_RUN_BADGE,
    checks,
    summary,
    errors: checks.filter((c) => c.status === FAIL).map((c) => `${c.label}: ${c.detail}`),
    warnings: checks.filter((c) => c.status === WARN).map((c) => `${c.label}: ${c.detail}`),
  };
}

// formatVpsDryRun(result) → a concise terminal block. PURE; safe on null.
export function formatVpsDryRun(result) {
  if (!result || typeof result !== 'object' || !Array.isArray(result.checks)) {
    return 'vps:dry-run: (no result)';
  }
  const glyph = { pass: '✓', fail: '✗', warn: '·', skip: '–' };
  const L = [];
  L.push('Torii Quest — VPS install dry-run');
  L.push('─'.repeat(60));
  L.push(result.badge || VPS_DRY_RUN_BADGE);
  L.push('');
  for (const c of result.checks) {
    L.push(`${glyph[c.status] || '?'} [${c.status.toUpperCase()}] ${c.label}`);
    if (c.detail) L.push(`      ${c.detail}`);
  }
  const s = result.summary || {};
  L.push('');
  L.push(`summary: ${s.pass || 0} pass · ${s.fail || 0} fail · ${s.warn || 0} warn · ${s.skip || 0} skip`);
  L.push(result.ok ? 'VPS INSTALL DRY-RUN READY (no blocking failures)' : `${s.fail || 0} BLOCKING FAILURE(S)`);
  L.push('─'.repeat(60));
  return L.join('\n');
}
