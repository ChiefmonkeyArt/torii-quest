# Torii Quest v0.2.185-alpha — VPS `/zone/*` SPA-fallback Deployment Readiness

> **Slice type:** safe documentation/tooling FOUNDATION (no runtime change). Builds on
> v0.2.184 (live/pushed). Committed LOCALLY ONLY — no push/deploy/publish/upload.

## 1. Goal

Make the one outstanding torii.quest/VPS static-host prerequisite for the gateway travel
feature — **serve `index.html` for any `/zone/<slug>` path on a COLD hard-refresh /
deep-link** — operationally EXPLICIT and LOCALLY CHECKABLE before a maintainer publishes a
new `dist/`, without changing anything the app does at runtime and without touching a server.

Context: v0.2.181 pushes the same-origin `/zone/<slug>` URL (`history.pushState`); v0.2.182's
pure `zoneRoute` parser gives that URL a safe client-side interpretation. That fully covers
*in-app* navigation. A **cold hard-refresh / shared deep-link** only reaches the app if the
static host serves `index.html` for the unmatched `/zone/*` path. That is a hosting-config
requirement living OUTSIDE the bundle; this slice documents and checks it, never fakes it in
app code.

## 2. What shipped (pure / read-only / network-free)

| Artifact | Kind | Notes |
|---|---|---|
| `tools/zoneFallbackReadiness.mjs` | NEW pure helper | No fs/network/child_process/THREE/DOM. Exports `ZONE_ROUTE_PREFIX`, `ZONE_FALLBACK_BADGE`, `REQUIRED_FALLBACK_DOCS`, `fallbackEvidence`, `checkFallbackDocs`, `zonePathsInDist`, `checkDistRoutes`, `checkZoneFallbackReadiness`. Inspects plain inputs (doc text + a list of built file paths) only. Mirrors the `docConsistency.mjs` pattern. |
| `tools/zone-fallback-check.mjs` | NEW CLI | Read-only, network-free. Reads `VPS_INSTALL.md`/`HANDOFF.md` + walks `dist/`, folds via the pure helper, prints a report, `process.exit(ok?0:1)`. Wired as `npm run zones:check`. |
| `tests/zone-fallback-readiness.test.js` | NEW (20 tests) | Constants, `fallbackEvidence` (nginx/Caddy/prose/bad input), `checkFallbackDocs` (pass/missing/under-documented/warn/deterministic), `zonePathsInDist`, `checkDistRoutes` (clean/skipped/no-index/shadow), folded `checkZoneFallbackReadiness`. |
| `tools/regression-check.mjs` | EDITED | Added check **[15]** — reads the required docs + walks `dist/`, calls `checkZoneFallbackReadiness`, prints advisories, pass/fail. |
| `tools/testProfiles.mjs` | EDITED | Added the new test file to the FOUNDATION profile. |
| `package.json` | EDITED | `version` → `0.2.185-alpha`; new `"zones:check"` script. |
| `ZONE_FALLBACK_READINESS.md` | NEW doc | §1 why · §2 host examples (clearly marked EXAMPLES — not deployed) · §3 pre-publish checklist · §4 the local check · §5 non-goals. |
| `VPS_INSTALL.md` | EDITED | New §11 "SPA `/zone/*` fallback readiness" referencing the Caddy/Nginx `try_files`, `npm run build && npm run zones:check`, regression [15], and the checklist doc. |
| `UPDATE_CHECK.md` | EDITED | §4 pointer to the new check as a read-only, network-free guard independent of the update-check flow. |
| `HANDOFF.md` | EDITED | Version line bump; v0.2.185 changelog entry (no SDK namespace); §7 note that the SPA prerequisite is now `zones:check`-verified. |

### What the check verifies (HARD FAIL conditions)

1. A required doc (`VPS_INSTALL.md`/`HANDOFF.md`) is missing or does NOT describe the
   `index.html` SPA fallback.
2. A built `dist/` has no `index.html` (nothing for the fallback to serve).
3. A static file is published under `dist/zone/*` that would SHADOW the fallback.

The dist route-shape check is SKIPPED (ok) when no `dist/` exists, so the docs guard runs
standalone (e.g. before a build). Both the CLI and regression-check [15] do the fs reads and
hand plain data to the pure helper, keeping the logic deterministic + unit-testable.

## 3. Safety / constraints honored

- **No server access, SSH, credentials, or VPS provisioning.** The §2 host blocks are
  EXAMPLES; configuring the real host stays a manual maintainer step.
- **No deploy / publish / upload / network.** Docs + a local read-only check only.
- **No auto-update.** The torii.quest update-check stays read-only / `actionable:false`.
- **No runtime / navigation change.** Gateway safety model untouched — proximity ARMs, KeyF
  CONFIRMs, route same-origin `/zone/` only, allowlist hard-scoped `['/zone/']`.
- `godMode=false`; no new `setTimeout`; no new `Vector3`/`Matrix4` hot-path allocations;
  debug tools ship unconditionally; comments authored in the nostrich voice.
- Version bumped to **v0.2.185-alpha** across all checked markers (config.js, package.json,
  index.html ×2, regression-check header/EXPECTED/stale-guard, continuum-dashboard test ×4,
  continuumData CONTINUUM_VERSION + metrics + health).

## 4. Verification (local, no network)

```
npm run zones:check     → ZONE FALLBACK READY
npm run test:fast       → 74 passed (5 files)
npm run test:foundation → 24 files passed
npm run test:release    → build + 993 passed (67 files) + check ALL GREEN + bundle + handoff
npm run check           → [15] ✓ docs document the /zone/* index.html fallback; ALL GREEN
```

Continuum regenerated: `node tools/build-continuum.mjs` → v0.2.185-alpha, docs in sync,
67 files, parser gaps none. XSS self-guard on `public/continuum.html` = **0** tokens.

Test totals: **993 passing / 67 files** (was 973 / 66 at v0.2.184; +20 from the new test
file). Regression check: **15 / 15 GREEN** (added [15]).

## 5. Deferred / next

- Configure the actual host SPA fallback on torii.quest (manual maintainer step — outside
  this repo).
- The dedicated in-world portal MESH and the audited read-only GitHub releases fetch remain
  deferred as before; this slice touches neither.

## 6. Commit

Committed LOCALLY ONLY. No push / deploy / publish / upload — a parent agent
verifies/security-reviews/deploys.
