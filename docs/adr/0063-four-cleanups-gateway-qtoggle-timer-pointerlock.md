# ADR-0063 — Four console-noise / UX cleanups (Gateway auto-open, Q-toggle, Clock→Timer, pointer-lock rejection)

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** chiefmonkey
- **Related:** `src/main.js`, `src/arenaRuntime.js`, `src/engine/plebeian/marketStall.js`, `src/loop.js`, `src/input.js`, `tests/adr-0063-regressions.test.js`, ADR-0036 (product panel proximity→open trigger)

## Context

A retest of `v0.2.692` surfaced six console warnings / UX papercuts. Four are
genuine code defects we can fix cleanly; two are library-internal or
environmental and are intentionally left alone (documented below so a future
reader doesn't reopen them).

### 1. Gateway Setup panel auto-opens on login (UX)

After Nostr login resolves and the player clicks ENTER, the Gateway Setup
settings panel pops open unprompted — only for the confirmed node owner, and
only once per browser session (sessionStorage flag). It read as a surprise
interrupt the moment the player pressed ENTER, right at the entry into the
world. The user wants the panel reachable only via explicit action (settings
icon / KeyM menu), never auto-popped.

### 2. KeyQ only opens the product HUD, never closes it (UX)

The ADR-0036 proximity trigger drives the in-world PRODUCT sign. Walking into
range raises a "Press Q to view products" prompt; pressing Q opens the
auction-panel + the three owner boards. But Q had no close path — the player
had to use the small close button (which itself only closed the market panel,
leaving the boards open) or walk out of range. The user wants Q to be a toggle:
first press opens, second press removes everything.

### 3. THREE.Clock deprecation warning (console)

three r183 deprecated `THREE.Clock`; `new THREE.Clock()` logs a deprecation
warning on construction. `loop.js` is the only construction site in the repo
(`new THREE.Clock()` at `loop.js:21`). The replacement, `THREE.Timer`, has the
same per-frame delta semantics (`update(ts)` + `getDelta()`) plus built-in page
visibility handling (delta clamped to 0 while the tab is hidden).

### 4. Pointer Lock NotAllowedError (console)

`input.js` `requestLock(el)` called `el.requestPointerLock()` without catching
the returned Promise. Modern browsers resolve `requestPointerLock` to a Promise
that rejects with `NotAllowedError` when the call happens outside a user
gesture — which happens on the ENTER-TORII entry path, where the canvas click
that started the gesture has expired by the time the async bootstrap calls
`requestLock`. The rejection was uncaught and logged on every entry.

### 3 (rapier) and 5 (relay) — left as-is

- **Rapier deprecation warning** (`@dimforge/rapier3d-compat`): the warning
  fires *inside* rapier's own `init()` wrapper — it passes embedded WASM bytes
  as a `Uint8Array` to `__wbg_init`, which warns. Our `RAPIER.init()` call in
  `physics.js` takes no parameters, so `init({})` does not silence it. Only a
  rapier upgrade or library patch would — both risky for a cosmetic warning
  that does not affect physics behaviour. Left as-is.
- **WebSocket relay failures** (`damus.io`, `nostr.band`): these are
  network-level — the relays are temporarily unreachable or rate-limiting. The
  existing `plebeianRelay.js` retry logic (3s backoff) already handles them
  gracefully and the panel falls back to the "Waiting for relay…" state. Not a
  code bug; left as-is.

## Decision

1. **Gateway auto-open removed.** Delete the login-resolved auto-open block in
   `main.js` (the `if (owner && !getActiveWorld() && !hasShownThisSession())
   { setShownThisSession(); _openHomepageStub(); }` block). The Gateway Setup
   tab remains reachable any time via the title-screen settings icon and the
   in-game KeyM menu — both explicit user actions. The now-unused
   `hasShownThisSession`/`setShownThisSession` import is removed.
2. **Q toggles.** Add an `isMarketActive()` getter to `marketStall.js`
   (reflects the existing `_active` flag). In the arenaRuntime KeyQ handler:
   if the market panel is open, close *both* the market panel and the boards
   (`setMarketActive(false); setBoardsActive(false)`) — this works regardless of
   range, so the player can close the panels even after stepping out of the
   prompt radius. If closed, fall through to the existing
   `_productPanelTrigger.interact()` (which only opens when in range). The
   trigger module itself is unchanged.
3. **Clock → Timer.** `loop.js` constructs `new THREE.Timer()` instead of
   `new THREE.Clock()`. `_tick` now takes the rAF `timestamp` and calls
   `_timer.update(timestamp)` before `_timer.getDelta()`. The existing
   `Math.min(dt, 0.05)` cap bounds the first-frame / post-freeze delta, so
   behaviour is unchanged from Clock. (The `Timer.connect(document)` page-
   visibility bonus is left unused to keep the change minimal; the cap already
   bounds hidden-tab deltas the same way Clock did.)
4. **Pointer-lock rejection caught.** `requestLock` now guards on a real
   element (`typeof el.requestPointerLock !== 'function'`) and catches the
   returned Promise (`p.catch(() => {})`), plus a synchronous `try/catch` for
   older browsers that throw instead of returning a Promise. Pointer lock still
   engages on the next real canvas click (a fresh user gesture) — the entry
   flow is unchanged, just quieter.

## Consequences

- The Gateway Setup panel no longer interrupts login. Node owners who relied on
  the once-per-session reminder can still reach it from the settings icon or
  KeyM menu.
- Q is now a true open/close toggle for the whole product HUD surface (market
  panel + boards). The in-panel close button still closes only the market panel
  (unchanged); Q is the "close everything" action.
- The render loop's delta semantics are identical (same cap, same first-frame
  behaviour). The only observable difference is the absence of the Clock
  deprecation warning on construction.
- Pointer-lock entry failures no longer log; the first click still may not
  engage lock (gesture expired), same as before, but silently — the next click
  succeeds.

## Tests

`tests/adr-0063-regressions.test.js` — four source-contract guards (same pattern
as `sw-app-shell.test.js` / `loop-fail-closed.test.js`): main.js no longer calls
the session-flag helpers or the auto-open condition; arenaRuntime's KeyQ
handler checks `isMarketActive()` and closes both panels when open; loop.js uses
`THREE.Timer` (not Clock) and calls `update()` before `getDelta()`; and
`input.js` `requestLock` guards the element and catches the returned promise.
All four pass; the existing 3371-test suite still passes.
