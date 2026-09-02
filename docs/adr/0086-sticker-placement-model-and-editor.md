# ADR-0086: Character Forge — sticker placement model + editor

- **Status:** Accepted
- **Date:** 2026-08-31
- **Deciders:** chiefmonkey
- **Related:** ADR-0091 (Character Forge), [`sticker-skin-system`](concepts/sticker-skin-system), `nap-torii-avatar-v0.md`

## Context

ADR-0091 committed to a validator-first character pipeline whose v1 ships
**presets + stickers, zero AI**. The kind-35100 event already models a sticker
as `["sticker", <hash>, <zoneId>, <u>, <v>, <rot>]` and `characterManifest.js`
already validates that shape. What was missing is the authoring half: a way for
a player to place a sticker on their own character and have it written back into
their signed character event.

The in-world 3D placement (raycast the player's own `SkinnedMesh`, resolve the
hit to a body zone + surface u/v) is a real runtime step, but its *decision
logic* — the body-zone registry, bone→zone resolution, and the immutable
manifest add/remove/update — is pure and testable without THREE/Rapier/DOM.

## Decision

1. **Ship the placement MODEL first, as a pure module.** Add
   `src/engine/character/stickerPlacement.js`: the body-zone registry
   (`STICKER_ZONES`, role→zone), bone-name→zone resolution
   (`resolveZoneFromBoneNames` via `skeleton.js`), placement normalisation
   (clamp u/v, wrap rot), and immutable manifest ops (`addSticker` /
   `removeSticker` / `updateSticker` / `countStickers`) with a `MAX_STICKERS`
   cap to bound signed-event size.

2. **Expose a settings-tab sticker editor.** The Character tab's "found" view
   gains an "Edit stickers" affordance; edit mode lists each sticker (zone +
   short hash + u/v/rot) with a Remove button, and offers the curated
   `STICKER_LIBRARY` to add one. Each add/remove re-signs + republishes the
   kind-35100 event through the existing `publishCharacter` round-trip.

3. **Ground the curated library in a real asset.** The first sticker reuses the
   shipped `ftff-sticker.png` (sha256 `cb321d5d…09ae7`) so its content hash is
   real and Blossom-resolvable, not a fabricated placeholder.

4. **Defer the in-world raycast.** The 3D placement interaction (raycast the
   player's own mesh in the NAP zone → `resolveZoneFromBoneNames` + `addSticker`)
   is a later runtime slice; the pure model it will drive is locked here.

## Consequences

- **Enables:** a player can attach/remove stickers to their character entirely
  within the settings tab, and the event round-trips create→read→edit; the
  future 3D placement reuses the same zone + manifest operations.
- **Forecloses:** nothing — no AI, no new network path; publishing still goes
  through the existing NIP-07 sign + relay fan-out.
- **Trade-offs:** the settings-tab path places a sticker on its recommended zone
  (centre u/v) rather than a precise surface point until the in-world raycast
  lands.
- **Enforcement:** `tests/character-sticker-placement.test.js` (zone mapping,
  normalisation, immutable ops, cap) + extended `character-forge-panel.test.js`
  (editor view + hostile-text escaping); SDK exposure at the experimental tier.

## Alternatives considered

- **Ship the 3D raycast placement in the same slice** — rejected: it drags the
  runtime raycast (THREE/Rapier) into a slice that can otherwise be fully
  pure-tested, and the model is the durable value.
- **One sticker, no zone model** — rejected: a zone model is what makes the
  placement portable across rigs and worlds (a bone name is convention-specific;
  a zone is semantic).

## Notes

- `STICKER_ZONES` covers 12 coarse body regions mapped from the canonical
  skeleton roles, so any Mixamo/Biped bone list resolves to a zone.
- Reuses `isSha256` from `characterManifest.js` (hash shape) and
  `mapBonesToRoles` from `skeleton.js` (bone→role), keeping the validator the
  single source of truth.