// src/engine/update/githubReleaseSource.js — pure GitHub Releases source adapter
// (LEAN-5, v0.2.157). Normalises a GitHub Releases API payload (a single
// `releases/latest` object OR a `releases` array) — or a simple update manifest —
// into the release object already accepted by parseRelease()/evaluateUpdate() in
// updateCheck.js, then can fold straight into an update verdict.
//
// Safety boundary (mirrors UPDATE_CHECK.md / the LEAN-5 rule):
//   - PURE + node-safe: no THREE/Rapier/DOM, no module-level network, never throws.
//   - The OPTIONAL fetchLatestRelease() helper performs the ONE read-only GitHub
//     fetch the pure layer deliberately omits, but it is host-only: it is NEVER
//     called automatically and REQUIRES an explicitly injected `fetcher` — there
//     is no global-fetch fallback. The game loop must never reach the wire here.
//   - No auto-update / install / shell / navigation / file mutation. Malformed
//     wire data degrades to EMPTY/MALFORMED + UNKNOWN, never an exception.

import {
  compareVersions, parseRelease, evaluateUpdate, RELEASE_SOURCE, UPDATE_STATUS,
} from './updateCheck.js';
import { VERSION } from '../../config.js';

export { RELEASE_SOURCE, UPDATE_STATUS };

// How the payload was recognised.
export const SOURCE_KIND = Object.freeze({
  LATEST: 'latest',   // a single GitHub `releases/latest` object (or a manifest)
  LIST: 'list',       // a GitHub `releases` array
  UNKNOWN: 'unknown', // not a recognisable releases payload
});

// Whether a usable release was found in the payload.
export const SOURCE_STATUS = Object.freeze({
  OK: 'ok',               // a usable release object was selected
  EMPTY: 'empty',         // recognisable shape, but no eligible release ([]/all draft/filtered)
  MALFORMED: 'malformed', // not a recognisable GitHub-releases object or array
});

function isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

// normalizeRelease(raw) → the canonical GitHub-release-shaped object that
// parseRelease() accepts, mapped from either a GitHub release object
// (`tag_name`/`name`/`html_url`/`body`/`draft`/`prerelease`/`published_at`) or a
// simple update manifest (`version|tag`/`url`/`notes`). Returns null when `raw`
// is not an object or carries no version identifier. Never throws. Does NOT decide
// eligibility (draft/prerelease) — that is selectLatestRelease()'s job.
export function normalizeRelease(raw) {
  if (!isObj(raw)) return null;
  const tag = raw.tag_name != null ? raw.tag_name
    : raw.tag != null ? raw.tag
      : raw.version != null ? raw.version
        : undefined;
  if (tag == null) return null;
  return {
    tag_name: str(tag),
    name: raw.name != null ? str(raw.name) : str(tag),
    html_url: raw.html_url != null ? str(raw.html_url)
      : raw.url != null ? str(raw.url)
        : RELEASE_SOURCE.releasesPageUrl,
    body: raw.body != null ? str(raw.body)
      : raw.notes != null ? str(raw.notes)
        : '',
    draft: raw.draft === true,
    prerelease: raw.prerelease === true,
    published_at: raw.published_at != null ? str(raw.published_at)
      : raw.publishedAt != null ? str(raw.publishedAt)
        : '',
  };
}

function eligible(rel, includePrerelease, includeDraft) {
  if (!rel) return false;
  if (rel.draft && !includeDraft) return false;
  if (rel.prerelease && !includePrerelease) return false;
  return true;
}

// compareVersion-friendly version string for a normalised release.
function relVersion(rel) {
  const parsed = parseRelease(rel);
  return parsed.version || rel.tag_name;
}

// selectLatestRelease(payload, opts) → { status, kind, release, candidates, errors }
// Accepts a single GitHub `releases/latest` object, a `releases` array, or a
// manifest object, and picks the highest-version ELIGIBLE release (tolerant semver
// compare on the tag; the first eligible entry wins ties). Never throws.
//   opts.includePrerelease (default true) — keep prerelease-flagged releases
//   opts.includeDraft     (default false) — keep draft releases
export function selectLatestRelease(payload, opts = {}) {
  const includePrerelease = opts.includePrerelease !== false;
  const includeDraft = opts.includeDraft === true;
  const errors = [];

  if (Array.isArray(payload)) {
    const candidates = payload.length;
    const usable = payload
      .map(normalizeRelease)
      .filter((r) => eligible(r, includePrerelease, includeDraft));
    if (usable.length === 0) {
      errors.push(candidates === 0
        ? 'empty releases array'
        : 'no eligible release in list (all draft/prerelease/unparseable)');
      return { status: SOURCE_STATUS.EMPTY, kind: SOURCE_KIND.LIST, release: null, candidates, errors };
    }
    let best = usable[0];
    for (let i = 1; i < usable.length; i += 1) {
      if (compareVersions(relVersion(usable[i]), relVersion(best)) > 0) best = usable[i];
    }
    return { status: SOURCE_STATUS.OK, kind: SOURCE_KIND.LIST, release: best, candidates, errors };
  }

  if (isObj(payload)) {
    const rel = normalizeRelease(payload);
    if (!rel) {
      errors.push('object payload has no tag_name/tag/version');
      return { status: SOURCE_STATUS.EMPTY, kind: SOURCE_KIND.LATEST, release: null, candidates: 1, errors };
    }
    if (!eligible(rel, includePrerelease, includeDraft)) {
      errors.push(rel.draft ? 'release is a draft' : 'release is a prerelease (filtered)');
      return { status: SOURCE_STATUS.EMPTY, kind: SOURCE_KIND.LATEST, release: null, candidates: 1, errors };
    }
    return { status: SOURCE_STATUS.OK, kind: SOURCE_KIND.LATEST, release: rel, candidates: 1, errors };
  }

  errors.push('payload is not a GitHub releases object or array');
  return { status: SOURCE_STATUS.MALFORMED, kind: SOURCE_KIND.UNKNOWN, release: null, candidates: 0, errors };
}

