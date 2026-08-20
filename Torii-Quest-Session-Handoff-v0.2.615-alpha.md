# Torii Quest — Session Handoff (v0.2.615-alpha)

**Date:** 2026-08-20 (late session) · **Session tag:** homepage composition + ESC restore + crash-ghost eviction
**Shipped:** `v0.2.615-alpha` · commit `deaa803` · branch `phase0m-menu-shell` · pushed + tagged
**Deploy (you run):** `sudo torii-deploy v0.2.615-alpha`
**Gates:** `vitest 2915/2915` (220 files) · `npm run check` ALL GREEN (3 advisories, pre-existing/tracked)

---

## 1 · What this session did

Everything on your 10:18 PM THINGS-TO-DO list, plus the root cause of why your
screenshots didn't match the deployed build.

### A · The meta-bug first: your browser was running a HALF-STALE build

Your homepage screenshot (no sun/mountains, edge-on gate, tiny distant character)
was **not** v0.2.614's scene — it was the pre-614 scene running under new HTML.
The service worker itself is sound (network-first JS/HTML, version-named cache,
skipWaiting + clients.claim + controllerchange→reload), but a long-lived tab that
never navigates never re-checks for a new SW, and HTTP cache could serve a stale
`sw.js`. Hardened in `index.html`:

- `navigator.serviceWorker.register(..., { updateViaCache: 'none' })` — the HTTP
  cache can never serve an old `sw.js`.
- `document.addEventListener('visibilitychange', … reg.update())` — switching back
  to the tab checks for a new deploy; the new SW activates → `controllerchange`
  → one guarded reload. Deploys now reach open tabs within one tab-switch.

**If anything ever looks stale again: hard refresh (Shift+Ctrl+R) is still the
instant fix — but it should no longer be needed.**

### B · Homepage (your screenshot 1 requests)

All in `src/engine/homepage/homepageScene.js`:

1. **Chiefmonkey faces the camera now.** Root cause was real (visible in the live
   probe too, not just your stale frame): the Z-up face quaternion was
   `π + 0.35` — his back to the lens. Now `0.10` rad, square-on.
2. **Closer still.** Full scale (0.8 → 1.0), ~1.5m from the eye-height camera,
   lifted +0.75 so head + shoulders hold the frame and his lower body falls
   **below the fold** (verified by screenshot — no more sliver of hair in the
   corner).
3. **Gate squared to the camera.** It stood edge-on (`rotation.y = -0.35`).
   Your "rotate 110 degrees" landed at `rotation.y = 1.57` (90°) — the
   walk-through plane now faces the lens. Verified by screenshot.
4. **Sun is back.** It was never missing — the 16-high ridge at z=-34
   **occluded it** (sun elevation 5.2° vs ridge silhouette 13.5°). Lifted to
   (14, 22, -50), now a proper golden disc with breathing halo above the
   mountain line. Sky gradient + ridges + sea-of-fog all render.
5. **Parallax reworked, pivoted on the gate.** Camera drift 2.6/1.4 → **0.9/0.5**
   (gentle); the gate itself never moves (the pivot); chiefmonkey nudges
   ±0.12; the three ridges shift progressively (0.55/1.10/1.65) and the sun
   ±1.8, sky rotates slightly — nearest layer least, farthest most.

### C · ESC — your "perfect before" behaviour, restored

Old code paused the game AND threw the modal on one press. New contract
(`src/arenaRuntime.js`, `index.html`):

- **1st ESC** (pointer-locked) → game pauses, mouse is freed, **NO modal** — a
  small `PAUSED — ESC for options · click to resume` pill shows top-centre.
  Clicking the canvas or the pill resumes (and re-locks).
- **2nd ESC** (paused, unlocked) → the **resume/exit modal** appears. ESC again
  (or RESUME) resumes; EXIT THE GAME leaves as before.
- Browsers that reserve the locked ESC (deliver no keydown) are covered by a
  `pointerlockchange` hook: any lock loss while PLAYING quiet-pauses. Deliberate
  exits (menu M / gateway F) transition out of PLAYING first, so they never
  double-trigger it.
- `tests/pause-input.test.js` rewritten to lock this contract.

### D · Ghost peers ("2 chiefmonkeys as well as myself")

Your pre-login crash was exactly the cause. A crashed client leaves its TCP
socket half-open for **minutes** — far beyond the server's 90s idle reaper — so
when you logged straight back in with the same key, TWO authed sessions existed
and every peer saw both. Two-layer fix:

1. **Server (`server/arena-ws.js` `finishAuth`)** — on every auth, any existing
   authed session with the **same pubkey** is closed (`superseded`) BEFORE the
   roster snapshot + JOIN broadcast. One live session per identity, enforced at
   the authoritative layer.
