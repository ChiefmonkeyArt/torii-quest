# Torii Quest v0.2.187-alpha — Release-Readiness Summary Tooling

**Slice type:** safe, read-only, local-only infrastructure / tooling. No runtime/gameplay change.
**Goal:** add a single concise command that aggregates the important local readiness
signals into ONE verdict for AI handoff + rapid shipping — version sync, test-profile
counts, the regression-check gate, the advisory bundle baseline, the `/zone/*` SPA-fallback
verdict, docs/status consistency, and the latest reports. Tooling/docs only — no gameplay,
portal-runtime, physics, controls, shooting, or live Nostr-write change.

---

## What shipped

- **`tools/releaseReadiness.mjs`** — a NEW PURE, node-safe aggregator (no fs / network /
  child_process / THREE / DOM). It folds the plain verdicts of the existing pure checks into
  one render-ready summary and reuses (never re-implements) the helpers it aggregates:
  `versionAgreement` (handoffStatus.mjs), `PROFILES` / `validateProfiles` (testProfiles.mjs),
  `formatBytes` (bundleSizes.mjs).
  - `buildReleaseReadiness({version, packageVersion, gitCommit, existingTests, regression,
    bundle, zoneFallback, docs, latestReports})` → JSON-serialisable
    `{ badge, gateCommand, status, statusLabel, ready, blockers, unknowns, version,
    packageVersion, gitCommit, signals:{versionSync, tests, regression, bundle, zoneFallback,
    docs}, latestReports }`.
  - Honest per-signal states: `ok` / `blocked` / `advisory` / `skipped` / `unknown`.
  - Honest overall verdict: **READY** (all required signals present and ok) / **NOT READY**
    (a present signal fails — `blockers[]`) / **INCOMPLETE · SIGNALS MISSING** (a required
    signal had no input — `unknowns[]`). Bundle is **ADVISORY** and never blocks.
  - `formatReleaseReadiness(summary)` → a concise terminal text block.
  - Exported constants: `REGRESSION_CHECK_COUNT` (=15), `RELEASE_READINESS_BADGE`
    (`'RELEASE READINESS · LOCAL · READ-ONLY'`), `RELEASE_GATE_COMMAND` (`'npm run test:release'`),
    `SIGNAL_STATES`.
- **`tools/release-readiness.mjs`** — a NEW thin CLI (`npm run release:status`). It does the
  fs/git I/O and folds the existing pure checks: config/package versions, best-effort git
  short commit, `tests/*.test.js` on disk (for `validateProfiles`), a **read-only** count of
  the `[N]` checks in `regression-check.mjs`, the advisory bundle baseline (`summarizeBundle`
  over `dist/`), the `/zone/*` verdict (`checkZoneFallbackReadiness`), and docs/status
  consistency (`checkDocConsistency`). **Always exits 0 — a visibility snapshot, NOT a gate**
  (the authority stays `npm run check` / `npm run test:release`). No network, no writes, no
  secrets.
- **`package.json`** — new `"release:status": "node tools/release-readiness.mjs"` script.
- **`tools/testProfiles.mjs`** — `release-readiness.test.js` added to the `foundation`
  profile (now 25 files); comment updated to list the new guard suite.

## Changed files

- **NEW** `tools/releaseReadiness.mjs` — pure aggregator + formatter.
- **NEW** `tools/release-readiness.mjs` — thin read-only CLI.
- **NEW** `tests/release-readiness.test.js` — +15 unit tests for the pure logic.
- `package.json` — `release:status` script + version `0.2.187-alpha`.
- `tools/testProfiles.mjs` — foundation profile +1 (release-readiness) + comment.
- `src/config.js`, `index.html` (×2), `tools/regression-check.mjs` (header +
  `EXPECTED_VERSION` + stale-guard now flags v0.2.186-alpha) — version bump.
- `src/engine/dashboard/continuumData.js` — `CONTINUUM_VERSION`,
  `HEALTH_LASTKNOWN.totalTests` (1016 passing), Tests/Source-version/Active-slice metrics,
  `activeNow`/`completed24h` rotation bumped to v0.2.187 (24h window kept at 4).
- `tests/continuum-dashboard.test.js` — version assertions bumped to v0.2.187-alpha.
- `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md` — version +
  per-version entries; new `release:status` command + tooling index rows documented.
- `public/continuum.html`, `public/continuum-data.json` — regenerated at v0.2.187-alpha.

## Tests run (pass/fail)

- `tests/release-readiness.test.js` (targeted): **15 passed / 0 failed** (new).
- `npm run test:foundation`: **25 files passed** (was 24).
- `npm run release:status`: prints **verdict: READY** (v0.2.187-alpha) — version sync ✓,
  test profiles fast 5 · foundation 25 ✓, regression gate 15/15 ✓, bundle advisory (rapier
  over-limit, tracked), `/zone/*` docs+dist ✓, docs consistency ✓.
- Full `vitest run`: **1016 passed / 0 failed** across **68 files** (was 1001 / 67).
- `npm run test:release` (build + vitest + regression-check + bundle + handoff): **GREEN**.
  Regression-check `[1]`–`[15]` **ALL GREEN** (incl. `[5]` version markers == v0.2.187-alpha,
  `[14]` docs consistency, `[15]` `/zone/*` fallback readiness). Bundle advisory unchanged
  (rapier chunk > 700 KB, expected/tracked).

## Safety / performance notes

- **No runtime/gameplay change.** No edits to physics, shooting, controls, portal runtime, or
  Nostr live-write paths. The slice is a pure aggregator + a read-only CLI + tests/docs.
- **Read-only, local-only, no network, no writes.** The CLI only reads local files + asks git
  for a short commit (best-effort, never throws). It writes nothing. The only generated
  artifacts touched (`public/continuum.*`) are regenerated by the EXISTING `build:continuum`
  step as part of the normal build, not by the new tool.
- **No new CSP/XSS surface.** The continuum regeneration is data-only; XSS self-guard
  `grep -cE "javascript:|window.location|location.href|eval\(|window.open" public/continuum.html`
  → **0**; the v0.2.172 `CONTINUUM_SCRIPT_SHA256` still matches (node:crypto test green).
- **Honest verdict.** Missing inputs degrade to INCOMPLETE / a signal `unknown` rather than
  over-claiming READY; the regression gate stays the authority (the summary only surfaces its
  presence + check count read-only). Bundle over-limit is ADVISORY and never blocks.
- **No hot-path allocation.** Pure data transforms only; no `Vector3` / `Matrix4`
  (regression `[4]` green); no new `setTimeout` (regression `[3]` green).
- **godMode false** (`[2]` green).

## Constraints honoured

Version bumped everywhere (regression `[5]` green); godMode false; no new setTimeout; no new
Vector3/Matrix4 in hot paths; debug/build tools ship unconditionally; ESC pause + panel-click
fire safety untouched (no main.js edit); "nostrich" / "Chiefmonkey" spellings unaffected (no
such comments added).

## Commit

Committed locally only (not pushed/published) — the parent agent verifies, deploys,
publishes, pushes, and uploads docs. Commit hash recorded below after commit.
