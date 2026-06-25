# Torii Quest — v0.2.193-alpha: VPS Install Dry-Run Checklist

> **Slice type:** infrastructure / tooling / docs only. **No runtime, gameplay, portal,
> physics, shooting, controls, live Nostr write, or update-execution change.** Local-only,
> read-only, network-free. Commit: `f159c66` (local only — not pushed/published).

---

## 1. What & why

The user wants future self-hosted torii.quest / VPS instances to be able to check GitHub for
the latest release and update **only when instructed**. This slice prepares **install
readiness only** — it does **not** connect to a VPS, open SSH, touch DNS, or change a server.

v0.2.193 adds a **local, read-only install dry-run**: a pre-deploy readiness checklist an
operator runs BEFORE walking the manual install (`VPS_INSTALL.md` §5) or update (§7) sequence.
It inspects only local repo/build/docs/metadata state and prints a clear per-item
pass/fail/warn/skip checklist. It is a readiness **guard**, not a deploy step — nothing here
connects anywhere, writes anything, or implies an install happened.

## 2. Deliverables

### Pure logic — `tools/vpsDryRun.mjs`
PURE / node-safe (no fs / network / child_process / SSH / THREE / DOM). REUSES the shipped
pure guards so the dry-run stays consistent with the gate:
- `validateReleaseMeta()` / `DEFAULT_SOURCE` (from `tools/releaseMeta.mjs`) — the manual /
  no-auto-update safety floor + the real repo coordinates.
- `fallbackEvidence()` (from `tools/zoneFallbackReadiness.mjs`) — the `/zone/*` SPA-fallback signal.

Exports: `VPS_DRY_RUN_BADGE`, `REQUIRED_DOCS`, `REQUIRED_VPS_SECTIONS`, `REQUIRED_BUILD_COMMANDS`,
`REAL_REPO_SLUG` (= `ChiefmonkeyArt/torii-gate`), `LIVE_URLS`; 11 per-row check functions;
`runVpsDryRun({docs, dist, releaseMeta})` → `{ ok, badge, checks, summary, errors, warnings }`
(`ok` is true iff NO check FAILED — warn/skip never flip it; never throws on null/degraded input);
`formatVpsDryRun(result)` → text block (safe on null).

The 11 checklist rows:
1. **required deploy docs present** — `VPS_INSTALL.md`/`UPDATE_CHECK.md`/`HANDOFF.md` readable.
2. **dist/ built with index.html** — SKIP when no build yet; FAIL if a built bundle lacks
   `index.html`; WARN if `index.html` present but `release-metadata.json` not yet copied; PASS if both.
3. **release-metadata.json present + parseable**.
4. **metadata is manual-only / non-actionable** — reuses `validateReleaseMeta()`; FAIL unless
   `manual=true`, `autoUpdate=false`, `actionable=false`.
