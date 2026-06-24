# torii.quest GitHub Update-Check — Architecture (LEAN-5)

> **Status:** architecture / pure helpers landed v0.2.138-alpha. **No network, no
> auto-update, no install.** Deploying a new release stays a MANUAL maintainer step
> (see `HANDOFF.md` §7). This document describes the shape of the update-check flow
> and the boundary between the pure (shipped) part and the deferred host part.

## 1. Purpose

A running torii.quest instance should be able to tell the player (or maintainer)
when a **newer GitHub release** exists than the version it is running, and surface
an **inert "update available" prompt**. This proves the "the world can keep itself
current" piece of the 15-hour proof-of-concept without ever shipping an unattended
auto-updater.

## 2. What ships now (pure, node-tested)

`src/engine/update/updateCheck.js` — pure ES module, no THREE/Rapier/DOM/network:

| Export | Shape | Notes |
|---|---|---|
| `RELEASE_SOURCE` | `{ owner, repo, latestReleaseUrl, releasesPageUrl }` | **Documentation only** — where the data WOULD be fetched. The module never fetches. |
| `UPDATE_STATUS` | `{ UPDATE_AVAILABLE, UP_TO_DATE, UNKNOWN }` | Frozen status enum. |
| `compareVersions(a, b)` | `-1 \| 0 \| 1` | Tolerant semver compare: optional leading `v`, dotted core, single dotted prerelease tag. A prerelease ranks below the same full release. |
| `parseRelease(raw)` | `{ ok, tag, version, name, url, notes, draft, prerelease, publishedAt, errors }` | Normalises a GitHub-release-shaped object (`tag_name`/`name`/`html_url`/`body`/`draft`/`prerelease`/`published_at`). Never throws. |
| `evaluateUpdate(release, currentVersion=VERSION)` | `{ status, currentVersion, latestVersion, updateAvailable, release }` | Compares runtime `VERSION` against the release. Draft/unparseable → `UNKNOWN`. |
| `updateCheckView(release, { currentVersion, notesMax })` | `{ status, currentVersion, latestVersion, updateAvailable, prompt, notesPreview, releaseUrl, releasesPageUrl, actionable:false }` | INERT render-ready view-model. `actionable` is ALWAYS `false`. |

Surfaced on the SDK as the `updateCheck` namespace (tier: experimental). Covered
by `tests/update-check.test.js` (deterministic).

### Visible preview (v0.2.142)

`src/engine/update/updatePreview.js` — pure, node-safe presentation layer over
`updateCheckView`. `updatePreviewBlock(release, { currentVersion, notesMax })`
flattens the view-model into a render-ready block of `{ label, value }` rows
(Version / Latest / Status / Source / Notes) + a `statusLabel` helper, a frozen
`STATUS_TEXT` map, and an `UPDATE_PREVIEW_BADGE` (`"PREVIEW · MANUAL · NO
AUTO-UPDATE"`). Every block is `actionable:false` / `readOnly:true`; the GitHub
releases-page URL is surfaced as display-only TEXT (no link); draft/unparseable
releases degrade to `UNKNOWN` without throwing. `main.js` renders it into the
title-screen `#update-preview` card via `textContent` only, driven by a
**deterministic LOCAL sample release** — it performs NO network fetch, NO install,
NO shell execution, NO auto-update, and NO navigation. Read-only at
`ToriiDebug.shells.updatePreview()`. SDK `updatePreview` (experimental). Covered by
`tests/update-preview.test.js`.

### Source adapter (v0.2.157)

`src/engine/update/githubReleaseSource.js` — pure, node-safe adapter that prepares
the read-only update-check path by turning a raw GitHub Releases payload into the
release object the helpers above already accept.

| Export | Shape | Notes |
|---|---|---|
| `SOURCE_KIND` | `{ LATEST, LIST, UNKNOWN }` | How the payload was recognised. |
| `SOURCE_STATUS` | `{ OK, EMPTY, MALFORMED }` | Whether a usable release was found. |
| `normalizeRelease(raw)` | canonical GitHub-release object \| `null` | Maps a GitHub release object OR a manifest (`version\|tag`/`url`/`notes`) into the `parseRelease()` shape. `null` for non-objects / no version identifier. Never throws. |
| `selectLatestRelease(payload, { includePrerelease=true, includeDraft=false })` | `{ status, kind, release, candidates, errors }` | Accepts a single `releases/latest` object, a `releases` array, or a manifest; picks the highest-version ELIGIBLE release (tolerant semver). Drafts excluded by default; prereleases kept by default (alpha project). |
| `evaluateFromSource(payload, opts)` | `{ source, status, currentVersion, latestVersion, updateAvailable, release }` | Folds `selectLatestRelease()` into `evaluateUpdate()`. Draft/empty/malformed → `UNKNOWN` / `updateAvailable:false`. Never throws. |
| `fetchLatestRelease(opts)` | `Promise<{ ok, status, url, payload, evaluation, errors }>` | **OPTIONAL host-only** fetch. REQUIRES an injected `fetcher` (no global-fetch fallback), NEVER auto-invoked from the game loop, timeout honoured WITHOUT `setTimeout` (caller `signal` or `AbortSignal.timeout()`), JSON/shape-validated; thrown/HTTP errors become safe `MALFORMED` states. |

Surfaced on the SDK as `githubReleaseSource` (tier: experimental). Covered by
`tests/github-release-source.test.js`. The pure helpers do NO network; only
`fetchLatestRelease()` can reach the wire, and only when a host explicitly injects a
fetcher — importing the module can never silently fetch.

## 3. What is deferred (the host step — NOT in this module)

- **The actual read-only fetch** of the GitHub releases endpoint
  (`RELEASE_SOURCE.latestReleaseUrl`). Must be a deliberate, audited host call —
  CSP `connect-src` would need a GitHub API entry, and rate-limiting belongs there.
  As of v0.2.157 `githubReleaseSource.fetchLatestRelease()` provides the *shape* of
  that call (injected fetcher, timeout, shape validation), but it is host-only and
  never wired into the game loop — a host must invoke it explicitly with a fetcher.
- **The in-world prompt MESH / HUD** that renders `updateCheckView(...)`. Browser
  side effect; deferred like the other LEAN view-model meshes.
- **Any "Update" affordance.** The view-model is display-only by design
  (`actionable:false`); turning it into a real action (open the releases page,
  trigger a rebuild) is a separate, explicitly-authorised step. The host-side
  manual update + the sketch of a future guarded update button live in
  `VPS_INSTALL.md` §7 and §10.

## 4. Safety boundary

- No `fetch`/XHR/WebSocket in the module — it is a pure compare + view-model.
- No code download, no `eval`/dynamic import, no install, no `window.location`.
- Deploying a release remains a manual maintainer action; this flow only *informs*.
  See `VPS_INSTALL.md` for how a maintainer self-hosts at `torii.quest` and updates
  by hand from GitHub (§7), the rollback model (§8), and the deferred guarded
  "update button" architecture (§10).
