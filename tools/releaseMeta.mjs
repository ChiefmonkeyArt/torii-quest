// tools/releaseMeta.mjs — PURE, node-safe RELEASE/UPDATE METADATA helpers (v0.2.192).
// Prepares the static metadata a FUTURE torii.quest / VPS update-checker will read to decide
// whether a newer GitHub release exists than the version a host is serving — WITHOUT performing
// any live update, install, or network fetch. This module only SHAPES + VALIDATES the metadata
// object; the thin CLI (tools/release-meta.mjs) does the fs/git I/O and the (flag-gated,
// in-repo) write. Build-time only — never imported by the game; NO fs/network/child_process/
// THREE/DOM in here. Deterministic + plain-data so the logic is unit-testable
// (tests/release-meta.test.js).
//
// SAFETY CONTRACT (enforced by validateReleaseMeta): the metadata is descriptive only. It NEVER
// authorises an auto-update — `update.autoUpdate` and `update.actionable` MUST be false, and a
// validator ERROR is raised if they are not. Deploying a release stays a deliberate MANUAL
// maintainer step (HANDOFF.md §7 / VPS_INSTALL.md §7,§10 / UPDATE_CHECK.md §4).

export const RELEASE_META_BADGE = 'RELEASE METADATA · LOCAL · READ-ONLY · NO AUTO-UPDATE';

// Bump when the metadata shape changes in a way a consumer must notice.
export const METADATA_SCHEMA_VERSION = 1;

// Self-identifying kind tag + the canonical in-repo output path the CLI writes (with --write).
export const RELEASE_META_KIND = 'torii-release-metadata';
export const RELEASE_META_FILE = 'public/release-metadata.json';

// Update channels derived from the prerelease tag of a version marker.
export const UPDATE_CHANNELS = Object.freeze({
  STABLE: 'stable',
  ALPHA: 'alpha',
  BETA: 'beta',
  RC: 'rc',
  UNKNOWN: 'unknown',
});

// Where the latest-release data WOULD be fetched from — the real GitHub repo;
// documentation only, nothing here fetches. (RELEASE_SOURCE in
// src/engine/update/updateCheck.js was corrected to the same real repo in v0.2.193 —
// it is documentation-only too, performs no I/O.)
export const DEFAULT_SOURCE = Object.freeze({
  owner: 'ChiefmonkeyArt',
  repo: 'torii-gate',
});

// What a published build is expected to contain. A VPS checker can assert these before flipping
// the served release (see VPS_INSTALL.md §7).
export const DIST_SPEC = Object.freeze({
  buildCommand: 'npm run build',
  outputDir: 'dist',
  entry: 'index.html',
  expectedArtifacts: Object.freeze(['index.html', 'assets']),
});

// Minimum files/checks a release is expected to ship/pass — the floor a future updater verifies
// before it would ever consider a release publishable.
export const REQUIRED_FILES = Object.freeze(['index.html', 'package.json', 'src/config.js']);
export const REQUIRED_CHECKS = Object.freeze(['npm run check', 'npm test']);

// Human-facing safety/consent wording carried IN the metadata so any surface that renders it
// inherits the manual/no-auto-update contract verbatim.
export const CONSENT_TEXT =
  'Updates are MANUAL. A maintainer reviews and deploys each release by hand; ' +
  'torii.quest never downloads, installs, or runs new code on its own.';
export const UPDATE_NOTICE =
  'This metadata only DESCRIBES the latest known release so an instance can show an inert ' +
  '"update available" notice. It performs no fetch and authorises no action.';

// A version marker like `v0.2.192-alpha` (lowercase tag).
const VERSION_MARKER_RE = /^v\d+\.\d+\.\d+(?:-[a-z][a-z0-9.]*)?$/i;

function isVersionMarker(s) {
  return typeof s === 'string' && VERSION_MARKER_RE.test(s.trim());
}

