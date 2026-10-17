# ADR-0132: NAP sticker feel: playful, immediate, measured feedback

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** chiefmonkey (approved in session on 2026-10-17: "Add the NAP sticker feel pass next"). This is item 2 of `docs/design/gameplay-lessons-nap-and-world.md`.
- **Builds on:** ADR-0131 (Game Zone combat feel) and the sticker system (ADR-0090 and the sticker-skin work).
- **Scope:** NAP zone only. Sticker placement, targeting and lifetime are unchanged. There is no combat, and points are unaffected.

## Context

In the NAP zone a sticker had almost no feedback. The click played the arena's laser "pow" and the old short z-kick, and the NPC played a random gesture when a sticker landed. There was nothing to say "you got them", no sound when it stuck, and the zone of peace shared the gunfight's audio. Each fire also allocated a new `SpriteMaterial` (disposed on landing), and each landing on the NPC ran a fresh dynamic `import()`.

## Decision

Apply the ADR-0131 pattern of immediate feedback on the click plus feedback when the result arrives, but with a playful, non-violent vocabulary.

1. **On the click.** The NAP gun plays its own soft "thwip" (band-passed air sweeping up plus a tiny blip) instead of the arena gunshot. Recoil is the arena curve at `STICKER_RECOIL_SCALE` 0.45. A pink `sticker` hit marker shows when the sticker is heading for a character (NPC, peer or bot); surfaces get none. Stickers have no authority to reject them, and the bone-local bake already guarantees they land on the target they were fired at, so nothing needs voiding.
2. **On landing**, at the end of the 0.22 s flight:
   - a bubbly pop sound, mixed by distance and bearing through `shotMix`, with a deterministic golden-ratio pitch step so bursts don't sound mechanical;
   - a pink `sticker` light flash at the landing point;
   - on a character only: a "STUCK!" pop and a cartoon "boing".
3. **NPC giggle bounce.** The Nakama NPC does a squash → hop → soft-landing bounce over 380 ms (`bounceEnvelope`):
   - squash/stretch peaks at ±8 % and preserves volume (`sxz = 1/√sy`);
   - the hop peaks at 9 cm;
   - the feet stay planted, using an offset of `_minY·(1−sy)`;
   - it is applied before the collider sync, so sticker raycasts see the drawn pose.

   The existing gesture still plays. Peers are not moved, because other players' avatars belong to their owners.
4. **Hooks, not coupling.** `stickerNpc.js` reports `onFire` (synchronous, including misses) and `onLand` through `setStickerFeelHooks`. A throwing hook is caught, so feedback can never break placement. The feel logic is the node-pure module `src/engine/feel/stickerFeel.js`; arenaRuntime injects the HUD, audio, flash and NPC bounce.
5. **Measured.** `ToriiDebug.stickerFeel` reports fired, misses, aimed-at-character/surface, landed, stuck, bounces and click→frame latency; `ToriiDebug.resetStickerFeel()` zeroes it. `ToriiDebug.napNpc` reports the NPC's position and bounce scale.
6. **Efficiency.**
   - One shared flying-sticker material replaces the per-shot material; it swaps from the pink fallback to the texture when that loads.
   - The NPC-gesture import is resolved once instead of on every landing.
   - Both sticker sounds reuse the shared noise buffer, so a sticker never allocates an AudioBuffer.

## Consequences

- **Enables:** the NAP gun feels responsive and friendly, and is clearly distinct from arena combat.
- **Trade-off:** the pink marker is a prediction from the fire-time ray. Because the sticker is bone-locked to its target, prediction and landing always agree.
- **Enforcement:**
  - `tests/sticker-feel.test.js` (19 tests) covers continuity and volume of the bounce curve, the pitch sequence, recoil scaling, the orchestrator driven with fakes, and source contracts for the hooks, the shared material, the cached import, the NPC bounce ordering and the NAP fire path.
  - `tests/gamezone/feel-dom.test.js` also checks the pink marker and STUCK! pop in the pooled HUD, and confirms the sticker audio makes no new buffers.

## Alternatives considered

- **Reusing the arena hit marker and sounds unchanged:** this reads as combat in the zone of peace. Rejected.
- **A flinch on the NPC:** it reads as hurt. The bounce reads as delight.
- **Bouncing peers locally:** this would make other players' avatars move on your screen when they didn't. Rejected.
