# ADR-0016 — Client Bot State Sync: Nameplate Lifecycle + Dead-Bot LOD

Status: **Accepted** (v0.2.626)
Deciders: chiefmonkey
Date: 2026-08-22

## Context

v0.2.625-alpha play test surfaced two visual/state defects tied to client-side
bot lifecycle:

1. **Ghost nameplates.** Screenshot evidence (Doc, Sleepy, Happy, Augustink
   floating in the sky above empty ground) shows dwarf-name labels persisting
   with no body underneath.
2. **Late-life state on distant/dead bots.** Log evidence
   (`[FIRE] hit=dead-bot toi=9.9` streams; distant `hit=none` while `[SHOT]`
   still lands) indicates the client's visible/collider state for dying or
   just-respawned bots can drift from what the player sees.

Investigation:

- The nameplate is created by `_makeNameplate(text)` in `src/botModel.js` and
  added to the scene with `scene.add(this._nameplate)` — it is a **sibling**
  of the character `root`, not a child. It is repositioned every frame in
  `syncTo(x,y,z,rotY)` to hover above the model's head.
- `src/lod.js::applyLod()` culls a bot at distance by setting
  `botModel.root.visible = false`. It does **not** touch the nameplate — so
  when the body is culled, the nameplate stays visible.
- `_syncNetBot()` in `src/bots.js` invokes `applyLod` only on the **alive**
  code path (line ~572). The **dead** code path (lines ~523–550) plays the
  death arc, parks the physics colliders at y = −100, and returns — it
  **never calls `applyLod`**, so `root.visible` retains whatever value LOD
  last assigned. If the bot was at the 'hidden' LOD when it died, its body
  stays invisible while the nameplate keeps updating position → a floating
  label with nothing beneath it.
- The dead code path never explicitly hides the nameplate either. After the
  death arc decays (arc reaches 0 by ~1.3 s), `syncTo(pose.x, fy, pose.z, …)`
  keeps positioning the nameplate at normal head height — even for a
  long-dead corpse.

## Decision

Fix the client bot state sync so nameplates track body visibility 1:1.

### D-1. Nameplate tracks `root.visible`

`BotModel.syncTo()` and `BotModel.updateAnim()` remain unchanged. Introduce
a single invariant enforced by `_syncNetBot` (and the SP `_syncBot`
counterpart) at the end of every frame:

    if (bot.model) bot.model.setNameplateVisible(bot.model.root?.visible === true && st.alive === true);

Add `BotModel.setNameplateVisible(v)` that sets `this._nameplate.visible = !!v`
(no-op if there is no nameplate). This makes the nameplate visible **iff**
the body is visible **and** the bot is alive.

### D-2. Dead bots run LOD after the death arc finishes

In `_syncNetBot`'s dead branch, defer LOD culling until the death arc has
completed. The death arc uses `bot._deathT` and `arc = max(0, 9t − 7t²)`
which returns to 0 by t ≈ 9/7 ≈ 1.286 s. Use `DEATH_ARC_DURATION = 1.3`
as a named constant.

Before returning from the dead branch:

    if (bot._deathT > DEATH_ARC_DURATION) {
      const lod = getLodLevel(pose.x, pose.z, pPos.x, pPos.z, bot.state?.id);
      applyLod(bot.model, lod);
    } else {
      // During the death arc, force the body visible so the ragdoll flight
      // is never popped by LOD mid-animation.
      if (bot.model?.root) bot.model.root.visible = true;
    }

This preserves the death-arc "kill juice" (the corpse always finishes its
flight visibly) and only culls old corpses that are far from the player.

### D-3. Nameplate hides immediately on death

The moment a client observes a bot's alive-transition true → false, hide
the nameplate. This is achieved automatically by D-1 (`st.alive === false`
gates visibility), so no extra call site is needed — but D-1 must be
evaluated on the same frame the alive transition happens, i.e. after
`_syncNetBot` sets `st.alive = false` and before the frame ends.

### D-4. Nameplate hides immediately on LOD-hidden

Also achieved by D-1 (`root.visible === false` gates visibility). No
extra call site needed.

### Scope guardrails (do NOT do in this ADR)

- Do **not** re-parent the nameplate under `root`. That would fix visibility
  incidentally but would also inherit the model's world transform, animation,
  and death-arc — changing the sprite's world position relative to the
  camera. Out of scope; the invariant approach is safer.
- Do **not** change LOD thresholds.
- Do **not** touch server-side spawn/respawn/AI logic.
- Do **not** touch collider parking (y=−100) — the existing behavior is
  correct; the visual sync is what needs fixing.

## Consequences

Positive:

- Screenshot-reported "labels in the sky above nothing" bug goes away.
- Dead bots at distance are culled consistently.
- No wire-protocol change; server unaffected.
- All state changes are on the client render path — reversible by feature
  flag if needed (not adding one; the fix is small).

Negative:

- A late-life bot whose model failed to load will still render no
  nameplate (no `BotModel` instance) — no regression, this is already the
  case in v0.2.625.
- One extra function call per bot per frame (`setNameplateVisible`). O(N)
  where N ≤ 5 bots; negligible.

## Test plan

Add `tests/multiplayer/bot-nameplate-lifecycle.test.js`:

1. **Nameplate hides on death.** Ingest an alive bot, run `_tickNet(dt)`,
   assert nameplate visible. Ingest same bot with `alive=false`, tick,
   assert nameplate hidden.
2. **Nameplate hides on LOD cull.** Ingest an alive bot far away
   (LOD='hidden'), tick, assert `root.visible=false` AND `nameplate.visible=false`.
3. **Nameplate reappears on respawn.** After D-1 hides on death, ingest
   `alive=true` again close to player, tick, assert nameplate visible.
4. **Death arc stays visible under LOD.** Ingest a dead bot far away with
   `_deathT < 1.3`, tick, assert `root.visible=true` (arc protected).
5. **Old corpses LOD-cull.** Advance `_deathT > 1.3`, tick, assert
   `root.visible=false` at distance.

## Alternatives considered

- **Re-parent nameplate under `root`.** Cleaner in theory (visibility
  inherits from parent), but changes the sprite's world transform. Rejected
  — the invariant approach is smaller and preserves world-space positioning.
- **Hide nameplate on kill event only.** Would miss LOD-cull case.
  Rejected.
- **Cull nameplate at distance threshold independent of LOD.** Introduces a
  second threshold, drift-prone. Rejected — piggyback on existing LOD.
