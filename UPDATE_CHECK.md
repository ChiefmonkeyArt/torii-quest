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

## 3. What is deferred (the host step — NOT in this module)

- **The actual read-only fetch** of the GitHub releases endpoint
  (`RELEASE_SOURCE.latestReleaseUrl`). Must be a deliberate, audited host call —
  CSP `connect-src` would need a GitHub API entry, and rate-limiting/error handling
  belong there, not in the pure helper.
- **The in-world prompt MESH / HUD** that renders `updateCheckView(...)`. Browser
  side effect; deferred like the other LEAN view-model meshes.
- **Any "Update" affordance.** The view-model is display-only by design
  (`actionable:false`); turning it into a real action (open the releases page,
  trigger a rebuild) is a separate, explicitly-authorised step.

## 4. Safety boundary

- No `fetch`/XHR/WebSocket in the module — it is a pure compare + view-model.
- No code download, no `eval`/dynamic import, no install, no `window.location`.
- Deploying a release remains a manual maintainer action; this flow only *informs*.
