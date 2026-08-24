# ADR-0052: Capture Kami Mode client state in the ema snapshot (v0.2.675-alpha)

- **Status:** Accepted (diagnostic)
- **Date:** 2026-08-24
- **Decides:** Add a `kami` field to the debug snapshot (and therefore every ema) that
  records the exact client-side Kami Mode state at capture time: `active`, `noteOpen`,
  `entering`, and `pointerLocked`. This is the diagnostic that will pinpoint the
  "stuck in Kami Mode — Esc does nothing" bug.

## Context

A playtest ema reported: *"i am now locked inside of kami mode... pressing esc does
nothing."* The server log confirms the client never sent the exit — `KAMI_STATE
active=true` at 17:00:23 with no `active=false` ever following.

The exit path is a capture-phase Escape listener in `arenaRuntime.js`:

```js
if (kamiNoteOpen()) { _escapeHandledOnKeyDown = true; return; }   // note open → discard
if (kamiBusy()) { … kamiExit(); return; }                          // in Kami → exit
```

`kamiBusy()` is `_kamiActive || _entering`. So "Esc does nothing" can only mean one of
a few things, and the existing ema snapshot cannot tell them apart:

- `_kamiActive` is true but the Escape keydown never fires (pointer-lock swallowed it),
- `_kamiActive` is false (state desync — the rack is visible but the flag cleared), or
- `_entering` is stuck true (a pending owner-check never resolved).

The Kami Mode exit code has not changed since v0.2.661, so this is a pre-existing bug or
a specific interaction, not a regression from ADR-0050/0051.

## Decision

Add a `kami` sub-report to the pure snapshot builder (`engine/debug/snapshot.js`) and
wire four providers into `installToriiDebug`:

```js
export function buildKamiReport(p = {}) {
  return {
    active:        safe(p.isKamiActive, false) ?? false,
    noteOpen:      safe(p.isKamiNoteOpen, false) ?? false,
    entering:      safe(p.isKamiEntering, false) ?? false,
    pointerLocked: safe(p.isPointerLocked, false) ?? false,
  };
}
```

- `kamiMode.js` gains a `kamiEntering()` export (the `_entering` flag was previously
  only reachable through `kamiBusy()`).
- `arenaRuntime.js` passes `isKamiActive`/`isKamiNoteOpen`/`isKamiEntering`/
  `isPointerLocked` into `installToriiDebug`, sourced from the already-imported
  `kamiActive()`/`kamiNoteOpen()`/`kamiEntering()` and `state.pointerLocked`.

Every ema now carries the four flags, so the next ema hung while stuck tells us exactly
which state is wrong.

## Consequences

- No gameplay change; the snapshot is read-only diagnostic data.
- Adds 3 tests (`tests/snapshot.test.js`) covering the `buildKamiReport` passthrough,
  missing-provider defaults, and throw-safety.
- The next stuck ema will disambiguate: `active:true + pointerLocked:true` → Escape is
  being eaten by pointer lock; `active:false` → a state desync; `entering:true` → a
  pending owner-check never resolved.
