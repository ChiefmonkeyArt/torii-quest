// engine/update/updateCheck.js — torii.quest GitHub release / update-check
// ARCHITECTURE (LEAN-5, v0.2.138). Pure, node-safe helpers that let a running
// torii.quest instance decide whether a newer GitHub *release* exists than the
// version it is running, and shape an INERT "update available" view-model for a
// future in-world prompt / HUD.
//
// SCOPE GUARD — this module is architecture ONLY:
//   - NO network fetch. It never calls fetch()/XHR/ws; the caller (a future,
//     audited host step) is responsible for fetching the GitHub releases JSON and
//     passing the parsed object in. RELEASE_SOURCE only documents WHERE that data
//     would come from.
//   - NO auto-update / NO code download / NO install / NO navigation. The output
//     is a display-only view-model; deploying a new release stays a MANUAL
//     maintainer step (see HANDOFF.md §7).
//   - Pure + deterministic: same inputs → same outputs, so it is fully node-tested
//     without a browser, relay, or network.

import { VERSION } from '../../config.js';

// Where the latest-release data WOULD be fetched from (documentation only — this
// module performs no I/O). The maintainer/host wires the actual read-only fetch.
// v0.2.361-alpha (UPD-1): repo constant corrected from `torii-gate` (a legacy
// name that GitHub only serves via redirect) to `torii-quest` — the previous
// value meant every live update probe fell through to "UNABLE TO CHECK" even
// when the API was reachable, because `/repos/.../torii-gate/releases/latest`
// is only resolvable after following the 301 redirect that browsers cannot
// transparently traverse for `api.github.com`.
export const RELEASE_SOURCE = Object.freeze({
  owner: 'ChiefmonkeyArt',
  repo: 'torii-quest',
  // GitHub "latest release" REST endpoint shape — for documentation/reference.
  latestReleaseUrl: 'https://api.github.com/repos/ChiefmonkeyArt/torii-quest/releases/latest',
  releasesPageUrl: 'https://github.com/ChiefmonkeyArt/torii-quest/releases',
});

// Update-check result statuses.
export const UPDATE_STATUS = Object.freeze({
  UPDATE_AVAILABLE: 'update-available', // a newer release exists than runtime
  UP_TO_DATE: 'up-to-date',             // runtime >= latest release
  UNKNOWN: 'unknown',                   // release data was missing/unparseable
});

// _coreAndPre('v0.2.138-alpha') → { core:[0,2,138], pre:['alpha'] }. Strips a
// leading 'v', splits the prerelease tag at the first '-', and parses the dotted
// core into numbers (non-numeric core segments → 0). Pure.
function _coreAndPre(version) {
  const raw = String(version || '').trim().replace(/^v/i, '');
  const [coreStr = '', preStr = ''] = raw.split('-');
  const core = coreStr.split('.').map((n) => {
    const v = parseInt(n, 10);
    return Number.isFinite(v) ? v : 0;
  });
  while (core.length < 3) core.push(0);
  const pre = preStr ? preStr.split('.') : [];
  return { core: core.slice(0, 3), pre };
}

// _comparePre(a, b) → -1|0|1 for two prerelease-identifier arrays, per semver:
// numeric identifiers compare numerically, others lexically; numeric < non-numeric.
function _comparePre(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1; // shorter prerelease set is lower
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = parseInt(x, 10) - parseInt(y, 10);
      if (d !== 0) return d < 0 ? -1 : 1;
    } else if (xn !== yn) {
      return xn ? -1 : 1; // numeric identifiers rank lower than alphanumeric
    } else {
      const c = x.localeCompare(y);
      if (c !== 0) return c < 0 ? -1 : 1;
    }
  }
  return 0;
}

// compareVersions(a, b) → -1 (a<b) | 0 (equal) | 1 (a>b). Tolerant semver compare:
// optional leading 'v', dotted numeric core, single dotted prerelease tag. A
// version WITH a prerelease ranks below the same core WITHOUT one (semver rule).
export function compareVersions(a, b) {
  const A = _coreAndPre(a);
  const B = _coreAndPre(b);
  for (let i = 0; i < 3; i++) {
    if (A.core[i] !== B.core[i]) return A.core[i] < B.core[i] ? -1 : 1;
  }
  if (A.pre.length === 0 && B.pre.length === 0) return 0;
  if (A.pre.length === 0) return 1;  // a is a full release, b is prerelease → a>b
  if (B.pre.length === 0) return -1; // a is prerelease, b is full release → a<b
  return _comparePre(A.pre, B.pre);
}

