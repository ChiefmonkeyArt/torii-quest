# ADR-0142: Cold-load engine preload on the title screen, and the `?nuked=1` pin lifecycle

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** chiefmonkey: "ship those four as one release... do all the things". This came from the 2026-10-21 screencast review.
- **Builds on:** ADR-0141 (no shader rebuilds mid-play), v0.2.775 Bug H (stale-shell self-heal), v0.2.791 (content-hashed entry).

## Evidence (operator screencast, v0.2.905, site data cleared first)

From ENTER to play took about 15 s:

| Loading step | Time |
|---|---|
| "Loading engine…" (fetching modules) | ≈5–6 s |
| "Growing grass…" | ≈3 s |
| Physics, avatar and world | ≈4 s |

The engine code (`arenaRuntime` 419 KB, `three-vendor` 809 KB, `rapier` 2.2 MB) only started downloading on ENTER. The player had already spent about 30 s on the title screen logging in with the signer.

The address also still carried `?nuked=1` from an earlier self-heal reload. That pin stops the heal from looping, but nothing ever removed it. So in that tab, and in any bookmark of it, the stale-cache self-heal stayed disabled for good.

## Decision

1. **Engine preload on the title screen.**
   - At build time (`tools/enginePreload.mjs`, called from the CSP plugin), the engine chunk, its static imports and the Rapier chunk are listed in `<meta name="torii-engine-preload">`. Chunks the entry already loads are left out, and only safe `./…js` paths are emitted.
   - Once the title screen is ready, `engine/boot/enginePrefetch.js` adds a `<link rel="modulepreload">` for each one, in idle time. It skips chunks already hinted, Data Saver and 2G connections.
   - modulepreload downloads and compiles the modules but does not run them, so no WebGL context or scene is created early. The later `import()` resolves from the module map.
   - The CSP `script-src 'self'` already allows this. Nothing extra goes over the network that ENTER wouldn't fetch anyway.
2. **Clear the pin once the game has booted.** `engine/boot/nukedParam.js` removes `nuked=1` with `history.replaceState`: no reload, no history entry, and other parameters are kept. It runs only after `bootstrapPhysics` succeeds, so the loop guard is still in place for the whole boot it protects.
3. **Fill light.** The scene ambient goes from 0.55 to 0.8 (`AMBIENT_FILL`), because faces turned away from the low sun went near-black up close. It stays a single uniform, so there is no shader-program change and no per-light cost (ADR-0141 still holds).

## Consequences

- A visitor who never presses ENTER downloads the engine code (≈3.4 MB; cached and shared with the next visit). We accept this for a game whose title screen exists to lead into play. Data Saver and 2G opt out.
- A stale cache can now be healed again in a tab that was healed before.
- The scene is slightly flatter in the shade; the sun still dominates lit faces.
- Tests: `tests/boot/cold-load-and-pin.test.js` (build list, safe meta, preload once, skips existing hints, Data Saver/2G, never throws; pin removal semantics and wiring order; ambient constant). Headless check: the preload links appear on the title screen and `/?nuked=1&x=2` becomes `/?x=2` after entering.
