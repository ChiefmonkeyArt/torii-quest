// src/engine/update/liveUpdateCheck.js — LIVE, cached update-check orchestration
// (M2, v0.2.285). Promotes the host-only GitHub fetch seam (githubReleaseSource
// .fetchLatestRelease) from "wired in tests only" to the surface the title-screen
// UPDATE card actually consumes, so an installed copy self-reports its TRUE standing
// against the latest published release instead of a hard-coded local fixture.
//
// Safety boundary (mirrors UPDATE_CHECK.md / the LEAN-5 rule):
//   - PURE + node-safe at import: no THREE/Rapier/DOM, no module-level network, never
//     throws. Every I/O dependency (fetcher, storage, clock) is INJECTED — there is no
//     global fetch/localStorage/Date fallback, so importing this never touches the wire.
//   - The ONE network call is a read-only GET to https://api.github.com/.../releases/latest
//     via the injected fetcher; it is cached client-side (short TTL) so a busy title
//     screen never hammers GitHub's 60-req/hr unauthenticated limit.
//   - NO auto-update / install / shell / navigation. The result is a display-only
//     view-model; deploying a release stays a MANUAL maintainer step. actionable:false.
//   - Fails CLOSED to "unable to check": any network error / rate-limit / 404 / malformed
//     payload degrades to an inert UNABLE view, never an exception and never a broken card.

import { fetchLatestRelease, RELEASE_SOURCE, UPDATE_STATUS } from './githubReleaseSource.js';
import { compareVersions } from './updateCheck.js';
import { VERSION } from '../../config.js';

// localStorage key + schema version for the cached latest-release probe. Bumping the
// suffix invalidates every client's cache on a shape change.
export const UPDATE_CACHE_KEY = 'torii.updateCheck.v1';

// Default cache lifetime — 15 minutes. Long enough that refreshes/route changes reuse
// the probe (rate-limit friendly), short enough that a fresh deploy is noticed soon.
export const DEFAULT_TTL_MS = 15 * 60 * 1000;

// Live update statuses (a superset of UPDATE_STATUS with the live-only UNABLE state and
// an explicit AHEAD verdict for a runtime newer than the published release).
export const LIVE_STATUS = Object.freeze({
  UP_TO_DATE: 'up-to-date',
  BEHIND: 'behind',
  AHEAD: 'ahead',
  UNABLE: 'unable',   // could not reach / parse GitHub — inert fallback
});

// _core(version) → the dotted numeric core as a 3-int array ('v0.2.280-alpha' → [0,2,280]).
function _core(version) {
  const core = String(version || '').trim().replace(/^v/i, '').split('-')[0].split('.')
    .map((n) => { const v = parseInt(n, 10); return Number.isFinite(v) ? v : 0; });
  while (core.length < 3) core.push(0);
  return core.slice(0, 3);
}

// versionDelta(current, latest) → { direction:'same'|'behind'|'ahead', count }. `count`
// is the absolute distance on the most-significant differing core component (for this
// project, whose releases share major.minor, that is the patch gap, e.g. v0.2.279 vs
// v0.2.285 → behind by 4). `count` is null when only the prerelease tag differs. Pure.
export function versionDelta(current, latest) {
  const cmp = compareVersions(current, latest);
  if (cmp === 0) return { direction: 'same', count: 0 };
  const direction = cmp < 0 ? 'behind' : 'ahead';
  const c = _core(current);
  const l = _core(latest);
  let count = null;
  for (let i = 0; i < 3; i += 1) {
    if (c[i] !== l[i]) { count = Math.abs(l[i] - c[i]); break; }
  }
  return { direction, count };
}

// readCache(storage, now, ttlMs) → a fresh cache entry { latestVersion, releaseUrl, at }
// or null when absent / expired / malformed. Pure; never throws (a broken/secured
// storage just yields null). `now` is a millisecond timestamp.
export function readCache(storage, now, ttlMs = DEFAULT_TTL_MS) {
  if (!storage || typeof storage.getItem !== 'function') return null;
  let raw;
  try { raw = storage.getItem(UPDATE_CACHE_KEY); } catch { return null; }
  if (!raw) return null;
  let entry;
  try { entry = JSON.parse(raw); } catch { return null; }
  if (!entry || typeof entry !== 'object') return null;
  const at = Number(entry.at);
  if (!Number.isFinite(at)) return null;
  if (!Number.isFinite(now) || now - at >= ttlMs) return null; // expired / no clock
  if (typeof entry.latestVersion !== 'string' || !entry.latestVersion) return null;
  return { latestVersion: entry.latestVersion, releaseUrl: entry.releaseUrl || null, at };
}