5. **metadata points at `ChiefmonkeyArt/torii-gate`** — metadata source + `UPDATE_CHECK.md`.
6. **/zone/* SPA fallback documented** — reuses `fallbackEvidence()` over `VPS_INSTALL.md` + `HANDOFF.md`.
7. **VPS_INSTALL.md required sections present** — build / manual update / rollback / security.
8. **build/verify commands documented** — `npm run build` + `npm run check`.
9. **rollback + manual-update safety wording** — symlink rollback + no-auto-update.
10. **service-worker cache-busting documented** — the app DOES ship `public/sw.js`; the doc must
    spell out cache-busting / update hygiene (bump `CACHE_VERSION` when precached assets change),
    not merely mention "service worker" (corrected in the follow-up below — see §6).
11. **live URL references clear** — `torii.quest` + `torii-quest.pplx.app`.

### Thin CLI — `tools/vps-dry-run.mjs` (`npm run vps:dry-run`)
Behind a `realpathSync` run-guard (silent on import). Reads `REQUIRED_DOCS` contents,
`public/release-metadata.json` (or null), and `dist/` relative paths (or omitted → dist row
SKIPPED). Text default; `--json` for machine output. READ-ONLY / local / no-network / no-write.
Exits non-zero **only** on a blocking FAIL (warnings + the skipped `dist/` row never fail).
Deliberately **not** wired into `npm run check` (standalone operator tool — keeps scope tiny
and avoids gating routine dev on build artifacts).

### Tests — `tests/vps-dry-run.test.js`
43 unit tests: every individual check (pass/fail/warn/skip), the folded `runVpsDryRun` result +
summary, the safety-floor reuse, degraded/missing/null cases, and the text formatter on
degraded input. No fs/network — every input is plain data, fully node-deterministic.

### Docs
- `VPS_INSTALL.md` — new **§13 Pre-deploy install dry-run**; §9 gained the **"No service
  worker (today)"** caveat explaining why the atomic symlink-flip needs no client cache-busting.
- `UPDATE_CHECK.md` — new **§6 Pre-deploy install dry-run**.
- `todo.md` / `progress.md` / `HANDOFF.md` / `CODE_INDEX.md` / `SDK_DEBUG_INDEX.md` — version
  bump to v0.2.193-alpha + a new tool/task/active-slice entry.
- `src/engine/dashboard/continuumData.js` — `CONTINUUM_VERSION`, last-known test count,
  metrics, active-now / completed-24h, LEAN-5 status updated for v0.2.193.

### Version markers (bumped together)
`package.json` (`0.2.193-alpha`), `src/config.js` (`VERSION`), `index.html` (×2),
`tools/regression-check.mjs` (`EXPECTED_VERSION` + the previous-version stale guard now flags
`v0.2.192-alpha`), `public/release-metadata.json` (regenerated deterministically).

## 3. Checks run & results

| Command | Result |
|---|---|
| `npm run vps:dry-run` | **11 pass · 0 fail · 0 warn · 0 skip** → READY, exit 0 |
| `npm run docs:stale` | advisory-only, exit 0 (clears once this report is linked) |
| `npm run release:meta` | metadata valid; source `ChiefmonkeyArt/torii-gate`; auto-update OFF; exit 0 |
| `npx vitest run tests/vps-dry-run.test.js` | **43 passed / 43** |
| `npm run test:release` | build + FULL vitest (**1145 / 72 files** after the §6 follow-up; 1143 at initial slice) + `npm run check` (ALL GREEN, 15/15) + bundle:report + handoff:status |

## 4. Security / performance concerns

- **None new.** The tool is PURE + thin-CLI, read-only, network-free, and never writes. It
  opens no SSH, touches no DNS, and changes no server — by construction it cannot perform a deploy.
- It **reduces** risk: it machine-asserts the no-auto-update safety floor (`validateReleaseMeta`)
  and the real-repo coordinates as a pre-deploy gate, surfacing drift before an operator ships.
- No hot-path code touched; no new `setTimeout` / `Vector3` / `Matrix4`; `godMode` stays `false`.
- The runtime `RELEASE_SOURCE` in `src/engine/update/updateCheck.js` previously carried the
  legacy placeholder slug; this was **corrected in the follow-up below (§6, WARN-2)** to the
  real repo `ChiefmonkeyArt/torii-gate`. It is a documentation-only constant (the module
  performs no I/O), so the change is constant-only with no network/write behavior change.

## 5. Non-goals held

No gameplay / portal runtime / physics / shooting / controls change; no live Nostr write; no
real update execution; no actual VPS / SSH / DNS action; no deploy/publish/push.

---

## 6. Follow-up: security-review WARN fixes (same v0.2.193 slice)

A post-slice security review raised three non-blocking WARNs. All three are resolved here
(docs / tooling / metadata, plus one constant-only runtime change). Still local-only,
read-only, network-free; no gameplay/physics/Nostr/portal/update-execution change.

### WARN-1 — service-worker doc/reality mismatch (FIXED)
The slice had asserted "torii ships no service worker today." That was **wrong**: the app
**does** ship a same-origin service worker — `public/sw.js` (copied to `dist/sw.js` at build),
registered from `index.html` via `navigator.serviceWorker.register('/sw.js')`, with a
cache-first strategy for static assets (`.glb/.webp/.jpg/.png/.woff2/.wasm`), network-first for
HTML/JS/CSS, and `skipWaiting()` + `clients.claim()`. Fixes:
- **`VPS_INSTALL.md` §9** rewritten to state the app ships `sw.js` and that operators must
  account for cache-busting / update hygiene — the symlink flip alone does NOT invalidate the
  SW's static cache; precached assets persist until `sw.js`'s `CACHE_VERSION` (`'tq-v1'` →
  `CACHE_NAME 'torii-quest-tq-v1'`) is bumped. HTML/JS/CSS are network-first so the app shell
  follows the flip, but a changed precached asset needs a coordinated `CACHE_VERSION` bump.
- **`tools/vpsDryRun.mjs`** — the comment block + `checkServiceWorkerCaveat` rewritten so the
  check now **validates accurate wording**: it FAILs unless the doc mentions a service worker
  AND a cache-busting / update-hygiene term (`cache-bust` / `cache version` / `CACHE_VERSION` /
  `cache invalidation`). Row label is now `service-worker cache-busting documented`.
- **`tests/vps-dry-run.test.js`** — `GOOD_VPS` fixture + `checkServiceWorkerCaveat` tests
  updated, incl. a new case that FAILs when a service worker is mentioned but cache-busting is
  not. **§13** of `VPS_INSTALL.md` description updated to match.

### WARN-2 — runtime `RELEASE_SOURCE` legacy placeholder (FIXED, constant-only)
`src/engine/update/updateCheck.js` `RELEASE_SOURCE` carried `torii-quest/torii-quest`. The
module performs **no I/O** (`RELEASE_SOURCE` is documentation-only — see the file's scope
guard), so this is a safe **constant-only** correction. Changed `owner`/`repo` + the two URLs
to `ChiefmonkeyArt/torii-gate`. No fetch/auto-update/write/network behavior changed; no actual
update execution. Added a test in `tests/update-check.test.js` asserting `RELEASE_SOURCE`
points at the real repo (and not the placeholder). The "still deferred / pending a runtime
slice" wording in `UPDATE_CHECK.md` §5, `HANDOFF.md`, and the `tools/releaseMeta.mjs` comment
updated to "corrected in v0.2.193 — documentation-only".

### WARN-3 — `commit`/`generatedAt` null in `public/release-metadata.json` (RESOLVED — honest, deterministic)
This is **by design**: the in-repo metadata is deliberately unstamped so a plain
`npm run release:meta -- --write` is idempotent and never churns the tree; provenance
(`commit` + ISO `generatedAt`) is baked into the **deployed** copy at deploy time via
`--write --stamp`. Committing a stamped (non-deterministic) file would break that idempotency,
so the null in-repo state is correct and we keep it. Made the tooling/docs **honest** about it:
- **`tools/vpsDryRun.mjs`** `checkReleaseMetaPresent` now reports stamp status in its detail
  (`stamped (...)` vs `unstamped in-repo template (... deploy bakes provenance via --write
  --stamp)`), **PASSing either way** — it never demands a stamped repo file.
- **`VPS_INSTALL.md` §12** gained an explicit note that the in-repo file is intentionally
  unstamped and stamping is a deploy-time action on the deployed copy only; **§13** notes the
  dry-run reports this honestly.

### Follow-up checks re-run
| Command | Result |
|---|---|
| `npm run vps:dry-run` | **11 pass · 0 fail · 0 warn · 0 skip** → READY, exit 0 |
| `npm run release:meta` | metadata valid; source `ChiefmonkeyArt/torii-gate`; auto-update OFF; exit 0 |
| `npm run docs:stale` | no drift detected; exit 0 (advisory) |
| `npx vitest run tests/vps-dry-run.test.js tests/update-check.test.js` | **58 passed** (44 + 14) |
| `npm run test:release` | **Test Files 72 passed · Tests 1145 passed** · `npm run check` ALL GREEN (15/15) · bundle advisory (rapier, expected) · handoff:status in sync |

Test count moved **1143 → 1145** (+1 service-worker cache-busting fail case, +1 `RELEASE_SOURCE`
real-repo assertion); `progress.md` + the dashboard last-known/full-suite counts updated to match.
