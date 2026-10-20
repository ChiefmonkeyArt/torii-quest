# ADR-0138: Human aim, agile bots, complementary incoming tracers

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** chiefmonkey: "bots could be more adaptive and agile… shots are natural not 100% on target, but errors and sometimes just close… Their bullets could be a bit more colourful and noticeable, complimenting opposite to ours".
- **Builds on:** ADR-0130 (shared authority), ADR-0136 (tracers, bot awareness).
- **Points:** unchanged and frozen (head 9, body 3, bot shot 6, boss shot 14, HP 5/60/100, +5 sats).

## Context

- **Bot aim.** Bots aimed straight at your current position plus a uniform random cone. Hits on still targets were laser-like, misses on moving targets were scattered, and nothing the player did changed the bot's aim.
- **Bot movement.** Bots strafed on a slow, regular rhythm and never reacted to being shot at.
- **Incoming tracers.** A bot round flying at you is seen end-on, so its streak shrank to a few pixels however it was coloured. Black/red also didn't contrast with your orange/purple.

## Decision

1. **Human aim** (`src/gamezone/core/sim.js`; tunables in `constants.js`):
   - **Reaction lag:** bots aim where they saw you 0.3 s ago (6 ticks; the boss 7).
   - **Error:** a slowly wandering offset (Ornstein–Uhlenbeck, about 1.6 Hz) plus a per-shot twitch, in metres at the target. Sigma is `max(0.22 m, aimErr × range)`; beyond 15 m it grows at 40%.
   - **Situation multipliers:** settled ×0.75, bot moving ×1.35, dodging ×1.9, just hurt ×1.7 (0.6 s), first shot ×1.4, capped at ×2.2.
   - **Lead:** while you run one way the bot learns your lead (0.6/s, up to 0.9). Stopping or reversing resets it.
2. **Agility:**
   - **Dodge:** a hit, or a round passing within 1.4 m, can trigger a 0.25–0.6 s side-step at run speed, away from the bullet line. The chance starts at 50%, rises with recent "threat" (capped at 85%), and is scaled by `agile` (boss 0.35). There's a 1.2 s cooldown.
   - **Jukes:** strafe reversals every 0.45–1.4 s at a varied pace.
   - **Wounded:** below 50% HP a bot backs off on a diagonal while still firing.
3. **Incoming tracers** (`src/gamezone/client/fx.js`):
   - bot rounds use the complements of yours: a cyan core (opposite orange) and a lime glow (opposite purple);
   - the streak is longer and wider;
   - every tracer has a camera-facing head glow with a minimum on-screen size, so a round coming straight at you still reads;
   - still one mesh and one draw call; now 8 vertices per tracer.
4. **Near-miss whizz** (`audio.playNearMiss`, `feel.nearMiss`):
   - a bot round that passes within 1.3 m of your head, without ending on you, plays a short falling band-passed noise "whizz";
   - it's panned to the side the round passed;
   - at most one every 350 ms, sharing one noise buffer.
5. **Debug:** `ToriiDebug.gz.stats.botShots` and `ToriiDebug.gz.feel.whiz`.

## Consequences

Headless pressure, 6 seeds × 5 minutes on the real arena:

| Player | v0.2.902 hit % | v0.2.903 hit % | v0.2.903 misses within 2 m |
|---|---|---|---|
| Standing still | 28 | ~32–35 | ~89% |
| Strafing | 12 | ~21 | ~82% |
| Juking | 13 | ~19–22 | ~86% |

- Bots no longer land every shot on a still target, and their misses now mostly pass close.
- Moving remains the best defence, and a sudden change of direction defeats the lead they've learned.
- Tests:
  - `tests/gamezone/bot-aim-agility.test.js`: aim rate bounds, median miss under 1 m, moving harder to hit, lead learn and reset, dodge happens but not always, jukes irregular, wounded retreat, whizz cases and wiring.
  - `tests/gamezone/tracers.test.js`: complementary hues and the head glow minimum size.
