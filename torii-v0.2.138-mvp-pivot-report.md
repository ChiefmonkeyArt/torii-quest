# Torii Quest — v0.2.138-alpha MVP-Pivot + Update-Check Report

## 1. Summary

v0.2.138 **refocuses the project onto the 15-hour proof-of-concept route** and
scaffolds the **torii.quest GitHub update-check architecture (LEAN-5)**. Two parts,
both safe (docs + one pure node-safe helper; no deploy/network/gameplay change):

1. **Docs pivot.** The living docs now make explicit that **shooter polish is
   maintenance-only unless demo-breaking**, and that the active MVP is the
   freedom-tech loop: gateway/NAP-to-NAP preview, Plebeian/Nostr product panel
   proof, leaderboard preview, and the torii.quest GitHub update-check.
   Retrospective polish comes **after** proof-of-concept validation.
2. **LEAN-5 update-check architecture.** Pure `engine/update/updateCheck.js`
   compares a GitHub-release-shaped manifest's semver tag against the runtime
   `VERSION` and returns an INERT "update available" view-model. **No network
   fetch, no auto-update, no install** — the releases fetch + in-world prompt mesh
   are documented deferred host steps.

- **Version bump:** `v0.2.137-alpha` → `v0.2.138-alpha`.
- **Tests:** 305 → **318** (+13), 28 → **29** files. Build green, `npm run check`
  ALL GREEN (11 guards).
- **No deploy / publish / push / upload.** Committed on branch `v0.2.138`
  (`d519508`); the main agent owns deployment.

## 2. Commit

- **Hash:** `d519508` on branch **`v0.2.138`** — **NOT pushed**.
- Branched from `951dd01` (v0.2.137, the current pushed base).
- Message: `feat(v0.2.138): 15-hour PoC pivot + torii.quest GitHub update-check architecture`.

## 3. Files changed (13 files, +463 / −44)

New:
- `src/engine/update/updateCheck.js` — pure update-check helpers + inert view-model.
- `tests/update-check.test.js` (13 cases).
- `UPDATE_CHECK.md` — the update-check architecture doc.

Modified:
- `src/config.js`, `index.html` (×2 version labels), `tools/regression-check.mjs`
  (header, `EXPECTED_VERSION`, stale-version guard → flag `v0.2.137-alpha`),
  `package.json` (`0.2.138-alpha`) — version markers.
- `src/sdk/index.js` — `updateCheck` namespace at the experimental tier.
- `todo.md`, `strategy.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md` — the
  15-hour PoC pivot + LEAN-5 entries. (`COMPONENTS.md` / `GATEWAY_PROTOCOL.md`
  untouched — no component-contract or protocol change.)

## 4. Exact version bump

- **v0.2.137-alpha → v0.2.138-alpha.** Markers: `src/config.js` (`VERSION`),
  `index.html` (`#version-label`, `#ver`), `tools/regression-check.mjs` (header,
  `EXPECTED_VERSION`, stale guard now flags `v0.2.137-alpha`), `package.json`
  (`0.2.138-alpha`, v-stripped semver — regression-check [5] asserts it).

## 5. The update-check helper (LEAN-5)

`src/engine/update/updateCheck.js` — pure, node-safe (no THREE/Rapier/DOM/network):

- `RELEASE_SOURCE` — `{owner, repo, latestReleaseUrl, releasesPageUrl}` (docs only).
- `UPDATE_STATUS` — `{UPDATE_AVAILABLE, UP_TO_DATE, UNKNOWN}`.
- `compareVersions(a, b)` → `-1|0|1` — tolerant semver compare (optional `v`,
  dotted core, single dotted prerelease tag; a prerelease ranks below the same
  full release per semver).
- `parseRelease(raw)` — normalises a GitHub-release-shaped object; never throws.
- `evaluateUpdate(release, currentVersion=VERSION)` → `{status, currentVersion,
  latestVersion, updateAvailable, release}`; draft/unparseable → `UNKNOWN`.
- `updateCheckView(release, {currentVersion, notesMax})` → INERT view-model
  `{status, currentVersion, latestVersion, updateAvailable, prompt, notesPreview,
  releaseUrl, releasesPageUrl, actionable:false}`.

## 6. Verification

- `npm run build` → exit 0 (`✓ built`; dist rebuilt at v0.2.138 markers).
- `npm run check` → **ALL GREEN** (11 guards, incl. package.json-version [5]).
- `npm test` → **318 passed / 318**, **29 files**.

## 7. MVP route progress

- **LEAN-5 advanced** — the torii.quest GitHub update-check architecture now has a
  pure helper + inert view-model + docs + tests (the fourth MVP slice's foundation).
- The docs pivot makes the 15-hour PoC route and the maintenance-only-shooter
  stance the explicit source of truth across todo/strategy/progress/HANDOFF/index.

## 8. What remains next

- **LEAN-5:** the read-only releases-endpoint fetch (a deliberate, audited host
  call — needs a CSP `connect-src` GitHub entry) + the in-world "update available"
  prompt MESH/HUD over `updateCheckView(...)`.
- **LEAN-2/3/4:** the deferred browser MESH steps over the existing view shells
  (portal mesh + `world/handoff.js` acting on the intent; in-world product panel
  mesh; title-screen rank board) + the real Nostr signer/relay.
- Retrospective shooter/feel/UX polish — only after PoC validation.

## 9. Safety gates preserved

- **SEC-1 / SEC-2 / SEC-3 intact** — no signer, no relay/publish, no navigation, no
  clickable/fetched product URL, no auto-update. The update-check view-model is
  `actionable:false` and performs no I/O.
- godMode stays `false`; no new `setTimeout`; no new Vector3/Matrix4 hot-path
  allocations; "nostrich"/"Chiefmonkey" conventions untouched; debug ships
  unconditionally; firing rule (barrel→crosshair) unchanged.
- **No deploy/publish/push/upload** — branch `v0.2.138` (`d519508`) is for the main
  agent to review, push, and ship.
