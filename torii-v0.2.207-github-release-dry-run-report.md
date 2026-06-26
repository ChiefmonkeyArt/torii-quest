# Torii Quest — v0.2.207-alpha slice report

## GitHub MVP release dry-run checklist

**Kind:** docs/tooling-only · local · read-only · NO tag / NO release / NO deploy
**Version:** v0.2.207-alpha (config + package in sync)
**Live:** https://torii-quest.pplx.app

### What shipped

A pure helper + thin CLI that validate the prerequisites for a FUTURE GitHub MVP
proof release **without creating it**:

- `tools/githubReleaseDryRun.mjs` — pure, node-safe (no fs/network/child_process/
  THREE/DOM; never throws). Exports the schema/badge/title/write-filename constants,
  the frozen 9-item `GITHUB_RELEASE_DRY_RUN_PREREQUISITES` set, the frozen 3-item
  `GITHUB_RELEASE_DRY_RUN_ADVISORIES`, the standing `GITHUB_RELEASE_APPROVAL_GATE`,
  and `buildGithubReleaseDryRunModel(...)` / `formatGithubReleaseDryRun(...)` /
  `formatGithubReleaseDryRunMarkdown(...)`.
- `tools/github-release-dry-run.mjs` — thin CLI (`npm run release:dry-run`), behind a
  `realpathSync` run-guard. Stamps version + package version + best-effort short commit
  + read-only git (`git status --porcelain` for clean-tree; `git rev-parse HEAD` vs
  `@{u}` for pushed — **no fetch**) + the shared live URL + the release-metadata
  autoUpdate/actionable read. Builds with `gateReady:null` (the RC gate is deliberately
  not run). Modes text / `--json` / `--markdown`; opt-in in-repo `--write[=path]`
  (default `GITHUB_RELEASE_DRY_RUN.md`); always exits 0 (rejected `--write` path → 2).
- `tests/github-release-dry-run.test.js` — 16 tests (constants, verdict
  READY/NEAR/BLOCKED, future commands + safety, formatters, robustness).

### Prerequisites validated

version marker · version↔package sync · clean working tree (soft) · pushed commit
(soft) · release-notes draft present · release package present · RC gate ready · public
live URL · no autoUpdate/actionable release metadata. Each carries a `gating` flag and a
resolved `state` ∈ ok/blocked/pending/unknown.

### Verdict semantics

- A **gating** prerequisite in `blocked` → **BLOCKED**.
- A **gating** `unknown` (e.g. the RC gate, never run by the tool) or a **soft-pending**
  signal (expected dirty tree / unpushed HEAD before the parent pushes) → **NEAR**.
- Otherwise → **READY**, which still reads "READY (pending manual approval)" because the
  manual-approval gate is a standing, always-shown requirement (`approvalRequired:true`),
  never a scored item.

Current local run is **NEAR** (dirty tree + unknown RC gate + unchecked push), which is
exactly the expected pre-handoff state.

### Safety posture

Every model pins `tagged/released/pushed/published/deployed/announced/served/navigated/
wrote/network = false`. The three suggested future commands (`git tag`, `git push`,
`gh release create`) are **text only** — none executed — and each carries an explicit
"DO NOT run without user approval" note.

### Artifacts

- `GITHUB_RELEASE_DRY_RUN.md` (generated via `npm run release:dry-run -- --write`).

### Constraints held

`godMode` false · no new `setTimeout`/`Vector3`/`Matrix4` · no gameplay/physics/shooter/
Rapier change · no Nostr signing/publishing/live network write · no server/DNS/SSH/
updater/git-tag/GitHub-release/deploy behavior · changes split by concern · committed
locally only (parent agent handles security review, deploy, publish, push, Space upload).

### Tests

Suite bumped to **1332 passing / 84 files** (+16, +1 file). Both test-count captures
(`mvpReadiness.DEFAULT_TEST_STATUS`, `continuumData.CURRENT_TEST_STATUS`) updated in
lock-step to keep the `tests/continuum-dashboard.test.js` drift-catcher green.
