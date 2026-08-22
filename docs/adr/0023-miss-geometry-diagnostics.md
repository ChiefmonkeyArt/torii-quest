# ADR-0023 — Miss-geometry diagnostics for player→bot shots

**Status:** Accepted
**Version:** v0.2.632-alpha
**Date:** 2026-08-22
**Type:** Diagnostic instrumentation (no gameplay change)

## Context

After ADR-0022 restored the MP bot mesh, play testing reported body hits working
well but **head/hat shots intermittently not registering**. A 25-minute live
capture of 51 shots gave a **23.5% miss rate**.

Analysis of that capture ruled out several hypotheses **by reading the code**,
not by guessing:

| Hypothesis | Verdict | Evidence |
|---|---|---|
| Fixed aim-origin height offset | **Ruled out** | miss→hit pairs at identical geometry (miss `dy=2.45`, hit `dy=2.45`) |
| Hat protrudes above the head sphere | **Ruled out** | sphere spans foot+1.20→1.90; banker GLB is only 1.70 tall |
| Rewind snaps to nearest snapshot | **Ruled out** | `sampleBotsAt` interpolates between flanking snaps |
| `footY` not interpolated on rewind | **Ruled out** | `interpRows` blends `footY` with `x`/`z` |
| Client/server time-frame mismatch | **Ruled out** | client renders at `now−100`; server rewinds `now−(100+one-way)`; `viewLag=164` matches |
| Bot movement during rewind (`dxz`) | **No correlation** | miss rate by `dxz` bucket: 42.9%, 16.7%, 0%, 44.4% (non-monotonic) |

The one real correlation is **vertical offset between shooter and target**:

| aim height above bot foot (`dy`) | n | miss rate |
|---|---|---|
| < 1.5 m | 5 | 40.0% |
| 1.5–2.0 m | 20 | **5.0%** |
| 2.0–2.5 m | 22 | 31.8% |
| > 2.5 m | 4 | 50.0% |

The outer buckets are too small to lean on; the meaningful comparison is
**5% when level vs 32% when 2.0–2.5 m above the bot's feet**.

## Problem

The investigation is **blocked by a diagnostic gap**, not by a lack of theories:

1. `[SHOT-RESOLVE]` logged `decision=bot-hit` but **never the zone**, even though
   `resolvePlayerShot` already returns it. A missed headshot was therefore
   indistinguishable from a body hit in every capture.
2. A miss logged only `decision=miss` — never **how far off**. A 4 cm graze
   (lag-comp / aim precision) and a metre-wide shot (framing or occlusion) look
   identical in the log but need completely different fixes.

Guessing further without this data would be unsound.

## Decision

Instrument the resolver. **No collider, damage, authority or wire change.**

1. **Zone on hits** — `botHit=<id>@t=<t>@<zone>`, so headshots are greppable.
2. **Miss geometry** — new `missGeomDiag(origin, dir, rewindTs, now, lagCompMs)`
   in `arenaBotSim`. For the nearest alive bot, **rewound exactly as resolution
   does**, it reports:
   - `headGap` / `bodyGap` — closest approach **minus radius**, so `>0` is the
     miss margin in metres and `<0` means inside the collider
   - `headVert` / `headHorz` — the head miss split into signed vertical and
     horizontal components, so "over the hat" is distinguishable from "beside
     the head"
   - `rng` — range to closest approach

   Ray-vs-capsule-axis distance uses a standard clamped ray/segment closest-point
   solve (`_raySegDist`). Emitted only on a miss, inside the existing rate limit,
   and never consulted for hit resolution.

## Design intent recorded: the hat IS a headshot

The head sphere deliberately reaches **foot+1.90 on a 1.70 m model**. These bots
wear hats, and the hat is **intentionally inside the headshot zone**: they are
small characters, and their size would otherwise be an unfair advantage in a
shooter, so the head zone is deliberately forgiving.

A positive `headVert` near the top of the sphere is therefore **expected and
correct**. This is captured by two tests so it is not "optimised away" later by
someone shrinking the collider to fit the mesh. Verified: a shot at hat height
(foot+1.62) resolves as `zone='head'`.

## Scope

- `server/bots/arenaBotSim.js` — added `_raySegDist`, `missGeomDiag`; exported.
- `server/arena-ws.js` — log zone on hit, miss geometry on miss.
- `tests/multiplayer/miss-geometry.test.js` — new, 11 cases.
- `tests/multiplayer/player-bot-combat.test.js` — **test-only** flake fix (below).

No client change. No gameplay change.

## Test flake fixed (test-only, no production change)

`player-bot-combat.test.js` was failing ~1 run in 3 (two different cases across
runs) while passing in isolation, blocking clean release gates.

Root cause: bot spawn positions use **unseeded `Math.random()`**
(`src/engine/entities/botSim.js:145-146`). The tests pick the highest-X *regular*
bot and fire horizontally along -X from 3–4 m. The **boss** is the only bot
allowed a higher X than that pick, so it can randomly land inside the firing
corridor and intercept the ray — `res.botId` comes back as the boss and the
assertion fails.

Fix: an `isolate(sim, keep)` helper parks every non-target bot 1000 m away so the
corridor is provably clear. The target keeps its real random position, so the
terrain-frame geometry these tests exist to pin is still exercised against
`sampleArenaHeight`. Verified with 8 consecutive isolated runs and 3 consecutive
full-suite runs, all green.

Production seeding of the spawn RNG was considered and **deliberately not done** —
it would change shipped behaviour to fix a test.

## Consequences

**Positive:** the next capture will state, per shot, the zone hit and the exact
miss margin split into vertical and horizontal components. That distinguishes a
lag-comp/precision issue from a framing or occlusion issue directly from the log.
Release gates are now stable.

**Neutral:** slightly longer log lines on misses, within the existing ≤1/sec
per-shooter rate limit. Extra maths runs only on a miss with a nearby bot.

**Negative / risks:** none identified — diagnostics are additive and never feed
resolution. `missGeomDiag` is guarded by `BOT_SIM_ENABLED` and a `typeof` check.

## Verification

- `tests/multiplayer/miss-geometry.test.js` — 11 cases: nearest bot + negative
  head gap on a centre head shot; a shot over the head reported as a positive
  vertical miss; a shot beside the head reported as horizontal; graze vs wide
  miss separated by margin; negative body gap on a chest shot; range to closest
  approach; null on missing origin/dir; non-unit direction tolerated; **hat shot
  resolves as `zone='head'`**; head zone stays generous above the mesh top on
  purpose; zone exposed on resolved hits.
- Gates: build OK, regression ALL GREEN, vitest **2978/2978 across 228 files**,
  three consecutive full runs green.

## Next step

Capture a live session with shots deliberately taken from **high ground**, where
the miss rate is 32%. `headGap`/`headVert` will then say whether those rays pass
just outside the sphere (lag-comp / precision → widen or improve rewind) or well
outside it (framing or occlusion → different fix entirely).
