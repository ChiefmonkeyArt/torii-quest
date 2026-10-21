# ADR-0141: No shader rebuilds mid-play (constant lights, boot prewarm, freeze meter)

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** chiefmonkey: "it was still glitchy on load". The operator installed dispatcher v3, and the autocap pull (run 39574066654) recovered the 2026-10-20 18:48 BST session.
- **Builds on:** ADR-0055 (autocap ring), ADR-0134 (diagnostic access), v0.2.612 (shadow-map toggle removed for the same reason).

## Evidence

The 1 Hz autocap ring fell behind twice, which means the main thread froze:

| When | Gaps between frames | What was happening |
|---|---|---|
| The first ~5 s after entering | 1.79 s and 1.47 s | Arena coming into view |
| The first fight (17:49:04 to 17:49:09 UTC) | 2.47 s and 1.99 s | Bots spotted the player and opened fire; HP 100 → 82 |

The frames themselves look normal: it's a stall, not a rendering bug.

## Cause

three.js bakes the visible light count into every lit material's shader program.

- **Flash lights toggled.** The muzzle/impact/hit flash pool turned its PointLights on and off (`light.visible`), up to 8 on HIGH. Every new count (1, 2, 3 …) recompiled every lit material in the scene: terrain, grass, bots, crates, the NAP zone. Several bots firing at once is exactly when new counts first appear.
- **Feedback loop.** The slow frames then made the adaptive quality tier step down. That changed the count again and triggered another recompile.
- **Lazy compiles.** Shaders also compiled the first frame each thing was drawn, so the arena's first appearance stalled too.

## Decision

1. **Constant light count** (`engine/render/muzzleFlash.js`):
   - `FLASH_LIGHTS = 3` on every tier;
   - the lights are always visible; idle means intensity 0 with a 1 cm range;
   - tiers only cap how many may be lit at once: HIGH 3, NORMAL 2, LOW 0 (were 8/4/0);
   - no code path toggles a flash light's visibility, and a tier change no longer changes the count.
2. **Boot prewarm** (`engine/render/shaderPrewarm.js`): at the end of `bootstrapPhysics`, behind the loading screen, call `renderer.compileAsync` for the world and the gun overlay.
   - It waits up to about 3 s (frame-counted, no timers) for the bot models first.
   - Its own wait is capped in frames.
   - It never throws; on failure the game falls back to lazy compiles, as before.
3. **Freeze meter** (`engine/render/frameHitch.js`):
   - long frames (100 ms and over) are counted while playing, ignoring tab-hidden gaps;
   - exposed as `ToriiDebug.perf` and `snapshot().perf`, together with the prewarm result and the shader program count;
   - so every future autocap frame says when and how long the game froze.

## Verification

The same headless arena run was done twice; the only difference was the flash-light code. The player fired 6 shots after play began, and no bots fired. Shader programs compiled after play started:
- **Old pool (lights toggled):** 15 new programs.
- **New pool (constant count):** 2 new programs (one-off sprite and model materials).

With prewarm, 65 programs are ready when play starts, and the prewarm itself took 61–98 ms. Frame times in software rendering aren't representative, so the real-GPU feel still needs a playtest. The new `perf` block in autocap frames will show it.

## Consequences

- Three always-present point lights cost a little per pixel even when dark. The range cap keeps that small, and the cost is fixed, not a spike.
- Fewer simultaneous flash lights on HIGH (3, was 8). The tracers and head glows (ADR-0138/0139) carry the readability.
- Loading can take up to about 3 s longer while shaders compile. That time moves out of play and into the loading screen.
- Tests:
  - `tests/render/muzzle-flash.test.js`: the visible count never changes through a fight or a tier change;
  - `tests/render/first-fight-hitch.test.js`: prewarm waits, caps and never throws; the meter counts freezes and ignores pauses; the snapshot carries `perf`; wiring.