// channelForVersion('v0.2.192-alpha') → 'alpha'. No prerelease tag → 'stable'; an unrecognised
// tag → 'unknown'; bad input → 'unknown'. Pure.
export function channelForVersion(version) {
  if (typeof version !== 'string' || !isVersionMarker(version)) return UPDATE_CHANNELS.UNKNOWN;
  const dash = version.indexOf('-');
  if (dash === -1) return UPDATE_CHANNELS.STABLE;
  const tag = version.slice(dash + 1).split('.')[0].toLowerCase();
  switch (tag) {
    case 'alpha': return UPDATE_CHANNELS.ALPHA;
    case 'beta': return UPDATE_CHANNELS.BETA;
    case 'rc': return UPDATE_CHANNELS.RC;
    default: return UPDATE_CHANNELS.UNKNOWN;
  }
}

// releaseUrlsFor('owner', 'repo') → the documentation-only GitHub endpoints. Pure.
export function releaseUrlsFor(owner, repo) {
  const o = encodeURIComponent(owner);
  const r = encodeURIComponent(repo);
  return {
    latestReleaseUrl: `https://api.github.com/repos/${o}/${r}/releases/latest`,
    releasesPageUrl: `https://github.com/${o}/${r}/releases`,
  };
}

// buildReleaseMeta({ version, commit, owner, repo, generatedAt }) → the canonical metadata
// object a host/VPS update checker reads. Pure — derives everything from its plain inputs and
// the frozen specs above. Missing/blank commit → null. owner/repo default to DEFAULT_SOURCE.
export function buildReleaseMeta({ version, commit = null, owner, repo, generatedAt = null } = {}) {
  const ownerName = typeof owner === 'string' && owner ? owner : DEFAULT_SOURCE.owner;
  const repoName = typeof repo === 'string' && repo ? repo : DEFAULT_SOURCE.repo;
  const urls = releaseUrlsFor(ownerName, repoName);
  return {
    kind: RELEASE_META_KIND,
    schemaVersion: METADATA_SCHEMA_VERSION,
    generatedAt: typeof generatedAt === 'string' && generatedAt ? generatedAt : null,
    channel: channelForVersion(version),
    version: typeof version === 'string' ? version : null,
    commit: typeof commit === 'string' && commit ? commit : null,
    source: {
      owner: ownerName,
      repo: repoName,
      latestReleaseUrl: urls.latestReleaseUrl,
      releasesPageUrl: urls.releasesPageUrl,
    },
    dist: {
      buildCommand: DIST_SPEC.buildCommand,
      outputDir: DIST_SPEC.outputDir,
      entry: DIST_SPEC.entry,
      expectedArtifacts: [...DIST_SPEC.expectedArtifacts],
    },
    requiredFiles: [...REQUIRED_FILES],
    requiredChecks: [...REQUIRED_CHECKS],
    update: {
      manual: true,
      autoUpdate: false,
      actionable: false,
      consent: CONSENT_TEXT,
      notice: UPDATE_NOTICE,
    },
  };
}

