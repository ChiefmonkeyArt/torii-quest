# ADR-0020 — Complete stale-bot cleanup (clear wrapper array + colliders)

**Status:** Accepted
**Version:** v0.2.629-alpha
**Date:** 2026-08-22

## Context

ADR-0019 (v0.2.628-alpha) cleared `_botNet` (the interpolation buffer) on disconnect to fix frozen nameplates. The first clean 1-bot play test showed the bug was **not** fixed: "Augustink" still floated over the water and multiple bots appeared frozen, despite the server running `TEST_MODE=true BOT_COUNT=1 BOSS_COUNT=0` (one Doc bot, zero bosses).

## Root cause

The nameplate sprites are not owned by `_botNet`. They live in a **separate** module-level `bots` array (`src/bots.js:44` — the wrapper objects that pair a `BotModel` with its THREE.js root + nameplate sprite).

`_botNet.clear()` emptied the interpolation buffer, but the `bots` wrapper array was **never cleared**. So after a roster change:

1. `_tickNet` iterates `_botNet.sample()` (now empty) → no `_syncNetBot` runs for stale wrappers.
2. But the stale wrappers' `BotModel` (root + nameplate sprite) were still `scene.add`-ed and never removed.

Result: the boss's model + "Augustink" nameplate stayed in the scene forever, frozen at their last position. The clear in ADR-0019 targeted the wrong structure.

## Decision

On disconnect (`setBotNetMode(false)`), tear down the **entire** MP bot scene, not just the interpolation buffer:

1. `_botNet.clear()` — empty the interpolation buffer (as before).
2. `_clearAllBots()` — new: for each wrapper, `model.dispose()` (removes root + nameplate sprite from the scene), remove the fallback capsule mesh, and `removeBotColliders(bot)` (removes body/head/bone colliders from the Rapier world + clears the collider→bot/part lookups). Then `bots.length = 0`.

`removeBotColliders` is a new export in `src/engine/physics/bodies.js` (re-exported via `src/physics.js`), mirroring the existing `removeNpcBoneColliders` for the body/head kinematic colliders.

## Scope

- `src/bots.js` — `_clearAllBots()` + call it in `setBotNetMode(false)`.
- `src/engine/physics/bodies.js` — `removeBotColliders(bot)`.
- `src/physics.js` — re-export `removeBotColliders`.

Server unchanged. Wire protocol unchanged. `_botNet`/`bots` are MP-only (SP reads `sim.bots` directly), so single-player is unaffected.

## Consequences

**Positive:** stale bots (models + nameplates + colliders) are fully removed on disconnect — no more frozen "Augustink" or phantom labels after a roster change.

**Neutral:** on a brief WS drop without a server restart, bots disappear for one frame before the next snapshot re-populates them. Acceptable.

**Negative / risks:** none material. `_clearAllBots` runs only on the MP→off transition; the physics world and scene are only touched through existing dispose/remove paths.

## Verification

- `tests/multiplayer/bot-collider-removal.test.js` — 3 real cases against the actual `bodies.js` module with a mocked Rapier world: removes body+head colliders and clears lookups; safe no-op when the world is uninitialised; removes bone colliders too.
- Gates: build OK, regression ALL GREEN, vitest 2953/2953 across 225 files.

## Still open (unchanged from ADR-0019)

- "Doc floating above a cube" — a *current* bot with a hidden body but visible nameplate (separate from stale-bot cleanup).
- "Dead Doc shooting" — needs bot-shot logging.
- Gun intermittently not firing — separate client weapon bug.
