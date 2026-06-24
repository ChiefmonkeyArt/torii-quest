# Torii Quest — v0.2.157-alpha: Read-Only GitHub Release-Check Foundation

## Goal
Prepare the update-check path so the app/host can evaluate GitHub release metadata
in a controlled, inspectable, **read-only** way — without any auto-update, install,
shell, navigation, or automatic network fetch. Foundation slice only: pure,
testable adapter first; the actual wire-up stays a deferred, audited host step.

## What landed

### 1. `src/engine/update/githubReleaseSource.js` (NEW — pure, node-safe)
Builds on the existing LEAN-5 `updateCheck.js` (`parseRelease`/`compareVersions`/
`evaluateUpdate`). No THREE/Rapier/DOM, no module-level network, never throws.
- `SOURCE_KIND` = `{ LATEST, LIST, UNKNOWN }`; `SOURCE_STATUS` = `{ OK, EMPTY, MALFORMED }`.
- `normalizeRelease(raw)` — maps a GitHub release object **or** a simple manifest
  (`version|tag` / `url` / `notes`) into the `tag_name`/`name`/`html_url`/`body`/
  `draft`/`prerelease`/`published_at` shape `parseRelease()` accepts; `null` for
  non-objects / no version identifier; strict-boolean `draft`/`prerelease`.
- `selectLatestRelease(payload, { includePrerelease=true, includeDraft=false })` —
  accepts a single `releases/latest` object, a `releases` **array**, or a manifest;
  picks the highest-version **eligible** release via tolerant semver compare →
  `{ status, kind, release, candidates, errors }`. Drafts excluded by default;
  prereleases kept by default (every torii release is an `-alpha` prerelease).
- `evaluateFromSource(payload, opts)` — folds the selection straight into the
  existing `evaluateUpdate()` → `{ source, status, currentVersion, latestVersion,
  updateAvailable, release }`; draft/empty/malformed degrade to `UNKNOWN` /
  `updateAvailable:false`.
- `fetchLatestRelease(opts)` — **OPTIONAL, host-only** async helper. Requires an
  explicitly injected `fetcher` (no global-fetch fallback — importing the module can
  never silently touch the wire), is **never auto-invoked** from the game loop,
  honours a timeout **without any `setTimeout`** (prefers a caller `signal`, else the
  standard `AbortSignal.timeout()`), JSON/shape-validates the response through
  `evaluateFromSource()`, and captures thrown/HTTP errors as safe `MALFORMED` states.
- Re-exports `RELEASE_SOURCE` / `UPDATE_STATUS` for convenience.

### 2. SDK exposure (read-only)
`src/sdk/index.js` re-exports `githubReleaseSource` and registers it in
`SDK_SURFACE` at the **experimental** tier. Safe to expose: the pure helpers do no
I/O and the fetch helper is inert unless a host injects a fetcher.

### 3. `tests/github-release-source.test.js` (NEW — 24 cases)
Covers `normalizeRelease` (GitHub object, manifest, url fallback, null/non-object,
boolean coercion); `selectLatestRelease` single-object (normal/draft/prerelease
default-keep + filter/no-tag) and array (highest-version pick, skip draft+prerelease,
`[]`/all-ineligible → EMPTY) and malformed inputs; `evaluateFromSource`
(newer/equal/older → available/up-to-date, draft/empty/malformed → UNKNOWN, default
`currentVersion`); and `fetchLatestRelease` (refuses with no fetcher, injected
fetcher + JSON, already-parsed JSON, thrown error → MALFORMED, non-ok HTTP noted) +
SDK exposure.

## Verification
- `npm test` → **529 passed / 45 files** (was 505/44; +24 cases).
- `npm run check` → **ALL GREEN**, 14/14; check `[14]` references v0.2.157-alpha (5 docs).
- `npm run bundle:report` → advisory baseline unchanged (rapier chunk tracked, not gated).
- `npm run build` → clean (known large-chunk advisory only).
- `npm run handoff:status` → VERSION v0.2.157-alpha, package in sync; exits 0.

## Safety
godMode=false. No new `setTimeout` (timeout via `AbortSignal.timeout()`). No new
Vector3/Matrix4. No payments, signing/publishing, relay writes, auto-update, shell
execution, installation, file mutation from release data, or navigation. The pure
helpers never fetch; only `fetchLatestRelease()` can reach the wire, and only when a
host explicitly injects a fetcher — it is never imported or called by the game loop.

## Version markers bumped → v0.2.157-alpha
`src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs`
(header, `EXPECTED_VERSION`, stale-guard now flags `v0.2.156-alpha`).

## Docs updated
`todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`,
`UPDATE_CHECK.md` (new §2 source-adapter table + deferred-fetch note).

## Not done (left to parent agent)
Not pushed/published. The audited host wire-up (CSP `connect-src` GitHub API entry,
rate-limiting, the actual injected fetcher) and the in-world prompt MESH/HUD remain
deferred. Parent agent verifies, security-reviews, deploys, publishes, pushes, and
syncs docs.
