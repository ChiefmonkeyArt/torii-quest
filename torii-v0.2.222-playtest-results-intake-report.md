# v0.2.222-alpha — MVP Playtest Results Intake

**Type:** docs / tooling / dashboard slice (no runtime/gameplay change).
**Commit:** local only — NOT pushed, NOT tagged, NOT released. Parent/main agent handles
security review, deploy, publish, GitHub push, and Space upload.

## What & why

The user is about to run the manual MVP playtest. v0.2.220 added `MVP_APPROVAL_STATE.json`
(defaulting to **pending**) and v0.2.221 surfaced that pending approval on the dashboard. A
regeneratable `MVP_PLAYTEST_RESULTS_TEMPLATE.md` already existed, but it is ephemeral (rebuilt
blank by the artifact sequence), so there was no clean, persistent place to record the actual
manual results without scattering notes.

This slice adds a canonical, source-controlled recording file `MVP_PLAYTEST_RESULTS.md` (ships
**blank** → reads as `not-run`, the safe default) plus a pure state model that maps the existing
results summary into one compact, pipeline-friendly verdict answering "has the human MVP playtest
actually been recorded, and what did it say?". Crucially, the state **never implies approval** —
`approvalImplied` is pinned false in every branch. A recorded (even fully-PASS) playtest is
necessary but NOT sufficient; the explicit user "MVP approved" gate (`MVP_APPROVAL_STATE.json`)
stays separate. No results are fabricated; everything defaults to not-run / pending.

## Changed / added files

### Core deliverable
- `MVP_PLAYTEST_RESULTS.md` — **NEW**, canonical hand-edited recording file derived from the
  existing template sections. Ships blank (all items unrecorded) so a fresh checkout reads
  `not-run`. **NO-CLOBBER / persistent** — deliberately NOT in the artifact regen sequence.
- `tools/playtestResultsState.mjs` — **NEW**, pure/node-safe (no fs/network/child_process/
  process/THREE/DOM; never throws). Imports `summarizePlaytestResults` from `./playtestResults.mjs`.
  Exports `PLAYTEST_RESULTS_STATE_SCHEMA` ('torii.playtest-results-state'),
  `PLAYTEST_RESULTS_STATE_SCHEMA_VERSION` (=1), `PLAYTEST_RESULTS_STATE_BADGE`,
  `PLAYTEST_RESULTS_STATE_FILE` (=`MVP_PLAYTEST_RESULTS.md`), frozen `PLAYTEST_RESULTS_STATUSES`
  (unknown/not-run/incomplete/attention/complete). `summarizePlaytestForState(input)` accepts a
  results markdown string OR a `summarizePlaytestResults()` object OR null →
  `{schema,schemaVersion,status,verdict,ran,complete,pending,approvalImplied:false,total,counts,fails}`.
  **HARD INVARIANT: `approvalImplied` pinned false in every branch.** `formatPlaytestResultsState`
  → null-safe text.
- `tools/playtest-results-status.mjs` — **NEW** CLI (`npm run playtest:status`): reads
  `MVP_PLAYTEST_RESULTS.md` + stamps version/commit behind a run-guard; text default / `--json`;
  READ-ONLY/local/no-network, never writes.

### Wiring
- `tools/nextActionState.mjs` — folds the playtest-results state into the machine-readable
  next-action export as `playtestResults` (always `approvalImplied:false`).
- `package.json` — `"playtest:status": "node tools/playtest-results-status.mjs"`.

### Version markers
- `src/config.js` (`VERSION`), `index.html` (×2: `#version-label` + `#ver`),
  `src/engine/dashboard/continuumData.js` (`CONTINUUM_VERSION` + "Source version" metric + Active
  slice narrative + `CURRENT_TEST_STATUS` 1450→1463 / files 88→89),
  `src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS` 1450→1463 / files 88→89),
  `tools/regression-check.mjs` (`EXPECTED_VERSION` + stale guard now flags `v0.2.221-alpha`),
  `public/sw.js` (`CACHE_VERSION` → `tq-v0.2.222-alpha`),
  `package.json` (`version` 0.2.222-alpha),
  `tests/continuum-dashboard.test.js` (4 version pins).

### Tests
- `tests/playtest-results-state.test.js` — **NEW** (11): unknown on null/garbled/empty; not-run
  when all blank; attention on any FAIL; incomplete on partial; complete on all PASS/N-A;
  `approvalImplied` false in every branch (incl. a fully-complete summary); formatter null-safe.
- `tests/next-action-state.test.js` — +2 blocks + formatter assertions (15 → 18): playtest results
  fold in with `approvalImplied:false`; a fully-complete playtest still never implies approval;
  text formatter shows `MVP playtest:` + `implies approval: no`.
- Suite 1450/88 → **1463/89**.

### Docs
- `todo.md` (header + new HARD-36 row), `progress.md` (header / Source version / Tests 1463/89 /
  Active slice / Active-now bullet), `HANDOFF.md` (§1 Current version + §3 `MVP_PLAYTEST_RESULTS.md`
  marker-table row marked "NOT a version marker — do NOT bump" + v0.2.222 narrative + report
  pointer), `CODE_INDEX.md` (Current version + new "MVP playtest results state" row),
  `SDK_DEBUG_INDEX.md` (status version).

### Regenerated artifacts
- `MVP_APPROVAL_STATE.json` (version → v0.2.222-alpha, still PENDING), `NEXT_ACTION_STATE.json`,
  `RELEASE_ARTIFACT_MANIFEST.md`, `public/release-metadata.json`, `public/continuum.html`,
  `public/continuum-data.json`, `HANDOFF.generated.md`, `MVP_RELEASE_PACKAGE.md`,
  `MVP_PLAYTEST_CHECKLIST.md`, `RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`,
  `MVP_PLAYTEST_RESULTS_TEMPLATE.md`, `MVP_RC_SNAPSHOT.md` (carry v0.2.222-alpha).
  **NOT regenerated:** `MVP_PLAYTEST_RESULTS.md` (no-clobber / persistent tester recording file).

### New
- `torii-v0.2.222-playtest-results-intake-report.md` — this slice report.

## Tests run / results

- `npx vitest run` → **1463 passing / 89 files**
- `npm run check` → **15 / 15 ALL GREEN**
- `npm run build` → clean (standing rapier >700 KB advisory only, not gated)
- `npm run test:release` → **exit 0**

## Security-sensitive behavior

**None added.** The new state module is pure (no fs/network/child_process/process/THREE/DOM); the
CLI reads one file and never writes. The canonical `MVP_PLAYTEST_RESULTS.md` ships blank and is
hand-edited only. The state **can never imply approval** — `approvalImplied` is pinned false in
every branch and asserted by tests (including a fully-complete playtest). No gameplay / physics /
shooter / Rapier change; no Nostr signing/publishing/live network write; no
network/deploy/publish/tag/release/self-update. `godMode` stays false; no new
`setTimeout`/`Vector3`/`Matrix4`; "nostrich"/"Chiefmonkey" untouched.

## Blockers / warnings

- **No playtest results are recorded** — `MVP_PLAYTEST_RESULTS.md` ships blank, so the state reads
  `not-run` / pending until the user manually records actual results.
- **MVP approval remains PENDING** — this slice records nothing as approved; approval is a separate
  explicit user gate.
- Commit is **local only** — not pushed, not deployed, not published, not tagged.
- Standing non-blocking advisories unchanged (rapier chunk >700 KB; SDK_DEBUG advisory; alpha).
- Parent/main agent handles security review, deploy, publish, push, and Space upload.
