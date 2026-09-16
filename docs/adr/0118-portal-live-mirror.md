# ADR-0118: Portal live-mirror (spectator-before-traveller threshold)

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** chiefmonkey
- **Related:** ADR-0117 (world-as-data travel), ADR-0116 (signed travel token), ADR-0115 (single-instance), ADR-0054 (gateway directory), `src/engine/world/worldResolver.js` + `worldRenderer.js`, `server/arena-ws.js` (wire protocol)

## Context

ADR-0117 makes a destination world resolvable and switchable in-place. But the
single most memorable property of the torii gate — the thing *it means* — is that
you can **see the other world before you cross it**. A player should stand at the
gate and look *through* it into a live, moving, parallax-correct other world, the
way you look through a mirror into a different dimension. The transition (ADR-0117)
delivers "appear there" but not "see there first."

This is achievable with a standard **render-to-texture portal**: keep two scenes,
derive a portal camera from the viewer's camera mirrored through the gate, render
the destination to an offscreen target, and paint it into the gate aperture. The
only genuinely new trust primitive it introduces is *how* the origin sees the
destination's **live** state without joining it.

## Decision

1. **The gate is a render-to-texture portal.** The destination world is a second
   scene; a portal camera (parallax-correct ⸺ derived from the viewer's camera via
   the portal's from/to transforms) renders it to a reduced-resolution
   `WebGLRenderTarget`; that texture is drawn onto the gate surface, masked to the
   gate aperture. As the viewer orbits, the view through the gate shifts like a
   real window. Recursion (a gate looking through another gate) is depth-capped.
2. **Three escalation tiers, one seam.**
   - **Peek** — resolve the manifest by hash (ADR-0117) and render a still / lightly
     animated world through the gate. No socket, no simulation.
   - **Live mirror** — additionally open a **spectator** connection to the
     destination `arena-ws` and stream its live entity state into the portal scene,
     so the other world is seen *happening* (players, weather, waves) before entry.
   - **Step through** — the ADR-0117 transition: the spectator socket is promoted to
     a full join on cross, world B becomes the player's world.
3. **Spectator-before-traveller is a trust tier.** The spectator is a *read-only*
   connection: it receives the world-state broadcast (the same frames seated peers
   see) but cannot join, be seated, mutate, or publish, and it carries no identity.
   Read-only presence comes first; write/join requires the signed travel token
   (ADR-0116) at the moment of crossing. This keeps the enclave two-voice boundary:
   look without entering, enter only by consent.
4. **The destination does not simulate on the viewer's machine.** Until the player
   crosses, local Rapier physics runs only for world A; the live mirror renders the
   destination's server-authoritative entity stream, not a local sim. This bounds
   the cost of "seeing through" — one extra scene + one reduced target, not a second
   physics world.
5. **Portal math is pure and shipped first.** A `portalCamera.js` module (matrix
   portal: `to · inv(from) · viewer`) + a `worldMirror.js` orchestration (peek →
   live → drop) are node-pure and unit-testable; the Three.js renderer and the
   `arena-ws` `SPECTATE` wire protocol are the subsequent, browser/server slices.
6. **The reveal is HYBRID: live aperture on approach, fullscreen iris on cross. (2026-09-16)**
   Two visual states on one seam:
   - **Approach** — the gate is a LIVE APERTURE window: the destination world renders
     only within the gate's opening (mask centred on the projected gate), and the
     ORIGIN sky holds outside it. You look through the threshold without entering.
   - **Cross** — the aperture IRIS EXPANDS past its own frame to fullscreen while the
     DESTINATION sky resolves in (the established iris/sky-resolve arc), settling on
     world B filling the screen.
   The mask is expressed in **aperture units**: a radius of 1 = the gate opening, and
   `fullFactor = cornerDistance / apertureRadius` is the radius that reaches the
   furthest screen corner. `portalReveal.js` encodes the arc (approach pins radius at 1,
   cross eases 1 → fullFactor, settled pins at fullFactor; the sky resolves only during
   cross). The shader takes `uCenter`/`uAperture` (the gate's projected centre + opening
   radius) and `uIris`/`uSkyBlend` from that arc — the renderer projects the gate to
   screen space, everything else is the tested pure math.

## First slice (adoption)

1. `src/engine/world/portalCamera.js` — parallax-correct portal camera (pure `three`
   matrix/vector math; identity, offset, and 180°-flip cases locked by tests).
2. `src/engine/world/worldMirror.js` — the escalation orchestration (resolve → open
   spectator → stream → drop), injected hooks, fail-closed, mirroring
   `worldTransition.js`.

Deferred (subsequent slices): the `arena-ws` `SPECTATE` read-only mode (wire protocol
+ server), the Three.js portal renderer (render target + mask + depth-capped
recursion), and the in-gate visual (iris, sky resolve, audio sting).

## Consequences

- The torii gate becomes a *threshold you look through*, not a button that navigates;
  the "moment" is the mirror, and crossing is the payoff rather than the whole event.
- A read-only spectator tier is a new, minimal surface on `arena-ws` — cheap to serve
  (it is the existing broadcast, filtered), but it is a distinct mode that must be
  hardened (no seat/mutate/publish, no identity) before it ships.
- Two live scenes double the draw cost; mitigated by reduced target resolution and no
  destination physics until cross. Lower-end devices get the peek tier (or a still)
  rather than the full live mirror.
- The escalation is still **local-first**: a cached manifest enables peek offline; the
  live mirror is the only tier that requires a destination socket.