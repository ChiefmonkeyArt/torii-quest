# ADR-0139: Your tracer leaves the gun you see, never hidden, opposite colours

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** chiefmonkey: "I still don't see our, the players, bullets... they should emanate from the end of the gun and be an opposing but complimentary or opposing colour to the bots".
- **Builds on:** ADR-0136 (ribbon tracers), ADR-0138 (bot tracers cyan/lime, head glow).
- **Points:** unchanged and frozen.

## Context

Three faults combined, so you never saw your own shots:

1. **Wrong start point.** The FP gun is drawn by a separate `gunCamera` (55° FOV) over the world camera (75°). The tracer started from a fixed camera-local offset (0.30 m forward, 0.12 m right, 0.10 m down). That offset projects nowhere near the gun on screen; it lands about a third of the way toward the crosshair.
2. **Grass hides it.** The headless probe confirmed the ribbon was in the buffer, from the gun tip to the target, yet invisible. Its path runs along the grass tops, and the blades around the player hid it.
3. **Already gone at the first frame.** At 240 m/s the streak was about 4 m out and seen end-on before it was ever drawn.

## Decision

1. **Visible-muzzle start** (`engine/weapons/muzzle.js`, `gunViewmodel.js`):
   - When the GLB loads, `findGunTip` finds the model's front-most vertices once.
   - Each shot projects that tip, including recoil, through `gunCamera`.
   - `screenMatchedPoint` puts the start on the main camera's ray through the same pixel, 0.5 m out.
   - `player.js` sends it as `tracerFrom` on `EV.SHOOT`; the tracer and the muzzle flash use it.
   - The hit simulation still uses `origin`/`dir`.
2. **Never hidden** (`fx.js` VS): your tracer only (`xray`) is pinned to the near plane in clip space, keeping w so perspective is unchanged. Its path is the crosshair ray up to the first hit, so it's clear by construction. Bot and peer rounds still respect walls.
3. **Readable launch:**
   - speed 170 m/s;
   - `anchor` 0.05 s keeps the tail on the muzzle for the first frames, then it eases off;
   - the width is set per end and capped per metre (`wMaxPx`, `headMaxPx`), so it tapers from the gun instead of looking fat.
4. **Colours:** a hot orange core (opposite the bots' cyan) with a magenta-violet glow (opposite their lime). Peers use the same colours. Your core is 1.7× wider (`coreW`), because the violet glow alone vanished against the lilac grass.

## Consequences

- Still one tracer mesh and one draw call. There's one extra float attribute per vertex, set only when a tracer is spawned.
- Tests:
  - `tests/gamezone/player-tracer-muzzle.test.js`: screen match round trip, the old offset proven off-pixel, tip finder, opposite hues, anchored start, width cap and taper, only your tracer is x-ray, wiring.
