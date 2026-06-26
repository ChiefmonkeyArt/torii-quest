# v0.2.215-alpha — Continuum Manual-Validation / MVP-Playtest Readiness Card

**Type:** safe dashboard/docs/tooling slice (no runtime/gameplay change).
**Commit:** local only — NOT pushed, NOT tagged, NOT released. Parent/main agent handles
security review, deploy, publish, GitHub push, and Space upload.

## What & why

The Torii Continuum oversight dashboard (`/continuum.html`, generated from progress.md + todo.md +
status helpers) already surfaced Ship readiness and, as of v0.2.214, an RC / release-manifest status
card. `MVP_RC_SNAPSHOT` says local gates are green but manual validation + approval remain pending,
and the repo already ships `MVP_PLAYTEST_CHECKLIST.md` + `MVP_PLAYTEST_RESULTS_TEMPLATE.md`. The user
wants concise visual project oversight that makes the remaining work unambiguous: what is no-blocker
(the local automated gates) vs what still needs manual input (the human live-browser playtest).

This slice adds a read-only **Manual validation** section just below the RC / release-manifest card
that CLEARLY SEPARATES those two postures and lists the highest-level manual validation areas without
flooding the dashboard with every checklist item. Per the work-order's "prefer deriving from existing
pure helpers/docs over duplicating logic", the card DERIVES from the already-frozen playtest-checklist
constants + doc presence rather than re-running any gate.

## Changed / added files (25; 1 new)

### Dashboard data + render (pure, browser-safe)
- `src/engine/dashboard/continuumData.js` — new PURE `buildManualValidationModel(input={})` +
  `MANUALVALIDATION_BADGE` ('MANUAL VALIDATION · MVP PLAYTEST · READ-ONLY') + frozen
  `MANUALVALIDATION_LASTKNOWN` (curated fallback: 13 sections / 17 items / 4 blocker / 5 major /
  8 minor / 7 areas). Folds plain data `{sections, items, blocker, major, minor, validationAreas,
  checklistDocPresent, resultsTemplatePresent, gateStatusLabel, areas}` into a render-ready model
  with a 6-card metrics list (Local automated gates, Manual playtest, Playtest checklist, Severity
  coverage, Playtest docs, Manual validation areas) and an honest band that SEPARATES automated vs
  manual:
  - checklist or results-template doc missing → `docs-incomplete` / pill `gated` / "PLAYTEST DOCS INCOMPLETE"
  - docs present + `/^READY/i` gate → `gates-green` / pill `manual` / "LOCAL GATES GREEN · MANUAL PLAYTEST + APPROVAL PENDING"
  - else → `manual-outstanding` / pill `manual` / "MANUAL VALIDATION OUTSTANDING"

  With no input it degrades to `MANUALVALIDATION_LASTKNOWN` (`kind:'last-known'`) and never throws —
  mirroring the rc-status/ship/health builders. `buildContinuumModel` attaches `manualValidation`
  (falling back to `CURATED_MANUALVALIDATION = buildManualValidationModel()`); `continuumDataJSON`
  carries `manualValidation`. New `_manualValidationSection(mv)` renderer (status pill from the
  existing vocabulary + `_healthChip(kind)` provenance chip + `_metricRows(mv.metrics)` + escaped
  note) inserted in `renderContinuumPage` immediately after `_rcStatusSection`. Reuses the existing
  `.metric`/`.pill` markup → NO new `<script>` and no new `data-k` key, so the v0.2.172 CSP + inline
  refresh-script sha256 are unchanged; every value HTML-escaped. Also CONTINUUM_VERSION +
  CURRENT_TEST_STATUS.passing 1388→1396 + Source version metric + Active slice narrative.

