# Torii Quest — v0.2.176-alpha · Continuum Milestones + Layout Pass

**Slice:** PROGRESS-1 / oversight — surface the **15-hour MVP / proof-of-concept route**
as an explicit, build-time, static, read-only **Milestones** section on the Torii
Continuum dashboard (`/continuum.html`), and start an honest **bullet-list** formatting
pass on grouped card values.
**Type:** docs/tooling/dashboard only — no gameplay change, no runtime behaviour change,
no new network/script surface.
**Status:** GREEN. 830 tests / 60 files, 14/14 regression checks, build clean.
Committed LOCALLY only (no push/deploy/publish). **Commit:** `<feat-hash>` (branch `v0.2.176`).

---

## Milestone count model (honest: 1 ACTIVE + N SEED)

A pure, browser-safe `buildMilestoneModel(input)` + a frozen `SEED_MILESTONES` list were
added to `src/engine/dashboard/continuumData.js`. The model is deliberately **honest**:

- **One true ACTIVE milestone** — the **15-hour proof-of-concept route** (`id: MVP-15H`).
  Its tasks ARE the existing `leanRoute` slices (LEAN-1..LEAN-5), so the milestone never
  invents a parallel task list — it reuses the route as its source of truth.
- **N clearly-labelled SEED / future milestones** — `M-RELAY` (live relay I/O + signing,
  gated by SEC-1/2/3), `M-WORLD` (open-world NAP-to-NAP federation), `M-MARKET`
  (component / Plebeian.Market economy). These carry **no task counts** — they are a seed
  roadmap, chipped `SEED · future`, so "total milestones" is honest without pretending the
  future ones are fully real.
- **Total milestones** rendered as `1 active + 3 seed` (= 4), with the active one carrying
  the only real, derived task counts.

`counts = { total: 4, active: 1, seed: 3, done: 0 }`. Future hook documented: derive seed
milestones from `strategy.md`.

## 15-hour MVP task counts / progress (DERIVED)

Folded from each `leanRoute` slice's `state` / `progress` (DERIVED, not curated):

- **Tasks total:** 5
- **Done:** 0
- **Active (in-progress):** 4  (LEAN-2/3/4/5)
- **Pending:** 1  (LEAN-1 — Torii.quest live, manual smoke first)
- **donePct (tasks done):** 0%
- **progressPct (directional estimate):** **46%** — the mean of per-slice progress
  (20/70/45/40/55), the same figure as the PoC ring. It is rendered with an explicit
  *(directional estimate)* sub plus a separate *0 / 5 tasks done* line so the directional
  bar is **never** mistaken for tasks-complete.

## Layout changes (bullet lists over dense prose)

Per the user preference for **bullet lists, not comma/dot-separated prose**:

- New `_cardValueHtml(value)` splits a value joined with ` · ` into a compact
  `<ul class="mini">` bullet list when there are 2+ parts; a single part stays a plain
  `<span class="metric-value">`. Each part is HTML-escaped.
- Adopted by the **metric rows**, the **engineering-health cards**, and the
  **docs-derived row** — so grouped values (e.g. profile timings, gate counts, the
  derived task tallies) now read as bullets. Targeted to ` · `-joined values only, so
  `/`- or `,`-separated values (like `821 passing / 60 files`) stay on one line.
- New **Milestones** `<section>` (inserted after At-a-glance): a "Total milestones" line,
  an **ACTIVE**-pill progress card (name + blurb + directional % bar + bullet-list
  counts), a responsive `.ms-grid` of **SEED · future** cards, and a provenance note.
- Layout/formatting **follow-up filed**: `DASHBOARD-LAYOUT-1` (todo.md) — an intentional
  information-hierarchy / responsive-grid pass, keeping it pure/static/CSP-safe.

## Generated vs curated (provenance)

- **DERIVED (this build):** the active milestone's task counts + directional % — computed
  from `CONTINUUM.leanRoute` slice `state`/`progress` at module load and re-run in the
  build tool. No hand-maintained duplicate.
- **SEED / future:** the three `SEED_MILESTONES` — curated roadmap data, explicitly chipped
  `SEED · future`, carrying no task counts.
- **LAST-KNOWN / GENERATED** engineering-health metrics (v0.2.175) are unchanged; their
  grouped values now simply render as bullet lists.

## Files changed

- `src/engine/dashboard/continuumData.js` — `SEED_MILESTONES` + `buildMilestoneModel`;
  `milestones` attached in `buildContinuumModel` + carried in `continuumDataJSON`;
  `_cardValueHtml` bullet-list helper (adopted by `_metricRows`, `_healthCards`, derived
  row); `_milestonesSection` / `_milestoneCard` / `_seedMilestoneCards` render helpers +
  `ul.mini` / `.ms*` CSS; section inserted after At-a-glance. `CONTINUUM_VERSION` →
  `v0.2.176-alpha`; metrics "Source version"/"Active slice" + activeNow[0]/completed24h
  bumped.
- `tests/continuum-dashboard.test.js` — +9 milestone/bullet tests (model counts/progress,
  bullet-ready count strings, SEED shape, honest total, empty/missing-route fallback, JSON
  carries milestones, render shows ACTIVE pill + SEED chips + % bar, grouped values render
  as `<ul class="mini">`, SAFETY: still one inline script + hash unchanged). Import added.
- Version markers → `v0.2.176-alpha`: `src/config.js`, `package.json`, `index.html` (×2),
  `tools/regression-check.mjs` (header + `EXPECTED_VERSION` + stale-guard now flags
  v0.2.175-alpha).
- Docs: `progress.md`, `todo.md` (incl. new `DASHBOARD-LAYOUT-1` follow-up), `HANDOFF.md`,
  `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md` bumped + describe the Milestones section + bullet
  pass.
- Regenerated `public/continuum.html` + `public/continuum-data.json`.

## Tests / timings

- `npm run test:release` — **830 tests / 60 files passing** (was 821 / 60; +9), `npm run
  check` **ALL GREEN** (14/14), build clean, bundle advisory only (rapier chunk, expected).
- Profile sizes unchanged: `test:fast` 5 files, `test:foundation` 17 files; full suite ~41s.
- Build confirms: milestones rendered (4× ACTIVE, 3× `SEED · future`, 1× directional
  estimate), JSON `milestones.active.tasks = {5,0,4,1}`, `progressPct 46`, docs in sync.

## Safety notes

- godMode `false`; no new `setTimeout`; no new `Vector3`/`Matrix4` hot-path allocations.
- The Milestones section + bullet lists are **server-rendered escaped static text** — no
  new `<script>`, no inline handlers, no external href/fetch/eval/navigation, and **no new
  `data-k` key**. The single same-origin refresh script (`CONTINUUM_REFRESH_SCRIPT`) is
  byte-unchanged → `CONTINUUM_SCRIPT_SHA256` and the strict CSP are intact (locked by the
  `node:crypto` test).
- `continuumData.js` stays crypto-free AND fs-free (browser-bundle-safe); all profile/fs
  reads live in the build-time tool only.
- No live writes, signing, NIP-07, payments, relay I/O, or auto-updates. Seed milestones
  are clearly labelled and never claim real task sets.

## Recommended next task

`DASHBOARD-LAYOUT-1` — the now-filed intentional layout pass (information hierarchy,
consistent card/grid sizing, uniform bullet grouping, mobile-responsive grid), keeping it
pure/static/CSP-safe. Alternatively the standing LEAN-2 item: wire
`createBrowserHostTransport(window)` (v0.2.170) into `world/handoff.js` so the v0.2.168
executor can ACT (gated behind SEC-1/2/3 + a same-origin allowlist).
