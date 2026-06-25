# Torii Quest — v0.2.190-alpha: AI Handoff Auto-Summary Tooling

**Date:** 2026-06-25
**Type:** Safe infrastructure / tooling / docs slice (no gameplay/runtime/physics/Nostr change)
**Scope:** Add an AI handoff auto-summary tool that folds the existing local
release-readiness signals into one concise brief for the next agent/model.

---

## What shipped

A new **handoff auto-summary** that gives the next agent/model the project state
at a glance — version, git commit, live URL, current gate verdict, regression +
test-profile counts, latest reports, the next safe task, the key constraints, and
the exact local commands to verify before shipping.

Built on the established **pure-helper + thin-CLI** pattern, reusing the existing
`gatherReleaseReadiness()` so nothing is re-implemented:

- **`tools/handoffSummary.mjs`** (PURE — no fs/network/child_process/THREE/DOM):
  - Constants: `HANDOFF_SUMMARY_BADGE`, `HANDOFF_SUMMARY_SCHEMA`
    (`'torii.handoff-summary'`), `HANDOFF_SUMMARY_SCHEMA_VERSION` (=1),
    `HANDOFF_SUMMARY_LIVE_URL`, frozen `VERIFY_COMMANDS` (check / test /
    release:status / test:release), frozen `KEY_CONSTRAINTS` (8 standing
    constraints incl. `godMode false`, comments use `'nostrich'`, Chiefmonkey
    spelling), `DEFAULT_NEXT_SAFE_TASK`.
  - `buildHandoffSummary({version,packageVersion,gitCommit,liveUrl,release,
    nextSafeTask,constraints,verifyCommands,latestReports,generatedAt})` folds a
    `buildReleaseReadiness()` summary into a JSON-serialisable envelope
    `{schema,schemaVersion,generatedAt,badge,version,packageVersion,gitCommit,
    liveUrl,gate:{status,statusLabel,ready,gateCommand,blockers,unknowns,
    regression,testProfiles},nextSafeTask,constraints,verifyCommands,
    latestReports}`.
  - **Deterministic by design:** `generatedAt` is the ONLY non-deterministic
    field — optional + isolated (omit → `null`, fully reproducible for tests).
  - A null/garbled release degrades to an honest `gate.status:'unknown'`
    (`'NO RELEASE SUMMARY'`, `ready:false`) and never throws.
  - `formatHandoffSummary(summary)` → text block; `formatHandoffSummaryMarkdown(summary)`
    → markdown; both safe on null.
- **`tools/handoff-summary.mjs`** (thin CLI): reads config/package/git, reuses
  `gatherReleaseReadiness()` behind a `realpathSync` run-guard (silent on import),
  and prints text (default) / `--json` / `--markdown`. **READ-ONLY / local /
  no-network**; it NEVER writes unless an explicit `--write[=path]` flag is
  supplied (markdown → `handoff-summary.md`).
- **`package.json`**: added `"handoff:summary": "node tools/handoff-summary.mjs"`.
- **`tests/handoff-summary.test.js`** (13 tests): assembly (folds READY summary;
  defaults task/constraints/verifyCommands; honours overrides; `generatedAt`
  isolation; NOT-READY blocker passthrough; JSON-serialisable), degraded/missing
  inputs (null/garbled → unknown gate; missing version/package → null), and both
  formatters (sections rendered; safe on null).

---

## Constraints honoured

- Version bumped to **v0.2.190-alpha** across `src/config.js`, `index.html`,
  `package.json`, and `tools/regression-check.mjs` (`EXPECTED_VERSION` +
  stale-guard now flags the previous `v0.2.189-alpha` literal).
- `godMode` stays `false`; no new `setTimeout`; no new `Vector3`/`Matrix4` in hot
  paths; comments use `nostrich`; Chiefmonkey spelling preserved; debug tools ship
  unconditionally.
- **No change** to gameplay, portal runtime behaviour, physics, shooting, controls,
  or live Nostr write behaviour. New tooling is local-only / read-only / no-network
  and does not write by default.

---

## Tests & checks run

