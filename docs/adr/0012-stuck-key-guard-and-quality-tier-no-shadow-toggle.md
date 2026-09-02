# ADR-0012: Stuck-key guard and quality-tier no-shadow-toggle (v0.2.612 forward-port)

- **Status:** Accepted
- **Date:** 2026-08-22
- **Deciders:** chiefmonkey
- **Related:** `src/input.js`, `src/engine/render/qualityTier.js`,
  `src/arenaRuntime.js`, `tests/pause-input.test.js`,
  `tests/render/qualityTier.test.js`,
  ADR-0010 (crosshair/ESC/pointer-lock baseline)

## Context

Two independent bugs, both visible in normal play:

1. **Sticky W/A/S/D movement.** Browsers swallow `keyup` events on
   window blur, tab-hide, and pointer-lock exit (including the exit
   caused by a NIP-07 signer prompt). A held movement key stayed
   latched in the input state and the player kept running after
   physical release. Reported in field play; reproducible with any
   NIP-07 signer flow mid-run.
2. **Mid-game render stalls.** The adaptive quality tier (v0.2.379)
   toggled `renderer.shadowMap.enabled` at runtime when stepping to
   or from LOW. Toggling that flag invalidates every material program
   in the scene, forcing a full shader recompile — a visible stall.
   With FPS hovering near the 45/55 thresholds, the tier flapped
   LOW↔NORMAL and the stall repeated mid-game.

## Decision

Adopt the v0.2.612-alpha implementations:

### Stuck-key guard (`src/input.js`)

Clear all held-key state on any of the following:

- `window.blur`
- `document.visibilitychange` (when `document.hidden === true`)
- `document.pointerlockchange` (when `document.pointerLockElement === null`)

The clear operation only touches held-key state — it does not request
pointer-lock, does not emit phase transitions, and does not call any
ESC/pause path. It is deliberately narrow so it does NOT modify the
ADR-0010 contract (crosshair / ESC / pointer-lock lifecycle).

`tests/pause-input.test.js` includes a source-guard test asserting that
the three listeners exist and only mutate held-key state.

### Quality-tier no-shadow-toggle (`src/engine/render/qualityTier.js`, `src/arenaRuntime.js`)

- `renderer.shadowMap.enabled` is set once at session start and never
  toggled thereafter.
- Stepping to LOW resizes the shadow map to 256px (cheap; disposes only
  the shadow target, no scene-wide recompile).
- Stepping back up restores a larger map size.
- `onTierChange` in `arenaRuntime.js` never touches
  `renderer.shadowMap.enabled`.

`tests/render/qualityTier.test.js` asserts the invariant.

## Consequences

- **Enables:** movement feels correct after signer prompts, tab
  switches, and window focus changes; auto quality-tier adjusts without
  a mid-game stall.
- **Forecloses:** toggling `renderer.shadowMap.enabled` at runtime; any
  input handler that touches phase/pointer-lock from a
  blur/visibility/pointer-unlock listener.
- **Trade-offs:** the LOW tier now always pays the (tiny) 256px shadow
  cost, whereas the pre-v0.2.612 shape saved it. We consider the stall
  removal worth vastly more than the LOW-tier savings.
- **Enforcement:** vitest tests listed above.

## Alternatives considered

- **Clear keys only on blur**: rejected — misses the NIP-07 signer
  case (pointer-lock exit) and the mobile tab-hide case
  (`visibilitychange`).
- **Debounce quality-tier flaps**: rejected — the recompile cost is the
  bug, not the flap rate; simpler to remove the recompile.
- **Disable shadows entirely on LOW**: rejected — `enabled` toggling
  IS the stall trigger.

## Notes

### ADR-0010 boundary

The pointer-lock unlock listener in this ADR **only clears held keys**.
It does NOT alter the ESC pause path, the crosshair listener, or the
pointer-lock request. Those remain under ADR-0010. If a future change
adds phase/state effects to this listener, it must supersede both
ADRs.

Forward-ported cleanly from `v0.2.612-alpha` onto the v0.2.605
baseline as part of v0.2.622-alpha.
