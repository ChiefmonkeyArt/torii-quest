# Torii Quest — v0.2.175-alpha · Engineering Health Metrics

**Slice:** PROGRESS-1 / oversight — surface a build-time, static, read-only
**Engineering health** section on the Torii Continuum dashboard (`/continuum.html`)
so the efficiency/oversight loop (**measure · profile · standardise · automate ·
modularise · document**) is visible at a glance.
**Type:** docs/tooling only — no gameplay change, no runtime behaviour change, no new
network/script surface.
**Status:** GREEN. 821 tests / 60 files, 14/14 regression checks, build clean.
Committed LOCALLY only (no push/deploy/publish). **Commit:** `3cc4fd2` (branch `v0.2.175`).

---

## What was added

A pure, browser-safe `buildHealthModel(input)` + a frozen `HEALTH_LASTKNOWN` baseline
in `src/engine/dashboard/continuumData.js`. It runs in two places from one definition:

1. **At module load** — builds the curated `CONTINUUM.health` fallback (so the bundled
   module always carries a complete health model with no build step).
2. **In `tools/build-continuum.mjs`** — re-runs with freshly GENERATED inputs at build
   time and merges the result over the curated fallback as a normal dataOverride.

Each metric carries a `kind` of `generated` or `last-known`, rendered as a provenance
chip (`.hk-gen` / `.hk-lk`) so a stale number is always obvious. The new
`Engineering health` `<section>` is server-rendered, fully escaped text — a cards grid
+ 3 SVG rings + the efficiency-loop note. **No new `<script>`**, so the v0.2.172 CSP
script hash is unchanged.

## Generated vs last-known (provenance)

**GENERATED at build time** (deterministic, from the build environment):

- **Build version** — from `src/config.js` `VERSION`.
- **Test files / profiles** — `fast`/`foundation` profile sizes from
  `tools/testProfiles.mjs`; full file count from a `readdirSync` of `tests/`.
- **Parser gaps** — the count of doc-parser gaps from `tools/continuumParse.mjs`
  (0 → "dashboard lists fully derived").
- **Source-of-truth docs** — `docsInSync` = `progress.md` + `todo.md` both carry the
  current `VERSION` ("carry this version" vs "doc/version drift").

**LAST-KNOWN** (captured from the most recent green `test:release`, labelled as such):

- **Total tests** — `821 passing`.
- **Profile timings** — `fast ~1s · foundation ~6s · full suite ~41s`.
- **Bundle baseline** — `2.9 MB raw / ~1022 KB gzip (rapier chunk >700 KB, expected)`.
- **Release gate** — `14 / 14 regression checks GREEN · last green v0.2.175-alpha`.

Rings: Tests passing (100%), Regression checks (100%), Foundation coverage
(`foundation/full` file %).

The `HEALTH_LASTKNOWN` baseline is the single hook to bump after each green release —
it never auto-fetches or writes anything.

## Files changed

- `src/engine/dashboard/continuumData.js` — `buildHealthModel` + `HEALTH_LASTKNOWN` +
  curated `CONTINUUM.health`; `health` in `continuumDataJSON`; `_healthChip` /
  `_healthCards` / `_healthSection` render helpers + `.hk` chip CSS; section inserted
  after At-a-glance. Version → `v0.2.175-alpha`; Tests metric → `821 passing / 60 files`.
- `tools/build-continuum.mjs` — `countTestFiles()`, `docsInSync`, and a
  `buildHealthModel({...generated inputs})` call merged into the model.
- `tests/continuum-dashboard.test.js` — +9 health tests (model shape/note, GENERATED
  reflects inputs, gap/drift honesty, LAST-KNOWN from baseline, coverage ring, curated
  health present, JSON carries health, render shows chips, SAFETY: still one inline
  script + hash unchanged). 38 tests in this file.
- Version markers → `v0.2.175-alpha`: `src/config.js`, `package.json`, `index.html`
  (×2), `tools/regression-check.mjs` (header + `EXPECTED_VERSION` + stale-guard).
- Docs: `progress.md`, `todo.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`
  bumped + describe the engineering-health section and the efficiency loop.
- Regenerated `public/continuum.html` + `public/continuum-data.json`.

## Tests / timings

- `npm run test:release` — **821 tests / 60 files passing**, `npm run check` **ALL
  GREEN** (14/14), build clean, bundle advisory only (rapier chunk, expected).
- Profile sizes: `test:fast` 5 files, `test:foundation` 17 files.
- Full suite ~41s.

## Safety notes

- godMode `false`; no new `setTimeout`; no new `Vector3`/`Matrix4` hot-path allocations.
- The health section is **server-rendered escaped static text** — no new `<script>`,
  no inline handlers, no external href/fetch/eval/navigation. The single same-origin
  refresh script (`CONTINUUM_REFRESH_SCRIPT`) is byte-unchanged → `CONTINUUM_SCRIPT_SHA256`
  and the strict CSP are intact (locked by the `node:crypto` test).
- `continuumData.js` stays crypto-free AND fs-free (browser-bundle-safe); all fs/profile
  reads live in the build-time tool only.
- No live writes, signing, NIP-07, payments, relay I/O, or auto-updates.

## Recommended next task

Wire `createBrowserHostTransport(window)` (v0.2.170) into `world/handoff.js` (real
router/history adapter + same-origin allowlist + CSP) so the v0.2.168 executor can ACT
— the top LEAN-2 item. Alternatively, continue the oversight loop by promoting one
LAST-KNOWN health metric (e.g. profile timings) to GENERATED by capturing the
`test-profile.mjs` timing footer into the build.
