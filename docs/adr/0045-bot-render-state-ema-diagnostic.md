# ADR-0045: Bot render-state ema diagnostic (v0.2.666-alpha)

- **Status:** Accepted (diagnostic deploy)
- **Date:** 2026-08-24
- **Decides:** Add per-bot render state to the kami ema snapshot to NARROW the
  bot-model-not-rendering bug instead of guessing the root cause.

## Context

v0.2.665 ema + screenshots show bots as dark cubes with floating dwarf-name
nameplates — the GLB character models are NOT consistently attached/rendered.
One screenshot shows "Sleepy" as a cube (no model) + "Doc" as a tiny glowing
humanoid (model loaded, wrong scale) in the SAME frame → inconsistent model
loading across bots. The name fix (ADR-0044, v0.2.664) worked + revealed this
underlying render bug.

The user's standing instruction: "never guess anything… always check the code
and propose logical fixes or methods to narrow down and diagnose a solid fix…
this must stop." So this deploy does NOT change the model/loader/LOD path. It
instruments the ema snapshot so the next ema tells us WHICH branch is broken.

## Decision

Add a `bots` array to `ToriiDebug.snapshot()` (the object sealed into every
ema) carrying per-bot render state, read behind `safe()` so a half-attached bot
wrapper never throws the snapshot:

```
{ id, label, kind, hp, alive, isDying,
  hasModel, modelLoaded, hasRoot, rootVisible,
  nameplateVisible, hasCapsule, capsuleVisible,
  dist, scale }
```

- `snapshot.js` `buildSnapshot` gains `bots: safe(p.getBotRenderStates)`.
- `toriiDebug.js` `snapProviders` gains `getBotRenderStates` mapping the live
  bot roster (`b.model` / `b._capsuleMesh` / `b.state` / `playerObj.position`)
  into the compact shape above.

No runtime combat / model / LOD change. No new test (pure provider behind
`safe()`; existing snapshot.test.js stays green).

## Which branch each field narrows

- `modelLoaded=false` → GLB template load failed (asset path / deploy / parse).
- `hasModel=false` + `hasCapsule=true` → fallback capsule never upgraded to the
  real model (the `_attachModelBot` in-place upgrade path is broken).
- `rootVisible=false` while `nameplateVisible=true` → ADR-0016 LOD/nameplate
  invariant regression (LOD hides `root` but the nameplate sprite is not
  touched).
- `modelLoaded=true` but `scale` far from 1 (or `hasRoot=true` with tiny bounds)
  → scale / clone / bounds issue.
- `hasCapsule=true` + `hasModel=true` + both visible → attach cleanup bug (old
  fallback not removed).

## Next step

User hard-refreshes on v0.2.666, shoots at bots, hangs an ema. The `bots` array
in that ema identifies the broken branch → the real fix (not a guess).

## Separately noted (NOT fixed in this deploy)

- Long-range shots "on target but no effect": client predicts `aim.kind=bot` /
  "Body hit." but the projectile resolves `moved-or-offset` at ~20–23m.
  `BULLET_SPEED=60`, flight ~0.35s, `BOT_SPEED=2.2` → bot moves ~0.73m during
  flight > body capsule radius. Likely a projectile-lead problem; a snappy
  arcade feel may need hitscan (player→bot) or a lead-aware predictor. Needs a
  user decision before changing combat feel.
- Cover inconsistent: ema #6 "shot bots through a box" vs ema #7 headshots
  "blocked" — server raycast blocker order. Separate, after the render + hit-feel
  issues.
