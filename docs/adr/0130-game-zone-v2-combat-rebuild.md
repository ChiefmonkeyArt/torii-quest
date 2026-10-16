# ADR-0130: Game Zone v2 — rebuild the arena combat layer from scratch

- **Status:** Accepted
- **Date:** 2026-10-16
- **Deciders:** chiefmonkey (operator approval in session, 2026-10-16: "Complete rebuild everything from scratch… 100% new code… point system seems fine for now… ONLY the game zone gameplay changes")
- **Supersedes (for the arena combat layer):** ADR-0006, ADR-0007, ADR-0011, ADR-0013, ADR-0014, ADR-0015, ADR-0016, ADR-0017, ADR-0019, ADR-0020, ADR-0021, ADR-0023, ADR-0024, ADR-0043. Their *goals* carry forward (server authority, locked 9/3 damage, hp ≤ 0 ⇒ dead, no stale bots, env roster overrides); their *mechanisms* are retired.
- **Related:** ADR-0018 (env roster overrides — kept), ADR-0032 (Kami untargetable — kept), ADR-0098 (client suspend on Home — kept), MP-3 score ledger (kept unchanged).

## Context

Operator playtest verdict on v0.2.894: combat is "glitchy and simply not good
enough". Required: consistent head/body shots, bots that die when hit, never a
ghost, never a freeze — "slick, snappy, fast and reactive".

A measured investigation (bench: `tools/gamezone-bench.mjs`, ground truth = the
triangle a ray actually strikes on the animated, skinned GLB) found the faults were
structural, not tuning:

1. **Collider ≠ what is drawn.** Bots were a fixed capsule (r 0.35 m to 1.61 m) plus
   a head sphere, while their clips carried unstripped root motion (Run_and_Shoot
   moves the head ~1 m; Shot_and_Blown_Back 2.5 m; boss Knock_Down 3.7 m). Result:
   regular-bot hit agreement **67 %** (10 % phantom hits, 22 % misses through the
   body), boss **79 %**, and boss headshots were **impossible (0 % head recall)**.
2. **Malformed rig.** `banker-rigged.glb`'s skeleton is half-size against its 1.70 m
   mesh and its "Head" bone drives every vertex from 0.76 m up, so any
   bone-name-based zone is wrong. Zones must be anatomical.
3. **Two simulations.** The client ran its own bot sim and merged server BOT_STATE
   into it, so a bot could be alive on one side and dead on the other (ghosts,
   bots that "won't die").
4. **Wall-clock lag compensation** (`viewLag` from ping estimates) rewound to a
   guessed instant rather than the frame the player saw.
5. **Slow terrain predicates** (~25 µs per sample) called per bot per tick —
   server drain and client hitches.

## Decision

Replace the arena combat layer — and only that layer — with **Game Zone v2**, new
code under `src/gamezone/` and `server/gamezone/`:

- **One authority, one copy of the rules.** `src/gamezone/core/sim.js` (node-pure,
  deterministic, seeded) decides every outcome. The VPS runs it for multiplayer
  (`server/gamezone/gameZoneServer.js`); the browser runs the *same module* for
  single-player (`client/authority.js`). There is no second simulation.
- **Tick-addressed time.** 20 Hz fixed ticks; clients render at a fractional
  `renderTick` two ticks behind the newest snapshot and report that tick when they
  fire. The authority samples the identical pose history (`core/history.js`) —
  no clock sync, no ping maths, rewind capped at 10 ticks (500 ms).
- **Hit what you see.** The client raycasts the bot as drawn: capsule broad phase
  fitted to the skinned geometry, then exact skinned-triangle Möller–Trumbore
  (`client/hitbox.js`); head = rest-pose height ≥ neck line. Root motion is
  stripped from every clip. The shot carries a *claim* `{k, id, zone, dist}`.
- **Validate, don't trust.** The authority checks the claim against a generous
  envelope of where that bot was at the claimed render tick, the claimed distance,
  occlusion, and (for head claims) the impact height. Claimless shots never hit
  bots (no invented hits next to the mesh); peers resolve on a coarse body.
