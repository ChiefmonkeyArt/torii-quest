# Torii Quest — v0.2.206-alpha Release Report

## Slice: MVP Release Package Index

**Type:** docs / tooling. **No runtime behavior change. Not a gameplay change and not a live browser test.**

### Goal

Create a single release-package INDEX artifact for the MVP proof-of-concept candidate so
humans and future agents can find every relevant file fast — pointing at the release notes
draft, playtest checklist + results template, handoff briefs, progress/todo source-of-truth
docs, and update/VPS/zone-fallback readiness notes, plus the current version/commit/test-count,
the live URL, the known non-blocking advisories, and the recommended next safe action. Backed
by a pure helper + a thin local CLI (`npm run release:package`) that prints text/json/markdown
and can optionally write the index in-repo. No network, no GitHub release, no tag, no deploy.

### What landed

**New — `tools/releasePackage.mjs`** (pure, node-safe; no fs/network/child_process/THREE/DOM;
never throws). Exports `RELEASE_PACKAGE_SCHEMA` ('torii.release-package'),
`RELEASE_PACKAGE_SCHEMA_VERSION` (1), `RELEASE_PACKAGE_BADGE`
('MVP RELEASE PACKAGE INDEX · LOCAL · READ-ONLY'), `RELEASE_PACKAGE_WRITE_FILENAME`
('MVP_RELEASE_PACKAGE.md'), `RELEASE_PACKAGE_TITLE`, a frozen `RELEASE_PACKAGE_ENTRIES` (10
entries `{key,file,label,category}` grouped Release & handoff / Playtest / Status & planning /
Ops readiness), frozen `RELEASE_PACKAGE_ADVISORIES` (3), and `RELEASE_PACKAGE_DEFAULT_NEXT_ACTION`.
`buildReleasePackageModel({version,gitCommit,liveUrl,testStatus,regression,advisories,nextAction,reports,present,generatedAt})`
returns a JSON-serialisable model with each entry carrying a `present` flag (true/false/null);
the `present` map is INJECTED by the CLI so the helper stays fs-free. `formatReleasePackage` (text)
and `formatReleasePackageMarkdown` (markdown) render the index grouped by category with a
present/MISSING/unknown mark per file; both null-safe. `safety` pins all eight flags false;
`rendered:false`, `actionable:false`.

**New — `tools/release-package.mjs`** (thin CLI, `npm run release:package`). Stamps
`configVersion()` + best-effort `git rev-parse --short HEAD` + `HANDOFF_SUMMARY_LIVE_URL` + the
curated `CURRENT_TEST_STATUS`, stat-s each indexed file (`existsSync`) for the `present` map, and
lists recent `torii-v*-report.md`, behind a `realpathSync` run-guard. Modes default text /
`--json` / `--markdown`; `--write[=path]` (default `MVP_RELEASE_PACKAGE.md`, confined in-repo via
the shared `resolveHandoffWritePath` — absolute / `..` rejected) is the ONLY write; always exits 0
(rejected `--write` path → exit 2).

**New — `tests/release-package.test.js`** (12 tests): constants/frozen index, assembly + present
map injection, advisory/next-action/reports defaults & overrides, safety flags all false, text +
markdown formatters, null-safety + garbled-input robustness.

**New — `MVP_RELEASE_PACKAGE.md`** (generated via the CLI `--write`): all 10 indexed files present.

### Why this is safe for the tests

This adds a NEW test file, so the suite grows. The drift-catcher
(`tests/continuum-dashboard.test.js`) asserts the curated `files` count equals the on-disk
`*.test.js` count and that `DEFAULT_TEST_STATUS` == `CURRENT_TEST_STATUS`, so the test counts were
bumped together: **1304 → 1316 passing, 82 → 83 files** in both
`src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS`) and
`src/engine/dashboard/continuumData.js` (`CURRENT_TEST_STATUS`).

### Tests

- Targeted: `tests/release-package.test.js` (12), `tests/continuum-dashboard.test.js`,
  `tests/agent-handoff.test.js` — pass.
- Full suite: **1316 passing / 83 files**.
- `npm run check` — 15/15 green ([14] reports v0.2.206 across the continuity docs).
- `npm run test:release` — exit 0.
- CLI smoke (`npm run release:package` text / `--json` / `--markdown` / `--write`) — renders the
  index; all 10 indexed files report present; version v0.2.206-alpha; tests 1316/83.

### Version bump (v0.2.205-alpha → v0.2.206-alpha)

`package.json` (version + new `release:package` script), `src/config.js` (`VERSION`),
`index.html` (×2: `#version-label` + `#ver`), `tools/regression-check.mjs` (`EXPECTED_VERSION` +
stale-`v0.2.205-alpha` guard), `src/engine/dashboard/continuumData.js` (`CONTINUUM_VERSION` +
`CURRENT_TEST_STATUS` 1316/83 + Source version metric + Active slice + activeNow + completed24h),
`src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS` 1316/83), `tests/agent-handoff.test.js`
(V/PKG), `tests/continuum-dashboard.test.js` (4 version pins), `public/release-metadata.json`
(regenerated), continuum artifacts rebuilt, dist rebuilt.

### Docs updated

`todo.md` (HARD-21 row + header), `progress.md` (header + at-a-glance Source version + Tests +
Active slice + Active now + Completed last 24h), `HANDOFF.md` (version line + v0.2.206 narrative +
latest-slice pointer), `CODE_INDEX.md` (version + new tool row), `SDK_DEBUG_INDEX.md` (status
version).

### Security-sensitive behavior

**None changed.** This is a pure, read-only index assembler + a thin local CLI. No transport, no
server, no fetch, no navigate, no publish, no sign. The only write is the explicit opt-in
`--write`, confined inside the repo via the shared `resolveHandoffWritePath` boundary. `godMode`
remains `false`. No new `setTimeout` (only the existing allowed nostr.js WS close + hud.js
kill-feed), no new `Vector3`/`Matrix4` in hot paths. No gameplay/physics/shooter/Rapier/Nostr
signing/Nostr publishing/live network write/server/DNS/SSH/updater/git tag/GitHub
release/deployment change.

### Blockers / warnings

- Standing advisory (never gated): `rapier-*.js` chunk > 700 KB.
- `SDK_DEBUG_INDEX.md` is an advisory doc (WARN-only in docConsistency [14]).
- The git branch label still reads `v0.2.180` (pre-existing, unrelated to this slice).
- The generated `MVP_RELEASE_PACKAGE.md` stamps the parent commit (`d45f1d2`) since it is
  produced before this slice's commit — same as `HANDOFF.generated.md`; cosmetic only.
