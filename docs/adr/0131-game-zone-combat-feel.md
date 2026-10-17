# ADR-0131: Game Zone combat feel: immediate, honest, measured feedback

- **Status:** Accepted
- **Date:** 2026-10-17
- **Deciders:** chiefmonkey (approved in session on 2026-10-17: "Do all of the above"). This covers hit markers, kill confirmation, bot reactions, gun feedback timing, feedback latency and the small extras.
- **Builds on:** ADR-0130 (Game Zone v2). The points are unchanged: head 9, body 3, bot 5 HP, boss 60 HP, player 100 HP, +5 sats per kill.

## Context

ADR-0130 made combat correct: what you see is what you hit, and the shared sim decides every outcome. Correct is not the same as satisfying. Before this change, landing a shot gave only two cues. A 0.25 s orange crosshair tint was one. The other was a full-screen red vignette, the same one used when you take damage, so a hit you landed looked like you were the one being hurt. Kills had a kill-feed line only. Bots did not react to non-lethal hits. Bot gunfire played at one volume from every distance. The recoil was a 5 cm z-kick with no climb.

## Decision

All feedback lives in the game zone client and the arena HUD, and none of it can change an outcome.

1. **Predict on the click, confirm or retract.** Hit marker, damage number, hit sound and bot reaction all show on the frame of the click, from the client hitbox claim. A rejected `result` pulls the marker within 70 ms (`MARKER_VOID_MS`) and removes the number. A zone downgrade re-shows the number the authority actually applied.
2. **Marker grammar.** There are four marker kinds of rising emphasis: body (white), head (gold), kill (red) and headkill (red and gold, largest). Each has its own lifetime (`MARKER_MS`) and its own sound: a dry tick for body, a bright "tink" for head, and a rising two-note for a kill, with a sparkle added for a headshot kill.
3. **The reward is honest.** `+5⚡` pops only when the authority's `kill` event pays it. A headshot kill is named in the kill feed.
4. **Bot reactions.** On a hit, the bot leans away along the shot about its feet. The lean is a pivot group between the holder and the model, with a fast-attack, eased-recovery envelope over 170 ms. Peaks are `FLINCH_BODY_RAD` 0.07 and `FLINCH_HEAD_RAD` 0.12. A headshot kill plays the death clip 1.4× faster (`HEADSHOT_DIE_SPEED`). Hit tests read the skinned world matrices, so the lean is hit exactly as drawn. The constants live in `core/constants.js` because the bench validates honest claims against a bot at maximum lean.
5. **Gun feedback.** The arena recoil is a 6 cm z-kick plus a 0.075 rad muzzle climb with a smoothstep settle over 95 ms, started in the same input event as the shot sound, muzzle flash, tracer and marker. The NAP sticker gun keeps its original kick.
6. **Screen kick.** Headshots and kills roll the camera by at most 0.012 rad, as a damped wobble over 110 ms. It is roll only, so the crosshair and aim line never move.
7. **Damage direction.** When a hit actually costs HP, a red arc around the crosshair points at the bot or peer that fired. God mode and Kami produce no arc. The red vignette is now used only for damage taken.
8. **Spatial gunfire.** Bot shots are mixed by distance (full volume within 6 m, `(6/d)^1.2` roll-off, a 0.06 floor, silent beyond 90 m) and panned by bearing. One shared noise buffer replaces a freshly allocated, randomly filled buffer per shot.
9. **Measured.** `ToriiDebug.gz.feel` reports click→first-frame latency (p50, p95 and max from a fixed 64-sample ring), markers shown, the share of markers voided, predicted and confirmed kills, and damage arcs.

Implementation details:
- `src/gamezone/client/feel.js` holds the maths, pure and allocation-free.
- The HUD elements are pooled: one marker with four bars, six floating texts and four arcs. They are animated from `tickHUD`, with no timers and no DOM created per hit.

## Consequences

- **Enables:** feedback that is instant and still trustworthy, plus numbers to tune against: latency, void rate, and the bench's flinch gate.
- **Trade-off:** a sound cannot be un-played. If the authority rejects a predicted hit, its tick has already sounded. Measured void rates are about 0 % (bench: 0 % honest-claim rejection), so this is accepted.
- **Enforcement:**
  - `tests/gamezone/feel.test.js` covers the maths, the bot flinch, and the real game zone client driven through GZ_SNAP/GZ_EVENT frames.
  - `tests/gamezone/feel-dom.test.js` covers the pooled HUD in jsdom, the audio node counts and the cached noise buffer.
  - The bench now fails if a flinching bot causes more than 0.5 % honest-claim rejections. The measured rate is 0 % for both the regular bot and the boss.

## Alternatives considered

- **Show feedback only after the authority confirms:** honest, but it adds a full round trip (50–150 ms) to every hit, which is the "not snappy" problem.
- **Pitch camera shake:** moves the aim line between shots. Rejected in favour of roll.
- **Skeletal hit-reaction clips:** the bot rigs have no clean hit clips, and the banker rig is malformed (ADR-0130). A procedural lean is cheaper and bench-verifiable.
