# Torii Quest — v0.2.240-alpha Travel Gateway Entry Repair Report

**Slice:** Restore live **ENTER ARENA** after v0.2.239 by making the new travel
gateway asset optional/fail-soft and making the service-worker precache resilient,
so a single un-fetchable decorative asset can never block boot or arena entry.

---

## 1. Symptom (live, post v0.2.239)

- Live URL `https://torii-quest.pplx.app`, version visible `v0.2.239-alpha`.
- Clicking **ENTER ARENA** → brief loading/spinner → stayed on the menu.
- No 3D canvas, no URL change; browser smoke described it as a silent no-op.
- LOGIN (v0.2.236 decoupling) still worked; v0.2.238 Enter-Arena had passed.

## 2. Root cause

The regression was **not** in the arena GLB load itself (that was already async
with an error callback). It was in the **service-worker precache**:

`public/sw.js` install did `cache.addAll(PRECACHE_ASSETS)`. `addAll()` is
**atomic** — if any single entry fails to fetch, the *entire* promise rejects.
v0.2.239 added the new, large `/torii-gateway-experience.glb` to that list. On a
fresh cloud deploy that asset can lag CDN propagation / fail to fetch, so:

1. `addAll` rejects → the `install` `waitUntil` rejects → **`self.skipWaiting()`
   never runs** → the new SW never activates.
2. The previous (v0.2.238) SW stays in control, serving cached assets while the
   freshly deployed `index.html` (network-first) points at the new content-hashed
   bundle/wasm — a **mismatched bundle/wasm pair**.
3. ENTER ARENA awaits `initPhysics()` (Rapier **WASM** fetch). With the SW upgrade
   wedged, that fetch fails → the `elEnterBtn` bootstrap **`catch`** runs →
   button resets → back to the menu (the observed spinner-then-no-op).

This is the classic atomic-`addAll` PWA footgun the existing `sw.js` header
comment already warns about for the app shell — extended here to a binary asset.

## 3. Fixes

### a) Service worker precache is now fail-soft (`public/sw.js`)
Replaced the atomic `cache.addAll(PRECACHE_ASSETS)` with an **independent per-asset
add** that swallows individual failures:

```js
caches.open(CACHE_NAME)
  .then(cache => Promise.all(
    PRECACHE_ASSETS.map(asset =>
      cache.add(asset).catch(err => {
        console.warn('[sw] precache skipped (non-fatal):', asset, err);
      })
    )
  ))
  .then(() => self.skipWaiting())
```

One bad/decorative asset is now simply skipped (and served from network on demand
by `cacheFirst()`), and `skipWaiting()` always runs — the upgrade can never wedge.
`CACHE_VERSION` bumped to `tq-v0.2.240-alpha`.

### b) Travel gateway GLB load hardened strictly fail-soft (`src/arena.js`)
`_buildTravelGateway()`:
- The turquoise procedural fallback is added to the scene **immediately**.
- The fallback is removed and the real model added **only after a fully successful
  load + process** (swap, not pre-remove) — a processing throw can never leave the
  scene with neither model.
- Three failure paths — loader construction (`loader-init-error`), GLTF load
  (`load-error`), and onLoad processing (`process-error`) — all route through one
  `markGatewayFallback()` that logs a **specific `console.error`** and sets
  `window.__toriiTravelGatewayFailed` / `__toriiTravelGatewayFailReason` so smoke
  harnesses can assert the fallback path was taken.
- The decorative gateway never blocks boot or entry.

### c) Placement preserved
The travel portal trigger, rings, spinning diamond, beam, detection zone and
"Press F to travel" prompt remain anchored at `TRAVEL_GATE_X` (= 40), and the
portal mesh is still built from `_portalTrigger.portalPos()`. The entrance
`torii-gate.glb` stays the non-travel NAP marker. No gameplay placement changed.

## 4. Tests

- **New:** `tests/travel-gateway-entry-repair.test.js` (10 tests) — asserts the SW
  precache is non-atomic (no `addAll(PRECACHE_ASSETS)`, uses `PRECACHE_ASSETS.map`
  + per-asset `cache.add().catch()`, still calls `skipWaiting()`); the GLB load is
  fail-soft (fallback added before load, removed only on success, all three failure
  paths + loggable error + `__toriiTravelGatewayFailed`); and the trigger/mesh stay
  anchored at `TRAVEL_GATE_X`.
- **Preserved:** `tests/travel-gateway-placement.test.js` (v0.2.239) still green.
- **Full suite:** `npx vitest run` → **1670 passed (1670) / 101 files (101)**.
- **`npm run check`** → **ALL GREEN (15/15)** incl. `[5]` version markers
  v0.2.240-alpha (config.js + sw.js `tq-v0.2.240-alpha`), `[2]` godMode false,
  `[3]` setTimeout allowlist (nostr.js + hud.js only — none added), `[4]` no new
  Vector3/Matrix4 in foundation modules, `[14]` docs consistency.
- **`npm run test:release`** (build + vitest + check + bundle:report +
  handoff:status) → **EXIT 0**; bundle advisory unchanged (rapier chunk over warn
  limit, tracked not gated).
- Curated counts synced: `CURRENT_TEST_STATUS` (continuumData.js) +
  `DEFAULT_TEST_STATUS` (mvpReadiness.js) → 1670/101; `NEXT_ACTION_STATE.json`
  regenerated (version v0.2.240-alpha).

## 5. Manual test notes

No live browser in this environment; the fix is verified by contract tests and a
clean production build. Expected live behavior after deploy: the new SW installs
and activates even if the gateway GLB is briefly un-fetchable, ENTER ARENA proceeds
through `initPhysics()` into the 3D arena, and the far-side gateway shows the
turquoise procedural fallback until the GLB loads (then swaps in). If the GLB never
loads, the fallback persists, a specific error is logged, and entry is unaffected.

## Verdict

**SHIP** — root cause identified and fixed, full release gate green
(1670/101, check 15/15, test:release exit 0), constraints satisfied, v0.2.236 and
v0.2.238 fixes preserved. No deploy/publish/push performed (left to the main agent).
