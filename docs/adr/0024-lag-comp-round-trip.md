# ADR-0024 — Lag compensation must count the round trip, not one way

**Status:** Accepted
**Version:** v0.2.633-alpha
**Date:** 2026-08-22
**Type:** Bug fix (hit registration; changes gameplay behaviour)
**Supersedes the `viewLag` derivation in:** v0.2.392 hit-reg work
**Follows:** ADR-0023 (the instrumentation that produced the evidence)

## Context

ADR-0023 instrumented the shot resolver because the hit-reg investigation was
blocked by a diagnostic gap. A play session on v0.2.632-alpha, shooting from
high ground, produced 53 shots: **43 hits (10 head, 33 body), 10 misses**.

Two results fell out immediately.

**Headshots register correctly.** 10 head hits were resolved and logged. The
hat-as-headshot zone from ADR-0023 works as designed; that hypothesis is closed.

**The misses split into two clearly separate populations:**

| bodyGap | headGap | headVert | headHorz | rng | dxz |
|---|---|---|---|---|---|
| 0.000 | 0.075 | −0.242 | 0.350 | 20.9 | 0.25 |
| 0.062 | 0.056 | −0.134 | 0.383 | 23.8 | 0.31 |
| 0.142 | 0.696 | −0.901 | 0.531 | 17.3 | 0.58 |
| 0.372 | 0.405 | −0.223 | 0.722 | 14.2 | 0.78 |
| 0.426 | 0.828 | −0.885 | 0.779 | 30.9 | 0.28 |
| 1.194 | 1.209 | −0.222 | 1.544 | 14.3 | 0.90 |
| 11.103 | 11.067 | +1.271 | 11.346 | 0.0 | 0.30 |
| 14.676 | 15.157 | −6.685 | 13.992 | 33.9 | 0.33 |
| 17.277 | 17.272 | +0.185 | 17.621 | 31.1 | 0.31 |
| 27.917 | 27.951 | −1.406 | 28.266 | 16.1 | 0.25 |

The bottom four missed by **11–28 metres** — one with `rng=0.0`, meaning the bot
was behind the shooter. Those are shots not aimed at a bot at all, not a
registration fault, and are excluded from the rest of this analysis.

That leaves six genuine near-misses. Three were within 15 cm of the body capsule,
with `headHorz` of 0.350, 0.383 and 0.531 against a **0.35 m head radius** — i.e.
passing *just* outside the head collider. In those six, `headHorz` tracks `dxz`
(bot travel during the rewind window) closely: 0.53/0.58, 0.72/0.78, 1.54/0.90.

The statistics alone do not prove causation — n=6, and missing a moving target
naturally skews along its direction of travel, so some correlation is expected
even under perfect compensation. They were treated as a pointer to read the code,
not as a conclusion.

## The actual defect, from the code

Reading the two clocks end to end:

`botNetState.ingest(states, nowMs)` stamps every sample with **`nowMs`, the client
RECEIVE clock** — `b.samples.push({ t: nowMs, ... })`. `sample(nowMs)` then renders
at `renderT = nowMs - DEFAULT_INTERP_DELAY_MS`.

So a snapshot generated on the server at time `s` is stamped `s + ow` (one downlink
trip). Selecting a sample 100 ms back in *receive* time therefore selects server
content from `100 + ow` ago: **the downlink trip is already baked into the stamps.**

The server, in `arena-ws.js`, does:

```
rewindTs = now - min(viewLag, LAG_COMP_MS)      // now = shot ARRIVAL time
viewLag  = DEFAULT_INTERP_DELAY_MS + oneWayMs   // multiplayerHost.viewLagMs()
```

`now` is when the shot *arrived*, one uplink trip after the player clicked. In one
aligned frame, with `fire` = the click instant:

```
seen on screen : fire - interpDelay - ow        (downlink, inside the buffer stamps)
server tests at: (fire + ow) - viewLag          (uplink, to shot arrival)
```

These are equal only when `viewLag = interpDelay + 2*ow`. With a single `ow` the
residual is:

```
(fire + ow) - (interpDelay + ow) - (fire - interpDelay - ow) = ow
```

**The server rewound to a state exactly one one-way trip too recent.** A moving bot
was tested `ow` of travel ahead of where the player saw it. The comment on
`arena-ws.js:535` — "the client ts is already inside viewLag, do NOT subtract it
again here" — is where the double-count was reasoned away: it correctly accounts
for the uplink once, but misses the downlink already carried in the receive stamps.

