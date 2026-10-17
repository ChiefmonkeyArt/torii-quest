# ADR-0133: Game Zone bot colour restore and multiplayer hand-over hold

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** chiefmonkey (play-test report on 2026-10-17: "there were still some glitches at the beginning on entering it... also all the bots are very dark as if in shade").
- **Builds on:** ADR-0130 (Game Zone v2: one authority, roster reconciliation) and ADR-0131 (combat feel).
- **Scope:** Game Zone client only. Points, damage, the NAP zone and the rest of the world are unchanged.

## Context

**Dark bots.** Both bot models (`public/banker-rigged.glb`, `public/augustink4.glb`) get their colour from an emissive texture (`emissiveFactor` [1,1,1] plus an `emissiveMap`). They are metallic and the arena has no environment map, so the emissive channel is what the player sees. The v2 hit flash wrote `emissive = red × k` and faded k to 0, which left emissive black after the first hit. Every bot that had ever been hit stayed dark for good, including after respawning (views persist across respawns). The legacy `botModel.js` had restored the original emissive; v2 lost that.

**Start-up glitches.** At boot the client started the in-browser (local) authority straight away, so local bots spawned. A second or so later multiplayer connected and the first `GZ_SNAP` arrived. `_switchTo(net)` then disposed every view and rebuilt the node's bots at different positions in one frame: a visible pop/teleport plus a rebuild hitch of five skinned clones. The same happened after Home (`resumeFromTitle` re-dials), after travel, and on every connection blip, which swapped twice (net → local → net).

## Decision

1. **Hit flash restores, never darkens.** `src/gamezone/client/hitFlash.js` (`createHitFlash(materials)`) records each cloned material's own emissive colour and intensity once. `apply(k)` blends from that original toward red; `k = 0` restores the original exactly. It is a no-op at rest, so there are no per-frame writes when nothing is flashing. `botView` uses it in place of the raw `setRGB`.
2. **Hold, don't swap.** `gameZone` gains a hold deadline:
   - `holdForNet(ms = NET_HOLD_MS = 5000)` is called by `arenaRuntime` before each `_mp.start()` (boot, re-entry after Home, travel rejoin).
   - Creating the net authority (connected, no snapshot yet) holds `NET_WAIT_MS` (3000).
   - Losing the node mid-game holds `NET_HOLD_MS` and disposes the stale net. A restarted node may reuse lower tick numbers, which the old net would drop as stale.
   - While holding, no bots are drawn and fire does nothing, unless a local game is already running. Offline play is never interrupted.
   - When the node's first snapshot lands, the client switches straight to it. If the hold expires first, the local sim starts, exactly as before.
3. **Observability.** `ToriiDebug.gz` reports `holding`, `holds` and `handovers` (world swaps between two live authorities). The normal multiplayer entry now shows `handovers: 0`.

## Consequences

- Hit bots keep their full colour. The rule is covered by `tests/gamezone/hit-flash.test.js`.
- On a multiplayer entry the player sees the node's bots first, with no throwaway local world. A guest without a signer, or an offline node, waits at most 5 s before the local sim starts. Covered by `tests/gamezone/net-handover.test.js`.
- A connection blip briefly shows no bots instead of a foreign world, with one rebuild on reconnect instead of two.
- The start-up cause was diagnosed from code and headless runs. The 1 Hz Kami capture ring was not readable from this session, so the live acceptance is the operator's play-test.
