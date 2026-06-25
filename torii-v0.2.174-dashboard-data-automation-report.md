# Torii Quest — v0.2.174-alpha · Dashboard Data Automation

**Slice:** PROGRESS-1 — reduce curated/manual dashboard data by DERIVING the Torii
Continuum oversight dashboard's list sections + a task-count metric from the project
docs (`progress.md` + `todo.md`) at BUILD time, with a safe curated fallback.
**Type:** docs/tooling only — no gameplay change, no runtime/bundle behaviour change.
**Status:** GREEN. 812 tests / 60 files, 14/14 regression checks, build clean.
Committed LOCALLY only (no push/deploy/publish).

---

## What now gets parsed / generated (derived at build time)

A new PURE, node-safe parser `tools/continuumParse.mjs` reads `progress.md` + `todo.md`
at build time (via `tools/build-continuum.mjs`) and DERIVES:

- **next-12 tasks** — from the `## Next 12 tasks` numbered list in `progress.md`.
- **active-now** — from the `## Active now` bullet list.
- **completed-24h** — from the struck (`~~…~~`) bullets under `## Completed last 24h`.
- **archive** — from the `## Archive` bullet clusters.
- **task-count metric (`taskTotals`)** — a docs-derived count object: `todoCompletedMarkers`
  (count of `~~struck~~` spans in `todo.md`), plus per-section counts (next12 / activeNow /
  completed24h / archiveClusters). Surfaced as a `DERIVED · build-time` at-a-glance row +
  a provenance footer (sources / parsed sections / gap-count) on the page.

Current build derives, with **no parser gaps**: `next12 (12)`, `activeNow (3)`,
`completed24h (5)`, `archive (11)`.

## What remains curated (intentionally)

- **Track bars, lean-route %s, milestone %s, PoC/build progress %** — kept as EXPLICIT
  curated **SEED/strategy metrics** in `continuumData.js` (traceable, not inferred from prose).
- **Contributors/clankers** — still a clearly-flagged SEED placeholder (not live Nostr data).
- **The whole curated `CONTINUUM` model** remains the canonical FALLBACK: any missing or
  garbled doc section degrades to the curated default and is reported as a parser `gap`,
  so the build never fails on a doc hiccup.

## How the merge works (no browser/CSP risk)

- `continuumData.js` `buildContinuumModel(overrides = {})` gained a merge seam:
  `{ taskTotals, derived, ...dataOverrides }` — list overrides REPLACE the curated arrays
  and `computeTotals` is recomputed; `taskTotals`/`derived` default to `null`.
  With **no overrides the render is byte-identical to v0.2.173** (null → empty fragments).
- The parser lives in `tools/` (build-only) — it is **never imported by the bundled
  module**, so `continuumData.js` stays fs-free and browser-safe.
- **CSP unchanged (v0.2.172 preserved):** `CONTINUUM_REFRESH_SCRIPT` is untouched and no
  new script-driven `data-k` keys were added, so the hardcoded sha256 script hash still
  matches. The derived row + footer are server-rendered static text (escaped via
  `escapeHtml`). Page stays fully static / read-only.

## Files changed

New:
- `tools/continuumParse.mjs` — pure parser (`stripInlineMd`/`cleanBullet`/`sectionLines`/
  `parseNumberedList`/`parseStruckBullets`/`parseBullets`/`countStruck`/`deriveContinuumData`/
  `summariseTaskTotals`).
- `tests/continuum-parse.test.js` — +15 tests.

Modified:
- `src/engine/dashboard/continuumData.js` — `buildContinuumModel(overrides)` merge seam;
  `continuumDataJSON`/`renderContinuumPage` carry optional `taskTotals` + `derived`
  provenance; `CONTINUUM_VERSION` → v0.2.174; metrics/active-now/completed-24h refresh.
- `tools/build-continuum.mjs` — reads `progress.md`+`todo.md` via `readSafe`, derives +
  merges overrides, logs derived sections + gaps.
- `tools/testProfiles.mjs` — added `continuum-parse.test.js` to the `foundation` profile.
- Version markers: `src/config.js`, `package.json`, `index.html`,
  `tools/regression-check.mjs`, `tests/continuum-dashboard.test.js`.
- Docs: `progress.md`, `todo.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`.
- Regenerated: `public/continuum.html`, `public/continuum-data.json`.

## Verification (scripts run)

- `node tools/build-continuum.mjs` → derived all four sections, **0 gaps**.
- `npm run test:release` (= `build && vitest run && check && bundle:report && handoff:status`)
  → **GREEN**. Vitest: **812 passed / 60 files** (~37s). 14/14 regression checks GREEN.
  handoff:status: VERSION ↔ package.json in sync (v0.2.174-alpha). Bundle advisory unchanged
  (rapier chunk >700 KB expected).
- Targeted re-run after the final metric edit: `continuum-dashboard` (29) +
  `continuum-parse` (15) = **44 passed**.

## Safety notes

- No live writes, no auth, no signing, no Nostr publish, no private keys, no payments,
  no auto-updates, no external redirects/`window.open`/eval/unsafe hrefs.
- Parser is build-time ONLY; page stays static/read-only; refresh script + CSP hash
  unchanged. `godMode` remains `false`. No new `setTimeout`/`Vector3`/`Matrix4`.
- Committed locally only — parent agent verifies / security-reviews / ships.

## Recommended next task

**Wire `createBrowserHostTransport(window)` (v0.2.170) into `world/handoff.js`** — the real
router/history adapter behind a same-origin allowlist + CSP, so the v0.2.168 executor can
ACT on a confirmed gateway hop (LEAN-2). It is the first piece of the MVP loop that needs a
SEC-2 verification gate, so pair it with that review. Alternatively, if staying in the
no-blocker docs/tooling lane: extend the parser to also derive the track-bar %s from
`progress.md` (currently curated SEED metrics) behind the same safe-fallback contract.
