# ADR-0010: Crosshair, ESC, and pointer-lock baseline is v0.2.605

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `src/arenaRuntime.js`, `src/input.js`, `index.html`,
  ADR-0001 (state FSM), ADR-0002 (event bus)

## Context

Between v0.2.606 and v0.2.620, a series of well-intentioned "hardening"
edits touched pointer-lock request handling, ESC pause/quiet-pause
gating, boot-order guards, and the SW entry-chunk normalisation. The
cumulative effect was that in the shipped v0.2.620 build the crosshair
never activated and ESC did not pause. Multiple attempts to patch
forward (v0.2.618–v0.2.620) failed. On 2026-08-21 we performed a
literal `git reset --hard v0.2.605-alpha` and shipped it as
v0.2.621-alpha, at which point crosshair and ESC worked again.

## Decision

The **behavioural contract** for crosshair activation, ESC handling,
and pointer-lock lifecycle is **the code as it stood at tag
`v0.2.605-alpha`** — the same code now living at HEAD on
`phase0m-menu-shell` behind v0.2.621-alpha (plus version-string bumps
only).

Specifically:

1. Pointer-lock is requested from a direct user gesture on the arena
   canvas — nothing else.
2. `pointerlockchange` toggles the crosshair `.active` class on/off
   using a single listener registered by `arenaRuntime.js`. There is
   no recency-gate, no boot-order guard, and no SW-side URL
   normalisation.
3. ESC releases pointer-lock (browser default). The subsequent
   `pointerlockchange = null` transitions PLAYING→PAUSED via
   `state.transition(GAME_EVENT.PAUSE)` (ADR-0001).
4. Re-clicking the arena from PAUSED requests pointer-lock again and
   transitions PAUSED→PLAYING via `state.transition(GAME_EVENT.RESUME)`.

Any code change that touches:

- The pointer-lock request site,
- The `pointerlockchange` listener,
- The ESC key handler,
- The boot ordering that owns any of the above,
- The service worker's handling of the entry chunk URL,

is an ADR-modifying change and MUST land as a new ADR (superseding this
one) BEFORE code moves. No "while I'm here" edits.

## Consequences

- **Enables:** a known-good baseline the operator can trust; forward
  feature work can proceed against a stable input contract.
- **Forecloses:** silent pointer-lock/ESC "hardening". Fixes that touch
  this area must be argued for in a superseding ADR, with a rollback
  plan.
- **Trade-offs:** we lose the ancillary improvements from v0.2.606–
  v0.2.620 in this area (recency-gate, boot guard, SW normalisation)
  until they are re-introduced under a superseding ADR. We consider
  this the correct trade — a working game beats theoretical robustness.
- **Enforcement:** operator-enforced via ADR gate. No automated check
  can encode "behaviour matches v0.2.605"; the guard is the review
  discipline this ADR system exists to provide.

## Alternatives considered

- **Patch forward from v0.2.620**: attempted three times
  (v0.2.618/.619/.620), failed each time. Rejected.
- **Cherry-pick individual v0.2.606–v0.2.620 changes**: rejected as a
  first move — will be considered later on a per-change basis, each
  behind its own ADR when it touches this area.

## Notes

Safe candidates for re-application from v0.2.606–v0.2.620 (none touch
this ADR's surface):

- v0.2.608 — combat hit-reg, bot difficulty, LOD hysteresis
- v0.2.612 — stuck-key guard, quality-tier stall removal
- v0.2.616 — homepage landscape (sea + grass), parallax tune

Risky (do NOT re-apply without a superseding ADR here):

- v0.2.606 (pointer-lock + stale-modal hardening)
- v0.2.607 (3D landing scene behind title)
- v0.2.609 (homepage rework + audio hardening)
- v0.2.610 (ESC pause recency-gate + MP bridge)
- v0.2.611 (homepage simplify + ARENA SHOOTER leaderboard)
- v0.2.613 (homepage polish + ENTER resilience)
- v0.2.614 (homepage framing + input fixes)
- v0.2.615 (homepage composition, ESC quiet-pause restore)
- v0.2.617 (homepage render crash fix + daytime palette)
- v0.2.618 (crosshair/ESC rollback attempt)
- v0.2.619 (in-chunk boot guard)
- v0.2.620 (SW entry-chunk normalisation)
