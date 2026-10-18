# ADR-0136: Visible tracers, bots that fight back, crates that aren't black

- **Status:** Accepted
- **Date:** 2026-10-18
- **Deciders:** chiefmonkey ("Fix the dark crates next… all the things that improve gameplay… orange/purple bullet tracers… tastefully done… Bots are a bit docile and should also fire back and look more intelligent… their bullets too should be obvious… maybe a black/red").
- **Builds on:** ADR-0130 (Game Zone v2 shared authority), ADR-0131 (combat feel), ADR-0133 (bot colour).
- **Points:** unchanged and frozen: head 9, body 3, bot shot 6, boss shot 14, bot 5 HP, boss 60 HP, player 100 HP, +5 sats per kill.

## Context

- **Tracers.** Tracers were `THREE.LineSegments`. WebGL draws lines 1 px wide on every platform, so shots read as hairlines.
- **Bots.** Bots saw only 14 m and fired single, very loose shots every 2.6 s. They ignored a player who shot them from beyond their sight. A headless pressure run (4 seeds × 5 min) measured it: a player shooting bots from range drew 0.1 engaged bots on average and took 1.4 damage per minute.
- **Crates.** The crates were a flat `#4a4458` slate, about 7% reflectance. Under the warm low sun their shaded faces rendered near-black.

## Decision

1. **Ribbon tracers** (`src/gamezone/client/fx.js`):
   - one camera-facing ribbon mesh in one draw call, with a fixed pool and zero allocation per shot;
   - a short streak with a hot core and a soft glow travels at bullet speed, lands and fades;
   - **your rounds**: orange core, purple glow (240 m/s);
   - **bot rounds**: black core, red glow, wider and slower (110 m/s) so incoming fire is obvious;
   - width never drops below about 1.5 px at range;
   - a round that hits you stops 1.5 m short of the camera;
   - colours are linear and converted to the output colour space; no tone mapping.
2. **Bot awareness** (`src/gamezone/core/sim.js`, the shared authority, so single-player and the VPS behave the same):
   - **Hit reaction:** a shot bot hunts its attacker for 6 s, looking up to 45 m away. Idle bots within 14 m of it join in.
   - **Memory:** a bot runs to where it last saw you for 3.5 s.
   - **Reaction beat:** 0.45 s before the first shot at a newly spotted target.
   - **Bursts:** regular bots fire 2-round bursts, 0.16 s apart; the boss fires single heavy shots.
   - **Settled aim:** after 0.9 s on a target moving at no more than 1.2 m/s, spread tightens (×0.45 regular, ×0.4 boss). Moving is how you stay hard to hit.
   - **Fan-out:** engaged bots side-step toward their own golden-angle slot on a 7.5 m ring around you instead of stacking up.
   - **Sight:** regular bots 20 m (was 14), boss 22 m.
3. **Crates** (`src/engine/render/crateLook.js`): one shared wood material with a 128² procedural canvas texture (planks, frame, brace, nails). It's drawn once, adds no download, and is used by arena and dynamic crates. UVs are scaled per box so big crates read as stacks of ~1.2 m crates. The data component colour matches.
4. **Debug:** `ToriiDebug.fxTimeScale(k)` slows effects so tracers can be inspected and captured.

## Consequences

Headless pressure run, damage per minute, before → after:

| Player behaviour | Damage per minute | Engaged bots |
|---|---|---|
| Standing still | 30 → 76 | |
| Strafing | 42 → 69 | |
| Shooting bots from range | 1.4 → 12 | 0.1 → 1.0 |

A passive player now dies about every 1.5 minutes instead of every 3–4. Moving still beats standing.

All tunables live in `src/gamezone/core/constants.js`.

Tests:
- `tests/gamezone/tracers.test.js`: ribbon, colours, travel, landing and fade, minimum width, stop-short, pool, crates.
- `tests/gamezone/bot-awareness.test.js`: alert and neighbours, reaction beat, bursts and frozen damage, settled aim, chase, forget.
