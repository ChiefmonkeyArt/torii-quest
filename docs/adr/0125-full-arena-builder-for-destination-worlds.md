# ADR-0125: Full Arena Builder for Destination Worlds (Mirror)

- **Status:** Accepted
- **Date:** 2026-09-24
- **Deciders:** chiefmonkey
- **Related:** ADR-0118 (portal live mirror), ADR-0124 (world-space gate window)

## Context

ADR-0124 replaced the fullscreen iris with a world-space gate window that samples the
live-mirror render target. In playtesting the window was correctly framed, but the
**destination world inside it was still unrecognisable** — "missing all her details".

The root cause was a two-builder split:

- The **home world** renders through the full legacy `buildArena()` — sea, undulating
  terrain, coastline glass wall, crates, bridge, torii gates, NAP zone + tree, and grass.
- The **peek/travel mirror** rendered the destination through `buildMinimalWorld()` — a
  generic heightmap cloud platform with none of those details.

Bekka's world is a copy of the home world (minus the `chiefmonkey.glb` NPC), so the
mirror was reconstructing a *different* place from the manifest instead of showing the
recognisable world the player already knows. The playtester's instruction was direct:
"Use the full arena builder for Bekka's world."

## Decision

The portal mirror builds the destination with the **full legacy arena builder**:

- `portalMirror.build()` calls `buildArena(_scene)` (floor, crates, bridge, torii gates,
  NAP zone, coastline, sea) plus `buildFoliage(undefined, _scene)` (grass) into the
  mirror's own offscreen scene, instead of `buildMinimalWorld()`.
- The arena builders are **scene-parameterised** so the mirror scene and the home scene
  never clobber each other:
  - `buildArena(scene = defaultScene)` and every sub-builder take a `scene`.
  - `buildBridge(targetScene = scene)` tracks its groups in a `WeakMap` keyed by scene.
  - `buildFoliage(onProgress, targetScene = defaultScene)` — grass singletons
    (`_grassMat`/`_grassMesh`) are only set for the home scene.
  - `buildSeaMesh(scene, { track })` — the sea material/mesh singletons are only set when
    `track !== false`; the mirror passes `track: false` so it never clobbers the home's
    `tickSea`/`disposeSea`/`getSeaMat` state.
- The mirror's `_disposeSceneContents()` disposes geometries and materials, but **skips
  materials shared with the home scene** (the module-level `crateMat`/`_glassMat`/
  `_neonMat` in `arena.js`) so tearing down the mirror never breaks the home world.
- The NPC (`buildNapNpc`, `chiefmonkey6.glb`) is **not** part of `buildArena` — it is
  built separately by `arenaRuntime` — so a destination without the NPC (Bekka's world)
  correctly renders without it.

## Consequences

- The gate window now shows the destination as the **same recognisable arena** the player
  already inhabits — sea, terrain, crates, bridge, gates, NAP zone, coastline and grass —
  matching the wardrobe metaphor (open the door, see the same world on the far side).
- The mirror scene is a full second arena, so peek is heavier than the minimal
  reconstruction (more geometry + two GLB loads). This is bounded: the mirror is built
  once per peek and torn down on close; the extra cost is GPU/CPU, not network.
- The mirror's sea and grass are **static** (their per-frame wind/wave ticks are driven by
  the home-scene singletons only). This is acceptable for a peek; the destination's
  motion still comes through via the spectator avatar stream.
- `buildMinimalWorld()` remains for the data-driven world path (worlds authored as
  manifests that are *not* copies of the home arena); only the mirror switched to
  `buildArena`.
