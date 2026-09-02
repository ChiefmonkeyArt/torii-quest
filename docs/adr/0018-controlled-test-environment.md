# ADR-0018 — Controlled test environment (env-driven bot roster override)

**Status:** Accepted
**Version:** v0.2.627-alpha
**Date:** 2026-08-22

## Context

v0.2.623 through v0.2.626 each shipped a fix attempt for two persistent multiplayer bugs — ghost nameplates and hit-registration failures — and none produced a clean repro. Live play-test signal has been noisy: 5 regular dwarf bots plus the Augustink boss all moving and shooting simultaneously, with lag-comp windows, respawn cycles, LOD transitions and death-arc timings interacting. When six hit events land in ~2 s across five moving targets, root cause disappears into background variance.

The user (project owner) explicitly asked to stop guessing at fixes and get a controlled repro rig in place before touching any more gameplay code:

> "so how many times more are we going to do this? … lets get the test environment in now so that we start tackling bugs in a controlled environment"

## Decision

Add two server-side environment variables read at `arenaBotSim` module init:

- `BOT_COUNT_OVERRIDE` — total roster size (regulars + bosses). Non-negative integer. Default: `BOT_COUNT` from `src/config.js`.
- `BOSS_COUNT_OVERRIDE` — how many of the roster are bosses. Non-negative integer. Default: `BOSS_COUNT` from `src/config.js`.

Invalid values (non-numeric, negative, non-integer) fall back to the config default. When either override is active, a one-shot startup log announces the effective values.

`arenaBotSim.spawn()` defaults to the env-driven effective count so callers (`server/arena-ws.js:182`) don't need to be updated when the operator flips the switch. Explicit `spawn(count)` still overrides — kept for unit tests.

Operator flow (no code redeploy needed):

```bash
sudo systemctl edit torii-quest
# Add under [Service]:
#   Environment=BOT_COUNT_OVERRIDE=1
#   Environment=BOSS_COUNT_OVERRIDE=0
sudo systemctl restart torii-quest
```

Result: server spawns 1 regular bot (id=0 → Doc per deterministic `id % 7` name allocator in `botIdentity.js`), no boss, no other dwarves. To restore normal play, `systemctl edit --full`, remove the two lines, restart.

## Scope

Server-only. Two files touched:

- `server/bots/arenaBotSim.js` — env read, config override, `spawn()` default.
- `server/arena-ws.js:182` — drop the explicit `BOT_COUNT` arg to `arenaBotSim.spawn()`.

Client is untouched:
- MP: client learns the roster from `BOT_STATE` snapshots — no compile-time dependency on server bot count.
- SP: still uses config `BOT_COUNT` unchanged.

Wire protocol unchanged. `PROTOCOL_VERSION` unchanged.

## Non-goals

- **This does not fix ghost nameplates or hit-registration.** Those bugs remain open; this ADR only builds the environment to diagnose them cleanly.
- Does not add a client-side test/debug mode.
- Does not remove the Augustink boss code path — it can still spawn under normal config.
- Does not touch the SP path (SP bot count still comes from `src/config.js`).

## Consequences

**Positive:**
- Operator can reproduce a bug with exactly one bot on the field — signal-to-noise ratio for `[SHOT-RESOLVE]` / `[BOT_HIT]` / `[BOT_KILL]` server logs improves dramatically.
- Zero-risk to production: env absent → identical behaviour.
- No compile step to switch between test and prod: `systemctl edit` + restart, ~10 s.

**Neutral:**
- The startup log adds one line when the override is active (intentional — makes it clear on the VPS `journalctl` whether the box is in test mode).

**Negative / risks:**
- If an operator forgets to remove the env vars after a test session, prod runs with one Doc bot until noticed. Mitigation: the startup log is greppable (`journalctl -u torii-quest | grep '\[BOT_SIM\] env override'`); the dashboard's `roster` field on `BOT_STATE` will visibly show one bot.
- `BOT_COUNT_OVERRIDE=99999` doesn't crash but degrades perf. Not gated — trusted-operator surface.

## Verification

`tests/multiplayer/arena-bot-sim-env-override.test.js` — 6 real cases against the actual `arenaBotSim` module (not a mirror), using `vi.resetModules()` per case to force fresh import with mutated `process.env`:

1. No env → defaults match `BOT_COUNT` / `BOSS_COUNT` from config.
2. `BOT_COUNT_OVERRIDE=1 BOSS_COUNT_OVERRIDE=0` → 1 regular bot (id=0, not a boss), HP = `BOT_HP`.
3. `BOT_COUNT_OVERRIDE=0` → empty roster.
4. `BOT_COUNT_OVERRIDE=3 BOSS_COUNT_OVERRIDE=1` → 2 regulars + 1 boss with `BOSS_HP`.
5. Invalid env values (`not-a-number`, `-2`) → fall back to config defaults.
6. Explicit `spawn(count)` arg still wins over the env default.

Test file properly restores `process.env` and resets module registry in `afterEach` so it doesn't pollute the surrounding suite.

Gates: build OK, regression 21/21, vitest 2944/2944 across 223 files.

## Lessons captured for the wider bug-hunt

The user recorded a standing principle this cycle:

> Never guess at root causes or ship speculative fixes. Read the actual code, trace the actual execution path, propose a logical diagnostic pathway before proposing any fix, and only propose a fix when you can point to the exact lines that cause the behaviour.

ADR-0018 is applying that principle at the process level: build the diagnostic environment first, gather real evidence with one moving variable, then propose ADR-0019 for the first bug fix.

## Next steps (not committed by this ADR)

Once v0.2.627-alpha is deployed and the operator confirms the 1-bot rig spawns Doc alone:

1. Reproduce ghost-nameplate bug against one bot.
2. Capture server `[SHOT-RESOLVE]` log lines for the head→body classification bug.
3. Only then propose ADR-0019 with a code-verified fix, not a guess.
