# Torii Quest — v0.2.196-alpha Release Report

## Slice: Update-Flow Smoke Harness

**Type:** infrastructure / testing / tooling. **No runtime behavior change.**

### Goal

Add pure/local/non-network smoke coverage proving the torii.quest / VPS
self-update path remains safe, so future VPS update work can be regression-checked
without a browser, server, network, or shell. Pins the contracts already shipped
across the update-check modules: current version read, latest release metadata
shape, update-availability classification, manual-only update intent, no
auto-update, no shell execution, no package install, no Git/network writes, and no
irreversible action without explicit user/instance confirmation.

**This is NOT an updater** and performs no real update — it only makes the
manual-deploy safety boundary checkable.

### What landed

**`src/engine/update/updateFlowSmoke.js`** — PURE node-safe smoke harness (no
THREE/Rapier/`window`/`location`/fs/`child_process`/network/socket/signing/
publishing; never throws; renders and acts on nothing).

- `UPDATE_SMOKE_VERSION` = 1
- `UPDATE_SMOKE_BADGE` = `'UPDATE FLOW SMOKE · READ-ONLY · NO AUTO-UPDATE'`
- `UPDATE_ACTION` = `'update:apply'`
- `SAMPLE_NEWER_FEED` — frozen 2-entry release feed (newest `v0.2.999-alpha` wins).
- `SAMPLE_CURRENT_RELEASE` — release tagged at the running `VERSION` (up-to-date).
- `MALFORMED_PAYLOADS` — frozen set (`null`, `42`, `'not-a-release'`, `{}`, a
  draft, `[]`) the flow must degrade on without throwing.
- `runUpdateFlowSmoke(opts?)` — composes the already-pure `updateCheck`,
  `githubReleaseSource`, `releaseMeta`, and consent-gate helpers over the frozen
  fixtures through **ten read-only signals**:
  1. current version read from runtime `VERSION`
  2. release metadata shape is well-formed
  3. a newer feed classifies as **update-available**
  4. a same-version release classifies as **up-to-date**
  5. malformed payloads degrade to **UNKNOWN** without throwing
  6. manual-only — **no auto-update**
  7. metadata **safety floor** rejects tampered `autoUpdate`/`actionable`
  8. **no fetch/install/exec** surface is exposed
  9. `update:apply` is **confirmation-gated** (no grant → blocked, never performed;
     grant → allowed, still never performed)
  10. **no auto action** — every report pins
      `performed/actionable/autoUpdate/installed/executed/fetched/network/signed/
      published/navigated = false`

  Returns `{ version, badge, ok, signals, summary, safety, reasons, rendered:false, actionable:false }`.
  Fixtures are injectable via `opts.newerFeed`/`opts.currentRelease`/`opts.malformed`;
  a broken fixture degrades to `ok:false` with concrete `reasons` (never throws,
  safety flags still all false).
- `formatUpdateFlowSmoke(result)` — one stable text block; safe on null.

Composes ONLY the already-shipped pure update modules — surfaces NO
fetch/install/update/apply/exec/spawn/run/download/write/navigate/sign/publish/
deploy method of its own.

### Wiring (debug/SDK only — no game behavior change)

- **SDK** `src/sdk/index.js`: `export * as updateFlowSmoke` + `SDK_SURFACE` entry
  at `STABILITY.EXPERIMENTAL`.
- **Debug shell** `src/engine/debug/shellReport.js`: `updateFlowSmokeReport(opts)`
  added to `buildShellReport()`.
- **`src/engine/debug/toriiDebug.js`**: `ToriiDebug.shells.updateFlowSmoke(opts)`.

### Tests

- New: `tests/update-flow-smoke.test.js` — **+17 tests** covering constants,
  frozen fixtures, all-green 10/10, the exact sorted signal-key array, safety flags
  all false, update-available/up-to-date classification, malformed→unknown, the
  metadata safety floor rejecting tampered metadata, no forbidden methods,
  confirmation gating (`grant.performed=false`), broken-fixture → `ok:false` with
  reasons (safety still false), no-arg/degraded opts safe, and
  `formatUpdateFlowSmoke` safe on null.
- Full suite after the slice: **1197 passing / 75 files**.

### Version bump (v0.2.195-alpha → v0.2.196-alpha)

`package.json`, `src/config.js`, `index.html` (×2), `tools/regression-check.mjs`
(EXPECTED_VERSION + stale guard), `src/engine/dashboard/continuumData.js`
(CONTINUUM_VERSION + metrics rows + active/completed entries),
`public/release-metadata.json` (regenerated), continuum artifacts rebuilt, dist rebuilt.

### Docs updated

`todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`,
`UPDATE_CHECK.md` (§7 — the harness documented as the executable record of the
update-flow safety contracts), `VPS_INSTALL.md` (§14 — the same contracts tied to
the manual-deploy story).

### Security-sensitive behavior

**None changed.** The harness is read-only; it injects no fetcher and no transport,
so it cannot fetch, install, execute, or navigate. The shipped safety model is
unchanged: update display is informational, deploying stays the manual maintainer
step, `update.autoUpdate`/`update.actionable` remain `false`, and `update:apply` is
consent-gated. `godMode` remains `false`. No new `setTimeout`, no new
`Vector3`/`Matrix4` in hot paths. No gameplay/physics/shooter/Rapier/Nostr signing/
Nostr publishing/live network write change.

### Verification

- `tests/update-flow-smoke.test.js` — pass (17).
- Full vitest suite — 1197 passing / 75 files.
- `npm run check` — see commit output.

### Blockers / warnings

- Standing advisory (never gated): `rapier-*.js` chunk > 700 KB.
- The real read-only GitHub fetch + the in-world prompt MESH/HUD + any guarded
  "update button" remain deferred host steps (UPDATE_CHECK.md §3, VPS_INSTALL.md
  §10) — unchanged by this slice.