// writeCache(storage, { latestVersion, releaseUrl }, now) → persists the probe. Pure;
// never throws (quota/secured storage is swallowed). Returns true on a best-effort write.
export function writeCache(storage, { latestVersion, releaseUrl } = {}, now) {
  if (!storage || typeof storage.setItem !== 'function') return false;
  if (typeof latestVersion !== 'string' || !latestVersion) return false;
  try {
    storage.setItem(UPDATE_CACHE_KEY, JSON.stringify({
      at: Number.isFinite(now) ? now : 0,
      latestVersion,
      releaseUrl: releaseUrl || null,
    }));
    return true;
  } catch { return false; }
}

// _statusFor(currentVersion, latestVersion) → { status, label, delta }. Pure.
function _statusFor(currentVersion, latestVersion) {
  if (!latestVersion) return { status: LIVE_STATUS.UNABLE, label: 'UNABLE TO CHECK', delta: null };
  const delta = versionDelta(currentVersion, latestVersion);
  if (delta.direction === 'behind') {
    return { status: LIVE_STATUS.BEHIND, label: delta.count != null ? `BEHIND BY ${delta.count}` : 'BEHIND', delta };
  }
  if (delta.direction === 'ahead') return { status: LIVE_STATUS.AHEAD, label: 'AHEAD', delta };
  return { status: LIVE_STATUS.UP_TO_DATE, label: 'UP TO DATE', delta };
}

// liveStatusView({ currentVersion, latestVersion, releaseUrl, fromCache, checkedAt })
// → an INERT, render-ready view-model for the UPDATE card. A null/empty latestVersion
// yields the UNABLE fallback. Pure; never throws.
export function liveStatusView({
  currentVersion = VERSION, latestVersion = null, releaseUrl = null,
  fromCache = false, checkedAt = null,
} = {}) {
  const current = String(currentVersion || VERSION);
  const { status, label, delta } = _statusFor(current, latestVersion);
  const lines = [
    { label: 'Installed', value: current },
    { label: 'Latest', value: latestVersion || '—' },
    { label: 'Status', value: label },
    { label: 'Source', value: RELEASE_SOURCE.releasesPageUrl },
  ];
  return {
    title: 'UPDATE CHECK',
    status,
    statusLabel: label,
    currentVersion: current,
    latestVersion: latestVersion || null,
    behindBy: status === LIVE_STATUS.BEHIND ? (delta ? delta.count : null) : 0,
    updateAvailable: status === LIVE_STATUS.BEHIND,
    fromCache: fromCache === true,
    checkedAt: Number.isFinite(checkedAt) ? checkedAt : null,
    releaseUrl: releaseUrl || RELEASE_SOURCE.releasesPageUrl,
    lines,
    readOnly: true,
    actionable: false, // display-only; deploying a release stays a manual host step
  };
}

// checkForUpdateLive(opts) → async, the live + cached update probe the UI consumes.
//   opts: { fetcher (required for a real check), storage, now=()=>Date.now(),
//           ttlMs=DEFAULT_TTL_MS, currentVersion=VERSION, url=RELEASE_SOURCE.latestReleaseUrl,
//           includePrerelease=true, timeoutMs, init }
// Flow: a FRESH cache entry short-circuits the network (fromCache:true, no fetch). Else it
// does the one read-only GET via fetchLatestRelease, caches a usable result, and returns the
// live view. Any failure (no fetcher / network / rate-limit / 404 / malformed) → UNABLE.
// Pure-by-injection; never throws.
export async function checkForUpdateLive(opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const nowFn = typeof o.now === 'function' ? o.now : () => Date.now();
  const now = Number(nowFn());
  const ttlMs = Number.isFinite(o.ttlMs) ? o.ttlMs : DEFAULT_TTL_MS;
  const currentVersion = o.currentVersion || VERSION;
  const storage = o.storage || null;

  const cached = readCache(storage, now, ttlMs);
  if (cached) {
    return liveStatusView({
      currentVersion, latestVersion: cached.latestVersion,
      releaseUrl: cached.releaseUrl, fromCache: true, checkedAt: cached.at,
    });
  }

  if (typeof o.fetcher !== 'function') {
    return liveStatusView({ currentVersion, latestVersion: null });
  }

  const res = await fetchLatestRelease({
    fetcher: o.fetcher,
    url: o.url || RELEASE_SOURCE.latestReleaseUrl,
    currentVersion,
    includePrerelease: o.includePrerelease,
    timeoutMs: o.timeoutMs,
    init: o.init,
  });

  const latestVersion = res && res.ok && res.evaluation ? res.evaluation.latestVersion : null;
  if (!latestVersion) {
    return liveStatusView({ currentVersion, latestVersion: null });
  }
  const releaseUrl = res.evaluation.release && res.evaluation.release.url
    ? res.evaluation.release.url : RELEASE_SOURCE.releasesPageUrl;
  writeCache(storage, { latestVersion, releaseUrl }, now);
  return liveStatusView({ currentVersion, latestVersion, releaseUrl, fromCache: false, checkedAt: now });
}

export { UPDATE_STATUS, RELEASE_SOURCE };
