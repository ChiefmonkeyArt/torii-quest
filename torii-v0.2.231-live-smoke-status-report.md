# Torii Quest — v0.2.231-alpha Live-Smoke Status Slice

**Type:** status / dashboard / docs-only (no gameplay or runtime behaviour change)
**Verdict:** SHIP
**Gates:** Vitest **1531 passing / 93 files** · `npm run check` **15/15 GREEN** · `npm run build` clean · `npm run test:release` **exit 0**

---

## Goal

v0.2.230-alpha is live and was cloud-smoke-tested green. This slice surfaces that LIVE
smoke result inside the existing oversight system (next-action state + Continuum dashboard
+ handoff docs) WITHOUT changing gameplay/runtime behaviour — only generated/static status
surfaces. It captures the one posture local gates (`npm run test:release`) can never prove:
an observation of the production URL after a manual deploy.

## What changed

### New state-artifact triple (mirrors `MVP_APPROVAL_STATE`)

- **`tools/liveSmokeState.mjs`** — PURE, node-safe module (no fs/network/child_process/THREE/DOM;
  never throws). Exports `LIVE_SMOKE_BADGE`, `LIVE_SMOKE_SCHEMA` (`torii.live-smoke-state`),
  `LIVE_SMOKE_SCHEMA_VERSION` (=1), `LIVE_SMOKE_FILE`, `LIVE_SMOKE_RESULTS` ({PASS,FAIL,UNKNOWN}),
  `LIVE_SMOKE_CHECK_OUTCOMES` (`['pass','fail','skip']`), frozen `LIVE_SMOKE_REQUIRED_KEYS`, and:
  - `buildLiveSmokeState(inputs)` — `result` COERCED (anything not exactly `pass`/`fail` → `unknown`,
    so a typo can never read green); checks normalised (idless dropped, unknown outcome → `skip`);
    `safety` block pinned all-false incl. `impliesApproval:false`.
  - `validateLiveSmokeState(state)` → `{ok,errors,warnings}` — **PASS-REQUIRES-EVIDENCE floor:**
    a `pass` verdict is an ERROR unless ≥1 check, NO failed check, a concrete version marker, AND a
    `smokedAt` timestamp.
  - `isLiveSmokePass(state)` — strict (`result==='pass'` AND validates).
  - `formatLiveSmokeState(state)` (null-safe text); `summarizeLiveSmokeForState(state)` →
    `{result,pass,version,smokedAt,checks,passed,failed,impliesApproval:false}`.
- **`tools/live-smoke-state.mjs`** — thin read-only CLI (`npm run smoke:state`). Reshapes/reads the
  committed record (text / `--json`); re-persists a NORMALISED record only under a flag-gated,
  in-repo `--write`. Read-only/local/no-network otherwise.
- **`LIVE_SMOKE_STATE.json`** — committed artifact recording the v0.2.230-alpha cloud smoke:
  - `version-visible` — version label renders on the live title screen → **pass**
  - `enter-arena-feedback` — ENTER ARENA → `Engine still loading - reload the page if this persists.` → **pass**
  - `login-nostr-fallback` — LOGIN WITH NOSTR → `NIP-07 extension not found` → **pass**
  - 3/3 checks, `safety` all-false, `impliesApproval:false`.

### Folded into existing surfaces (no second source of truth)

- **`tools/nextActionState.mjs`** — added `liveSmoke` (via `summarizeLiveSmokeForState`) to
  `buildNextActionState`, to `NEXT_ACTION_STATE_REQUIRED_KEYS`, and to both the text and markdown
  formatters (`live smoke: … (implies approval: no)`).
- **`tools/next-action-state.mjs`** — added `gatherLiveSmoke()` reading `LIVE_SMOKE_STATE.json`
  (fallback UNKNOWN), wired into the `buildNextActionState` call.
- **`src/engine/dashboard/continuumData.js`** — new **Live smoke** metric row in the "At a glance"
  array; `CONTINUUM_VERSION`, `CURRENT_TEST_STATUS` (1531/93), Source-version + Active-slice updated.

### Live-trails-build invariant

The recorded smoke version (**v0.2.230-alpha**) legitimately LAGS the build/config version
(**v0.2.231-alpha**) — a smoke can only observe a DEPLOYED build. The freshness guard asserts
recorded **≤** config `VERSION` (never leads), not equality.

### Tests

- **`tests/live-smoke-state.test.js`** (NEW, +16) — constants; build shape/coercion/check-normalisation/
  safety; the pass-requires-evidence floor; `summarizeLiveSmokeForState`; `formatLiveSmokeState`; and a
  non-staleness guard on the committed `LIVE_SMOKE_STATE.json` (parses, validates, version never leads
  config `VERSION`).
- **`tests/next-action-state.test.js`** (extended) — folds the live-smoke state, pins `impliesApproval:false`,
  null input degrades to `{result:'unknown',pass:false}`.
- Net: suite **1514/92 → 1531/93**.

### Version bump (230 → 231, lockstep)

`src/config.js`, `package.json`, `public/sw.js` (`CACHE_VERSION`), `index.html` (`#version-label`, `#ver`),
`tools/regression-check.mjs` (`EXPECTED_VERSION` + stale-guard now flags v0.2.230),
`src/engine/dashboard/continuumData.js` (`CONTINUUM_VERSION` + `CURRENT_TEST_STATUS` + Source version + Active slice),
`src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS`), `tests/continuum-dashboard.test.js` (4 pins).

### Docs

`todo.md` (header + new HARD-45 row), `progress.md` (header/Source/Tests + live-smoke active-slice entry),
`HANDOFF.md` (Current version + §3 `LIVE_SMOKE_STATE.json` row + v0.2.231 changelog block),
`CODE_INDEX.md` (Current version + new Live-smoke state index row), `SDK_DEBUG_INDEX.md` (status version).

### Artifacts regenerated

`MVP_APPROVAL_STATE.json`, `public/release-metadata.json`, `HANDOFF.generated.md`, `NEXT_ACTION_STATE.json`
(now carries `liveSmoke` + 1531/93), `MVP_RELEASE_PACKAGE.md`, `MVP_PLAYTEST_CHECKLIST.md`,
`RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`, `MVP_RC_SNAPSHOT.md`, `RELEASE_ARTIFACT_MANIFEST.md`,
`LIVE_SMOKE_STATE.json`, `dist/`. **`MVP_PLAYTEST_RESULTS.md` deliberately untouched (NO-CLOBBER).**

## Hard constraints honoured

- Status/dashboard/docs only — no change to gameplay, physics, shooting, Rapier, Nostr writes, or gateway execution.
- `godMode` stays false; no new `setTimeout`; no new `Vector3`/`Matrix4` in hot paths; comments use "nostrich"; Chiefmonkey spelling exact; debug tools ship unconditionally.
- `impliesApproval` pinned false everywhere — a green smoke is NOT MVP approval; status STAYS not-run/pending, no MVP approval granted, no results fabricated.
- No deploy/publish/push/tag/release/self-update — committed locally only; parent agent handles security review, deploy, publish, GitHub push, Space upload, and live smoke.

## Result

**SHIP** — v0.2.231-alpha. All gates green: 1531 passing / 93 files, 15/15 regression checks, build clean, test:release exit 0.
