# Torii Quest — v0.2.153-alpha bundle-size tracking baseline

**Type:** safe performance/observability slice — ADVISORY/reporting only.
**Intent:** turn the recurring Vite "large chunk" build warning into a measurable,
AI-handoff-friendly LOCAL baseline **without changing runtime gameplay or the existing
bundle splitting**. This slice creates visibility + a baseline so future file-size/speed
work is structured; it does NOT attempt code-splitting.

---

## What landed

### 1. `tools/bundleSizes.mjs` — PURE, node-safe core (no fs/zlib/THREE/DOM)
Unit-testable size formatting + classification. Exports:

- `KIB`, `MIB`, `DEFAULT_WARN_LIMIT` (`700 · KIB`, mirroring `vite.config.js`
  `build.chunkSizeWarningLimit: 700` so the report speaks the same language as the build
  warning).
- `formatBytes(bytes, digits=1)` — `'158 B'` / `'116.3 KB'` / `'2.1 MB'`; `'n/a'` on
  invalid/negative.
- `classifyAsset(name)` — hash-agnostic stem match → `app` / `three` / `rapier` /
  `runtime` / `html` / `other`. The content hash + separator are ignored.
- `isJsCategory(category)` — which categories count toward "total JS".
- `severityFor(bytes, limit=DEFAULT_WARN_LIMIT)` — `'warn'` strictly over the limit, else
  `'ok'`; NaN-safe.
- `summarizeBundle(entries, opts?)` → JSON-serialisable
  `{ warnLimit, assets[sorted bytes desc, then name asc], totals{count,jsBytes,jsGzip,htmlBytes,allBytes}, categories, warnings }`.
  gzip is optional (null when absent, never polluting `jsGzip`); html bytes are excluded
  from the JS totals.

Deterministic + allocation-only-plain-data, so two runs over the same inputs produce
identical reports.

### 2. `tools/bundle-report.mjs` — CLI (does the fs + `node:zlib` I/O)
Reads `dist/assets/*.js` + `dist/index.html`, computes raw + gzip sizes locally, hands
plain entries to `summarizeBundle`, and prints a padded per-asset table (asset / category
/ raw / gzip / flag), a per-category raw breakdown, and totals + an advisory line for any
over-limit chunk. **Exits 0 always** (visibility, not a gate). When `dist/` is absent it
prints a hint (`run npm run build first`) and exits 0. Run with `npm run bundle:report`.

### 3. `package.json` — new script
`"bundle:report": "node tools/bundle-report.mjs"`. (No new dependency — `node:zlib` is
built in.)

### 4. `tools/regression-check.mjs` — non-failing advisory `[13]`
A new advisory block prints a one-line total-JS + per-category summary and lists any
over-limit chunk. It is **ADVISORY ONLY**: it never touches `fails`, catches its own
errors, and is skipped when no `dist/` exists — so `npm run check` stays green. Threshold
is `DEFAULT_WARN_LIMIT` (700 KiB), matching the build warning.

### 5. `tests/bundle-sizes.test.js` — 16 cases
Covers `formatBytes` rounding/units/`n/a`, `classifyAsset` stem matching + `other`
fallback + `isJsCategory`, `severityFor` strict threshold + custom limit + NaN safety, and
`summarizeBundle` sort / JS-vs-html + per-category totals / over-limit warnings /
determinism + JSON-serialisability / empty + missing-gzip + custom-warnLimit edge cases.

### 6. Version bump → v0.2.153-alpha
`src/config.js`, `package.json`, `index.html` (×2), and `tools/regression-check.mjs`
(header, `EXPECTED_VERSION`, stale-version guard → flags `v0.2.152-alpha`).

### 7. Docs
`todo.md`, `progress.md` (sprint row `BUNDLE-TRACK` + Completed-Last-24h entry),
`HANDOFF.md` (version + 468/42 + 13 checks + `bundle:report` in the scripts block),
`CODE_INDEX.md` (Tests row count + new Bundle-size tracking row), `SDK_DEBUG_INDEX.md`
(status line + test-map row).

---

## Measured baseline (current `dist/`)

| asset                         | category | raw       | gzip      | flag    |
|-------------------------------|----------|-----------|-----------|---------|
| `rapier-*.js`                 | rapier   | 2.1 MB    | 842.2 KB  | ⚠ over  |
| `three-vendor-*.js`           | three    | 609.1 KB  | 160.3 KB  |         |
| `index-*.js`                  | app      | 116.3 KB  | 42.1 KB   |         |
| `index.html`                  | html     | 36.0 KB   | 9.0 KB    |         |
| `rolldown-runtime-*.js`       | runtime  | 158 B     | 154 B     |         |

- **total JS:** 2.8 MB raw / ~1.0 MB gzip (5 assets)
- **advisory:** 1 chunk over 700.0 KB — `rapier-*.js`. This is **expected and acceptable**:
  Rapier is lazy-loaded (dynamic `import()` on Enter Arena), so it is not in the
  title-screen critical path. Tracked, not gated.

(Numbers come straight from `npm run bundle:report`; exact raw bytes vary slightly with
each build's content hashing.)

---

## Verification

- `npm run build` — clean (the pre-existing Vite large-chunk warning remains; that is the
  warning this slice now tracks, not one introduced here).
- `npm run check` — **ALL GREEN**, 13/13 (the new `[13]` advisory prints the baseline and
  never fails).
- `npm test` — **468 passed (468)** across **42 files** (was 452/41; +16 from
  `tests/bundle-sizes.test.js`).

---

## Safety / constraint checklist

- **godMode:** false (unchanged).
- **No new `setTimeout`** (allowlist untouched).
- **No new `Vector3`/`Matrix4`** in hot paths — the new code is build-time tooling and
  pure plain-data transforms; never imported by the game.
- **No gameplay/visual change** — tooling lives in `tools/`, runs against built artifacts.
- **No bundle-splitting change** — `vite.config.js` `manualChunks` / `chunkSizeWarningLimit`
  untouched.
- **No network, navigation, payments, signing/publishing, relay/live fetch/WebSocket,
  auto-update, click/raycast changes, or external side effects.** The CLI only READS local
  files; gzip is computed locally via `node:zlib`. No install, no build triggered by the
  tools themselves.
- **`npm run check` not slowed meaningfully** — `[13]` only reads already-built files and
  is skipped when no `dist/` exists.

---

## Next (NOT in this slice)

Structured code-splitting / lazy-loading work off this baseline (e.g. further splitting
the three-vendor chunk, or trimming the app entry), now that there is a measurable,
tracked starting point. Deferred by design.

---

*Committed locally on branch `v0.2.153` (message starts `feat(v0.2.153): ...`). NOT pushed
or published — the parent agent will verify, security-review, deploy, publish, push, and
sync docs.*
