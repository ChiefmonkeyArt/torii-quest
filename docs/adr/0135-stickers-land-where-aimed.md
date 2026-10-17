# ADR-0135: Stickers land exactly where you aim

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** chiefmonkey (approved in session 2026-10-17: "Keep stickers land exactly where aimed as the next approved gameplay task… I approve lets do it… i approve to improve"). This is item 1 of `docs/design/gameplay-lessons-nap-and-world.md`.
- **Builds on:** ADR-0130 (Game Zone hitbox: exact skinned-triangle test), ADR-0132 (sticker feel), ADR-0090 (sticker render modes).
- **Scope:** sticker targeting and attachment on characters (NAP NPC, peers). Static-surface stickers, the feel pass and the points are unchanged.

## Context

Character stickers were gated by 0.20 m Rapier ball sensors on every NPC bone plus a broad capsule, two physics raycasts per shot. When the real mesh test missed, a "graze" fallback invented a point on an estimated limb radius, so a sticker could land somewhere the crosshair never touched. The mesh test itself was three.js's `SkinnedMesh` raycast, run after `computeBoundingSphere()`. That skins every vertex on every shot, about 41 ms per shot on the NPC (24k vertices), which is a visible hitch on every click. A landed sticker was parented to the one bone with the most skin weight, so on blended skin (shoulders, hips, elbows) it slid off the surface as the pose changed.

## Decision

1. **The drawn skin is the only truth.** `src/engine/character/stickerSkin.js` reuses the Game Zone hitbox (`fitHitboxParts` / `createHitboxRig`). The hitbox is fitted once per geometry, and on the NPC it is fitted on the first frame after it loads, never on a click. `raycastSkin` runs broad capsules, then the exact skinned triangles. `hitbox.js` now also reports the hit triangle and its barycentrics.
2. **A small, honest assist.** If the crosshair just misses, parallel rays on two rings (2 cm and 4 cm, `STICKER_ASSIST_M`) find the nearest real skin. The sticker never lands on a point that isn't on the drawn surface, and a clear miss flies on to whatever is behind.
3. **Anchor, don't parent.** A hit is stored as `{tri, u, v, sign}`. `anchorPose` re-skins those three vertices with the current bones, both during the 0.22 s flight and every frame once stuck, so the sticker stays exactly on the skin in every clip. Stickers of a character that left the scene are dropped.
4. **Less work.**
   - The NPC's per-bone Rapier sensors and their per-frame sync are removed, along with the full `updateMatrixWorld(true)` they forced every frame.
   - Sticker targeting no longer casts Rapier rays.
   - Peers are skin-tested only when the aim line passes within 2.5 m of them.
5. **Observability.** `ToriiDebug.stickerAim` reports `{shots, assisted, lastMs, maxMs, last, attached, onSkin}`.

## Consequences

- Covered by `tests/sticker-skin.test.js`, which uses a synthetic two-bone limb with a blended joint:
  - an exact hit lands on the surface;
  - a near miss within the assist lands on real skin;
  - a clear miss returns null;
  - after the joint bends, a ray cast back along the anchor normal meets the drawn skin within 1 mm.
- Wiring contracts are in `tests/sticker-feel.test.js`.
- Node measurement on `chiefmonkey6.glb`: about 2.6 ms per shot including assisted near-misses (old path 41 ms), a one-time 49 ms fit, and 1.9 µs per anchored sticker per frame.
- The physics module still exports the bone-collider helpers (now unused by the NPC). Removing them is a separate clean-up.
