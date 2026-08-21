# Torii Quest — Session Handoff (v0.2.616-alpha)

**Date:** 2026-08-21 · **Session tag:** homepage landscape + parallax tune + chiefmonkey frame
**Shipped:** `v0.2.616-alpha` · commit `4509df2` · branch `phase0m-menu-shell` · pushed + tagged
**Deploy (you run):** `sudo torii-deploy v0.2.616-alpha`
**Gates:** `vitest 2915/2915` (220 files) · `npm run check` ALL GREEN (3 advisories, pre-existing/tracked)

---

## 1 · What this session did

The THINGS-TO-DO list, on top of v0.2.615 (which was already pushed but not yet
deployed — see §A below, the meta-bug is unchanged).

### A · The meta-bug (unchanged from v0.2.615 handoff)

Your screenshots (no sun/mountains, no crosshair, ESC removes the gun with no
modal) were the **pre-v0.2.614 stale build**, not the current source. The SW
hardening in v0.2.615 (`updateViaCache:'none'` + `visibilitychange` reg.update)
is in place; **hard refresh (Shift+Ctrl+R) is the instant fix if anything looks
stale.** Crosshair + ESC two-stage are ALREADY correct in v0.2.615 source — they
only read as broken on the stale build.

### B · Homepage — full 3D parallax landscape (`src/engine/homepage/homepageScene.js`)

1. **Sea + grass added.** The home surface now reads as a full landscape
   (sky → sun → mountains → sea → grass) instead of flat colour bands:
   - `_buildSea()` — a teal water plane with a gentle vertex-shader sine swell
     (1 draw call, `uTime` ticked per-frame), placed behind the gate.
   - `_buildGrass()` — an instanced grass field (500 seeded blades, 1 draw
     call) over the foreground; the ground disc recoloured to grass green.
2. **Parallax reworked** (operator: "too strong", "pivot between the gate and
   chiefmonkey"): camera drift reduced ±0.9/±0.5 → **±0.6/±0.35**; the gate now
   moves a touch (±0.18) so the pivot sits between gate + chiefmonkey;
   chiefmonkey nudges a little (±0.1) and is **clamped** so he never leaves the
   frame; the sun travels side-to-side (±7) but is **clamped** on-screen
   (x ∈ [6, 22]); ridges/sky move progressively less.
3. **Chiefmonkey reframed** (operator: "lower him a bit more, bring him a little
   closer"): lift +0.75 → **+0.3** (lower in frame), z 24.5 → **25.3** (~0.7m
   from the lens).

### C · Crosshair + ESC — already fixed in v0.2.615, NOT re-touched

- **Crosshair** shows whenever the pointer is locked (both NAP zone and arena);
  in NAP the reticle is neutral white (no weapon). If it still reads missing in
  play, the pointer isn't locked — click the canvas to re-lock.
- **ESC** is two-stage: 1st press pauses + frees the mouse (no modal, a small
  PAUSED pill shows), 2nd press opens the resume/exit modal. Locked in
  `tests/pause-input.test.js`.

### D · Arena freeze — still NOT root-caused

Needs a live `[LONG-FRAME]` capture (DevTools console shows `frame=N gapMs=X
heapMB=Y`, throttled). The strongest suspect (ghost peers) was already fixed in
v0.2.615. **Next playtest: if it freezes, grab the `[LONG-FRAME]` lines + heap
trend before reloading.**

---

## 2 · Version bump checklist (manual — `tools/bump-ver.sh` is STALE, don't use it)

`package.json`, `package-lock.json` (2 refs), `src/config.js` VERSION,
`public/sw.js` CACHE_VERSION, `index.html` (`#version-label` + `#ver`),
`tools/regression-check.mjs` EXPECTED_VERSION, `NEXT_ACTION_STATE.json`,
`MVP_APPROVAL_STATE.json`, `src/engine/dashboard/toriiQuestDashboardData.js`
(TORII_QUEST_VERSION + CURRENT_TEST_STATUS), `src/engine/status/mvpReadiness.js`
DEFAULT_TEST_STATUS, the four `tests/torii-quest-dashboard.*.test.js` pins, then
`node tools/build-torii-quest-dashboard.mjs`, then prepend summaries to
`torii-quest-todo.md` / `progress.md` / `handoff.md`. **Order matters:**
`npm run build` BEFORE `npx vitest run` (release-meta-dist.test reads dist/),
and `npm run check` last.

## 3 · Repo / workflow facts

- Repo: `github.com/ChiefmonkeyArt/torii-quest`, branch `phase0m-menu-shell`.
- Deploys are operator-run only: `sudo torii-deploy <tag>` on the VPS. Agents
  never SSH.
- Hard rules: no `setInterval`/`setTimeout` in `src/engine` (rAF only);
  homepage layer stays three-free at module eval (lazy `import('three')`);
  homepage scene does no fetch/sign/navigate; combat values frozen
  (BOT_HP=5, BODY=3, HEAD=9, SHOOT_CD=0.06).
- Screenshot harness: `vite preview` is broken in sandboxes; serve `dist/` with
  `python3 -m http.server` and drive Playwright. Debug handle:
  `window.__toriiHomeScene = { camera, charRef(), gateRef(), scene }`.

## 4 · Known open items (next session's queue)

1. **Freeze root cause** — needs a live `[LONG-FRAME]` capture (§D).
2. **Banker hit-reg** — needs `journalctl -u torii-quest-arena -f`
   `[SHOT-RESOLVE]` lines correlated with client `[HIT-REG]` during a playtest.
3. **Deep cleanup audit + ADRs** — needs operator SSH.
4. **Advisories from `npm run check`** (not gated): two >700KB chunks
   (rapier, three-vendor — tracked), SDK_DEBUG_INDEX.md / CODE_INDEX.md version
   lines, one stale historical line in progress.md (v0.2.453 table row).
