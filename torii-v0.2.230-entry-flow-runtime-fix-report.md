# v0.2.230-alpha — Entry-Flow Runtime Fix (bundle-independent inline bootstrap)

**Type:** surgical bug fix (entry-flow runtime follow-up to v0.2.228/229). Two files of
shipped runtime change (`index.html` inline bootstrap + CSP hash, `src/main.js` readiness
flags) plus a test extension and the standard version/docs/artifact lockstep. No
gameplay/physics/shooter/Rapier logic change.
**Commit:** local only — NOT pushed, NOT tagged, NOT released. Parent/main agent handles
security review, deploy, publish, GitHub push, Space upload, and the live cloud-browser smoke.

## What & why

v0.2.229-alpha is live at https://torii-quest.pplx.app, but the cloud smoke STILL reported a
**complete silent no-op on BOTH title-screen buttons**: the version label rendered, yet
clicking **ENTER ARENA** did nothing visible and clicking **LOGIN WITH NOSTR** with no
provider did nothing visible. The browser task could not inspect the console.

The v0.2.228/229 fixes were source-level (immediate `showEntryStatus(...)`, aria-hidden
death overlay, guarded login await) — all inside `src/main.js`. They cannot help if the
module never executes.

## Root cause

The two critical buttons (`#btn-enter`, `#btn-nostr-centre`) are wired ONLY by the module
bundle `/assets/index-<hash>.js`. The title screen itself is static HTML, so the version
label always renders. If the bundle:

1. **404s** — a stale service-worker shell pinning an old hashed bundle path after a
   redeploy (the v0.2.226 failure class), OR
2. **throws at module-eval** — e.g. WebGL/renderer initialization failing in a headless
   cloud browser BEFORE the handler-binding code (~`main.js` line 369) runs,

then **no click listener ever attaches**. The page looks alive (static label) while every
button is inert. The earlier source fixes live past the point of failure, so they never run.

`public/sw.js` was already correct as of v0.2.226 (network-first HTML/JS, no HTML-shell
precache, version-named cache, loop-guarded controllerchange self-heal) — so the residual
defect is not the SW layer; it is the single point of failure that ALL button wiring depends
on the one module bundle.

## Fix (surgical, two runtime files)

- **`index.html`** — a new attribute-less inline IIFE (prepended inside the existing inline
  `<script>`, before the SW registration) binds click handlers to BOTH buttons INDEPENDENT
  of the module bundle:
  - ENTER → visible `Engine still loading - reload the page if this persists.`
  - LOGIN → if `!window.nostr` → the full `NIP-07 extension not found` no-provider fallback;
    otherwise `Login still loading - reload the page if this persists.`
  Each inline handler `return`s early when its readiness flag is set, so when the module is
  alive it owns the click (no double-handling). `textContent` only — never `innerHTML`. No
  timers, nothing loops. Because the inline script content changed, the CSP `script-src`
  sha256 was recomputed to **`sha256-DZGng6oSY8eSKoAlumOJO8sutYAKBcjeE4vN1FkRLBA=`**
  (Vite preserves inline scripts verbatim, so source hash == dist hash;
  `tests/sw-app-shell.test.js` recomputes and asserts this dynamically).
- **`src/main.js`** — sets `window.__toriiEnterReady = true` immediately AFTER the real ENTER
  handler is bound, and `window.__toriiLoginReady = true` immediately AFTER the LOGIN handler
  is bound. These are the flags the inline bootstrap checks to stand down.

Goal 3 (stale-SW self-heal) was already satisfied by the v0.2.226 loop-guarded
`controllerchange` → `reload()` in the SW registration block; the inline bootstrap adds a
second, independent guarantee that the buttons are never silently dead even if the bundle is
unreachable.

## Changed / added files

### Shipped runtime fix
- `index.html` — inline bundle-independent bootstrap + recomputed CSP sha256.
- `src/main.js` — `window.__toriiEnterReady` / `__toriiLoginReady` set after binding.

