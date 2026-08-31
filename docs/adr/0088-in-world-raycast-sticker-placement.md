# ADR-0088: Character Forge — in-world raycast sticker placement

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** chiefmonkey
- **Related:** ADR-0086 (sticker placement model), [`skinnedmesh-raycast`](concepts/skinnedmesh-raycast), [`sticker-skin-system`](concepts/sticker-skin-system), ADR-0085 (sticker studio napplet)

## Context

ADR-0086 shipped the placement *model* and a settings-tab editor, but placement
was still "recommended zone centre" — `_addOwnSticker` drops the sticker at the
zone's default u/v with no knowledge of where on the character the player meant.
The player wants to aim at their own character and put a sticker *there*:
resolve the exact body zone, surface u/v, and orientation from a 3D raycast.

`stickerNpc.js` already proves the surface-authoritative raycast: recompute the
SkinnedMesh bounding sphere, apply the skeleton, intersect, then read the hit
face's `skinIndex`/`skinWeight` to find the bone(s) that actually deform that
patch of skin, and read the geometry UV. DecalGeometry does **not** work on a
SkinnedMesh, so a sticker is baked bone-locally and attached with
`Object3D.attach`. Stickers are NAP-zone-only, and the player's own character is
already the mirror subject there.

The *decision logic* — hit → zone/u/v/rot conversion, and the enter→aim→confirm
state machine around it — is pure and testable without THREE.

## Decision

1. **Keep the conversion pure.** Add `src/engine/character/stickerRaycast.js`:
   `normalizeRaycastHit`, `rotationFromNormal`, and `placementFromRaycastHit`
   (boneNames → zone via `resolveZoneFromBoneNames`, geometry u/v clamped, rot
   derived from the surface normal's azimuth).

2. **Add an inert placement-mode state machine.** Add
   `src/engine/character/stickerPlacementMode.js`: enter → aim → confirm/cancel,
   returning *new immutable* states (mirrors the gateway controllers). `aim`
   combines a resolved hit with the selected `STICKER_LIBRARY` sticker hash —
   **the raycast supplies position, the library selection supplies identity** —
   and `placementToManifest` folds a confirmed draft through `addSticker`.

3. **Isolate THREE in a runtime adapter.** Add `src/stickerStudio.js`, which
   raycasts the player's *own* character (`playerModel.getPlayerModelRoot()`,
   layer 1) with the proven stickerNpc.js approach and returns a normalised hit
   the pure modules consume. It is deliberately **not** re-exported by the SDK.

4. **Self-placement targets a self-view camera.** The own-character mesh is
   hidden from the FPS camera, so placement aim originates from a dedicated
   **self-view orbit camera** — the direct, usable form of the NAP-zone mirror
   (the mirror renders the same layer-1 mesh from one fixed angle; the orbit
   camera lets the player place on any side). The hit is injected, so the input
   binding is decoupled from the raycast/conversion/no-op.

5. **Wire the input binding in a runtime module.** Add `src/stickerSelfView.js`:
   `KeyP` enters self-view (detach the shared camera, orbit it around the
   character centre, swap the layer mask to show layer 1 and hide the headless
   layer-2 FP body), pointer-lock mouse orbits + aims, left-click confirms a
   raycast placement through the pure state machine, `Esc` cancels. Confirmation
   hands `{hash, zoneId, u, v, rot}` to the shell (`createArenaRuntime`
   `confirmStickerPlacement` hook → `main.js`), which folds it through
   `addSticker` + the kind-35100 republish. While active, `player.js` hands the
   camera to the self-view (`state.stickerPlacementActive`), the gun viewmodel is
   hidden, and `Esc` cancels instead of pausing.

## Consequences

- Pure conversion + state machine are unit-tested in node; the runtime orbit
  camera + layer swap are browser-playtested (enter/aim/confirm/cancel).
- Placement is still validator-first: a confirmed placement flows through
  `addSticker` (MAX_STICKERS cap) then the existing kind-35100 republish.
- The visual decal baking (a sticker actually attached to the skin, per the
  `sticker-skin-system` concept) remains a later rendering step — this slice
  resolves + persists the placement data.