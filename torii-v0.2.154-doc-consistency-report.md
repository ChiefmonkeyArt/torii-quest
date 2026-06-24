# Torii Quest — v0.2.154-alpha: Docs/Status Consistency Guard

## Goal
Reduce drift between version markers and the cross-model handoff docs (`todo.md`,
`progress.md`, `HANDOFF.md`, `SDK_DEBUG_INDEX.md`, `CODE_INDEX.md`) so AI handoffs
stay reliable. Make doc drift **visible** without blocking safe development
unnecessarily. No runtime/gameplay/visual change.

## What landed

### 1. `tools/docConsistency.mjs` (NEW — pure, node-safe)
No `fs`/`zlib`/`THREE`/DOM — unit-testable; the regression-check CLI does the I/O.
- `CONTINUITY_DOCS = ['todo.md', 'progress.md', 'HANDOFF.md']` — **hard-fail** on
  current-version drift / missing core file.
- `ADVISORY_DOCS = ['SDK_DEBUG_INDEX.md', 'CODE_INDEX.md']` — **warn only**.
- `versionInText(version, text)` — exact substring match, bad-input safe.
- `findVersionMarkers(text)` — all `vX.Y.Z-tag` markers in order.
- `staleLiveVersionLines(text, version)` — flags only a genuine
  `live/published/deployed … version <marker>` **status assertion** that names a
  version other than the current one. Requires the word "version" adjacent to the
  marker so deploy-task / changelog lines that merely mention "live" + a version
  are **not** flagged (robust, not brittle archaeology).
- `checkDocConsistency({ version, files, present })` →
  `{ ok, version, errors, warnings, checked }` — deterministic, JSON-serialisable.

### 2. `tools/regression-check.mjs` — check `[14]`
Reads the five docs and runs `checkDocConsistency`. HARD FAILS on continuity-doc
current-version drift or a missing core doc; emits ADVISORY warnings (never fails)
for advisory-doc lag + stale live-version lines. Version markers bumped; stale-guard
regex now flags the previous version (`v0.2.153-alpha`).

### 3. `tests/doc-consistency.test.js` (NEW — 18 cases)
Covers `versionInText`, `findVersionMarkers`, `staleLiveVersionLines` (incl. the
not-flagged deploy-task line), and `checkDocConsistency` (passes; hard-fails on
drift / missing core / explicit `present:false` / no-version; warn-only advisory
lag + stale lines; deterministic + JSON; exposes the doc lists).

### 4. Stale contradiction fixed in `progress.md`
Replaced the hardcoded `Live published version: v0.2.113-alpha` / "source ahead of
live by N versions" lines (the deploy section) with a statement that deploy is a
manual maintainer step and this file tracks the SOURCE version only — removing the
long-standing stale-version contradiction the task called out.

## Verification
- `npm test` → **486 passed / 43 files** (was 468/42; +18 cases).
- `npm run check` → **ALL GREEN**, 14/14. Check `[14]` confirms all three continuity
  docs reference `v0.2.154-alpha`; advisory warnings only (no failures).
- `npm run bundle:report` → advisory baseline unchanged (rapier chunk tracked, not gated).
- `npm run build` → clean (vite 8.0.16, 85 modules; large-chunk warning is the
  known advisory).

## Safety
godMode=false. No new `setTimeout` (allowlist intact). No network, navigation,
payments, signing/publishing, relay/live fetch/WebSocket, auto-update, or
click/raycast changes. New code is build-time only and never imported by the game;
it reads local files only.

## Version markers bumped → v0.2.154-alpha
`src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs`.

## Not done (left to parent agent)
Not pushed/published. Parent agent verifies, security-reviews, deploys, publishes,
pushes, and syncs docs.
