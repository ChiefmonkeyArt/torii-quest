# ADR-0019 — Stale-bot cleanup + TEST_MODE instant respawn

**Status:** Accepted
**Version:** v0.2.628-alpha
**Date:** 2026-08-22

## Context

v0.2.627-alpha shipped the `BOT_COUNT_OVERRIDE` / `BOSS_COUNT_OVERRIDE` test rig. The first clean single-bot play test surfaced two things:

1. **Frozen "Augustink" (and other) nameplates.** With `BOSS_COUNT_OVERRIDE=0` the server spawned only Doc, yet the client still rendered a floating "Augustink" label over the water. Augustink is the boss (`BOSS_NAME`, config.js:87) and should not have existed that session.

2. **Slow test loop.** Each kill waits out the death arc (~2.67 s blowback) plus an 8 s respawn timer before the bot is back — ~10 s of dead time per kill, which makes iterative hit-reg testing painful.

Both were diagnosed from the code, not guessed.

## Root cause (stale nameplates)

`src/engine/entities/botNetState.js` exposes `clear()` and `remove()`, but **neither is called anywhere in the codebase**. The client bot map is populated by `ingest()` and grows monotonically.

`setBotNetMode(false)` (src/bots.js) runs on WebSocket close and only resets boss-bar tracking — it never clears the interpolation buffer. So when the server restarted with a reduced roster, the client reconnected but kept every bot from the previous session (including the boss, id=4, `alive=true`, last-known position). The new server never sends a snapshot for id=4, so it lingers forever, rendered every frame with a visible nameplate.

This is why v0.2.623–626 all failed to fix the ghost nameplates: none touched the bot-map lifecycle.

## Decision

### 1. Clear the bot map on disconnect (production bug fix)

In `setBotNetMode(false)`, call `_botNet.clear()`. `_botNet` is MP-only (SP reads `sim.bots` directly), so clearing it on disconnect cannot affect single-player.

### 2. `TEST_MODE` env var (one-stop test flag)

A single `TEST_MODE` flag on the server that:

- Defaults the roster to **1 regular bot / 0 bosses** (granular `BOT_COUNT_OVERRIDE` / `BOSS_COUNT_OVERRIDE` still win if set).
- Enables **instant respawn**: `killBot` skips the death arc (no blowback launch, `_isDying=false`) and sets `respawnTimer=0`, so the bot revives on the next tick instead of after 8 s.

Accepted values: `1`, `true`, `yes`, `on` (case-insensitive). Absent → `false`, production byte-identical.

## Scope

Three files:

- `src/bots.js` — `_botNet.clear()` in `setBotNetMode(false)`.
- `server/bots/arenaBotSim.js` — read `TEST_MODE`, default roster to 1/0, pass `TEST_MODE` into the sim config.
- `src/engine/entities/botSim.js` — destructure `TEST_MODE` (default false); `killBot` short-circuits to instant respawn when true.

Wire protocol unchanged. Client unchanged (the client already handles a fast alive→dead→alive flip correctly: the alive branch calls `bot.model.show()` on the respawn transition). `PROTOCOL_VERSION` unchanged.

## Operator flow

```bash
sudo systemctl edit torii-arena-ws
# [Service]
# Environment=TEST_MODE=1
sudo systemctl restart torii-arena-ws
```

One flag replaces the two-override setup. To restore production, remove the line and restart.

## Consequences

**Positive:**
- Ghost nameplates from a changed roster are gone — the stale-map fix is a genuine production bug fix, not test-only.
- Test loop is ~10 s faster per kill (no death arc, no 8 s respawn).

**Neutral:**
- On a brief WebSocket drop without a server restart, clearing the map causes a one-frame bot flicker before the next snapshot re-populates. Acceptable.

**Negative / risks:**
- `TEST_MODE=1` left on in production yields a 1-bot instant-respawn arena until removed. Mitigated by the startup log (`[BOT_SIM] env override active: TEST_MODE=true …`) and the visibly reduced roster.

## Verification

- `tests/multiplayer/bot-test-mode-respawn.test.js` — 4 real cases against the actual `createBotSim` module: TEST_MODE sets `respawnTimer=0` + `_isDying=false`; revives on the next tick; default (false) keeps the 8 s respawn + death arc; TEST_MODE does not alter regular bot stats.
- `tests/multiplayer/arena-bot-sim-env-override.test.js` — 2 new cases: `TEST_MODE=1` alone → 1 regular bot / 0 bosses; `TEST_MODE=1` does not override an explicit `BOT_COUNT_OVERRIDE`.
- Gates: build OK, regression ALL GREEN (21/21), vitest 2950/2950 across 224 files.

## Still open (not addressed here)

- **"Doc floating above a cube"** — a *current* bot with a hidden body but visible nameplate. Separate from the stale-map bug; needs its own diagnosis.
- **"Dead Doc shooting at me"** — `onBotShot` broadcasts `BOT_SHOT` but logs nothing, so it can't be confirmed from journalctl alone; needs bot-shot logging or client-console correlation.
- **Gun intermittently not firing** — separate client-side weapon bug, to be diagnosed after the rig is clean.
