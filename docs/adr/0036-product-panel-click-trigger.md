# ADR-0036: Product Panel Click Trigger, Decoupled From Kami Mode

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0026 (auction-panel), ADR-0034 (Kami visual unification),
  ADR-0035 (product/auction boards), `src/engine/world/proofSurfaceSpecs.js`,
  `src/engine/world/proofSurfaceMeshes.js`, `src/arenaRuntime.js`,
  `src/engine/plebeian/marketStall.js`, `src/engine/plebeian/ownerBoards.js`

## Context

ADR-0035 shipped three DOM-overlay boards (Live Products, Live Auctions, Past
Auctions) that auto-show whenever the player is inside the NAP zone, gated
only by `_inNapNow && !kamiActive()`. The pre-existing `#auction-panel`
(ADR-0026) auto-shows on the same `_inNapNow` condition.

This was wrong on two counts, confirmed directly with chiefmonkey after a
screenshot review:

1. **Auto-show was never wanted.** These panels are meant to appear only when
   the player interacts with the in-world "PRODUCT" sign mesh that has stood
   between the mirror and the torii gate for weeks (`product-stall-panel` in
   `proofSurfaceSpecs.js`, position `{x:5, y:2.0, z:31}`, rendered by
   `proofSurfaceMeshes.js`). That mesh is explicitly documented as
   "DISPLAY-ONLY and INERT: no click handlers, no raycast/interaction" — it
   has never had any interaction wired to it.
2. **Kami Mode has nothing to do with these panels.** The `!kamiActive()`
   gate added in ADR-0034/0035 was scope creep — the market/auction panels
   and Kami Mode (ema notes, emagake rack) are unrelated systems that happen
   to both live in the NAP zone. Gating one on the other caused the exact bug
   reported: entering Kami Mode did not hide the boards reliably, and boards
   showed regardless of any deliberate player action.

## Decision

Remove NAP-zone auto-show entirely from `setMarketActive` / `setBoardsActive`.
Add a proximity + keypress trigger to the existing in-world PRODUCT sign mesh
(`product-stall-panel`): when the player is within range, a small "Press Q"
prompt appears; pressing `Q` opens the auction-panel and the three ADR-0035
boards together. Mouse-click was ruled out for this first pass — the game
holds pointer-lock during play (mouse drives the camera, no cursor), so a
true click would require breaking pointer-lock; proximity+key needs no such
change (chiefmonkey, 2026-08-23: "for now just walk close and press e", key
later confirmed as `Q` since `E` was already in use elsewhere).
Kami Mode's `kamiActive()` gate is removed from both panel systems — they no
longer reference Kami state in either direction. Closing the panels requires
an explicit close/X control on the panel UI, not a second `Q` press
(chiefmonkey, 2026-08-23: "No, need a separate close button").

## Consequences

- **Enables:** a real first interaction on the PRODUCT sign mesh; panels that
  open only on deliberate player action; Kami Mode and market panels can
  evolve independently without cross-breaking each other.
- **Forecloses:** any future implicit auto-show tied to zone entry for these
  panels — opening must always be an explicit user action from here on,
  unless a future ADR revisits this.
- **Trade-offs:** the sign mesh needs a new raycast hit-test wired into the
  existing click/interaction pipeline; a close control must be added to the
  panel markup (previously relied on the NAP-exit auto-hide, which is now
  gone).
- **Enforcement:** `_inNapNow` is no longer read by `setMarketActive` /
  `setBoardsActive` at all — removing the auto-show path outright rather than
  defaulting it off, so it cannot silently regress back on.

## Alternatives considered

- Keep NAP-zone auto-show but exclude Kami Mode from the gate — rejected:
  still shows panels the player never asked to see.
- Toggle on re-click of the sign — rejected by chiefmonkey in favor of an
  explicit close control, to avoid accidental re-closing while trying to
  interact with the open panel.

## Notes

- The PRODUCT sign mesh position/spec already exists and is correctly placed
  per the screenshot (between mirror and torii gate); no visual/position
  change needed, only the interaction wiring.
- The old `#auction-panel` (ADR-0026) and the three ADR-0035 boards open
  together as one action for now; splitting them further is deferred to a
  future ADR if needed.