| Check | Result |
|-------|--------|
| `node tools/handoff-summary.mjs` (text) | ✅ renders; gate verdict **READY** |
| `--json` (parsed) | ✅ `schema=torii.handoff-summary v1`, gate READY, reg 15/15, profiles 5/25 |
| `--markdown` | ✅ headings + bullets |
| default no-write | ✅ no `handoff-summary.md` created |
| `npm run test:release` (full gate) | ✅ **ALL GREEN** — `Test Files 69 passed (69)`, `Tests 1045 passed (1045)`, regression-check ALL GREEN |
| continuum regen | ✅ `public/continuum.html` carries v0.2.190; XSS guard grep = **0** |

Suite grew from 1032/68 (v0.2.189) to **1045 tests / 69 files** (+13 / +1).

---

## Docs updated

`todo.md` (HARD-5 row + version), `progress.md` (version, tests metric, active-now +
completed-24h slices), `HANDOFF.md` (version + v0.2.190 paragraph + command line),
`CODE_INDEX.md` (new AI-handoff auto-summary row), `SDK_DEBUG_INDEX.md` (new tool
row), `src/engine/dashboard/continuumData.js` (version, totals 1045/69, active +
completed slices), `tests/continuum-dashboard.test.js` (version pins).

---

## Security / performance concerns

- **None introduced.** The tool is pure logic + a read-only CLI; no network, no
  writes by default, no secrets. The `--write` flag is the single, explicit writer
  (markdown to a local file, logged to stderr).
- Bundle advisory unchanged: `rapier` chunk over the 700 KB warn limit (tracked,
  not gated — pre-existing).

---

## Files changed

- **New:** `tools/handoffSummary.mjs`, `tools/handoff-summary.mjs`,
  `tests/handoff-summary.test.js`, this report.
- **Modified:** `package.json`, `src/config.js`, `index.html`,
  `tools/regression-check.mjs`, `tests/continuum-dashboard.test.js`,
  `src/engine/dashboard/continuumData.js`, `public/continuum.html`,
  `public/continuum-data.json`, `todo.md`, `progress.md`, `HANDOFF.md`,
  `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`.

**Commit:** `8b03f4c` — _v0.2.190-alpha: add handoff auto-summary tooling_ (local-only; not pushed)

---

## Follow-up: security-review WARN-3 fix (low)

**Finding (WARN-3, new/low):** the `--write` path in `tools/handoff-summary.mjs`
accepted an arbitrary absolute path with no repo-boundary assertion. Developer-tool
only, but flagged to remove the warning.

**Fix (tooling-only, tiny):**
- Added a PURE, unit-tested resolver `resolveHandoffWritePath(raw, root)` (+
  `DEFAULT_WRITE_FILENAME`) to `tools/handoffSummary.mjs`. It confines the `--write`
  target to INSIDE the repo using deterministic `node:path` string math (no fs):
  rejects an **absolute path** (`absolute-path-not-allowed`), any **`..` escape** or
  resolving to the repo root itself (`outside-repo`), and a missing root (`no-root`);
  an empty/blank path falls back to the in-repo `handoff-summary.md`. Never throws.
- `tools/handoff-summary.mjs` now routes `--write` through the resolver and **refuses**
  an unsafe target (stderr message + exit 2) instead of writing it. Default no-write
  behaviour is unchanged; a safe in-repo relative path (incl. a subdirectory) still works.
- Tests: `tests/handoff-summary.test.js` gained a `resolveHandoffWritePath` block
  (+7) covering default, allowed in-repo/subdir, rejected absolute, rejected `..`
  escapes, rejected repo-root, garbled root, and never-throws-on-hostile-input.

**Verified:**
- `npx vitest run tests/handoff-summary.test.js` → 20 passed (was 13).
- CLI: `--write=/tmp/evil.md` → refused, exit 2, file NOT created; `--write=../escape.md`
  → refused, exit 2, file NOT created; `--write=tmp-brief.md` → written inside repo;
  default (no flag) → no file written.
- `npm run test:release` → **ALL GREEN**, `Test Files 69 passed (69)`, `Tests 1052
  passed (1052)`; continuum regenerated (XSS guard grep = 0).
- Dashboard/docs test count bumped 1045 → **1052** (`continuumData.js`, `progress.md`);
  still 69 files (no new test file).

**No gameplay/runtime/physics/Nostr/portal code touched.**

**Follow-up commit:** `6002313` — _v0.2.190-alpha: confine handoff-summary --write to the repo (WARN-3)_ (local-only; not pushed)
