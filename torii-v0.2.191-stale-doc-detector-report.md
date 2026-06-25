# Torii Quest — v0.2.191-alpha: Stale-Doc Detector

**Date:** 2026-06-25
**Type:** Safe infrastructure / tooling / docs slice (no gameplay/runtime/physics/Nostr change)
**Scope:** Add an ADVISORY stale-doc detector that catches docs/status/version drift earlier
and more clearly than the existing gated docConsistency guard.

---

## What shipped

A new **stale-doc detector** (`npm run docs:stale`) that surfaces finer, higher-recall
docs/status/version drift signals than the hard docConsistency gate — so a fresh agent/model
sees doc rot at a glance before it becomes a handoff problem.

Built on the established **pure-helper + thin-CLI** pattern, REUSING the proven docConsistency
primitives rather than re-deriving them:

- **`tools/staleDocs.mjs`** (PURE — no fs/network/child_process/THREE/DOM):
  - `STALE_DOCS_BADGE`; re-exports `CONTINUITY_DOCS`.
  - `staleVersionHeaderLines(text, version)` → HEADER lines citing a non-current version
    marker. Low false positives by design: a narrow `VERSION_HEADER_RE` matches `version`
    followed by ONLY separator/markup chars (no letters) then the marker, and backtick
    inline-code + double-quote spans are stripped first — so changelog prose like
    "runtime version drift fixed (v0.2.137)" and quoted examples are NOT flagged.
  - `testCountsInText(text)` → every `<N> passing` count (3–5 digits), in order.
  - `reportVersionToken(version)` → the version with the prerelease tag stripped
    (`v0.2.191-alpha` → `v0.2.191`), the token a slice's report filename carries.
  - `detectStaleDocs({version, docs, reports})` → `{ok, version, badge, issues, counts,
    summary}` checking: (A) per-continuity-doc version-HEADER drift + a doc that never
    mentions the current version + an unavailable doc; (B) the newest report not referenced
    in any continuity doc; (C) the newest report lagging the current version + a no-reports
    case; (D) disagreeing test counts across the continuity docs. `ok` is true unless NO
    version is supplied (the only error); every drift signal is a WARNING — advisory.
  - `formatStaleDocs(report)` → concise text block; safe on null.
- **`tools/stale-docs.mjs`** (thin CLI): reads the continuity-doc contents + config `VERSION`
  + mtime-sorted `torii-*report.md` filenames (newest first) behind a `realpathSync`
  run-guard (silent on import); prints text (default) / `--json`. **READ-ONLY / local /
  no-network** and **ALWAYS exits 0** — advisory, never a gate.
- **`package.json`**: added `"docs:stale": "node tools/stale-docs.mjs"`.
- **`tests/stale-docs.test.js`** (25 tests): header-vs-prose discrimination, quoted-span
  suppression, `testCountsInText`, `reportVersionToken`, the `detectStaleDocs` aggregation
  (clean / each drift kind / no-version / no-reports / garbled inputs / defaults), and the
  text formatter (no-drift, issue lines, safe-on-null).

---

## Advisory vs gated — the decision

The detector is **ADVISORY** (its own `npm run docs:stale`, deliberately NOT wired into
`npm run check`). Rationale: the HARD cases — current-version drift in a continuity doc or a
missing core doc — are ALREADY gated by docConsistency [14]. This detector adds finer,
higher-recall signals (header-precise drift, missing report pointer, lagging report, test-
count drift) that are valuable to surface but carry edge false-positive risk that should not
block safe development. Per the docConsistency philosophy: make drift VISIBLE without blocking
unnecessarily. The detector is engineered for low false positives (HEADER-only matching +
quoted-span stripping) and dogfoods itself: it correctly flags that this report lags until it
is committed.

---

## Constraints honoured

- Version bumped to **v0.2.191-alpha** across `src/config.js`, `index.html` (2 markers),
  `package.json`, `tools/regression-check.mjs` (`EXPECTED_VERSION` + stale-guard now flags the
  previous `v0.2.190-alpha` literal), `tests/continuum-dashboard.test.js`,
  `src/engine/dashboard/continuumData.js`, and the continuity docs.
- `godMode` stays `false`; no new `setTimeout`; no new `Vector3`/`Matrix4` in hot paths;
  comments use `nostrich`; Chiefmonkey spelling preserved; debug tools ship unconditionally;
  ESC pause + panel-click fire safety untouched.
- **No change** to gameplay, portal runtime behaviour, physics, shooting, controls, or live
  Nostr write behaviour. New tooling is local-only / read-only / no-network.

---

## Tests & checks run

| Check | Result |
|-------|--------|
| `node tools/stale-docs.mjs` (text) | ✅ renders; advisory signals only (exits 0) |
| `--json` | ✅ parseable detector report |
| `npx vitest run tests/stale-docs.test.js` | ✅ 25 passed |
| `npm run check` [14] docConsistency | ✅ continuity docs reference v0.2.191-alpha (5 docs) |
| `npm run test:release` (full gate) | ✅ **ALL GREEN** — `Test Files 70 passed (70)`, `Tests 1077 passed (1077)`, regression-check ALL GREEN |
| continuum regen | ✅ `public/continuum.html` carries v0.2.191 (7×); XSS guard grep = **0** |

Suite grew from 1052/69 (v0.2.190) to **1077 tests / 70 files** (+25 / +1).

---

## Docs updated

`todo.md` (header version + new HARD-6 row), `progress.md` (header + Source/Tests metrics
1077/70 + active-slice + active-now + completed-24h), `HANDOFF.md` (current version + v0.2.191
paragraph + command line), `CODE_INDEX.md` (header version + new stale-doc detector row),
`SDK_DEBUG_INDEX.md` (status version + new tool row), `src/engine/dashboard/continuumData.js`
(version, totals 1077/70, active + completed slices; oldest v0.2.187 rolled off completed-24h
to keep the pinned length), `tests/continuum-dashboard.test.js` (version pins),
`public/continuum.html` + `public/continuum-data.json` (regenerated).

---

## Security / performance concerns

- **None introduced.** The tool is pure logic + a read-only CLI; no network, no writes, no
  secrets, no child process beyond the existing build. It only reads local files.
- Bundle advisory unchanged: `rapier` chunk over the 700 KB warn limit (tracked, not gated —
  pre-existing).

---

## Files changed

- **New:** `tools/staleDocs.mjs`, `tools/stale-docs.mjs`, `tests/stale-docs.test.js`, this
  report.
- **Modified:** `package.json`, `src/config.js`, `index.html`, `tools/regression-check.mjs`,
  `tests/continuum-dashboard.test.js`, `src/engine/dashboard/continuumData.js`,
  `public/continuum.html`, `public/continuum-data.json`, `todo.md`, `progress.md`,
  `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`.

**Commit:** `7d747fe` — _v0.2.191-alpha: add stale doc detector_ (local-only; not pushed)
