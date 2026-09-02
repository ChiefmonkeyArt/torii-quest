# ADR-0001: State FSM seam — `state.phase` writes confined to `src/state.js`

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `src/state.js`, `src/events.js`, `tools/regression-check.mjs` (rule #7)

## Context

The game runs across TITLE, PLAYING, PAUSED, DEAD, and GAMEOVER phases with
a small number of legal transitions (`ENTER`, `PAUSE`, `RESUME`, `HOME`,
`DIE`, `RESPAWN`, `END`). Prior to formalisation, `state.phase` was
mutated from arena, weapons, HUD, and input modules — making it impossible
to reason about which phase we were in, or to observe transitions in one
place.

## Decision

All writes to `state.phase` are confined to `src/state.js`. Callers use
`transition(GAME_EVENT.<X>)`, which:

1. Looks up the next legal phase from a frozen `TRANSITIONS` map.
2. Rejects illegal transitions (returns `false`, phase unchanged).
3. Emits `EV.PHASE_CHANGE { from, to, event }` on the event bus so any
   number of subscribers can react without importing `state.js` back.

`PHASE` and `GAME_EVENT` are `Object.freeze`d. The transitions table is:

- `TITLE  → ENTER   → PLAYING`
- `PLAYING → PAUSE  → PAUSED`, `DIE → DEAD`, `END → GAMEOVER`
- `PAUSED → RESUME  → PLAYING`, `HOME → TITLE`
- `DEAD   → RESPAWN → PLAYING`, `END → GAMEOVER`
- `GAMEOVER → (terminal; no outgoing edge yet)`

## Consequences

- **Enables:** one grep (`state.phase =`) lists every write site (currently
  one: `src/state.js:106`). Every phase change fires `PHASE_CHANGE`, so
  UI/HUD/audio can react centrally.
- **Forecloses:** ad-hoc "quiet" phase changes from feature code. Any new
  phase or event needs an ADR update and a `TRANSITIONS` map entry.
- **Trade-offs:** the transition indirection is slightly more verbose than
  a direct write; the win is testability and observability.
- **Enforcement:** `tools/regression-check.mjs` rule #7 fails the build if
  any file under `src/` other than `src/state.js` writes `state.phase`.
  `endRun()` is the sanctioned public API for `END`.

## Alternatives considered

- **Free-form phase writes with lint rules**: rejected — lint rules drift,
  and the value here is a single verified seam.
- **A full state chart library (xstate, robot3)**: rejected — the FSM is
  tiny; a hand-rolled table is easier to audit and adds zero deps.

## Notes

`state.phase === PHASE.PLAYING && !state.pointerLocked` is exposed as the
predicate `needsPointerLock()` and is the gate the arena click handler
uses to re-engage pointer lock. That predicate is ADR-0010's concern.