- **The snapshot is the roster.** `client/reconciler.js` makes the set of bot views
  equal the snapshot's id set after every update — the only path that creates or
  keeps a view — so a ghost cannot exist. Death is shown from the authoritative row
  / kill event; client prediction only flashes and is rolled back on rejection.
- **O(1) world.** `core/arenaWorld.js` samples the terrain/play-area predicates once
  into a 0.5 m grid (lazy fill on read + background warm-up; identical values either
  way) and answers footing, walkability, occlusion and LOS from it.
- **Fixed-cost effects.** Tracers and sparks are two pooled draw calls (`client/fx.js`).
- **Wire:** three additive messages on PROTOCOL_VERSION 1 — `GZ_FIRE` (C→S, the only
  combat ingress, rate-limited), `GZ_SNAP` and `GZ_EVENT` (S→C; shot `result`s reach
  only the shooter). Legacy SHOT/HIT/KILL frames are ignored. Spectator nodes still
  receive legacy `BOT_STATE` rows.

**Unchanged by explicit instruction:** the point system (head 9 / body 3, bot 5 HP,
boss 60 HP, player 100 HP, +5 sats per bot kill), the score ledger and SCORE frames,
the world, terrain, NAP zone, gateways, portals, Kami, identity, HUD layout, audio,
player movement, viewmodel art. The gun viewmodel was moved verbatim from
`weapons.js` into `engine/weapons/gunViewmodel.js`.

## Consequences

- **Enables:** bench-measured parity between what is drawn and what is hit; boss
  headshots; one place to change combat rules; deterministic replay tests.
- **Forecloses:** client-authoritative damage of any kind; projectile travel time
  (combat is hitscan with tracer cues).
- **Trade-offs:** clients render 100 ms behind the authority (interpolation buffer);
  exact skinned raycasts cost ~0.2 ms (regular) / ~0.03 ms (boss) per shot, paid only
  on a click. Legacy SHOT-era clients can no longer fight on a v2 node (they still
  connect, move and chat).
- **Enforcement:** `tests/gamezone/*` (core rules, every reject reason, randomised
  no-ghost invariant, lazy-vs-warm world determinism, server routing, bench gates on
  the real GLBs); `npm run bench:gamezone` (strict timing gates);
  regression-check [17] GZ_FIRE-only ingress and [18] damage single source (9/3).

## Alternatives considered

- **Tune the legacy colliders** — capped by root motion and the malformed rig; the
  best capsule-only fit plateaued at ~88 % agreement.
- **Server-side skinned raycasts** — needs the GLBs + animation mixer on the VPS
  (heavy, and the server cannot know each client's exact animation phase).
- **Rebuild the whole world** — rejected by the operator; only the game zone changes.

## Notes

Bench baseline (`docs/gamezone-bench-baseline.json`, 300 rays × 8 poses, seeded):

| Model | Regular hit agree | Regular head recall | Boss hit agree | Boss head recall |
| --- | --- | --- | --- | --- |
| Legacy (≤ v0.2.894) | 67.1 % | 61.8 % | 79.4 % | 0 % |
| v2 coarse (no claim) | 71.3 % | 55.2 % | 79.4 % | 51.5 % |
| **v2 client hitbox** | **99.99 %** | **100 %** | **100 %** | **100 %** |

Validator false-reject on honest claims: 0 % (regular, 6 132 claims; boss, 3 367).
Sim tick (4 players, 6 000 ticks, real arena grid): p50 0.004 ms, p99 0.064 ms,
max 2.8 ms, none over 5 ms. Bundle: arenaRuntime chunk 398.85 → 394.19 kB
(gzip 135.61 → 134.66 kB); server bundle 994 → 978 kB.

Follow-ups: the now-unused bot-collider factories in `physics.js`/`bodies.js`;
the legacy wire types (SHOT/HIT/KILL/BOT_HIT/BOT_KILL) can be dropped once no
spectator node needs them; a live multi-client playtest on the VPS.
