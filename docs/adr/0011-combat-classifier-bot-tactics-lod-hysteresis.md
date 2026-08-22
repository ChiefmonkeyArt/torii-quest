# ADR-0011: Combat classifier, bot tactics, and LOD hysteresis baseline (v0.2.608 forward-port)

- **Status:** Accepted
- **Date:** 2026-08-22
- **Deciders:** chiefmonkey
- **Related:** `src/engine/combat/classifier.js`, `src/engine/entities/bot-tactics.js`,
  `src/bots.js`, `src/engine/physics/bodies.js`, `src/lod.js`,
  `server/bots/botColliders.js`,
  `tests/classifier.test.js`, `tests/bot-tactics.test.js`,
  `tests/multiplayer/bot-sim.test.js`,
  ADR-0006 (server-authoritative HIT), ADR-0007 (damage table parity)

## Context

Under the pre-v0.2.608 baseline, three independent quality-of-play issues
were live:

1. **Hit classification edge cases.** The client's zone classifier
   (`head|body|limb`) had thin spots at capsule ends; MP hit-reg
   sometimes disagreed with SP visual feedback.
2. **Bot tactics were too uniform.** Bots pursued and shot with a single
   difficulty curve, creating flat encounters.
3. **LOD popping.** Level-of-detail bands used single thresholds, so a
   player straddling a boundary saw a rapid, distracting LOD flip.

v0.2.608-alpha shipped fixes for all three; they were reset out with the
v0.2.605 baseline. This ADR forward-ports and locks them.

## Decision

Adopt the v0.2.608-alpha implementations of:

1. **Combat classifier** (`src/engine/combat/classifier.js`) —
   tightened zone thresholds, deterministic given ray-vs-capsule
   inputs; parity with `server/combat/damageTable.js` remains via
   ADR-0007.
2. **Bot tactics** (`src/engine/entities/bot-tactics.js`,
   `src/bots.js`, `server/bots/botColliders.js`) — difficulty tuning
   with per-bot personality bands and honing behaviour.
3. **LOD hysteresis** (`src/lod.js`, `src/engine/physics/bodies.js`) —
   entry and exit thresholds differ for each LOD band; a player must
   cross a wider gap to trigger a downgrade than to trigger an
   upgrade. Prevents boundary flapping.

The tests `tests/classifier.test.js`, `tests/bot-tactics.test.js`, and
`tests/multiplayer/bot-sim.test.js` encode the intended behaviour and
run in vitest.

## Consequences

- **Enables:** better MP hit-reg agreement between client feedback and
  server-authoritative resolution (ADR-0006); more varied bot combat;
  stable LOD when a player hovers on a threshold.
- **Forecloses:** silent tuning of these constants without a test update;
  reverting the classifier to the pre-v0.2.608 shape.
- **Trade-offs:** the tuning is opinionated. Future rebalancing is fine
  but must land as a new ADR (or supersede this one) if it changes the
  invariants the tests encode.
- **Enforcement:** vitest test files listed above.

## Alternatives considered

- **Leave the v0.2.605 shape**: rejected — the three bugs are visible in
  play.
- **Bring in only a subset of the three**: rejected — they were shipped
  together, tested together, and touch orthogonal files. Cheaper to
  lock as one unit than to introduce three ADRs.

## Notes

Does NOT touch the ADR-0010 surface (pointer-lock, ESC, crosshair
listener, boot flow, SW). Forward-ported cleanly from
`v0.2.608-alpha` onto the v0.2.605 baseline as part of v0.2.622-alpha.
