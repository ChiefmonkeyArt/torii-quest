# Torii Quest — v0.2.188-alpha report

## Ship readiness & next safe task in the Continuum dashboard

**Slice:** Surface "last release readiness" and "next safe task" clearly on the Torii
Continuum project-oversight dashboard, reusing the existing v0.2.187 release-readiness
data/model. Dashboard/docs/tooling ONLY — no gameplay, portal runtime, physics, shooting,
controls, or live Nostr write behaviour touched.

**Previous shipped version:** v0.2.187-alpha (live/pushed/synced — added `npm run release:status`).

---

## What changed

### New pure model + renderer (`src/engine/dashboard/continuumData.js`)
- `buildShipModel(input = {})` — PURE, browser/node-safe (no fs/git/network/THREE/DOM,
  renders to a STRING). Folds the v0.2.187 read-only release-readiness verdict (passed in as
  `input.readiness`) into a render-ready ship model:
  - live signals present → `kind: 'generated'`;
  - otherwise degrades to the frozen `SHIP_LASTKNOWN` baseline → `kind: 'last-known'`.
  - accepts an optional `input.nextTask` override (default `SHIP_NEXT_SAFE_TASK`);
  - NEVER throws.
- Frozen exports (auto-surfaced under the SDK `continuum` namespace via `export *`):
  `SHIP_BADGE` (`'SHIP READINESS · LAST GATE · READ-ONLY'`), `SHIP_STATUS_COMMAND`
  (`'npm run release:status'`), `SHIP_NEXT_SAFE_TASK` (`{title, why, kind:'infra'}`),
  `SHIP_LASTKNOWN` (`{status:'ready', statusLabel:'READY', version, signals:[6]}`).
- `SHIP_SIGNAL_PILL` maps a signal status onto the EXISTING pill vocabulary
  (ok→`no-blocker`, blocked→`gated`, advisory→`manual`, skipped/unknown→`deferred`) —
  no new CSS.
- `_shipSignalRows(signals)` — null-safe signal-row builder.
- `_shipSection(ship)` renderer — a status pill (ready→`no-blocker` / not-ready|blocked→
  `gated` / incomplete→`manual` / else `deferred`), the `_healthChip(ship.kind)` provenance
  chip, a **Next safe task** `.focus` block, a six-row signal table, and
  blockers/unknowns/verdict `.focus` lines — all `escapeHtml`'d. Inserted AFTER the
  Active-focus section, BEFORE Milestones. NO new `<script>`, no new `data-k` key.
- `buildContinuumModel` attaches `ship` (falling back to `CURATED_SHIP = buildShipModel()`);
  `continuumDataJSON` carries `ship`.

### Reused release-readiness I/O (`tools/release-readiness.mjs`)
- Refactored to EXPORT `gatherReleaseReadiness(root = process.cwd())` — all fs/git helpers
  became closures over `root`. A `realpathSync` run-guard keeps the `npm run release:status`
  CLI behaviour UNCHANGED (formatted block + exit 0 only when invoked directly; silent and
  side-effect-free when imported).

### Build-time wiring (`tools/build-continuum.mjs`)
- Imports `buildShipModel` + `gatherReleaseReadiness`; builds the ship via
  `buildShipModel({ readiness: gatherReleaseReadiness(ROOT) })` inside try/catch (fallback to
  the last-known baseline), then passes `ship` into `buildContinuumModel`. The SAME live
  verdict the CLI prints now drives the dashboard's Ship-readiness section at packaging time.

### Version bump (every-deploy constraint)
- `index.html` (version-label + footer), `package.json`, `tools/regression-check.mjs`
  (`EXPECTED_VERSION` + header + stale-guard for v0.2.187) → all v0.2.188-alpha.