### Tests
- `tests/entry-flow-smoke.test.js` — +5 tests (15 → 20 in this file; no new file). Freezes:
  the inline script binds BOTH buttons (≥2 click bindings); the no-provider LOGIN fallback
  (`window.nostr` + `NIP-07 extension not found`); the readiness flags exist
  (`__toriiEnterReady` / `__toriiLoginReady`); `main.js` sets each flag AFTER its
  `addEventListener` (index ordering); the inline bootstrap uses `textContent`, never
  `innerHTML`.

### Version markers (229 → 230)
`src/config.js`, `package.json`, `public/sw.js` (`CACHE_VERSION = tq-v0.2.230-alpha`),
`index.html` (`#version-label` + `#ver`), `tools/regression-check.mjs` (`EXPECTED_VERSION` +
stale guard → flags v0.2.229), `src/engine/dashboard/continuumData.js` (`CONTINUUM_VERSION` +
Source version + Active slice + `CURRENT_TEST_STATUS.passing` 1509→1514),
`src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS.passing` 1514),
`tests/continuum-dashboard.test.js` (4 version pins). Test counts 1509→**1514 passing**,
files stays **92** (no new test file).

### Docs
`todo.md` (new HARD-44 row + header), `progress.md` (header / Source version / Tests),
`HANDOFF.md` (Current version + v0.2.230 changelog block + report pointer), `CODE_INDEX.md`
(Current version + new "both buttons dead in production / inline bootstrap" diagnosis row),
`SDK_DEBUG_INDEX.md` (status version).

### Regenerated artifacts
`MVP_APPROVAL_STATE.json` (status=pending), `public/release-metadata.json`,
`HANDOFF.generated.md`, `NEXT_ACTION_STATE.json`, `MVP_RELEASE_PACKAGE.md`,
`MVP_PLAYTEST_CHECKLIST.md`, `RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`,
`MVP_RC_SNAPSHOT.md`, `RELEASE_ARTIFACT_MANIFEST.md`, `public/continuum.html`,
`public/continuum-data.json`, plus the `dist/` rebuild. **`MVP_PLAYTEST_RESULTS.md` is
NO-CLOBBER — not regenerated.**

### New
- `torii-v0.2.230-entry-flow-runtime-fix-report.md` — this report.

## Tests run / results

- `npx vitest run` → **1514 passing / 92 files** (+5 from the extended entry-flow suite)
- `npm run build` → clean (standing rapier >700 KB advisory only, not gated)
- `npm run check` → **15 / 15 ALL GREEN** (docConsistency confirms v0.2.230-alpha across 5 docs)
- `npm run test:release` → **exit 0**

## Manual verification notes

- Automated coverage stays static (file-read): it freezes that the inline bootstrap binds
  both buttons independent of the bundle, shows the no-provider LOGIN fallback, and stands
  down once the module sets its readiness flags. The LIVE proof (both buttons respond on the
  deployed site even if the bundle 404s/throws) remains the parent agent's cloud-browser
  smoke of https://torii-quest.pplx.app.
- Expected live behaviour after deploy: clicking **ENTER ARENA** always shows a visible
  status (the module's `Entering arena…` when the bundle is alive, or the inline
  `Engine still loading…` if the bundle is dead) — never a silent no-op. Clicking
  **LOGIN WITH NOSTR** with no extension always shows `NIP-07 extension not found`. When the
  bundle is healthy, the module's richer handlers run and the inline ones stand down.
- **No MVP approval granted; playtest remains not-run / pending.** No fabricated results.

## Security-sensitive behavior

**None new.** No new fs/crypto/git/network surface. No Nostr signing/publishing or live
network write beyond the existing NIP-07 read. No deploy/publish/tag/self-update. `godMode`
stays false; no new `setTimeout`/`Vector3`/`Matrix4`; "nostrich"/"Chiefmonkey" untouched.
The inline bootstrap uses `textContent`, never `innerHTML` (no injection surface), and the
CSP `script-src` sha256 was recomputed for the edited inline script — `sw-app-shell.test.js`
verifies it matches.

## Blockers / warnings

None blocking. Commit is **local only** — not pushed, not deployed, not published, not
tagged. Standing non-blocking advisories unchanged (rapier chunk >700 KB; alpha).
Parent/main agent handles security review, deploy, publish, push, Space upload, and the live
cloud-browser smoke.

**Status: SHIP** (pending the parent agent's live cloud-browser smoke).