// validateReleaseMeta(meta) → { ok, errors, warnings }. Pure; never throws. `ok` is true iff
// there are zero errors. The no-auto-update contract is an ERROR if violated — this is the
// safety floor, not an advisory nicety.
export function validateReleaseMeta(meta) {
  const errors = [];
  const warnings = [];
  const add = (e) => errors.push(e);
  const warn = (w) => warnings.push(w);

  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
    return { ok: false, errors: ['metadata is not an object'], warnings };
  }

  if (meta.kind !== RELEASE_META_KIND) add(`kind must be "${RELEASE_META_KIND}"`);
  if (meta.schemaVersion !== METADATA_SCHEMA_VERSION) {
    add(`schemaVersion must be ${METADATA_SCHEMA_VERSION}`);
  }
  if (!isVersionMarker(meta.version)) add('version is not a valid version marker (vX.Y.Z[-tag])');

  const validChannels = new Set(Object.values(UPDATE_CHANNELS));
  if (!validChannels.has(meta.channel)) add(`channel must be one of ${[...validChannels].join(', ')}`);
  else if (meta.channel === UPDATE_CHANNELS.UNKNOWN) warn('channel is "unknown" — version tag was unrecognised');
  if (isVersionMarker(meta.version) && validChannels.has(meta.channel) && meta.channel !== UPDATE_CHANNELS.UNKNOWN) {
    if (channelForVersion(meta.version) !== meta.channel) add('channel does not match version tag');
  }

  if (meta.commit !== null && (typeof meta.commit !== 'string' || !meta.commit)) {
    add('commit must be a non-empty string or null');
  }
  if (meta.generatedAt !== null && typeof meta.generatedAt !== 'string') {
    add('generatedAt must be a string or null');
  }

  const src = meta.source;
  if (!src || typeof src !== 'object') add('source is missing');
  else {
    if (typeof src.owner !== 'string' || !src.owner) add('source.owner is missing');
    if (typeof src.repo !== 'string' || !src.repo) add('source.repo is missing');
    for (const key of ['latestReleaseUrl', 'releasesPageUrl']) {
      if (typeof src[key] !== 'string' || !/^https:\/\//.test(src[key])) add(`source.${key} must be an https URL`);
    }
  }

  const dist = meta.dist;
  if (!dist || typeof dist !== 'object') add('dist is missing');
  else {
    if (typeof dist.buildCommand !== 'string' || !dist.buildCommand) add('dist.buildCommand is missing');
    if (typeof dist.outputDir !== 'string' || !dist.outputDir) add('dist.outputDir is missing');
    if (typeof dist.entry !== 'string' || !dist.entry) add('dist.entry is missing');
    if (!Array.isArray(dist.expectedArtifacts) || dist.expectedArtifacts.length === 0) {
      add('dist.expectedArtifacts must be a non-empty array');
    }
  }

  if (!Array.isArray(meta.requiredFiles) || meta.requiredFiles.length === 0) {
    add('requiredFiles must be a non-empty array');
  }
  if (!Array.isArray(meta.requiredChecks) || meta.requiredChecks.length === 0) {
    add('requiredChecks must be a non-empty array');
  }

  const upd = meta.update;
  if (!upd || typeof upd !== 'object') add('update is missing');
  else {
    // The safety floor — these are ERRORS, not warnings.
    if (upd.autoUpdate !== false) add('update.autoUpdate MUST be false (no auto-update contract)');
    if (upd.actionable !== false) add('update.actionable MUST be false (metadata is descriptive only)');
    if (upd.manual !== true) add('update.manual MUST be true (deploys stay a manual maintainer step)');
    if (typeof upd.consent !== 'string' || !upd.consent) add('update.consent wording is missing');
    if (typeof upd.notice !== 'string' || !upd.notice) add('update.notice wording is missing');
  }

  return { ok: errors.length === 0, errors, warnings };
}

// formatReleaseMeta(meta) → a concise text block for the terminal. Pure; safe on null.
export function formatReleaseMeta(meta) {
  if (!meta || typeof meta !== 'object') return 'release-meta: (no metadata)';
  const L = [];
  L.push('Torii Quest — release/update metadata');
  L.push('─'.repeat(60));
  L.push(RELEASE_META_BADGE);
  L.push(`version:    ${meta.version ?? '(unknown)'}`);
  L.push(`channel:    ${meta.channel ?? '(unknown)'}`);
  L.push(`commit:     ${meta.commit ?? '(none)'}`);
  L.push(`generated:  ${meta.generatedAt ?? '(unset)'}`);
  if (meta.source) {
    L.push(`source:     ${meta.source.owner}/${meta.source.repo}`);
    L.push(`releases:   ${meta.source.releasesPageUrl}`);
  }
  if (meta.dist) L.push(`dist:       ${meta.dist.buildCommand} → ${meta.dist.outputDir}/`);
  if (Array.isArray(meta.requiredChecks)) L.push(`checks:     ${meta.requiredChecks.join(', ')}`);
  const upd = meta.update || {};
  L.push(`auto-update: ${upd.autoUpdate === false ? 'OFF (manual only)' : 'UNEXPECTED'}`);
  const { ok, errors, warnings } = validateReleaseMeta(meta);
  L.push('');
  L.push(ok ? '✓ metadata valid.' : `✗ ${errors.length} error(s): ${errors.join('; ')}`);
  if (warnings.length) L.push(`· ${warnings.length} warning(s): ${warnings.join('; ')}`);
  L.push('─'.repeat(60));
  return L.join('\n');
}
