# v0.2.228-alpha — ENTER-ARENA No-Op Fix

**Type:** surgical bug fix (entry-flow). Two files of shipped runtime change
(`index.html` markup + `src/main.js` handlers) plus a test extension and the
standard version/docs/artifact lockstep. No gameplay/physics/shooter/Rapier
logic change.
**Commit:** local only — NOT pushed, NOT tagged, NOT released. Parent/main agent
handles security review, deploy, publish, GitHub push, Space upload, and live smoke.

## What & why

Live cloud-browser smoke after v0.2.226 (the service-worker app-shell fix) and
v0.2.227 (static entry-flow smoke tests) showed the app loads and JS runs, but:

- **ENTER ARENA** click gives no visible transition — the arena is not entered.
- **LOGIN WITH NOSTR** click registers but gives no visible response.

The SW fix was necessary but not sufficient: the buttons are reachable and bound
(v0.2.227 tests pass), yet a click in a cloud / no-extension browser is a silent
no-op. This slice diagnoses and fixes the actual remaining entry-flow bug.

## Root cause

Two independent SILENT no-op paths in `src/main.js`:

1. **LOGIN feedback dropped to a non-existent element.** `_doNostrLogin()` wrote
   `nostrLogin()`'s result string to `elNostrTxt = document.getElementById('nostr-status')`,
   but **`#nostr-status` never existed in `index.html`** (confirmed by grep — zero
   matches). So `nostrLogin()` correctly returns `'NIP-07 extension not found'`
   when no NIP-07 signer is present, and that string was written to `null` —
   nothing visible. The click "registered" (handler ran) but produced no UI.

2. **ENTER failure was a silent reset, and post-init steps were outside the try.**
   The ENTER handler `await initPhysics()` (Rapier WASM — the prime suspect in a
   headless/cloud browser) inside a `try`, but the `catch` only `console.error`'d
   then reset the button — no user-facing message. Worse, the model-load bootstrap
   (`loadPlayerModel` / `loadFirstPersonBody` / `buildNapNpc`) sat **outside** the
   `try`, so a throw there would leave the button stuck on `LOADING PHYSICS…`
   forever with no message and no recovery.

Anonymous entry is already the intended design — the ENTER handler does **not**
gate on a Nostr login — so the correct MVP behaviour is: ENTER visibly enters or
shows a clear failure message; LOGIN shows visible feedback when no signer exists.

## Changed / added files

### Shipped runtime fix (surgical, two files)
- **`index.html`** — adds a visible `#entry-status` line directly below the two
  entry buttons: `role="status"`, `aria-live="polite"`, hidden (`display:none`)
  until a message is set. Markup only — the inline SW `<script>` is untouched, so
  the CSP `script-src` sha256 stays valid.
- **`src/main.js`** —
  - Replaces the dead `elNostrTxt`/`#nostr-status` lookup with
    `elEntryStatus = getElementById('entry-status')` + a `showEntryStatus(msg)`
    helper (sets `textContent` and toggles visibility).
  - Moves the FULL ENTER bootstrap (incl. `loadPlayerModel`/`loadFirstPersonBody`/
    `buildNapNpc`) **inside** the `try`; on ANY failure the `catch` now shows
    `⚠ Arena failed to load — please reload the page and try again.`, resets the
    button text, and re-enables it for a retry (no stuck/silent button). Status is
    cleared on a successful entry.
  - `_doNostrLogin()` now routes the `nostrLogin()` result (and a `Connecting…`
    interim) to the visible `#entry-status` line. Anonymous entry preserved — login
    is never required to ENTER.

### Tests
- **`tests/entry-flow-smoke.test.js`** — +4 tests (7 → 11), no new file. Freezes
  the "no silent no-op" contract: `#entry-status` exists in `index.html`; feedback
  routes through it (and the dead `#nostr-status` lookup is gone); the ENTER catch
  surfaces a `showEntryStatus(...)` message AND re-enables the button; the LOGIN
  handler shows its result on the status line.

