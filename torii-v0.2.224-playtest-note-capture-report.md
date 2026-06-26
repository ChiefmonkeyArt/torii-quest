# v0.2.224-alpha — MVP Playtest Note Capture

**Type:** docs / tooling slice (no runtime/gameplay change).
**Commit:** local only — NOT pushed, NOT tagged, NOT released. Parent/main agent handles
security review, deploy, publish, GitHub push, and Space upload.

## What & why

The user will manually test the live build and may send rough notes ("aim feels good, reload is
broken, crashes on the bazaar gateway"). v0.2.222 created the canonical recording file
`MVP_PLAYTEST_RESULTS.md` (defaults to **not-run**) and v0.2.223 surfaced its state on the
Continuum dashboard. What was still missing: an easy, structured way to convert those rough notes
into `MVP_PLAYTEST_RESULTS.md` later **without guessing or implying approval**.

This slice adds a read-only **note-capture explainer** that takes whatever the tester has drafted
so far and explains, item by item, what maps to PASS/FAIL/N-A/blank, which meta fields and per-item
fields are still blank, and — for any FAIL — the follow-up fields a tester still owes (`severity`
and `nextAction`; media optional). It reuses the canonical parser + state model as the single
source of truth (no second vocabulary) and HARD-pins `approvalImplied: false` in every branch:
capture is necessary but never sufficient. The CLI is strictly read-only (no `--write` at all), so
the no-clobber `MVP_PLAYTEST_RESULTS.md` is structurally untouchable.

## Changed / added files

### Core deliverable (new)
- `tools/playtestNoteCapture.mjs` — **NEW** PURE/node-safe explainer (no fs/network/child_process/
  process/THREE/DOM; never throws). Imports `parsePlaytestResults`, `summarizePlaytestResults`,
  `PLAYTEST_RESULTS_META_FIELDS`, `PLAYTEST_RESULTS_ITEM_FIELDS` from `./playtestResults.mjs` and
  `summarizePlaytestForState` from `./playtestResultsState.mjs`. Exports
  `PLAYTEST_NOTE_CAPTURE_SCHEMA` (`'torii.playtest-note-capture'`),
  `PLAYTEST_NOTE_CAPTURE_SCHEMA_VERSION` (=1), `PLAYTEST_NOTE_CAPTURE_BADGE` (carries `READ-ONLY` +
  `NOT AN APPROVAL`), frozen `CAPTURE_FOLLOWUP_FIELDS` (`['severity','repro','nextAction']`),
  `explainPlaytestCapture(text)`, `formatPlaytestCaptureExplain(explain)`.
  `explainPlaytestCapture` returns `{schema,schemaVersion,badge,status,ran,complete,pending,
  approvalImplied:false,total,recorded,blank,counts,fails,meta:{filled,blank},
  items:[{id,result,recorded,missingFields,needsFollowup}],followups,nextSteps,note}`. It reuses
  the canonical parser/state for status (unknown/not-run/incomplete/attention/complete) and LAYERS
  per-item field-completeness on top. **HARD INVARIANT: `approvalImplied` pinned `false` in every
  branch.**
- `tools/playtest-capture.mjs` — **NEW** STRICTLY READ-ONLY CLI (`npm run playtest:capture`).
  Reads `MVP_PLAYTEST_RESULTS.md` by default, or a `--file=` confined in-repo (rejects absolute /
  `..` → exit 2) behind a `realpathSync` run-guard. Modes: default text / `--json`. **NO `--write`
  of any kind** — the no-clobber results file cannot be touched. Local / no-network, exits 0.
- `PLAYTEST_NOTE_CAPTURE.md` — **NEW** how-to doc: one-minute capture loop, note→result mapping
  table (works/good/ok→PASS; broken/bug/crash→FAIL + severity + next action; n/a→N/A; blank→not
  recorded), severities (blocker/major/minor), status derivation, and an explicit "this is never an
  approval" section.

### npm script
- `package.json` — added `"playtest:capture": "node tools/playtest-capture.mjs"` (after
  `playtest:status`); `version` → `0.2.224-alpha`.

### Version markers
- `src/config.js` (`VERSION`), `index.html` (×2: `#version-label` + `#ver`),
  `src/engine/dashboard/continuumData.js` (`CONTINUUM_VERSION` + "Source version" metric + Active
  slice narrative + `CURRENT_TEST_STATUS` 1471→1482 / files 89→90),
  `src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS` 1471→1482 / files 89→90),
  `tools/regression-check.mjs` (`EXPECTED_VERSION` + stale guard now flags `v0.2.223-alpha`),
  `public/sw.js` (`CACHE_VERSION` → `tq-v0.2.224-alpha`),
  `tests/continuum-dashboard.test.js` (4 version pins).