### Build-time live gather (node side, cheap file-presence only)
- `tools/build-continuum.mjs` — imports `buildManualValidationModel` (continuumData.js) +
  `PLAYTEST_CHECKLIST_SECTIONS`/`PLAYTEST_SEVERITIES`/`PLAYTEST_CHECKLIST_WRITE_FILENAME`/
  `playtestItemCount` (`./playtestChecklist.mjs`). Adds a try/catch block that derives the
  section/item counts + blocker/major/minor severity tallies from the frozen checklist sections,
  `existsSync`-stats the two playtest docs (`MVP_PLAYTEST_CHECKLIST.md` /
  `MVP_PLAYTEST_RESULTS_TEMPLATE.md`), uses `RC_SNAPSHOT_MANUAL_VALIDATION.length` for the area count,
  reuses the already-gathered `ship.statusLabel`, and folds via `buildContinuumModel({manualValidation})`.
  No crypto/git/network; degrades to curated last-known on failure.

### Tests (+8 → 1396)
- `tests/continuum-dashboard.test.js` — manual-validation imports + 4 version pins → v0.2.215-alpha;
  new `describe('manual validation / MVP-playtest readiness (v0.2.215)')` with 8 tests (last-known
  model, live generated band SEPARATING automated vs manual, PLAYTEST DOCS INCOMPLETE on a missing
  doc, MANUAL VALIDATION OUTSTANDING on a non-green gate, pill vocabulary, JSON carries
  manualValidation, render shows the section, hostile-input escape + script-hash intact).

### Version bump
- `src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs` (EXPECTED_VERSION
  + stale guard now rejects v0.2.214-alpha), `src/engine/status/mvpReadiness.js` (DEFAULT_TEST_STATUS
  1388→1396).

### Docs
- `todo.md` (header + new HARD-29 row), `progress.md` (header/Source version/Tests/Active slice/
  Active-now bullet), `HANDOFF.md` (version + v0.2.215 narrative + report pointer), `CODE_INDEX.md`
  (version + project-oversight-dashboard row note), `SDK_DEBUG_INDEX.md` (status version).

### Regenerated artifacts
- `RELEASE_ARTIFACT_MANIFEST.md`, `public/release-metadata.json`, `public/continuum.html`,
  `public/continuum-data.json`, `HANDOFF.generated.md`, `MVP_RELEASE_PACKAGE.md`,
  `MVP_PLAYTEST_CHECKLIST.md`, `RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`,
  `MVP_PLAYTEST_RESULTS_TEMPLATE.md`, `MVP_RC_SNAPSHOT.md` (carry v0.2.215-alpha).

### New
- `torii-v0.2.215-manual-validation-dashboard-report.md` — this slice report.

## Tests run / results

- `npx vitest run` → **1396 passing / 86 files** (was 1388/86; +8)
- `npm run check` → **15 / 15 ALL GREEN**
- `npm run build` → clean (standing rapier >700 KB advisory only, not gated)
- `npm run build:continuum` → all four lists derived from progress.md; manual-validation card generated
- `npm run test:release` → **exit 0**

## Security-sensitive behavior

**None added.** The dashboard data module stays PURE/browser-safe (no fs/crypto/network/
child_process/THREE/DOM). The card reuses existing `.metric`/`.pill` markup so the Continuum CSP and
inline refresh-script sha256 are untouched; every value HTML-escaped. The build-time gather is cheap
`existsSync` file-presence + frozen-constant reads only — no crypto/git/network — reusing the
playtest-checklist constants so it can't drift from the playtest-checklist CLI. No gameplay/physics/
shooter/Rapier change; no Nostr signing/publishing/live network write; no network/deploy/publish/tag/
release/self-update. `godMode` stays false; no new `setTimeout`/`Vector3`/`Matrix4`; "nostrich"/
"Chiefmonkey" untouched.

## Blockers / warnings

None. Commit is **local only** — not pushed, not deployed, not published, not tagged.
Standing non-blocking advisories unchanged (rapier chunk >700 KB; SDK_DEBUG advisory; alpha).
Parent/main agent handles security review, deploy, publish, push, and Space upload.