// parseRelease(raw) → normalised release descriptor:
//   { ok, tag, version, name, url, notes, draft, prerelease, publishedAt, errors }
// Accepts a GitHub-release-shaped object ({ tag_name, name, html_url, body,
// draft, prerelease, published_at }). Pure; never throws — bad input → ok:false.
export function parseRelease(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') {
    return {
      ok: false, tag: null, version: null, name: null, url: null, notes: '',
      draft: false, prerelease: false, publishedAt: null,
      errors: ['release is not an object'],
    };
  }
  const tag = typeof raw.tag_name === 'string' ? raw.tag_name.trim() : '';
  if (!tag) errors.push('missing tag_name');
  const version = tag.replace(/^v/i, '');
  const url = typeof raw.html_url === 'string' ? raw.html_url : null;
  return {
    ok: errors.length === 0,
    tag: tag || null,
    version: version || null,
    name: typeof raw.name === 'string' ? raw.name : null,
    url,
    notes: typeof raw.body === 'string' ? raw.body : '',
    draft: raw.draft === true,
    prerelease: raw.prerelease === true,
    publishedAt: typeof raw.published_at === 'string' ? raw.published_at : null,
    errors,
  };
}

// evaluateUpdate(release, currentVersion=VERSION) → {
//   status, currentVersion, latestVersion, updateAvailable, release
// }. `release` may be a raw GitHub object or an already-parsed descriptor.
// Pure. Unparseable / draft release → status UNKNOWN, updateAvailable:false.
export function evaluateUpdate(release, currentVersion = VERSION) {
  const parsed = release && release.ok !== undefined ? release : parseRelease(release);
  const current = String(currentVersion || VERSION);
  if (!parsed.ok || parsed.draft || !parsed.version) {
    return {
      status: UPDATE_STATUS.UNKNOWN,
      currentVersion: current,
      latestVersion: parsed.version || null,
      updateAvailable: false,
      release: parsed,
    };
  }
  const cmp = compareVersions(current, parsed.version); // current vs latest
  const updateAvailable = cmp < 0; // runtime is OLDER than the published release
  return {
    status: updateAvailable ? UPDATE_STATUS.UPDATE_AVAILABLE : UPDATE_STATUS.UP_TO_DATE,
    currentVersion: current,
    latestVersion: parsed.version,
    updateAvailable,
    release: parsed,
  };
}

// _previewNotes(notes, max) → a single-line, length-capped preview of release
// notes for an inert prompt. Pure; collapses whitespace, never throws.
function _previewNotes(notes, max = 140) {
  const flat = String(notes || '').replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

// updateCheckView(release, { currentVersion, notesMax }) → an INERT, render-ready
// view-model for a future "update available" prompt / HUD:
//   { status, currentVersion, latestVersion, updateAvailable, prompt,
//     notesPreview, releaseUrl, releasesPageUrl, actionable }
// `actionable` is ALWAYS false — this view never carries a clickable/auto-update
// action; surfacing a real "Update" affordance is a separate, audited host step.
export function updateCheckView(release, { currentVersion = VERSION, notesMax = 140 } = {}) {
  const evald = evaluateUpdate(release, currentVersion);
  let prompt;
  switch (evald.status) {
    case UPDATE_STATUS.UPDATE_AVAILABLE:
      prompt = `Update available: ${evald.latestVersion} (running ${evald.currentVersion})`;
      break;
    case UPDATE_STATUS.UP_TO_DATE:
      prompt = `Up to date (${evald.currentVersion})`;
      break;
    default:
      prompt = 'Update status unknown';
  }
  return {
    status: evald.status,
    currentVersion: evald.currentVersion,
    latestVersion: evald.latestVersion,
    updateAvailable: evald.updateAvailable,
    prompt,
    notesPreview: _previewNotes(evald.release.notes, notesMax),
    releaseUrl: evald.release.url || null,
    releasesPageUrl: RELEASE_SOURCE.releasesPageUrl,
    actionable: false, // display-only; deploying a release stays a manual step
  };
}