### Tests (`tests/continuum-dashboard.test.js`)
- Pins bumped v0.2.187→v0.2.188; added a `describe('ship readiness & next task (v0.2.188)')`
  block of 10 tests: last-known no-input fallback; live-summary `kind:'generated'` passthrough;
  NOT-READY blockers + `gated` pill; INCOMPLETE unknowns + `deferred` pill; `nextTask` override;
  pill-vocabulary-only assertion; `continuumDataJSON` carries `ship`; render shows
  `Ship readiness` / `SHIP_BADGE` / `Next safe task` / a pill; and a SAFETY test using
  tag-injection (`<script>`, `<img src=x>`, `<svg/onload=1>`) asserting escaping + banned-token-
  free markup + exactly one `<script>` + the CSP hash intact.

### Docs
- `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md` updated with
  the v0.2.188 ship-readiness slice + version markers; Tests metric → `1025 passing / 68 files`.
- `progress.md`: reworded one historical phrase `new-window-open` → `popup-windows` in the
  v0.2.180 entry so the regex form of the XSS verification CLI no longer false-positives (see
  Security below).

---

## Tests run / results
- `npm run test:foundation` → **25 files / 412 tests passed**.
- `npm run test:release` (full gate: `build` → `vitest run` → `check` → `bundle:report` →
  `handoff:status`):
  - build:continuum wrote `public/continuum.html` + `public/continuum-data.json`
    (`ship readiness: READY (generated)`);
  - vitest → **68 files / 1025 tests passed** (continuum-dashboard.test.js = 70 tests);
  - `npm run check` → **ALL GREEN** (15 regression checks, incl. [5] version markers,
    [14] doc consistency across 5 docs at v0.2.188, [15] zone-fallback);
  - bundle:report → advisory only (rapier chunk over warn limit — tracked, not gated);
  - handoff:status → config.js + package.json in sync at v0.2.188-alpha.
- `npm run release:status` → behaviour unchanged after the refactor.

## Continuum regeneration / XSS guard
- `npm run build:continuum` regenerates the dashboard with the **Ship readiness** section,
  v0.2.188 markers, `ship readiness: READY (generated)`.
- `grep -cE "javascript:|window.location|location.href|eval\(|window.open" public/continuum.html`
  = **0**.
- Exactly **1** `<script>` (the static refresh script); CSP sha256 unchanged.

---

## Security / performance concerns
- **XSS guard false-positive (fixed, not a vulnerability):** the regex verification CLI
  (`grep -cE`) treats `.` as a wildcard, so `window.open` matched the literal hyphenated word
  `window-open` inside derived v0.2.180 history prose. The SHIPPED guard
  (`tests/continuum-dashboard.test.js` line 466) uses literal `expect(html).not.toContain(...)`
  and was already 0; reworded the source phrase to `popup-windows` so the CLI form is also 0.
  No actual injection vector existed — `escapeHtml` neutralises markup; the new section adds no
  script and introduces none of the five banned literals.
- **No new runtime risk:** the new model/renderer are pure (no fs/git/network/THREE/DOM); the
  fs/git I/O lives in the build-time tool. No `setTimeout`, no `Vector3`/`Matrix4`, no live
  Nostr writes, no navigation. godMode stays false; ESC pause + panel-click fire safety
  untouched; debug tools ship unconditionally.
- **Performance:** dashboard/build-time only; zero hot-path impact.

---

## Changed files
- `src/engine/dashboard/continuumData.js` (buildShipModel/_shipSection/_shipSignalRows/JSON +
  HEALTH_LASTKNOWN + metrics test counts → 1025)
- `tools/release-readiness.mjs` (export gatherReleaseReadiness + run-guard)
- `tools/build-continuum.mjs` (feed live verdict into buildShipModel)
- `tools/regression-check.mjs` (EXPECTED_VERSION + stale-guard)
- `index.html`, `package.json` (version bump)
- `tests/continuum-dashboard.test.js` (+10 ship tests, pins)
- `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`
- `public/continuum.html`, `public/continuum-data.json` (regenerated)

## Commit
- Local only: `v0.2.188-alpha: show release readiness and next task in Continuum dashboard`
- Commit hash: _(appended below after commit)_

> Do NOT push or publish — parent will verify, review, deploy, publish, push, and upload docs.
