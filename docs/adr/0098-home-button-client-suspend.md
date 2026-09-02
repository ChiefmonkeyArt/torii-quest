# ADR-0098: Home Button Client-Suspend (Not Teardown)

- **Status:** Accepted
- **Date:** 2026-09-02
- **Deciders:** chiefmonkey
- **Related:** v0.2.742-alpha, `src/arenaRuntime.js` (`leaveToTitle` / `resumeFromTitle`), `src/engine/state/clientSuspended.js`, `src/audio.js`, `src/bots.js`, `src/loop.js` (`stopLoop` export), `tests/adr-0098-client-suspend-on-home.test.js`. Supersedes: none. Refines: ADR-0094 (server-always-on presence beacon), because the server world is authoritative.

## Context

In v0.2.741-alpha the arena pause modal's Home button (`#btn-home`) only issued `transition(GAME_EVENT.HOME) + exitPointerLock + resetEnterButton`. It did not:

- halt the render loop,
- suspend the AudioContext,
- disconnect the multiplayer socket,
- or otherwise inform the audio / bot subsystems that the local player was no longer in the world.

Because bots are server-authoritative in MP (`arenaRuntime.js` marks the client "RENDER-ONLY" and defers to server `BOT_STATE` / `BOT_SHOT` relays), server-relayed `mp_botShot` events kept arriving after Home was pressed and kept calling `applyBotShot(...) → playBotShoot()`. Result: audible bot fire on the title screen, and the render loop kept ticking a torn-down UX state.

The naive fix — "tear it all down on Home" — is wrong for this game. Torii Quest's world is a **perpetual, server-authoritative simulation**. Other players may still be in the arena when the local player presses Home; destroying our client state on Home would either kick peers out (if we treat Home as a global shutdown) or leave us with a slow, brittle re-boot on ENTER. Both are unacceptable.

The correct model, stated by the operator:

> "the game and world are perpetual for the public. I (the owner) do not want to destroy their experience and kick them out … suspend is a better option … when I re-enter I should jump right back into the live game."

## Decision

On Home, **suspend the local client without disposing the world**. Server-side simulation, socket, and peer roster are unaffected.

Concretely:

1. Introduce a single shared flag module `src/engine/state/clientSuspended.js` exporting `isClientSuspended()` / `setClientSuspended(v)`.
2. Export `stopLoop()` from `src/loop.js` to let callers halt `requestAnimationFrame` scheduling without touching module state.
3. Add `suspendAudioContext()` / `resumeAudioContext()` exports on `src/audio.js`. Guard `playBotShoot()` with an early return when `isClientSuspended()`.
4. Guard `applyBotShot()` in `src/bots.js` with the same early return so no bullet spawn callback fires either.
5. Add `leaveToTitle()` and `resumeFromTitle()` to `arenaRuntime.js`:
   - `leaveToTitle()` sets the suspended flag, suspends audio, calls `stopLoop()`, exits pointer lock. It does **not** touch `_mp` or dispose world state.
   - `resumeFromTitle()` clears the flag, resumes audio, and restarts the loop if stopped.
6. Wire `#btn-home` to call `leaveToTitle()` **before** `transition(GAME_EVENT.HOME)`. Wire `enter()` to call `resumeFromTitle()` before its normal boot handoff.

The multiplayer socket is deliberately **not** dropped. The `_mp` creation lives inside the once-per-page `boot()` and is not re-runnable; a drop-and-redial after Home would leave a subsequent ENTER with no bots and no peers, which is worse than the alternative. Keeping the socket alive costs only idle `BOT_STATE` bandwidth while suspended; the audio/bots guards short-circuit incoming SHOT events as belt-and-braces.

## Consequences

- **Enables:** instant ENTER-after-Home resume, no audio bleed, peers unaffected, world scene stays warm, single-source truthy suspend flag reusable by any future subsystem (particles, VFX, HUD tickers, etc.).
- **Forecloses:** full "cold" boot on Home (deliberately — that is what page reload is for). If we ever need a hard local reset without a reload, it will need its own explicit path, not `leaveToTitle`.
- **Trade-offs:** the local client remains a ghost in the server's roster while at title; peers see a stationary avatar rather than a departure. Acceptable per the perpetual-world model.
- **Enforcement:** `tests/adr-0098-client-suspend-on-home.test.js` locks (a) `stopLoop` semantics and idempotency, (b) the `clientSuspended` flag shape, (c) the presence of the guards inside `playBotShoot` and `applyBotShot` as the first statement, (d) the `leaveToTitle` / `resumeFromTitle` bodies, (e) the `#btn-home` handler order (`leaveToTitle` before `transition(GAME_EVENT.HOME)`), and (f) `enter()` calling `resumeFromTitle` before its own `transition(...)`. A refactor that breaks any of these breaks the test.

## Alternatives considered

- **Full teardown on Home** (dispose terrain, colliders, disconnect socket). Rejected: perpetual-world model, expensive re-boot, would evict peers if generalised.
- **Extract MP wiring into a re-callable `wireMultiplayer()` seam and drop + redial on Home.** Rejected for this slice as much larger refactor for negligible user benefit; the socket-keeps-open model is strictly simpler and already tested. Left as an option for a future ADR if we need to change server auth or renegotiate identity mid-session.
- **UI-only fix** (grey out the audio button etc.). Rejected: the render loop and bot event handlers were the actual leak; a UI patch would not stop the audio.

## Notes

- Regression-check gate [5] requires ≥2 occurrences of `EXPECTED_VERSION` in `index.html`; both were bumped to `v0.2.742-alpha` (`#ver` label + `#update-preview-body` current-version line).
- Version markers bumped in lockstep: `src/config.js`, `package.json`, `public/sw.js` (`CACHE_VERSION`), `src/engine/dashboard/toriiQuestDashboardData.js` (`TORII_QUEST_VERSION` + curated smoke fixtures), `NEXT_ACTION_STATE.json`, `MVP_APPROVAL_STATE.json`.
- Continuity docs (`torii-quest-progress.md`, `torii-quest-todo.md`, `torii-quest-handoff.md`) prepend the new "Current version" line and demote the prior one.
