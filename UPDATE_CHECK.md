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

### In-game update-status panel (v0.2.158)

`src/engine/update/updateStatus.js` — pure, node-safe panel that folds the
v0.2.157 source adapter and the v0.2.142 inert preview into ONE render-ready,
display-only update-status view for the in-world UPDATE proof surface
(`update-prompt-board`) / a HUD card. It reflects both the update verdict AND the
source diagnostics.

| Export | Shape | Notes |
|---|---|---|
| `UPDATE_STATUS_BADGE` | `'STATUS · MANUAL · NO AUTO-UPDATE'` | Makes the manual/no-auto-update contract explicit on the panel. |
| `UPDATE_SURFACE_ID` | `'update-prompt-board'` | Display-only string reference to the proof surface (does NOT bind/render/act). |
| `SAMPLE_RELEASE_FEED` | frozen `releases` array | Deterministic LOCAL fixture (two `-alpha` prereleases; newest `v0.2.999-alpha` wins). Never reaches the wire. |
| `updateStatusPanel(payload, opts)` | `{ title, badge, surface, step, status, statusLabel, currentVersion, latestVersion, updateAvailable, prompt, notesPreview, source:{status,kind,candidates,errors}, sourceUrl, lines:[{label,value}], readOnly:true, actionable:false }` | `selectLatestRelease`s the newest eligible release (defaults to `SAMPLE_RELEASE_FEED`), reuses `updatePreviewBlock` for the verdict; `lines` are Version/Latest/Status/Source/Releases; draft/empty/malformed degrade to UNKNOWN without throwing. Exposes NO fetch/install/update/navigate/href/onClick/autoUpdate key. |

Surfaced on the SDK as `updateStatus` (tier: experimental) and read-only at
`ToriiDebug.shells.updateStatus()`. Covered by `tests/update-status.test.js`. The
panel does NO network and exposes NO action surface — the audited host fetch + the
in-world prompt MESH/HUD remain deferred (below).

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
- Publish readiness for the gateway `/zone/<slug>` deep-links (the host-side SPA fallback
  that must serve `index.html` for `/zone/*`) is tracked separately in
  `ZONE_FALLBACK_READINESS.md` and locally checkable via `npm run zones:check` — a
  read-only, network-free guard, independent of this update-check flow.

## 5. Static release metadata (v0.2.192)

The pieces above shape the update-check *at runtime* from a release object a host hands
in. v0.2.192 adds the complementary **build-time** half: a small, static **release-metadata
template** that a self-hosted instance (or a VPS update-checker) can read to know what the
release it is serving *claims* to be — version, channel, the documentation-only GitHub
source endpoints, the expected `dist/` artifacts, the minimum files/checks a publishable
release must carry, and the manual/no-auto-update consent wording — all WITHOUT any network
fetch or live update.

Pure helpers in `tools/releaseMeta.mjs` (node-tested, no fs/network/THREE/DOM):

| Export | Shape | Notes |
|---|---|---|
| `RELEASE_META_BADGE` | `'RELEASE METADATA · LOCAL · READ-ONLY · NO AUTO-UPDATE'` | Makes the contract explicit on any surface that renders it. |
| `METADATA_SCHEMA_VERSION` / `RELEASE_META_KIND` / `RELEASE_META_FILE` | `1` / `'torii-release-metadata'` / `'public/release-metadata.json'` | Schema/identity + the canonical in-repo output path. |
| `UPDATE_CHANNELS` | `{ STABLE, ALPHA, BETA, RC, UNKNOWN }` | Frozen channel enum. |
| `DEFAULT_SOURCE` / `DIST_SPEC` / `REQUIRED_FILES` / `REQUIRED_CHECKS` | frozen | Repo coordinates (the real `ChiefmonkeyArt/torii-gate`; `RELEASE_SOURCE` in `updateCheck.js` was corrected to the same real repo in v0.2.193 — it is documentation-only, no I/O), build/artifact expectations, the publish floor. |
| `CONSENT_TEXT` / `UPDATE_NOTICE` | strings | Manual/no-auto-update wording carried IN the metadata. |
| `channelForVersion(version)` | channel | Derives stable/alpha/beta/rc/unknown from the prerelease tag. |
| `releaseUrlsFor(owner, repo)` | `{ latestReleaseUrl, releasesPageUrl }` | Documentation-only https GitHub endpoints. |
| `buildReleaseMeta({version, commit, owner, repo, generatedAt})` | metadata object | The canonical record a checker reads. |
| `validateReleaseMeta(meta)` | `{ ok, errors, warnings }` | **Safety floor:** ERRORs if `update.autoUpdate` or `update.actionable` is anything but `false`; plus shape/channel/url/required-array checks. Never throws. |
| `formatReleaseMeta(meta)` | text block | Terminal summary; safe on null. |

The thin CLI `tools/release-meta.mjs` (`npm run release:meta`) reads the local `VERSION` +
best-effort git commit and prints the metadata (text default / `--json`). `--write` emits a
**deterministic** `public/release-metadata.json` (no commit/timestamp baked in, so re-running
never churns the working tree); a deploy step that wants provenance baked into the *deployed*
copy runs `--write --stamp`. The CLI is READ-ONLY by default, writes ONLY the in-repo safe
path under an explicit `--write`, performs NO network/install/update, and ALWAYS exits 0.

This is metadata only — it authorises nothing. `update.autoUpdate`/`update.actionable` are
fixed `false` and `validateReleaseMeta` enforces it, so the §4 safety boundary holds: an
instance can *describe* and *display* the latest known release, but deploying a new one stays
the manual maintainer step in `VPS_INSTALL.md` §7 (and §12 for how the metadata fits the
manual-update story).

## 6. Pre-deploy install dry-run (v0.2.193)

Before a maintainer walks the manual install/update story above, the **local install dry-run**
(`npm run vps:dry-run`, `VPS_INSTALL.md` §13) confirms the metadata half is in order — with NO
SSH, network, DNS, or server change. Among its 11 read-only checks it REUSES `validateReleaseMeta()`
to assert `public/release-metadata.json` is present and **manual-only / non-actionable**, and it
verifies that BOTH the metadata source AND this document reference the real repo
`ChiefmonkeyArt/torii-gate` (not the legacy placeholder). It exits non-zero only on a blocking
failure; it performs no deploy. The pure checklist logic lives in `tools/vpsDryRun.mjs`
(unit-tested, `tests/vps-dry-run.test.js`).
