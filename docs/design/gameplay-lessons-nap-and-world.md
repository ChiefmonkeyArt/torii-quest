# Applying the Game Zone lessons to the NAP zone and the wider world

Status: **proposal, for operator review**. Nothing here is approved or built. Game Zone v2 (ADR-0130) and its feel pass (ADR-0131) are the only shipped changes. Items are ordered by player-visible value per unit of risk. Each one names the shipped pattern it reuses.

## The patterns that worked

| Pattern | Where it lives now | What it fixed |
| --- | --- | --- |
| Hit what you see | `gamezone/client/hitbox.js` (exact skinned triangles, cached per frame) | Collider ≠ drawn mesh (67 % → 99.99 % agreement) |
| One authority, one copy of the rules | `gamezone/core/sim.js` | Two simulations disagreeing (ghosts, bots that wouldn't die) |
| The snapshot is the roster | `gamezone/client/reconciler.js` | Stale views lingering |
| Tick-addressed time | `core/history.js` + `client/tickClock.js` | Wall-clock and ping guesswork |
| O(1) world queries | `core/arenaWorld.js` (0.5 m grid) | 25 µs terrain predicates on hot paths |
| Pooled, fixed-cost effects | `client/fx.js`, the HUD feel pools | Per-event allocation and GC hitches |
| Predict on click, confirm or retract | `gameZone.js` + `feel.js` | "Not snappy" without lying |
| Measure first | `npm run bench:gamezone`, `ToriiDebug.gz.feel` | Tuning by feel alone |

## NAP zone

1. **Stickers land exactly where you aimed.** *Hit what you see.* Sticker hits on the NAP NPC use Rapier per-bone ball sensors plus a broad capsule (`stickerNpc.js`). That is the same collider-versus-drawn-mesh gap that broke bot hits, and the bot rigs showed how far off bone-based placement can be. Reusing `hitbox.js` would give exact triangle placement on the drawn skin, faster and with no Rapier sensors to maintain. *Measure:* add a sticker bench mode that checks the placement point against the skinned-mesh truth.
2. **Sticker feel pass.** *Predict and confirm; pooled feedback.* Show a small "stuck!" marker and a soft pop sound on the click frame. The NPC gives a playful reaction, such as a giggle bounce rather than a flinch, using the same pivot-lean technique with a non-violent curve. Reuse the arena recoil curve at lower strength for the sticker gun.
3. **No ghost NPCs or peers in the NAP.** *The snapshot is the roster.* Apply the same reconcile invariant and a randomised no-ghost test to remote avatars and NAP NPCs. Today `remoteAvatars.js` has a separate peer-left recovery path (audit F2).
4. **Spatial audio for social cues.** *Distance mix and pan.* Peer footsteps, chat pings, NPC gesture sounds and portal hum would use `shotMix`, so you can hear where people are.
5. **Directional social hints.** *Damage arc, reused gently.* A soft arc pointing towards someone who waved, mentioned you, or placed a sticker on you while they're off-screen.

## Whole world

6. **Smoother peers everywhere.** *Tick-addressed time.* Peer movement interpolates on a client-clock render time with `INTERP_DELAY_MS` = 100 (`positionSync.js`). Moving it onto the server tick (`tickClock` + `history`) removes clock-offset jitter and extrapolation snaps for every avatar in every world.
7. **Footstep and landing audio stop allocating.** *Pooled, fixed-cost.* `playFootstep`, `playJumpLand`, `playSplash` and the player's `playShoot` still build and randomly fill a fresh noise buffer on every call, and footsteps fire many times a second while moving. Caching one buffer each, as the bot shot now does, is a small, safe efficiency win.
8. **O(1) ground queries off the arena too.** *Grid world.* Footing, walkability and line-of-sight for the player controller, NAP NPC wandering and portal approach can come from the same lazily filled grid instead of per-call terrain predicates.
9. **Kill feed, chat bubbles and nameplates without per-event DOM.** *Pooled UI.* `addKill` still creates DOM and uses `setTimeout` per entry. Moving these onto fixed pools driven by `tickHUD` gives no timers and no layout churn.
10. **One latency meter for every interaction.** *Measure first.* The click→frame meter generalises to E-to-interact, portal entry, menu open and world swap. Adding it to `ToriiDebug` and a committed headless smoke harness (today's browser checks live outside the repo) would make "snappy" a number for the whole game.
11. **Claims plus validation for multi-user actions.** *One authority.* Any action another player can see, such as stickers on peers or crate pushes, should follow the GZ pattern: the client claims what it saw, and the node validates and broadcasts.

## Suggested order

Start with **1 and 2** (NAP stickers: most visible, self-contained), then **7** (tiny, safe), then **6** (biggest feel win world-wide, needs a multiplayer playtest), then **3** and the rest. Each lands as its own PR, with bench or meter numbers and an ADR where architecture changes.