2. **Client seatbelt (`src/engine/multiplayer/multiplayerHost.js`)** — new
   `getSelfNpub()` dep (captured at NIP-42 sign time in `arenaRuntime.js`); any
   `roster`/`peerJoin` entry whose npub matches our own is **dropped** and never
   rendered.

Tests: `tests/multiplayer/ghost-eviction.test.js` (server source contract) + two
behavioural tests in `multiplayer-host.test.js`.

### E · Gun SFX "multiple times again"

Traced the whole chain: `mousedown` (gated on pointer lock) → one `shoot()` →
`shootCd = 60ms` guard → one `EV.SHOOT` → **one** `playShoot()` call site. The
double-recoil bug you reported before was fixed in v0.2.611 and is still fixed;
your session was likely the half-stale build (§A). Belt-and-braces anyway:
`playShoot()` (`src/audio.js`) now **refuses a second call within 30ms** — no
future double-subscription/double-emit regression can ever repeat the sound.

### F · Arena freeze ("totally frozen, fan cranking")

**Honest status: not root-caused.** The v0.2.614 `[LONG-FRAME]` watchdog is live
(DevTools console shows `frame=N gapMs=X heapMB=Y`, throttled) — that's the
telemetry we need. The strongest suspect was your ghost-peer state (2 extra
SkinnedMesh avatars + mixers ticking), which §D now prevents. The roster's
dispose paths are clean (verified). **Next playtest: if it freezes again, grab
the console's `[LONG-FRAME]` lines + heap trend before you reload.**

---

## 2 · Version bump checklist (manual — `tools/bump-ver.sh` is STALE, don't use it)

`package.json`, `package-lock.json` (2 refs), `src/config.js` VERSION,
`public/sw.js` CACHE_VERSION, `index.html` (`#version-label` + `#ver`),
`tools/regression-check.mjs` EXPECTED_VERSION, `NEXT_ACTION_STATE.json` (version
refs + test-status capture), `MVP_APPROVAL_STATE.json`,
`src/engine/dashboard/toriiQuestDashboardData.js` (TORII_QUEST_VERSION +
CURRENT_TEST_STATUS), `src/engine/status/mvpReadiness.js` DEFAULT_TEST_STATUS,
the four `tests/torii-quest-dashboard.*.test.js` pins, then
`node tools/build-torii-quest-dashboard.mjs`, then prepend summaries to
`torii-quest-todo.md` / `progress.md` / `handoff.md`. **Order matters:**
`npm run build` BEFORE `npx vitest run` (release-meta-dist.test reads dist/),
and `npm run check` last. Editing the inline `<script>` in index.html changes
the CSP hash — recompute into `tools/csp.mjs` INLINE_SCRIPT_SHA256 (recipe in
`tests/sw-app-shell.test.js`).

## 3 · Repo / workflow facts for DeepSeek

- Repo: `github.com/ChiefmonkeyArt/torii-quest`, branch `phase0m-menu-shell`.
- Deploys are operator-run only: `sudo torii-deploy <tag>` on the VPS. Agents
  never SSH.
- Hard rules: **no `setInterval`/`setTimeout` in `src/engine`** (rAF only,
  regression-gated); homepage layer must stay **three-free at module eval**
  (lazy `import('three')`, `homepageStub.test.js` asserts it); homepage scene
  does **no fetch/sign/navigate**; combat values frozen (BOT_HP=5, BODY=3,
  HEAD=9, SHOOT_CD=0.06) unless the operator asks.
- Source-of-truth docs: `torii-quest-strategy.md`, `-todo.md`, `-progress.md`,
  `-handoff.md` — update all four per release (headers + prepended summary).
- Screenshot harness: `vite preview` is broken in sandboxes; serve `dist/` with
  `python3 -m http.server` and drive Playwright against it. Debug handle:
  `window.__toriiHomeScene = { camera, charRef(), gateRef(), scene }`.
- Live GLBs exist ONLY under `/quest/` on the VPS.

## 4 · Known open items (next session's queue)

1. **Freeze root cause** — needs a live `[LONG-FRAME]` capture (§F).
2. **Banker hit-reg** — needs `journalctl -u torii-quest-arena -f` `[SHOT-RESOLVE]`
   lines correlated with client `[HIT-REG]` during a playtest.
3. **Deep cleanup audit + ADRs** — needs operator SSH.
4. Crosshair: unchanged this cut (toggled `.active` on pointerlockchange, arena
   only, never in NAP). If it still reads missing in play, it means the pointer
   isn't locked — the new quiet-pause flow (§C) makes that state visible now.
5. **Advisories from `npm run check`** (not gated): two >700KB chunks
   (rapier, three-vendor — tracked), SDK_DEBUG_INDEX.md / CODE_INDEX.md version
   lines, one stale historical line in progress.md (v0.2.453 table row).
