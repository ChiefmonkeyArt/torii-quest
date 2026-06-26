# v0.2.210-alpha — MVP RC Snapshot / Freeze-Candidate Summary

**Type:** safe docs/tooling-only infrastructure slice (no runtime/gameplay change).
**Commit:** local only — NOT pushed, NOT tagged, NOT released. Parent/main agent
handles security review, deploy, publish, GitHub push, and Space upload.

## What & why

The MVP proof-of-concept now has a deep stack of pure, read-only release-readiness
verdicts — `runMvpReadiness()` (the 9-signal rollup), `gatherReleaseReadiness()` (the
release-readiness summary), `buildMvpRcGate()` (the RC candidate verdict), and
`buildGithubReleaseDryRunModel()` (the GitHub release prerequisites). They each answer
part of "is this build ready?", but the answer was scattered across five CLIs and a
present/missing pile of RC package docs. This slice folds them into ONE freeze-candidate
document so a human or a future agent can see the whole release-candidate state at a
glance — exact version, latest commit, test/regression counts, RC-gate verdict, MVP
rollup, GitHub release dry-run, the present/missing state of every RC package doc, the
known advisories, **what still needs manual user validation**, and **what would be
required to cut a real GitHub release/tag later**.

It re-derives NOTHING — it COMPOSES the already-pure verdicts (consistent with the
codebase's pure-lib + thin-CLI pattern) and stays a VISIBILITY snapshot, never a gate.
The authority remains `npm run test:release`.

## Changed / added files

### New
- `tools/rcSnapshot.mjs` — PURE/node-safe assembler. Exports `RC_SNAPSHOT_SCHEMA`
  (`torii.rc-snapshot`) / `RC_SNAPSHOT_SCHEMA_VERSION` (1) / `RC_SNAPSHOT_BADGE` /
  `RC_SNAPSHOT_WRITE_FILENAME` (`MVP_RC_SNAPSHOT.md`) / `RC_SNAPSHOT_TITLE` /
  `RC_SNAPSHOT_STATES` (frozen `['FREEZE-CANDIDATE','NEAR','BLOCKED']`), frozen
  `RC_SNAPSHOT_DOC_REFS` (7 RC package docs), `RC_SNAPSHOT_MANUAL_VALIDATION`,
  `RC_SNAPSHOT_RELEASE_STEPS`, `RC_SNAPSHOT_ADVISORIES`; `rcSnapshotVersionConsistency()`,
  `buildRcSnapshotModel()`, `formatRcSnapshot()` (text), `formatRcSnapshotMarkdown()`
  (markdown). Imports `sourceCommitInline` from `./commitStamp.mjs` (v0.2.209). All
  formatters null-safe; never throws.
- `tools/rc-snapshot.mjs` — thin CLI (`npm run rc:snapshot`). Does the fs/git I/O behind
  a `realpathSync` run-guard, composes `gatherReleaseReadiness` + `runMvpReadiness` +
  `buildHandoffSummary` + `buildMvpRcGate` + `buildGithubReleaseDryRunModel`, read-only
  git (`status --porcelain` clean-tree, `rev-parse HEAD` vs `@{u}` pushed — NO fetch),
  stat-s each RC doc, lists recent reports. Modes default text / `--json` / `--markdown`
  / `--write[=path]` (confined in-repo via the SHARED `resolveHandoffWritePath`). Always
  exits 0 (exit 2 on a rejected `--write` path).
- `tests/rc-snapshot.test.js` — 19 tests: constants/frozen lists; references-real-docs
  (every `RC_SNAPSHOT_DOC_REFS` file `existsSync` on disk) + version consistency vs
  config `VERSION`; version-consistency mismatch/absent/no-version; assembly + verdict
  banding (FREEZE-CANDIDATE / BLOCKED ×2 / NEAR / defaults / overrides / safety);
  formatters (text/markdown/null-safe); robustness (no-inputs/garbled never throw).
- `torii-v0.2.210-mvp-rc-snapshot-report.md` — this report.

### Version bump (every deploy)
- `src/config.js` — `VERSION` → `v0.2.210-alpha`
- `package.json` — `version` → `0.2.210-alpha`; added `"rc:snapshot"` script
- `index.html` — `#version-label` + `#ver` → v0.2.210-alpha
- `tools/regression-check.mjs` — `EXPECTED_VERSION` → v0.2.210-alpha; stale-version guard
  now rejects `v0.2.209-alpha`
- `src/engine/dashboard/continuumData.js` — `CONTINUUM_VERSION` → v0.2.210-alpha;
  `CURRENT_TEST_STATUS` passing 1339→1358 / files 84→85; Source version + Active slice
  metric narrative
- `src/engine/status/mvpReadiness.js` — `DEFAULT_TEST_STATUS` passing 1339→1358 /
  files 84→85
- `tests/continuum-dashboard.test.js` — 4 version pins → v0.2.210-alpha

### Docs
- `todo.md` — header version + new HARD-15 row
- `progress.md` — header / Source version / Tests 1358-85 / Active slice / Active now bullet
- `HANDOFF.md` — current-version line + v0.2.210 narrative + slice-report pointer
- `CODE_INDEX.md` — current version + new rcSnapshot.mjs tools-table row
- `SDK_DEBUG_INDEX.md` — status-line version

### Regenerated artifacts
- `MVP_RC_SNAPSHOT.md` (NEW, via `npm run rc:snapshot -- --write`)
- `public/release-metadata.json`, `public/continuum.html`, `public/continuum-data.json`
  (build:continuum / release:meta)
- `HANDOFF.generated.md`, `MVP_RELEASE_PACKAGE.md`, `MVP_PLAYTEST_CHECKLIST.md`,
  `RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`, `MVP_PLAYTEST_RESULTS_TEMPLATE.md`
  (regenerated so committed copies carry v0.2.210-alpha)

## Tests run / results

- `npx vitest run` → **1358 passing / 85 files** (was 1339/84; +19 new file
  `tests/rc-snapshot.test.js`)
- `npm run check` → **15 / 15 ALL GREEN** ([14] reports v0.2.210-alpha; [5] config↔package
  match)
- `npm run test:release` → **exit 0**
- `npm run build` → clean (standing rapier >700 KB advisory only, not gated)
- `npm run build:continuum` → all four lists derived from progress.md, no gaps
- `npm run rc:snapshot` → prints a FREEZE-CANDIDATE snapshot for v0.2.210-alpha

## Security-sensitive behavior

**None changed.** `tools/rcSnapshot.mjs` + CLI are pure/node-safe and run at BUILD time
only (never imported by the bundled game). No gameplay/physics/shooter/Rapier change; no
Nostr signing/publishing/live network write; no server/DNS/SSH/updater/git-tag/
GitHub-release/deploy behaviour. The CLI's git use is READ-ONLY (`rev-parse` /
`status --porcelain`, no fetch). `--write` is the ONLY write and is confined inside the
repo (absolute path / `..` escape rejected). `godMode` stays false; no new
`setTimeout`/`Vector3`/`Matrix4`; "nostrich"/"Chiefmonkey" untouched; debug tools still
ship unconditionally.

## Blockers / warnings

None. Commit is **local only** — not pushed, not deployed, not published, not tagged.
Standing non-blocking advisories unchanged (rapier chunk >700 KB; SDK_DEBUG advisory;
alpha). Parent/main agent handles security review, deploy, publish, push, and Space
upload.
