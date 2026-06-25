# Torii Quest — v0.2.199-alpha Release Report

## Slice: Agent Handoff Readiness Export

**Type:** infrastructure / docs / tooling. **No runtime behavior change.**

### Goal

Improve the AI handoff surface so future agents/models — including non-Perplexity
tools like DeepSeek/Perplexica/Routstr-style handoffs — can quickly continue WITHOUT
reading the entire repo. Prefer a pure/local generated markdown or JSON export from
already-existing status signals: current version, live URL, latest reports, test
counts, smoke harnesses, MVP readiness pct/status, next safest tasks, and hard
constraints.

The existing `handoff-summary` (v0.2.190) already covered version/URL/reports/
test-profiles/next-task/constraints, but was MISSING the two pieces v0.2.198 added:
the **MVP readiness pct/status** and the **smoke-harness inventory**. This slice adds
a thin SUPERSET layer that COMPOSES the existing summary + rollup and fills exactly
that gap — keeping the change small and non-source-heavy. **It reaches no server/
DNS/SSH/network and changes nothing the app does at runtime.**

### What landed

**`tools/agentHandoff.mjs`** — PURE node-safe module (no fs/network/
`child_process`/THREE/DOM; never throws).

- `AGENT_HANDOFF_BADGE` = `'AGENT HANDOFF READINESS · LOCAL · READ-ONLY'`
- `AGENT_HANDOFF_SCHEMA` = `'torii.agent-handoff'`, `AGENT_HANDOFF_SCHEMA_VERSION` = 1
- `AGENT_HANDOFF_WRITE_FILENAME` = `'HANDOFF.generated.md'`
- Frozen `SMOKE_HARNESSES` (5): `readHealth`, `gatewayTravelSmoke`,
  `updateFlowSmoke`, `hostRouteSmoke`, `mvpReadiness` — each annotated with its SDK
  name, its `ToriiDebug.shells.*(o?)` shell, and the rollup `signalKey` it maps to
  (`mvpReadiness` has `signalKey:null` — it IS the rollup).
- `buildAgentHandoff({handoffSummary,mvpReadiness,smokeHarnesses,generatedAt})`
  folds a `buildHandoffSummary()` brief + a `runMvpReadiness()` rollup into a
  JSON-serialisable `{ schema, schemaVersion, generatedAt, badge, version,
  packageVersion, gitCommit, liveUrl, gate, readiness:{pct,status,ok,summary,reasons},
  harnesses (each annotated with live status by signalKey), nextSafeTask (prefers
  the rollup structured task; falls back to the summary string), constraints,
  verifyCommands, latestReports }`. Null/garbled inputs degrade to honest UNKNOWNs;
  never throws.
- `formatAgentHandoff(handoff)` → text block (null → `'agent-handoff: (no handoff)'`).
- `formatAgentHandoffMarkdown(handoff)` → markdown (harness table + a note that the
  curated `HANDOFF.md` stays the source of truth; null → `'# Agent handoff\n\n_(no
  handoff)_\n'`).

Composes ONLY the already-shipped pure modules — surfaces NO serve/deploy/publish/
upload/fetch/write/navigate/exec/spawn/run/ssh/connect method of its own.

**`tools/agent-handoff.mjs`** — local CLI behind a `realpathSync` run-guard. Reuses
`gatherReleaseReadiness()` + `buildHandoffSummary()` + `runMvpReadiness()`; does
best-effort git + config/package fs reads only. Modes: default text / `--json` /
`--markdown` / `--write[=path]` (the ONLY writer; defaults to `HANDOFF.generated.md`,
confined in-repo via the SHARED `resolveHandoffWritePath` boundary). READ-ONLY/local/
no-network; always exits 0.

### Wiring (tooling only — no game / SDK / debug-shell change)

- **`package.json`**: `"handoff:agent": "node tools/agent-handoff.mjs"`.
- `agentHandoff` is a build-time CLI, NOT an SDK namespace or `ToriiDebug` shell — it
  is never imported by the game. No `src/sdk` or `toriiDebug.js` change.

### Generated artifact

- `HANDOFF.generated.md` — written by `node tools/agent-handoff.mjs --write`,
  regenerated LAST after docs/version were final. The curated `HANDOFF.md` is NOT
  replaced; `HANDOFF.generated.md` is in NEITHER the continuity nor advisory doc
  list, so no gate (incl. docConsistency [14]) touches it.

### Tests

- New: `tests/agent-handoff.test.js` — **+13 tests** covering constants
  (badge/schema/v1/write filename/frozen `SMOKE_HARNESSES` order + `signalKey`
  mapping), assembly (folds summary + rollup; readiness pct/status/summary; per-
  harness live-status annotation incl. `mvpReadiness` status === null; a failing
  signal → ✗ + NEAR; rollup task preferred over summary string; fallback to the
  summary task; no-input honest UNKNOWNs + 5 harnesses status:null; garbled inputs
  never throw), and formatters (text contains badge / `MVP readiness: 100% · READY` /
  `shells.readHealth(o?)`; markdown contains title / source-of-truth note / harness
  table row / `**MVP readiness:** 100% · READY`; both null-safe).
- Full suite after the slice: **1241 passing / 78 files**.

### Version bump (v0.2.198-alpha → v0.2.199-alpha)

`package.json`, `src/config.js`, `index.html` (×2), `tools/regression-check.mjs`
(EXPECTED_VERSION + stale guard), `src/engine/status/mvpReadiness.js`
(`DEFAULT_TEST_STATUS` 1228/77 → 1241/78), `src/engine/dashboard/continuumData.js`
(CONTINUUM_VERSION + metrics rows + active/completed entries),
`public/release-metadata.json` (regenerated), continuum artifacts rebuilt, dist rebuilt.

### Docs updated

`todo.md` (HARD-14 row), `progress.md`, `HANDOFF.md` (changelog block + latest-slice
report), `CODE_INDEX.md` (version + mvpReadiness test count + new agent-handoff row),
`SDK_DEBUG_INDEX.md` (status version).

### Security-sensitive behavior

**None changed.** The export is read-only; it injects no transport and reaches no
server, so it cannot serve, deploy, navigate, fetch, sign, publish, or write — except
the single explicit `--write` output file, which is confined inside the repo by the
shared `resolveHandoffWritePath` boundary (absolute paths / `..` escape rejected). It
composes only the already-shipped pure summary + rollup and reflects, never mutates,
readiness state. `godMode` remains `false`. No new `setTimeout`, no new
`Vector3`/`Matrix4` in hot paths. No gameplay/physics/shooter/Rapier/Nostr signing/
Nostr publishing/live network write/server/DNS/SSH/updater change.

### Verification

- `tests/agent-handoff.test.js` — pass (13).
- Full vitest suite — 1241 passing / 78 files.
- `npm run check` / `npm run test:release` — see commit output.
- CLI smoke (text / `--json` / `--markdown` / `--write`) + path-rejection (absolute
  and `..` both refused) — all behave as designed.

### Blockers / warnings

- Standing advisory (never gated): `rapier-*.js` chunk > 700 KB.
- The handoff export folds the same curated fs-backed defaults the rollup uses (test
  count, VPS dry-run, docs/handoff freshness); a build/CLI step can feed live values
  later without breaking module purity.
