# ADR-0123: Live Gaze-Through Gate Browse

- **Status:** Accepted
- **Date:** 2026-09-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0118 (portal live mirror), ADR-0114 (seamless travel), ADR-0122 (world reference owner attribution)

## Context

Pressing F at an armed torii gate opened the browse loop by pausing the game
(`transition(PAUSE)`) and releasing pointer lock, then showing a smoked-glass
directory card. Peeking a world armed a CROSS reveal, which expanded the iris to
fullscreen: the destination (sampled from a raw linear mirror texture with no sRGB
conversion, under a hardcoded dark dusk `skyBHex #0e1a2e`) covered the whole screen
while the directory's own preview canvas was separately linear→sRGB corrected — the
"dark world behind the travel modal" the playtester reported.

Player feedback asked for three things at once:

1. Move the directory panel down and remove the shaded layer, so the gate and the
   player's own world stay visible.
2. See the destination by *looking through the gate* — a live aperture window with
   parallax as the viewer moves and looks.
3. Keep the exact control scheme of normal play — full WASD movement and
   pointer-locked mouse look — while browsing, "everything like just now", with the
   gate as a window into another dimension.

The parallax math for this already existed but was never consumed:
`computePortalCamera` (ADR-0118, `M_to · M_from⁻¹ · M_viewer`) was fully written and
tested, and the render loop already fed the live viewer pose into the mirror every
frame — yet `portalMirror.render()` ignored all three transforms and rendered a fixed
arrival pose with a gentle time-driven head-pan.

## Decision

The gate browse loop keeps the player PLAYING, pointer locked, with movement and
mouse-look live. Shooting is the only suppressed input
(`setShootingSuppressed(true)`), restored on close. Peeking arms an APPROACH-mode
reveal — the destination shown *only* through the gate aperture, the origin world
visible and interactive around it — and the reveal holds open (no auto-end) until the
host ends it. The mirror renders its frame through `computePortalCamera` so the view
through the aperture shifts like a real window as the player walks and looks. The
directory is a slim, near-transparent strip pinned to the bottom of the screen, and
the 入 walk-through is reachable from the keyboard (Enter) so it works under pointer
lock.

## Consequences

- **Enables:** a "look through the gate into another world" experience that stays
  consistent with normal first-person control; origin and destination coexist in one
  frame; parallax tracks real viewer motion.
- **Forecloses:** the fullscreen CROSS iris as the *peek* visual (CROSS remains the
  commit/entry transition); the old pause-then-browse flow (no longer reachable from
  the gate).
- **Trade-offs:** while browsing the player can be hit by the world's normal hazards
  (they are truly PLAYING, not paused); the directory click path is supplemented, not
  replaced, by the Enter keyboard seam.
- **Enforcement:** `tests/gateway-screen-commit.test.js` locks the keyboard commit
  seam; `tests/portal-mirror-viewer-pose.test.js` and `tests/world/portal-reveal.test.js`
  cover the parallax + approach-window math.

## Alternatives considered

- **Fullscreen CROSS peek (status quo):** rejected — the dark full-frame overlay was
  the reported defect and hid the player's own world.
- **Pause-free peek with a fixed mirror view:** rejected — no parallax, so the
  "window" read as a flat texture when the player moved.
- **Cursor-driven look (drag-to-pan) instead of pointer lock:** rejected — the player
  explicitly wanted "everything like just now" (pointer-locked mouse look + WASD).

## Notes

The mirror render target remains linear; the in-panel preview canvas already applies a
linear→sRGB LUT on read-back, and the aperture shader samples the texture directly.
Colour-space unification of the aperture path is a follow-up, not part of this decision.

### v0.2.884 refinement (cursor ↔ gaze toggle)

Keeping pointer lock engaged for the whole browse left the directory unclickable — the
cursor stayed on the crosshair and the panel was unreachable. Refined: the browse opens
with the cursor FREE (directory is clickable, WASD still moves), and **F toggles** between
the free cursor and pointer-locked gaze. The two states are the explicit "select a world,
look through the gate, select another" loop the playtester described. Shooting stays
suppressed throughout; Enter walks through; Esc/✕ steps away, and a commit from the
free-cursor state re-engages pointer lock so the landed world plays like normal entry.