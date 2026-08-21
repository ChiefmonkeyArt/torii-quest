# ADR-0002: Event bus — every `EV.<NAME>` must be registered in `src/events.js`

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `src/events.js`, `tools/regression-check.mjs` (rule #8)

## Context

Publisher/subscriber decoupling only works if the set of signals is
discoverable in one place. If `emit()` and `on()` accepted arbitrary
strings, event names would proliferate silently across the codebase and
typos would fail silently (a subscriber to `'player:kild'` never fires).

## Decision

Modules communicate through a single event bus (`src/events.js`) whose
event names are frozen in the `EV` object. All `emit(...)`/`on(...)`
calls MUST use `EV.<NAME>` — never a bare string.

The regression check greps for every `EV.<IDENT>` reference in the
codebase and fails if any name is not present in the frozen registry.

Emitting to an empty listener list is a harmless no-op, so a publisher
may ship ahead of its consumers (`PHASE_CHANGE`, `WS_*` currently have no
subscribers).

## Consequences

- **Enables:** one file lists every signal in the system; typos surface
  as build failures; new subscribers can find every publisher trivially.
- **Forecloses:** ad-hoc string-keyed events; feature-local buses.
- **Trade-offs:** every new signal requires an edit to `src/events.js`
  and (per this ADR system) an ADR update if the signal is load-bearing.
- **Enforcement:** `tools/regression-check.mjs` rule #8. `on/emit/off`
  only accept the frozen registry.

## Alternatives considered

- **DOM CustomEvents**: rejected — introduces DOM coupling and browser-
  specific quirks into pure engine modules.
- **Per-module observers**: rejected — reintroduces the coupling the bus
  was designed to remove.

## Notes

`EV.PHASE_CHANGE` is emitted by `state.transition()` (ADR-0001). Adding
a new event that will become load-bearing (subscribed across modules)
requires an ADR-update or new ADR describing what the event means and
who subscribes.
