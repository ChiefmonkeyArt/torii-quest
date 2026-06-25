# Torii Quest — v0.2.181-alpha · Portal Mesh / Proximity Trigger Wiring

**Slice:** LEAN-2 / GATEWAY-PORTAL-TRIGGER
**Date:** 2026-06-25
**Status:** committed LOCALLY ONLY (no push/deploy/publish/upload — parent agent owns release)
**Gate:** `npm run test:fast` ✓ · `npm run test:foundation` ✓ · `npm run test:release` ✓ · `npm run check` ALL GREEN
**Suite:** 912 passing / 63 test files

---

## Goal

Wire the actual in-world portal mesh / proximity trigger to the existing
v0.2.180 `gatewayPortalActivation` seam, preserving every gate. Proximity must
ARM/PREVIEW only — never auto-navigate; an explicit player interaction is the
sole thing that confirms the same-origin hop.

## What shipped

### New module — `src/engine/gateway/portalTrigger.js` (pure, node-safe)

The PROXIMITY→CONFIRM controller that finally binds an in-world portal POSITION
to the v0.2.180 `createGatewayPortalBoundary`.

- `PORTAL_TRIGGER_VERSION = 1`, `PORTAL_PROMPT_TEXT = 'Press F to travel'`.
- `createPortalTrigger({ boundary, component, context, portalPos, range = 3, onPrompt, promptText })`
  → `{ tick(playerPos), interact(grant = true), isArmed(), inRange(), promptShown(), reset(), portalPos(), range() }`.
- `tick(playerPos)` uses the v0.2.180 `withinPortalRange` scalar squared-distance
  compare (NO `Vector3`/`Matrix4` allocation — hot-path safe). State changes ONLY
  on a range TRANSITION: entering range → `boundary.arm(component, context)` +
  show prompt; leaving range → `boundary.cancel()` + hide prompt. Returns
  `{ inRange, armed, changed }`. Proximity ALONE never navigates.
- `interact(grant)` acts ONLY while `boundary.armed()`, delegating to
  `boundary.confirm(grant)` — so all three v0.2.178 gates (`confirmed===true`,
  consent-gated `plan.ok`, route-allowlist prefix) **and** the v0.2.180 `['/zone/']`
  allowlist still apply. Clears the prompt, returns the activation report or `null`.
- `reset()` cancels + clears the prompt (used when leaving play).
- Exposes NO bare `navigate/open/reload/goto/assign/href/pushState` method; NO
  `window`/THREE/DOM at module scope (the boundary, which captured the injected
  window ONCE at construction, is injected). `onPrompt` is best-effort (try/catch).
  Never throws.

### HUD — `src/hud.js`

Added an inert prompt surface mirroring the existing NAP-indicator pattern:
lazy `#portal-prompt` div (fixed, bottom 90px, opacity 0), `showPortalPrompt(text)`
/ `hidePortalPrompt()` crossfade via CSS opacity transition — **no `setTimeout`**.

### Composition root — `src/main.js` (the ONLY browser-window injection site)

- Build a `createToriiGateway(...)` portal component at the NAP-zone edge.
- Build `createGatewayPortalBoundary({ window, routeAllowlist: ['/zone/'],
  hostContext: { currentRoute, rollbackRoute }, home: '/' })` — the browser
  `window` / host transport is injected HERE, at the boundary, never at module scope.
- Build `createPortalTrigger({ boundary, component, context, portalPos, range: 3,
  onPrompt })` where `onPrompt` toggles `showPortalPrompt`/`hidePortalPrompt`.
- In `update()`: `if (isPlaying()) _portalTrigger.tick(playerObj.position); else _portalTrigger.reset();`
- `onKeyDown(KeyF)` → `interact(true)` (only while playing + armed). **KeyF** chosen
  because KeyE is jump in `player.js` — no key/weapon regression.

### SDK + debug surface

- `src/sdk/index.js`: `export * as portalTrigger` + `SDK_SURFACE.portalTrigger`
  at the `experimental` tier.
- `src/engine/debug/shellReport.js`: `portalTriggerReport(component, context, opts)`
  drives a `createRecordingHost` boundary through a far→near approach (+ optional
  `interact`), returning `{ title:'GATEWAY PORTAL TRIGGER', badge, promptText,
  farInRange, nearInRange, armedAfterApproach, pushStateAfterArm, promptLog,
  interacted, status, navigated, confirmed, live, zoneId, targetRoute,
  routeAllowlist, pushStateCalls, inMemory:true, external/worldReloaded/signed/
  published/network:false, errors }`.
