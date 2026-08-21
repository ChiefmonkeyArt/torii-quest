# ADR-0007: Server↔client damage-table constants are locked (head=9, body=3)

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `src/engine/combat/damage.js`, `server/combat/damageTable.js`,
  `tests/multiplayer/damage-table-parity.test.js`,
  `tools/regression-check.mjs` (rule #18)

## Context

The client renders local hit feedback (flinch, tracer, reticle flash)
against a damage model; the server resolves authoritative damage
(ADR-0006) against its own model. If those two models disagree, the
UI shows a kill the ledger denies (or vice-versa). Players notice
instantly and lose trust in the game.

## Decision

The damage table is copied — deliberately, not imported — into both
trees:

- `src/engine/combat/damage.js`: `HEADSHOT_DAMAGE = 9`, `BODY_DAMAGE = 3`
- `server/combat/damageTable.js`: same constants, verbatim

The parity test `tests/multiplayer/damage-table-parity.test.js` imports
BOTH modules and asserts equality. Any drift breaks CI.

Kill-threshold contract (with `BOT_HP = 5`), enforced by unit tests:

- HEADSHOT one-shots (`HEADSHOT_DAMAGE >= BOT_HP`)
- One BODY shot does not kill (`BODY_DAMAGE < BOT_HP`)
- Two BODY shots do kill (`2 * BODY_DAMAGE >= BOT_HP`)

## Consequences

- **Enables:** client feedback matches server ledger. Any tuning change
  must land in both files simultaneously or CI blocks it.
- **Forecloses:** cross-tree imports that would couple server and
  client. The parity is enforced by test, not by shared code.
- **Trade-offs:** two source-of-truth files instead of one. The parity
  test makes this safe.
- **Enforcement:** `tools/regression-check.mjs` rule #18 asserts the
  constants match. The parity unit test runs in vitest.

## Alternatives considered

- **Shared package**: rejected — introduces server↔client coupling that
  we've deliberately avoided elsewhere; a two-line copy with a parity
  test is simpler.
- **Server imports from `src/`**: rejected — same objection.

## Notes

`limb` is reserved on the wire (see `wireProtocol.js` LIMITS.ZONES) but
the shipped ray tester emits only `head` and `body`. If we ever tune
damage per limb, this ADR needs an update.