// evaluateFromSource(payload, opts) → folds selectLatestRelease() into the existing
// evaluateUpdate(), so a host can go straight from a raw GitHub releases payload to
// an update verdict. Returns { source, status, currentVersion, latestVersion,
// updateAvailable, release }. When no usable release is found the verdict is
// UNKNOWN / updateAvailable:false. Never throws.
//   opts: { currentVersion=VERSION, includePrerelease=true, includeDraft=false }
export function evaluateFromSource(payload, opts = {}) {
  const currentVersion = opts.currentVersion || VERSION;
  const sel = selectLatestRelease(payload, opts);
  const source = {
    status: sel.status, kind: sel.kind, candidates: sel.candidates, errors: sel.errors,
  };
  if (sel.status !== SOURCE_STATUS.OK || !sel.release) {
    return {
      source,
      status: UPDATE_STATUS.UNKNOWN,
      currentVersion,
      latestVersion: null,
      updateAvailable: false,
      release: null,
    };
  }
  return { source, ...evaluateUpdate(sel.release, currentVersion) };
}

// fetchLatestRelease(opts) → async, HOST-ONLY read-only release fetch. This is the
// one deliberate exception to "no network in the update module", and it is gated:
//   - It is NEVER imported by the game loop and NEVER auto-invoked.
//   - It REQUIRES an explicitly injected `fetcher` (typically window.fetch). With
//     no fetcher it is a no-op error state — there is NO global-fetch fallback, so
//     importing this module can never silently touch the wire.
//   - The timeout is honoured WITHOUT a setTimeout: it prefers a caller-supplied
//     AbortSignal, else the standard AbortSignal.timeout() static (no timer of our
//     own to leak or to add to the regression allowlist).
//   - The response is JSON- and shape-validated through evaluateFromSource(), so
//     malformed wire data degrades to EMPTY/MALFORMED + UNKNOWN, never a throw.
// Returns { ok, status, url, payload, evaluation, errors }.
//   opts: { fetcher (required), url=RELEASE_SOURCE.latestReleaseUrl, timeoutMs=8000,
//           signal, init, currentVersion, includePrerelease, includeDraft }
export async function fetchLatestRelease(opts = {}) {
  const url = opts.url || RELEASE_SOURCE.latestReleaseUrl;
  const errors = [];

  if (typeof opts.fetcher !== 'function') {
    errors.push('no fetcher injected — refusing to touch the network');
    return { ok: false, status: SOURCE_STATUS.MALFORMED, url, payload: null, evaluation: null, errors };
  }

  let signal = opts.signal;
  const timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 8000;
  if (!signal && Number.isFinite(timeoutMs) && typeof AbortSignal !== 'undefined'
      && typeof AbortSignal.timeout === 'function') {
    try { signal = AbortSignal.timeout(timeoutMs); } catch { /* ignore — best-effort */ }
  }

  let payload = null;
  try {
    const res = await opts.fetcher(url, { ...(opts.init || {}), signal });
    if (!res || typeof res !== 'object') {
      errors.push('fetcher returned no response');
      return { ok: false, status: SOURCE_STATUS.MALFORMED, url, payload: null, evaluation: null, errors };
    }
    if ('ok' in res && res.ok === false) errors.push(`http ${res.status != null ? res.status : 'error'}`);
    payload = typeof res.json === 'function' ? await res.json() : res;
  } catch (e) {
    errors.push(`fetch failed: ${e && e.message ? e.message : 'error'}`);
    return { ok: false, status: SOURCE_STATUS.MALFORMED, url, payload: null, evaluation: null, errors };
  }

  const evaluation = evaluateFromSource(payload, opts);
  return {
    ok: evaluation.source.status === SOURCE_STATUS.OK,
    status: evaluation.source.status,
    url,
    payload,
    evaluation,
    errors: errors.concat(evaluation.source.errors),
  };
}
