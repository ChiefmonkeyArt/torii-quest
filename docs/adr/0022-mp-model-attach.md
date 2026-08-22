# ADR-0022 — MP must attach its own GLB models to authoritative rows

**Status:** Accepted
**Version:** v0.2.631-alpha
**Date:** 2026-08-22
**Follows:** ADR-0021 (which exposed this latent bug)

## Context

After ADR-0021 correctly removed the client's local bot roster in MP, the play
test showed the intended single bot — but rendered as the **purple fallback
capsule** (`_colors[0] = 0x8b5cf6`), with no GLB model and, as the user observed,
no head or limb colliders.

## Root cause

`_tickNet` materialises every authoritative server row as a capsule placeholder
via `_makeCapsuleBot` so that no bot can shoot a player without a render-side
counterpart. That part is deliberate. What was missing: **nothing ever upgraded
the placeholder to the GLB model.**

- `_modelsReady` was assigned (`bots.js:248`) and **never read anywhere**.
- `_attachModelBot` was called **only** from the `initBots()` single-player path.

So MP never had a model-attach path at all. It worked **by accident**: the SP
init path eagerly spawned a full local roster *with* models, and `_tickNet`'s
`_botById(p.id)` lookup then found those already-modelled wrappers whenever a
server bot id happened to match a local one. The local roster was effectively
acting as a model supplier for MP.

Removing the local roster (ADR-0021, correct on its own terms) removed that
accidental supply, leaving only the capsule. No model ⇒ no `SkinnedMesh` ⇒
`createBotBoneColliders` never runs ⇒ no per-bone limb colliders. The body and
head colliders were still present (created by `_ensureBotColliders`), which is
why the bot remained shootable at all.

A second gap: `preloadBossModel()` was only ever kicked off inside the (now
net-gated) `initBots` continuation, so in MP the boss template was never fetched.

## Decision

Give MP its own model lifecycle, in `_tickNet`, upgrading each row in place as
soon as the relevant template is ready:

```js
if (_modelsReady && !bot.model) {
  if (p.kind !== 'boss')        _attachModelBot(bot.state, 'regular');
  else if (_bossModelReady)     _attachModelBot(bot.state, 'boss');
  else if (_bossFallbackRegular) _attachModelBot(bot.state, 'regular');
  else                          _ensureBossPreload();  // capsule until GLB lands
}
```

- `_attachModelBot` already handles the upgrade-in-place case: it removes the
  capsule mesh, swaps in the model, and builds bone colliders when
  `physicsReady && model.skinnedMesh`. `BotModel.init` is synchronous once the
  template is cached and assigns `skinnedMesh` (`botModel.js:149`), so the limb
  colliders are created in the same tick.
- `_ensureBossPreload()` (new) fetches the boss template once in MP, with a
  regular-model fallback on failure — mirroring the SP behaviour.
- The `!bot.model` guard makes the upgrade idempotent across ticks.
- `_modelsReady = true` is assigned *before* the ADR-0021 net guard returns, so
  the regular template still loads in MP.

## Scope

`src/bots.js` only. No server change, no wire-protocol change, no damage,
authority, or collider-geometry change. SP path untouched.

## Consequences

**Positive:** MP bots now render the correct GLB with nameplates and get full
per-bone limb colliders, independent of any local roster. The MP render path no
longer depends on an accidental id collision with SP-spawned bots.

**Neutral:** a bot may appear as a capsule for the few hundred ms before its
template resolves (and longer for the ~7.6 MB boss GLB). Intentional — it keeps
the authoritative row shootable rather than invisible.

**Negative / risks:** none identified. Body/head colliders are unchanged; bone
colliders are additive and built only when a `SkinnedMesh` exists.

## Verification

- `tests/multiplayer/mp-model-attach.test.js` — 8 cases: capsule upgrades to the
  regular GLB; limb colliders built on attach; stays a capsule with no limb
  colliders while templates are unready (body/head still present); server name
  reaches the nameplate label; no double-attach across repeated ticks; boss
  deferred with preload kicked off then attached when ready; regular-model
  fallback when the boss GLB fails; mixed roster in one tick.
- Gates: build OK, regression ALL GREEN, vitest 2967/2967 across 227 files.

## Known pre-existing flake (NOT introduced here, NOT fixed here)

`tests/multiplayer/player-bot-combat.test.js` → "a torso-height shot from player
eye registers a body HIT on a regular bot" failed once in three full-suite runs
and passes in isolation. It imports only server modules (`arenaBotSim`,
`botColliders`, `heightmap`, `config`) and never touches `src/bots.js`, so it is
independent of this change.

Mechanism: bot spawn positions use unseeded `Math.random()`
(`src/engine/entities/botSim.js:145-146`). The test selects the highest-X regular
bot and fires horizontally along -X from 3 m, so when another bot randomly spawns
between shooter and target the ray resolves to the wrong bot and the `botId`/
`zone` assertion fails. Same family as the known `bot-sim.test.js`
"holds position within regular standoff" flake.

Suggested fix (needs approval — deliberately not done here): inject a seeded RNG
into `createBotSim`/`createArenaBotSim` so spawn layout is deterministic under
test.
