# ADR-0124: World-Space Gate Window (Replaces the Fullscreen Iris)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** chiefmonkey
- **Related:** ADR-0118 (portal live mirror), ADR-0123 (live gaze-through gate browse)

## Context

ADR-0123 shipped the gaze-through browse by keeping the player PLAYING and arming an
**APPROACH aperture reveal** — a fullscreen screen-space quad whose circular iris mask
expanded from the gate. In playtesting the effect read wrong in two ways:

1. The iris was a **massive expanding circle in front of the player's face**, not
   contained by the torii gate. It covered ~85–90% of the screen and overlapped the
   gate's own posts and crossbeam.
2. The destination world shown inside it was **missing its details** — the mirror
   sampled a raw linear texture through a hardcoded dark-dusk blend, so the world read
   as a simplified terrain/sky rather than the actual place.

The playtester asked to "keep this simple": a **screen between the torii's posts**, sized
to the gate's dimensions, that shows the destination — "the Lion, the Witch and the
Wardrobe — you open the cupboard door and you see into a new reality."

## Decision

Replace the screen-space circular iris with a **world-space portal window**:

- A single flat `PlaneGeometry` stands **inside the travel gate opening** — between the
  two pillars and below the crossbeam — sized to the gate's real dimensions (width 3.0,
  height 3.6, centred 1.8 above the gate's ground line; the gate itself is ~3.90 wide ×
  ~4.16 tall).
- The window is part of the **arena scene** (not a post-pass overlay), so it renders at
  correct depth and is naturally framed by the gate's wooden posts and crossbeam.
- Its material samples the **live-mirror render target** (the destination world), which
  already renders with parallax via `computePortalCamera` (ADR-0118). The mirror target
  aspect is set to match the window (900×1080 ≈ 3:3.6) so the destination is sampled
  **undistorted**.
- The window is hidden by default; `openLiveMirror` binds the mirror texture into it on
  peek, and `closeLiveMirror` hides it. No separate reveal timeline, no easing, no
  fullscreen cross.

The ADR-0118 iris math (`portalSurface`, `portalProjection`, `portalReveal`,
`portalUniforms`, `irisReveal`, `portalShader`) is **retired from the live path** — the
pure modules remain in the tree but are no longer imported by `arenaRuntime`. The KeyG
iris demo trigger is removed.

## Consequences

- The browse peek now reads as a **window into another dimension**, framed by the gate,
  matching the playtester's wardrobe metaphor.
- The destination world is shown at full fidelity (the mirror already builds the world's
  objects + terrain + sky + avatars); the distortion and dark-dusk tint are gone.
- The window is a scene object, so it is occluded correctly by the gate frame and the
  player's own world — no more screen-space circle floating over the face.
- `portalSurface.js` and its pure math siblings are dead code in the runtime; they are
  left in place (still unit-tested) rather than deleted, to avoid churn and keep the
  ADR-0118 record intact. A later cleanup ADR may remove them.