### Version markers (227 → 228)
`src/config.js`, `package.json`, `public/sw.js` (`CACHE_VERSION = tq-v0.2.228-alpha`),
`index.html` (`#version-label` + `#ver`), `tools/regression-check.mjs`
(`EXPECTED_VERSION` + stale guard → v0.2.227), `src/engine/dashboard/continuumData.js`
(`CONTINUUM_VERSION` + Source version + Active slice + `CURRENT_TEST_STATUS.passing`
1501→1505), `src/engine/status/mvpReadiness.js` (`DEFAULT_TEST_STATUS.passing` 1505),
`tests/continuum-dashboard.test.js` (4 version pins). Test counts 1501→**1505 passing**,
files stays **92** (no new test file).

### Docs
`todo.md` (new HARD-42 row + header), `progress.md` (header / Source version /
Tests / Active slice), `HANDOFF.md` (Current version + v0.2.228 changelog block +
report pointer), `CODE_INDEX.md` (Current version + new "click registers but no
visible response" diagnosis row), `SDK_DEBUG_INDEX.md` (status version).

### Regenerated artifacts
`MVP_APPROVAL_STATE.json`, `public/release-metadata.json`, `HANDOFF.generated.md`,
`NEXT_ACTION_STATE.json`, `MVP_RELEASE_PACKAGE.md`, `MVP_PLAYTEST_CHECKLIST.md`,
`RELEASE_NOTES_DRAFT.md`, `GITHUB_RELEASE_DRY_RUN.md`, `MVP_RC_SNAPSHOT.md`,
`RELEASE_ARTIFACT_MANIFEST.md`, `public/continuum.html`, `public/continuum-data.json`,
plus the `dist/` rebuild. **`MVP_PLAYTEST_RESULTS.md` is NO-CLOBBER — not regenerated.**

### New
- `torii-v0.2.228-enter-arena-noop-fix-report.md` — this report.

## Tests run / results

- `npx vitest run` → **1505 passing / 92 files** (+4 from the extended entry-flow suite)
- `npm run check` → expected **15 / 15 GREEN** (after `npm run build` refreshed dist markers)
- `npm run build` → clean (standing rapier >700 KB advisory only, not gated)
- `npm run test:release` → expected **exit 0**

## Manual verification notes

- The automated coverage stays static (file-read) — it freezes the source contract
  that feedback is wired to a real visible element and that ENTER failures surface a
  message + re-enable the button. The LIVE check (buttons actually respond / the
  failure message renders on the deployed site) remains the parent agent's
  cloud-browser smoke of https://torii-quest.pplx.app.
- Expected live behaviour after deploy: clicking **LOGIN WITH NOSTR** with no
  extension shows `NIP-07 extension not found` on the new status line (instead of
  nothing); clicking **ENTER ARENA** either enters the arena or, if physics fails to
  load, shows `⚠ Arena failed to load — please reload the page and try again.` with
  the button re-enabled — never a silent no-op or a stuck `LOADING PHYSICS…`.
- **No MVP approval granted; playtest remains not-run / pending.** No fabricated results.

## Security-sensitive behavior

**None new.** No new fs/crypto/git network surface. No Nostr signing/publishing or
live network write beyond the existing NIP-07 read in `nostrLogin()`. No
deploy/publish/tag/self-update. `godMode` stays false; no new
`setTimeout`/`Vector3`/`Matrix4`; "nostrich"/"Chiefmonkey" untouched. The new
`index.html` markup is a static `<div>` — the inline SW script and its CSP sha256
are unchanged.

## Blockers / warnings

None blocking. Commit is **local only** — not pushed, not deployed, not published,
not tagged. Standing non-blocking advisories unchanged (rapier chunk >700 KB; alpha).
Parent/main agent handles security review, deploy, publish, push, Space upload, and
the live cloud-browser smoke.
