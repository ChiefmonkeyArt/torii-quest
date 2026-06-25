# Torii Quest — v0.2.201-alpha Release Report

## Slice: MVP Release-Candidate Gate

**Type:** infrastructure / tooling. **No runtime behavior change.**

### Goal

Add a pure/local gate or CLI that answers ONE question: **is this build ready to
call an MVP proof-of-concept *release candidate*?** It must COMPOSE the existing
readiness signals only — regression checks, test status, MVP readiness, handoff
readiness, release-metadata safety floor, update-flow smoke, host-route smoke,
gateway-travel smoke, Nostr read health, VPS dry-run status, docs consistency — and
emit a concise verdict: **READY / NEAR / BLOCKED**, a percentage, the blocking
reasons, and the next one or two safe tasks. **No real release creation, no git tag,
no GitHub release, no deployment logic, no network, no server.**

The two upstream rollups already exist and cover all of these signals:
- `runMvpReadiness()` (v0.2.198) folds the four live smoke harnesses + version/meta/
  test/VPS/docs floor into an MVP pct/status.
- `gatherReleaseReadiness()` → `buildReleaseReadiness()` (v0.2.187) folds versionSync/
  tests/regression/zoneFallback/docs (+ bundle advisory) into a ship verdict.

This slice adds a thin layer that COMPOSES both into a single release-candidate
verdict — it re-derives no check. It mirrors the v0.2.199 agentHandoff pattern
exactly (pure helper + thin CLI).

### What landed

**`tools/mvpRcGate.mjs`** — PURE node-safe module (no fs/network/`child_process`/
THREE/DOM; never throws).

- `MVP_RC_GATE_SCHEMA` = `'torii.mvp-rc-gate'`, `MVP_RC_GATE_SCHEMA_VERSION` = 1
- `MVP_RC_GATE_BADGE` = `'MVP RELEASE-CANDIDATE GATE · LOCAL · READ-ONLY'`
- `MVP_RC_GATE_COMMAND` = `'npm run test:release'`
- `MVP_RC_STATES` = frozen `['READY','NEAR','BLOCKED']`
- `buildMvpRcGate({mvpReadiness,releaseReadiness,handoff,generatedAt})` folds a
  `runMvpReadiness()` rollup + a `buildReleaseReadiness()` summary (+ a
  `buildHandoffSummary()` brief as the next-task fallback) into a JSON-serialisable
  `{ schema, schemaVersion, generatedAt, badge, gateCommand, version, gitCommit,
  status, isCandidate, pct, reasons, nextTasks, components:{mvpReadiness,
  releaseReadiness}, safety, rendered:false, actionable:false }`.
  - **Verdict:** `READY` iff the release is ready AND the MVP rollup is green AND
    there are no release unknowns; `BLOCKED` if inputs are missing, a release
    blocker exists, or ≥2 MVP signals fail; else `NEAR`.
  - **`pct`** blends the passing MVP signals + the five required release signals
    (versionSync / tests / regression / zoneFallback / docs).
  - **`reasons`** lists `release:<key>` / `mvp:<key>: <detail>` /
    `release:<key> (not checked this pass)`.
  - **`nextTasks`** leads with `Clear top blocker: <reasons[0]>` then the safe task
    (the rollup `nextSafeTask.title`, else the handoff fallback), deduped + capped at 2.
  - **`safety`** pins `served/deployed/published/navigated/released/tagged/wrote/
    network = false`.
  - Null/garbled inputs degrade to an honest `BLOCKED` at `0%` and never throw.
- `formatMvpRcGate(gate)` → text block (null → `'mvp-rc-gate: (no gate)'`).
- `formatMvpRcGateMarkdown(gate)` → markdown (verdict, candidate line, components,
  reasons, next safe task; null-safe).

Composes ONLY the already-shipped pure rollups — surfaces NO release/tag/deploy/
serve/publish/navigate/fetch/write/exec/spawn/run/ssh/connect method of its own.

