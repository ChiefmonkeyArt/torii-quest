# ADR-0021 — MP is authoritative: never render the local bot roster

**Status:** Accepted
**Version:** v0.2.630-alpha
**Date:** 2026-08-22
**Supersedes the fix intent of:** ADR-0019, ADR-0020 (both correct in isolation, both wired to the wrong branch)

## Context

Three play-test bugs persisted across v0.2.626 → v0.2.629 despite the server being
configured with `TEST_MODE=true BOT_COUNT=1 BOSS_COUNT=0`:

1. Augustink standing frozen in the water.
2. "All the bots still in game, frozen."
3. Floating nameplates not attached to any visible bot.

ADR-0019 cleared `_botNet`. ADR-0020 additionally cleared the `bots[]` wrapper
array and its colliders. Neither changed the observed behaviour at all.

## Evidence

Live server logs during the failing session (`journalctl -u torii-arena-ws`) show
every `[SHOT-RESOLVE]` line carrying `bot=0` and nothing else — the server had
exactly one bot, id 0, for the whole session. The client screenshot simultaneously
showed Augustink plus additional bots, and the HUD read `v0.2.629-alpha`, so the
new client was definitely live.

Conclusion: the extra bots were never server entities. The client was creating
them itself.

## Root cause

`initBots()` (`src/arenaRuntime.js:1077`) runs unconditionally at world start,
before any MP connection exists, and inside `preloadBotModel().then(...)` calls:

```js
sim.spawnAll(BOT_COUNT);   // CLIENT config: 5 regulars + the Augustink boss
```

pushing all six wrappers — models **and** nameplate sprites — into `bots[]`.

MP connects later, at which point `setBotNetMode(true)` fires
(`arenaRuntime.js:1367`) and `tickBots` switches permanently to the `_netMode`
branch:

```js
if (_netMode) { _tickNet(dt); return; }   // renders ONLY server rows
```

The local sim never ticks again. Every locally-spawned bot the server does not
have therefore stops updating and remains in the scene forever, frozen at its
spawn position with its nameplate still drawn each frame. Augustink's client-side
spawn point is in the water — hence bug 1. The frozen regulars are bug 2. Their
still-rendered labels are bug 3.

**Why ADR-0019/0020 did nothing:** both cleared on `setBotNetMode(false)` — the
*disconnect* branch, which never runs during normal play. The stale bots are
created *before* MP turns on and needed clearing when MP turns **on**.

## Decision

In MP the server is authoritative; the client must render only server rows.

1. `setBotNetMode(on)` now tracks the transition and clears the roster on the
   **OFF→ON** edge as well (`_botNet.clear()` + `_clearAllBots()` + boss-bar
   reset). Guarded on the edge so a repeated `setBotNetMode(true)` cannot wipe
   live server rows. The ADR-0019 ON→OFF clear is retained.
2. Three spawn guards (`if (_netMode) return;`) close the async race, since MP can
   connect while the GLBs are still streaming:
   - the `preloadBotModel().then(...)` continuation that calls `sim.spawnAll`,
   - the late `bossReady.then(...)` boss attach (~7.6 MB, resolves last — the
     exact frozen-Augustink-in-water path),
   - the `.catch(...)` capsule fallback.

Without the guards, the local roster is simply re-created after the entry clear
and freezes again.

## Scope

`src/bots.js` only — the netMode transition plus three guards. No server change,
no wire-protocol change, no collider/damage/authority change.

Single-player is unaffected: `_netMode` stays false, so the local roster spawns
exactly as before (covered by a regression case in the test).

## Consequences

**Positive:** frozen bots, the water-bound Augustink, and orphan nameplates are
all eliminated at the source. In MP the rendered roster now matches the server
exactly, which finally makes the `BOT_COUNT_OVERRIDE`/`BOSS_COUNT_OVERRIDE` test
rig (ADR-0018) actually control what the player sees.

**Neutral:** in MP the arena is empty for the few hundred ms between connect and
the first `BOT_STATE` snapshot, instead of showing local placeholder bots.
Correct behaviour — those placeholders were never real.

**Negative / risks:** none identified. If MP ever needed client-predicted bots,
this would have to be revisited, but `_tickNet` is explicitly render-only.

## Verification

- `tests/multiplayer/local-roster-mp-authority.test.js` — 6 cases modelling the
  real control flow: drops the local roster incl. Augustink on MP entry; renders
  only the server's bot 0; does not re-spawn when preload resolves after MP entry;
  does not attach the late boss GLB; still spawns the full roster in SP;
  idempotent on repeated `setBotNetMode(true)`.
- Gates: build OK, regression ALL GREEN, vitest 2959/2959 across 226 files.

## Process note

Two consecutive versions shipped a fix for the wrong branch because the failing
behaviour was reasoned about from the teardown path instead of being traced to
where the bots were *created*. The server log line `bot=0` — available the whole
time — was the decisive evidence and should have been read before the first fix.

## Still open

- "Dead Doc shooting at me" — needs bot-shot logging.
- Gun intermittently not firing — separate client weapon bug.
- Hit-reg tuning: many `decision=miss` lines with `dy≈1.9` warrant review of
  aim-origin height vs bot foot height.