- `src/engine/debug/toriiDebug.js`: `shells.portalTrigger(component?, context?, opts?)`.
- `tools/testProfiles.mjs`: `portal-trigger.test.js` added to the foundation profile.

### Tests — `tests/portal-trigger.test.js`

Covers: module shape + no-bare-nav-name; proximity tick is inert (enter ARMS +
prompts but records **no** `pushState`; out-of-range never arms; `onPrompt` fires
only on transitions; leaving cancels); `interact` while armed navigates exactly
`/zone/plebeian-market-bazaar` through the injected recording host; not-armed
interact → `null` no-op; external URL never navigates; missing grant blocks;
`['/']` allowlist folds → `['/zone/']`; `reset()` disarms; re-enter re-arms;
geometry inputs are copied; never throws on null; SDK exposure; and the debug
shell (`portalTriggerReport`) asserting `farInRange:false`, `nearInRange:true`,
`armedAfterApproach:true`, `pushStateAfterArm:[]`, final status NAVIGATED with
`pushStateCalls:['/zone/plebeian-market-bazaar']`, plus the armed-but-not-confirmed
(`{interact:false}`) no-op.

## Requirement → evidence

1. **Wire proximity to the v0.2.180 boundary** — `portalTrigger.tick` calls
   `boundary.arm`/`cancel`; `interact` calls `boundary.confirm`. ✓
2. **Explicit confirmation, no auto-nav** — `tick` only arms/previews; navigation
   happens solely via `interact` (KeyF). Test: "proximity alone arms but records
   no pushState". ✓
3. **Window/transport injection at the boundary, not module scope** — injected in
   `main.js` only; `portalTrigger.js` + boundary are window-free at module scope. ✓
4. **Allowlist scoped to `['/zone/']`, never `['/']`** — boundary built with
   `['/zone/']`; `sanitizePortalAllowlist` folds `['/']`→`['/zone/']`. ✓
5. **Same-origin only; drop external URLs; no relay-sourced live destinations** —
   `portalActivationInput` drops the external `website`; only the internal
   `/zone/<slug>` route travels. Test: "external URL never navigates". ✓
6. **Constraints preserved** — version → v0.2.181-alpha everywhere; `godMode=false`
   untouched; no new `setTimeout` (HUD uses CSS opacity transition); no new
   `Vector3`/`Matrix4` hot-path allocation (`withinPortalRange` is scalar); debug
   tools ship unconditionally; ESC pause / panel lock / weapon behavior untouched
   (KeyF ≠ KeyE jump); comments use nostrich. ✓
7. **Tests added** — see `tests/portal-trigger.test.js` above. ✓
8. **Docs updated** — todo.md, progress.md, HANDOFF.md, CODE_INDEX.md,
   SDK_DEBUG_INDEX.md, GATEWAY_PROTOCOL.md; continuum regenerated. ✓
9. **Gates run** — fast/foundation/release + `check` ALL GREEN; committed locally. ✓

## What remains deferred (documented, not a regression)

A dedicated in-world portal **MESH** and an SPA `/zone/<slug>` **route handler** so
a hard refresh resolves the target zone. Today `pushState` changes the URL without a
reload, so the running game keeps its state — the hard-refresh resolution is an infra
(server SPA-fallback / router) concern, not a code regression. The trigger seam,
boundary gates, allowlist, and same-origin guarantees are all live and tested.

## Files touched

- NEW `src/engine/gateway/portalTrigger.js`
- NEW `tests/portal-trigger.test.js`
- NEW `torii-v0.2.181-portal-mesh-trigger-report.md` (this file)
- `src/hud.js`, `src/main.js`
- `src/sdk/index.js`, `src/engine/debug/shellReport.js`, `src/engine/debug/toriiDebug.js`
- `tools/testProfiles.mjs`, `tools/regression-check.mjs`
- `src/config.js`, `package.json`, `index.html`
- `src/engine/dashboard/continuumData.js`, `tests/continuum-dashboard.test.js`
- `public/continuum.html`, `public/continuum-data.json` (regenerated)
- `todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`, `GATEWAY_PROTOCOL.md`