### Tests
- `tests/playtest-note-capture.test.js` — **NEW** file, **+11** tests: constants; not-run all-blank;
  null/garbled→unknown; incomplete; attention with FAIL follow-up fields (repro filled →
  missingFields=['severity','nextAction']); fully-documented FAIL needs no follow-up; complete all
  PASS/NA never implies approval; build/session header blank detection; `approvalImplied:false`
  across every branch; formatter renders mapping + "implies approval: NO"; formatter null-safe.
- Suite 1471/89 → **1482/90** (NEW test file → files count bumps 89→90).

### Docs
- `todo.md` (header + new HARD-38 row), `progress.md` (header / Source version / Tests 1482/90 /
  Active slice), `HANDOFF.md` (§1 Current version + v0.2.224 narrative block + report pointer),
  `CODE_INDEX.md` (Current version + new MVP-playtest-note-capture row), `SDK_DEBUG_INDEX.md`
  (status version).

### Regenerated artifacts
- `NEXT_ACTION_STATE.json`, `MVP_APPROVAL_STATE.json` (version → v0.2.224-alpha, still PENDING),
  `RELEASE_ARTIFACT_MANIFEST.md`, `public/release-metadata.json`, `public/continuum.html`,
  `public/continuum-data.json`, `HANDOFF.generated.md`, `MVP_RELEASE_PACKAGE.md`,
  `MVP_PLAYTEST_CHECKLIST.md`, `RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`,
  `MVP_PLAYTEST_RESULTS_TEMPLATE.md`, `MVP_RC_SNAPSHOT.md` (carry v0.2.224-alpha).
  **NOT regenerated:** `MVP_PLAYTEST_RESULTS.md` (no-clobber / persistent tester recording file).

### New
- `torii-v0.2.224-playtest-note-capture-report.md` — this slice report.

## Tests run / results

- `npx vitest run` → **1482 passing / 90 files**
- `npm run check` → **15 / 15 ALL GREEN**
- `npm run build` → clean (standing rapier >700 KB advisory only, not gated)
- `npm run test:release` → **exit 0**

## Security-sensitive behavior

**None added.** The new explainer module is pure/node-safe (no fs/network/child_process/process/
THREE/DOM; never throws) and composes only the canonical parser + state model. The CLI is strictly
read-only — it has NO `--write` path at all, so the no-clobber `MVP_PLAYTEST_RESULTS.md` cannot be
mutated; `--file=` is confined in-repo (absolute / `..` rejected → exit 2). The explainer **can
never imply approval** — `approvalImplied` is pinned `false` in every branch and asserted by tests
(including a fully-complete playtest). No gameplay / physics / shooter / Rapier change; no Nostr
signing/publishing/live network write; no network/deploy/publish/tag/release/self-update. `godMode`
stays false; no new `setTimeout`/`Vector3`/`Matrix4`; "nostrich"/"Chiefmonkey" untouched.

## Blockers / warnings

- **No playtest results are recorded** — `MVP_PLAYTEST_RESULTS.md` ships blank, so the capture
  explainer (and the dashboard card) reads `not-run` / pending until the user manually records
  actual results. No results are fabricated.
- **MVP approval remains PENDING** — this slice records nothing as approved; approval is a separate
  explicit user gate.
- Commit is **local only** — not pushed, not deployed, not published, not tagged.
- Standing non-blocking advisories unchanged (rapier chunk >700 KB; SDK_DEBUG advisory; alpha).
- Parent/main agent handles security review, deploy, publish, push, and Space upload.