At the measured `viewLag=164` (so `ow≈64 ms`) and observed bot speeds of 1.5–5.5 m/s,
the error is **0.10–0.35 m of lateral misregistration** — the width of the entire
head collider, and the same magnitude as the three tight head misses above. The
error scales with bot speed, which is why fast lateral movement felt worst and why
the small head zone suffered while the wider body capsule mostly absorbed it.

This also explains why `headVert` was negative on nearly every near-miss without
any vertical bug: the residual is applied along the bot's travel, and these were
long, steeply downward shots.

## Decision

Count the round trip.

```js
// src/engine/multiplayer/multiplayerHost.js
const v = DEFAULT_INTERP_DELAY_MS + 2 * ow;   // was: + ow
```

The 250 ms clamp is unchanged, so the value still lands inside the server's 300 ms
`LAG_COMP_MS` window. `oneWayMs` is itself already capped at 250 by `wsClient`, so
the worst case saturates the clamp rather than overflowing the window. The server
clamps independently as a second guard.

At `ow=64` the shot now reports `viewLag=228` instead of `164`.

### Considered and rejected

- **Use the `clientTs` already on the wire.** The client clock is not synced to the
  server, so `clientTs` needs `serverTsOffset` to be usable, adding a second
  estimated quantity to the path. The existing `viewLag` channel needs no wire or
  protocol change, so it is the smaller correction.
- **Stamp `botNetState` samples with server send time.** More principled, but it
  requires threading `serverTsOffset` into ingest and changes the meaning of every
  existing sample timestamp — a wide blast radius for the same arithmetic result.
- **Widen the head collider.** Rejected outright: it would paper over a clock bug
  by making aim more forgiving, and would corrupt the deliberate hat-zone sizing
  recorded in ADR-0023.

## Scope

- `src/engine/multiplayer/multiplayerHost.js` — `viewLagMs()`: `+ ow` → `+ 2 * ow`,
  with the derivation recorded in the comment.
- `tests/multiplayer/lag-comp-alignment.test.js` — new, 11 cases.

No server change. No wire, protocol, collider or damage change. Peer-vs-peer hit
registration reads the same `viewLag` and is fixed by the same line.

## Consequences

**Positive:** the server now tests the collider at the instant the shooter actually
saw, for both bots and peers. Expected to convert the tight near-misses into hits;
the ADR-0023 instrumentation stays in so the next capture can confirm it by
measurement rather than by feel.

**Negative / risks:** shots are rewound ~64 ms further into the past at typical
latency, which slightly increases "shot behind cover" favouring the shooter — the
standard, accepted trade of lag compensation. On a very poor connection the clamp
binds earlier (at `ow>75` rather than `ow>150`), so beyond that latency the
compensation is again short — bounded by the lag-comp window, not by this change.
Nothing here loosens a collider, so a genuinely bad shot still misses.

**Unblocked:** this was the last live hypothesis for the head-miss reports. The
remaining known issues are unrelated: the gun intermittently not firing, and the
"dead Doc shooting" report.

## Verification

`tests/multiplayer/lag-comp-alignment.test.js`, 11 cases in three groups:

1. **`viewLagMs` contract** — bare interp delay when latency is unmeasured; adds
   two one-way trips (228 at `ow=64`, explicitly asserting it is *not* the old
   164); scales linearly; clamps to 250 on a bad link; never leaves
   `[interpDelay, 250]` for any latency including absurd values. Latency is driven
   through the **real PONG measurement path**, not by poking a field.
2. **The premise, empirically** — using the real `botNetState` with a 1 m/s bot and
   snapshots stamped at `s + ow`, the pose returned by `sample()` is shown to be
   server content from `clientNow - interpDelay - ow`, and explicitly *not* from
   `clientNow - interpDelay`. This proves the downlink is baked into the stamps
   rather than assuming it.
3. **The alignment identity** — `seen` and `tested` coincide exactly under
   `interpDelay + 2*ow`; the old single-trip form leaves a residual of exactly
   `ow`; that residual maps to 0.192 m of lateral error for a 3 m/s bot at
   `ow=64` (more than half the head radius); and alignment holds with no
   accumulated drift as latency varies shot to shot.

Gates: build OK, regression ALL GREEN, vitest **2989/2989 across 229 files**,
three consecutive full runs green.

## Next step

Play a session and shoot moving bots from high ground again — the same conditions
that produced the 18.9% miss rate. In the logs, the three tight misses should now
resolve as hits, and any remaining `headGap` values should be clearly positive
(genuine aim misses) rather than clustered just outside the 0.35 m radius.