**`tools/mvp-rc-gate.mjs`** — local CLI behind a `realpathSync` run-guard. Reuses
`gatherReleaseReadiness()` + `runMvpReadiness()` + `buildHandoffSummary()`; does
best-effort git + config/package fs reads only. Modes: default text / `--json` /
`--markdown`. READ-ONLY/local/no-network; **NEVER writes, creates no release, cuts no
git tag**; always exits 0.

### Wiring (tooling only — no game / SDK / debug-shell change)

- **`package.json`**: `"rc:gate": "node tools/mvp-rc-gate.mjs"`.
- `mvpRcGate` is a build-time CLI, NOT an SDK namespace or `ToriiDebug` shell — it is
  never imported by the game. No `src/sdk` or `toriiDebug.js` change.

### Tests

- New: `tests/mvp-rc-gate.test.js` — **+14 tests** covering constants
  (schema/v1/badge/command/frozen `MVP_RC_STATES`); READY assembly (100%,
  `isCandidate` true, next task with no `Clear` prefix, all safety flags false);
  NEAR (one short MVP signal; release incomplete/unknown); BLOCKED (a release
  blocker; ≥2 MVP fails; missing inputs → honest BLOCKED at pct 0); the blended
  percentage; the formatters (text contains badge / `READY` / `100%` / release
  candidate line / gate command; markdown contains title / verdict / candidate /
  `release:docs` / next-safe-task); null-safety; garbled-input robustness.
- Full suite after the slice: **1260 passing / 79 files**.

### Version bump (v0.2.200-alpha → v0.2.201-alpha)

`package.json`, `src/config.js`, `index.html` (×2), `tools/regression-check.mjs`
(`EXPECTED_VERSION` + stale guard), `src/engine/status/mvpReadiness.js`
(`DEFAULT_TEST_STATUS` 1246/78 → 1260/79), `src/engine/dashboard/continuumData.js`
(`CONTINUUM_VERSION` + `CURRENT_TEST_STATUS` 1260/79 + metrics rows + active/
completed entries), `tests/agent-handoff.test.js` (V/PKG pins),
`tests/continuum-dashboard.test.js` (version pins), `public/release-metadata.json`
(regenerated), continuum artifacts rebuilt, dist rebuilt.

### Docs updated

`todo.md` (HARD-16 row), `progress.md` (header + at-a-glance + active-slice +
active-now), `HANDOFF.md` (version line), `CODE_INDEX.md` (version + new MVP RC-gate
row), `SDK_DEBUG_INDEX.md` (status version).

### Security-sensitive behavior

**None changed.** The gate is read-only; it injects no transport and reaches no
server, so it cannot serve, deploy, navigate, fetch, sign, publish, create a release,
cut a git tag, or write. It composes only the already-shipped pure rollups and
reflects, never mutates, readiness state. `godMode` remains `false`. No new
`setTimeout`, no new `Vector3`/`Matrix4` in hot paths. No gameplay/physics/shooter/
Rapier/Nostr signing/Nostr publishing/live network write/server/DNS/SSH/updater/git
tag/GitHub release change.

### Verification

- `tests/mvp-rc-gate.test.js` — pass (14).
- Full vitest suite — 1260 passing / 79 files.
- `npm run check` — 15/15 green ([14] reports v0.2.201 across the continuity docs).
- `npm run test:release` — see commit output.
- CLI smoke (text / `--json` / `--markdown`) — all behave as designed.

### Blockers / warnings

- Standing advisory (never gated): `rapier-*.js` chunk > 700 KB.
- `SDK_DEBUG_INDEX.md` is an advisory doc (WARN-only in docConsistency [14]).
- The git branch label still reads `v0.2.180` (pre-existing, unrelated to this slice).
- The RC gate folds the same curated fs-backed defaults the MVP rollup uses (test
  count, VPS dry-run, docs/handoff freshness); a build/CLI step can feed live values
  later without breaking module purity.
