# Torii Quest — Code Index

> Lightweight developer/agent index. Keep this practical and update it as systems are touched.
> Purpose: help future debugging, SDK extraction, FOSS contribution, and AI handoff speed.

Current version: `v0.2.127-alpha`  
Live site: [torii-quest.pplx.app](https://torii-quest.pplx.app)

---

## Index Rule

When a bug fix or feature pass stabilises a system, update at least one of:

- SDK/API seam
- `window.ToriiDebug` hook
- regression/smoke check
- this index

Do not abstract imaginary systems. Index proven systems and extract boundaries from working code.

---

## Core Runtime Areas

| Area | Current location / seam | Notes |
|---|---|---|
| Version/config | `src/config.js`, `index.html`, `tools/regression-check.mjs` | Version must bump every deploy. `godMode` must remain false. |
| Game state | `src/state.js` | v0.2.115 added the explicit state machine: `PHASE` + `GAME_EVENT` + transition table; `transition(event)` is the only write path; predicates `isTitle/isPlaying/isPaused/isDead/isGameover/isLive`. All phase reads/writes route through this seam. Check 7 guards against direct `state.phase =` writes elsewhere. v0.2.116: `transition()` also emits `EV.PHASE_CHANGE`. |
| Event bus | `src/events.js` | Decoupling seam — modules publish/subscribe by name instead of importing each other. `EV` is the canonical registry; `on/off/emit`. Imports nothing (no cycles). v0.2.116 wired `EV.PHASE_CHANGE` (payload `{from,to,event}`) from `state.transition()` and added check 8 (every `EV.<NAME>` reference must be defined here). v0.2.117 migrated the bot-hit bridge onto the bus: weapons.js emits `EV.BOT_HIT_BY_PLAYER` (`{bot,dmg}`), main.js subscribes (`hitBot`+`flashCross`); the legacy `window._onBotHit` global is now a deprecated debug-tap alias that forwards onto the bus, and check 9 forbids internal `window._onBotHit(` calls. v0.2.118 moved the foliage shader materials off `window` into a module-scope registry in `arena-foliage.js` (`tickFoliage`/`getGrassMat`/`getFlowerMat`); v0.2.119 moved the mirror Reflector handle off `window` into a `mirror.js` accessor (`getMirror()`); `window._grassMat`/`_flowerMat`/`_mirrorMesh` remain only as deprecated debug aliases and check 10 forbids internal reads of them. **No functional `window.*` globals remain as internal wiring.** v0.2.121 added the FIRST real `PHASE_CHANGE` subscriber: main.js subscribes and drives top-level screen visibility (title/HUD/pause modal) via the pure `engine/ui/phaseScreens.js` map, replacing the imperative `classList` toggles that were scattered across the ENTER/PAUSE/RESUME/HOME call sites. Dormant seams remaining: `WS_PLAYER_HIT`, `WS_CHAT`. |
| Scene/rendering | `src/scene.js`, mirror modules, Three.js renderer | Mirror and first-person camera regressions should be checked manually. |
| Player | `src/engine/entities/player.js` (boundary), `src/player.js` (runtime), `src/firstPersonBody.js`, `playerObj` | v0.2.114 began the boundary: geometry, spawn shape, and look-down POV math. v0.2.123 added the movement **heading basis** (`forwardX`/`forwardZ`/`rightX`/`rightZ(yaw)` — pure scalars the movement tick writes into its scratch vectors; LOS/allocation-free) and narrowed the module's import to the pure `engine/physics/bodies.js` leaf so it (and its tests) stay free of the Three/Rapier chain. Stateful movement tick, combat, lifecycle, and body-state still in `src/player.js` (next slice). Covered by `tests/player-boundary.test.js`. |
| Weapons/combat | `src/weapons.js`, `src/engine/combat/classifier.js`, `src/engine/combat/shotDiagnostics.js`, `src/engine/combat/damage.js`, `src/engine/combat/aim.js`, `src/engine/weapons/reloadPose.js`, `src/targetReticle.js`, `src/hud.js` | **v0.2.127 — reload viewmodel feel reworked to "click down, clack snap back" via the pure `engine/weapons/reloadPose.js` (`reloadDip`); `RELOAD_TIME` and audio unchanged.** **v0.2.126 — barrel-origin projectile aimed THROUGH the crosshair (current firing rule).** `player.js shoot()` casts the camera/crosshair ray to find the point the reticle is on (first hit, or `CONVERGE_DIST` 80 m fallback), spawns the bullet at the gun BARREL (`getGunBarrelWorld`), and fires it along **barrel → that crosshair point** (pure `engine/combat/aim.js`: `crosshairPoint`/`aimDirection`/`CONVERGE_DIST`). The projectile passes through the exact spot the reticle classified, so a previewed headshot lands as a headshot — convergence happens at the ACTUAL aimed point at any range, not a fixed distance. This **supersedes the v0.2.125 camera-origin experiment** (bullet == camera ray, muzzle nudged off the gun): that killed parallax but moved the muzzle off the barrel, so the new rule restores the gun-barrel origin while keeping the shot honest. Diagnostics still compare the camera aim line vs the bullet line. Damage mapping extracted to the pure `engine/combat/damage.js` (`shotDamage(isHead)`→9/3, `applyDamage`, `isLethal`); `EV.BOT_HIT_BY_PLAYER` now also carries `isHead`. Contract locked: headshot 9 ≥ `BOT_HP` 5 (one-shot), body 3 (two-shot). v0.2.113 introduced the shared headshot classifier for bullets and HUD preview. v0.2.120 extracted it into a pure module `engine/combat/classifier.js` (`isInHeadSphere`/`classifyHeadshot` + derived `HEAD_BOTTOM`/`HEAD_PROX`; imports only the geometry constants from `bodies.js`, no Three/Rapier) so it is unit-tested; `weapons.js` re-exports it unchanged. **v0.2.124 — target-practice diagnostics.** The reticle preview (`targetReticle.js`) is an instantaneous hitscan ray from the CAMERA, but the player bullet is a projectile fired from the gun BARREL toward an 80 m convergence point (`player.js shoot()`) — so a green/👌 reticle can still miss, especially at range (target moves during flight, and the barrel/convergence offset only zeroes at ~80 m). `weapons.js` now records a per-shot diagnostic: at fire time `recordPlayerShot()` casts both the aim line (camera) and the bullet line and stores what each is on; at resolution the actual outcome is captured and a miss reason derived via the pure `engine/combat/shotDiagnostics.js` (`classifyShotOutcome(aim,outcome) -> {reason,label}`; categories: `head`/`body`/`head-to-body`/`blocked`/`moved-or-offset`/`aim-off`). Surfaced via `ToriiDebug.combat.lastShot`/`lastMiss` (and `lastHit`). Per-shot allocations only (never per-frame). No gameplay change — diagnostics only. |
| Tests | `tests/*.test.js`, `vite.config.js` (`test` block), `npm test` | v0.2.120 added Vitest (node env). Suites: `state.test.js` (FSM transitions/guards/predicates), `events.test.js` (bus on/emit/off/no-op/ordering), `classifier.test.js` (head-vs-body geometry), `phaseScreens.test.js` (v0.2.121 — phase→screen map + the PHASE_CHANGE subscriber integration), `bot-agent.test.js` (v0.2.122 — BotAgent decision helpers + decideActions facade), `player-boundary.test.js` (v0.2.123 — movement heading basis + look-down POV math + geometry constants), `shot-diagnostics.test.js` (v0.2.124 — aim-vs-outcome miss-reason classifier), `combat-damage.test.js` (v0.2.125 — head/body damage + kill-threshold contract vs `BOT_HP`), `aim.test.js` (v0.2.126 — barrel→crosshair aiming: `crosshairPoint`/`aimDirection`/convergence + the guarantee that a barrel-fired bullet passes through the aimed point), `reload-pose.test.js` (v0.2.127 — `reloadDip` "click down, clack snap back" curve: drop/hold/snap-back/settle phases, rest at p=0 and p=1, overshoot bounds). 108 tests / 10 files. Run with `npm test`; `npm run check` stays separate but check [11] statically guards the scaffold exists. |
| Physics | `src/engine/physics/raycast.js`, `src/engine/physics/bodies.js` | Rapier-backed truth layer for LOS, bullets, crates, bodies. |
| Bots/NPCs | `src/bots.js` (runtime), `src/engine/entities/bot-agent.js` (SDK boundary) | v0.2.122 began the BotAgent boundary: pure decision helpers `engageSpeed`/`steerComponent`/`inEngageRange`/`wantsToShoot`, `BOT_ACTION` constants, and a `decideActions(worldState) -> BotAction[]` facade (the `BotAgent.tick` direction). `bots.js` consumes the allocation-free scalar helpers in `tickBots()` (LOS short-circuit preserved: cheap `inEngageRange()` gates the expensive `hasLineOfSight()`); `decideActions` is tested-but-unwired (allocates per call). Remaining: migrate the stateful tick/shoot/blowback runtime behind the boundary. |
| HUD/UI | `src/hud.js`, `src/engine/ui/phaseScreens.js`, `index.html` HUD markup/styles | Reticle states: none, close, body, headshot. v0.2.121: top-level screen visibility (title/HUD/pause modal) is derived from a pure phase→visibility map in `engine/ui/phaseScreens.js` and applied by a single `EV.PHASE_CHANGE` subscriber in main.js. |
| Audio | `src/audio.js` | Reload is WebAudio-scheduled; no new `setTimeout`. |
| World/NAP | `src/world/napZone.js`, `src/world/handoff.js`, `src/identity/presence.js` | Skeletons exist; formalise after SDK Layer 1. |

---

## SDK/API Boundaries

### Stable or started

- **Physics raycast**: `castRay`, `castRayStatic`, `hasLineOfSight`.
- **Physics bodies**: dynamic/static/kinematic/body factory direction; crate collider mapping now supports bullet impulses.
- **Combat targeting**: shared headshot classifier used by both bullet hit result and target reticle preview. Extracted to a pure, dependency-light module `engine/combat/classifier.js` (v0.2.120) and unit-tested. v0.2.126: the bullet is fired from the gun barrel TOWARD the crosshair target point, so the projectile passes through exactly what the reticle classified (classifier itself unchanged).
- **Combat aiming (v0.2.126)**: `engine/combat/aim.js` — pure barrel-to-crosshair math, imports nothing. `crosshairPoint(camO,camDir,dist)` = the point the crosshair is on; `aimDirection(barrel→target, fallback)` = the unit firing direction; `CONVERGE_DIST` (80 m) = open-sky fallback. `player.js shoot()` casts the camera ray for the target distance, takes the barrel origin from `getGunBarrelWorld`, and fires barrel→crosshair-point. Locked by `tests/aim.test.js`.
- **Reload viewmodel pose (v0.2.127)**: `engine/weapons/reloadPose.js` — pure `reloadDip(p)` curve, imports nothing, returns a scalar (no Three / no hot-path alloc). Shapes the FP gun's reload motion as "click down, clack snap back": ease-out DROP (p<`RELOAD_DROP_END` 0.12) → HOLD lowered (→`RELOAD_HOLD_END` 0.68) → fast SNAP-BACK through rest into a small overshoot (→`RELOAD_SETTLE_END` 0.86, `RELOAD_OVERSHOOT` 0.12) → SETTLE to rest by p=1. `weapons.js _tickGun()` feeds `progress = 1 - reloadTimer/RELOAD_TIME` in and scales the rest-offsets (Y −0.22, Z −0.10, roll −0.6) by the dip. `RELOAD_TIME=1.1` unchanged so audio sync is preserved. Locked by `tests/reload-pose.test.js`.
- **Combat damage (started v0.2.125)**: `engine/combat/damage.js` — pure `shotDamage(isHead)` (9 head / 3 body), `applyDamage(hp,dmg)`, `isLethal(hp,dmg)`. Imports nothing. `weapons.js` uses `shotDamage`; the head/body damage + kill-threshold contract is locked against `BOT_HP` by `tests/combat-damage.test.js` (headshot one-shots, body two-shots).
- **Shot diagnostics (started v0.2.124)**: `engine/combat/shotDiagnostics.js` — pure `classifyShotOutcome(aim, outcome) -> {reason,label}` (no Three/Rapier). Names WHY a player shot landed/missed by comparing the crosshair aim line against the bullet's actual outcome. `weapons.js` records a per-shot snapshot (`recordPlayerShot`/`getLastShot`/`getLastMiss`) surfaced via `ToriiDebug.combat.lastShot`/`lastMiss`. Diagnostics only — no gameplay change. Distance-miss root cause documented: reticle is camera-hitscan, bullet is a barrel-fired projectile (offset + travel time), so the two diverge most at range/with moving targets.
- **Vitest suite (started v0.2.120)**: `tests/*.test.js`, node env, `npm test`. Seams covered: state machine, event bus, headshot classifier, phase→screen map, BotAgent decision helpers (v0.2.122), player heading basis + look-down POV (v0.2.123) — all pure, no browser/Three/Rapier. Check [11] guards the scaffold.
- **BotAgent boundary (started v0.2.122)**: `engine/entities/bot-agent.js` — pure decision helpers (`engageSpeed`, `steerComponent`, `inEngageRange`, `wantsToShoot`), `BOT_ACTION` action constants, and a `decideActions(worldState) -> BotAction[]` facade in the `BotAgent.tick` shape. Imports only config tuning constants. `bots.js` consumes the scalar helpers in its hot path (LOS short-circuit intact); `decideActions` is unit-tested but not yet wired (allocates per call). Stateful tick/shoot/blowback runtime still in `src/bots.js`.
- **Player boundary (started v0.2.114)**: `engine/entities/player.js` — pure geometry (`EYE`, `BODY_FROM_EYE`), spawn shape (`SPAWN_X/Y/Z`, `SPAWN_YAW`, `PLAYER_SAFE_CORNER`), allocation-free look-down POV math (`lookDownEyeY`, `lookDownEyeZ`), and (v0.2.123) the movement heading basis (`forwardX`/`forwardZ`/`rightX`/`rightZ(yaw)`). Imports only the pure `engine/physics/bodies.js` leaf — no Three/Rapier. Unit-tested in `tests/player-boundary.test.js`. Stateful tick/combat/lifecycle/body-state still in `src/player.js`.
- **State machine (started v0.2.115)**: `src/state.js` — `GAME_EVENT` event set, frozen `TRANSITIONS` table, `transition(event)`/`canTransition`/`nextPhase`, and phase predicates. The table mirrors the prior `if (phase !== X) return;` guards exactly, so behaviour is unchanged; all 6 call sites (main, player, input, bots, targetReticle, hud) now read via predicates and write via `transition()`.
- **Event bus (live; seam formalised v0.2.116)**: `src/events.js` — `EV` registry + `on/off/emit`. Already the cross-module signalling backbone (HUD, combat, nostr, stats). v0.2.116 documented the registry convention, wired `EV.PHASE_CHANGE` from `state.transition()` (`{from,to,event}`), and added check 8 (no undefined `EV.<NAME>` references). Imports nothing → no dependency cycles.
- **Debug namespace**: `window.ToriiDebug` is the alpha inspection surface.

### Next to extract

- **Player boundary (continue)**: pure geometry/spawn/POV (v0.2.114) and the movement heading basis (v0.2.123) are extracted. Remaining: lift the stateful movement/kinematic tick, combat (shoot/reload/recoil), lifecycle (damage/death/respawn), and body-state (`setPlayerBody`/`getPlayerCollider`/`spawnPlayerBody`) behind the boundary; then add dash/zoom shape. Good next pure slices: play-area clamp helpers, reload/respawn timing math.
- **State machine (continue)**: first slice landed v0.2.115 (see Stable/started). Remaining: fold the secondary booleans (`reloading`, `pointerLocked`) into derived/guarded state, wire a real `GAMEOVER` edge if an end-of-run screen lands, and add unit tests for the transition table.
- **Event bus / decoupling (continue)**: first slice formalised v0.2.116; bot-hit bridge migrated v0.2.117 (`EV.BOT_HIT_BY_PLAYER`, `window._onBotHit` now a deprecated forwarding alias, check 9); foliage shader materials moved off `window` into a module-scope registry in `arena-foliage.js` v0.2.118 (`tickFoliage`/`getGrassMat`/`getFlowerMat`, deprecated `_grassMat`/`_flowerMat` aliases, check 10); mirror Reflector handle moved off `window` into `mirror.js` `getMirror()` v0.2.119 (deprecated `_mirrorMesh` alias, check 10 extended). **All functional `window.*` globals are now decoupled** — only deprecated debug aliases remain. v0.2.121 added the first real `PHASE_CHANGE` subscriber (top-level screen visibility via `engine/ui/phaseScreens.js`). Remaining: add further `PHASE_CHANGE` reactions (audio/presence) and emit `WS_*` from the netcode skeleton when it lands.
- **BotAgent (continue)**: boundary started v0.2.122 (pure decision helpers + `decideActions` facade; scalar helpers wired into `bots.js`). Remaining: migrate the stateful runtime — movement tick, shoot/cooldown, blowback/death/respawn, world-state shaping — behind the boundary, and wire `decideActions` once it can run off the hot path (or made allocation-free).
- **Vitest suite (continue)**: seams landed v0.2.120–124 (state machine, event bus, classifier, phase map, BotAgent helpers, player heading basis, shot diagnostics). Next: physics raycast/bodies (with injected mock world), and later kind:0 profile fetch.

---

## Debug Hooks to Use First

| Need | Debug path / check |
|---|---|
| Confirm running version | `window.ToriiDebug.version` and HUD version label |
| Check bot spawn count | `window.ToriiDebug.bots.count` |
| Inspect combat classification | `window.ToriiDebug.combat.lastHit` |
| Explain a missed shot (target practice) | `window.ToriiDebug.combat.lastShot` / `lastMiss` — compare `.aim` (crosshair ray) vs `.outcome` (what the bullet hit); read `.reason`/`.label` |
| Verify headshot/body damage + kill | `window.ToriiDebug.bots.damage(i, 9)` one-shots; `damage(i, 3)` twice kills. Contract in `tests/combat-damage.test.js` |
| Check mirror presence | `window.ToriiDebug.world.mirror` |
| Check physics/bodies direction | physics raycast/bodies exports and regression markers |
| Check no god mode | `npm run check` |
| Check no disallowed timers | `npm run check` |
| Check no stale version markers | `npm run check` |
| Run logic unit tests (FSM, bus, classifier, BotAgent) | `npm test` |

---

## Common Fault Index

| Symptom | First places to inspect |
|---|---|
| Headshots/body shots feel wrong | shared classifier in combat path, bot head/body colliders, `ToriiDebug.combat.lastHit`, target reticle state |
| Reticle colour mismatches bullet result | ensure reticle uses same classifier as bullets; avoid duplicated aim math |
| Shots "on target" miss, especially at distance | `ToriiDebug.combat.lastShot`/`lastMiss` — `reason: 'moved-or-offset'` ⇒ projectile travel time (moving bot left the path); `'blocked'` ⇒ geometry in the way; `'aim-off'` ⇒ crosshair wasn't on a bot; `'head-to-body'` ⇒ headshot dropped to torso. (v0.2.126: the bullet is fired barrel→crosshair-point, so it passes through exactly what the reticle is on — static parallax is gone; remaining at-range misses are travel-time/lead.) |
| Headshots "take two shots" to kill | Was camera↔barrel parallax dropping the bullet onto the body collider. v0.2.125 fixed it via a camera-origin bullet; **v0.2.126 keeps the fix but restores the gun-barrel origin** by aiming barrel→crosshair-point (`engine/combat/aim.js`), so the bullet still passes through the previewed head point. Verify damage contract via `tests/combat-damage.test.js` / `ToriiDebug.bots.damage(i,9)`; a clean head hit is 9 dmg vs `BOT_HP` 5 (one-shot). If still two-shot on MOVING bots, it's travel-time lead (see COMBAT-HITREG). |
| Mirror player scale or gun orientation regresses | mirror layer/camera logic, player model layer, world gun transform |
| Looking down clips inside neck | first-person body/camera height and body offset logic |
| Footsteps drumroll | movement/grounded footstep cadence accumulator |
| Reload too slow or visually dead | reload time constant, viewmodel reload animation, `playReload()` timing |
| Crates do not react | `raycast.js` hit crate mapping, `bodies.js` collider map, bullet impulse application |
| NAP NPC stuck or mesh splitting | NPC placement, scale, skin/material setup, animation root |
| Live site shows old behaviour | version label, service worker cache, dist version markers |

---

## Manual Smoke Checklist

Run on real hardware after publish:

1. Version label shows current version.
2. Enter arena and reach playing state.
3. Aim near bot: reticle turns orange.
4. Aim body: reticle turns green.
5. Aim head: reticle turns green and shows 👌.
6. Shoot body/head and compare damage/classification via `ToriiDebug.combat.lastHit`.
7. Shoot crates and confirm visible nudge without launch.
8. Press reload and confirm fast clunk-clunk-click feel.
9. Look down and confirm no major neck interior.
10. Check mirror player scale and reflected gun handle orientation.
11. Confirm footsteps do not drumroll.
12. Confirm NAP Chiefmonkey NPC is not stuck or splitting.

---

## Living Reports

- `strategy.md` — strategic source of truth.
- `todo.md` — active task source of truth.
- `torii-source-reconciliation-report.md` — source reconciliation history.
- `torii-foundation-sprint-report.md` — v0.2.110 foundation history.
- `torii-v0.2.111-regression-repair-report.md` — v0.2.111 repair history.
- `torii-v0.2.112-tuning-report.md` — v0.2.112 collision/POV tuning history.
- `torii-v0.2.113-foundation-tuning-report.md` — v0.2.113 combat/HUD/crate/reload tuning history.
- `torii-v0.2.114-player-boundary-report.md` — v0.2.114 player boundary first-slice extraction.
- `torii-v0.2.115-state-machine-report.md` — v0.2.115 state-machine groundwork first slice.
- `torii-v0.2.116-event-bus-report.md` — v0.2.116 event-bus seam formalisation + `PHASE_CHANGE` wiring.
- `torii-v0.2.117-bot-hit-event-report.md` — v0.2.117 bot-hit bridge migrated onto the bus (`EV.BOT_HIT_BY_PLAYER`); `_onBotHit` deprecated to a forwarding alias.
- `torii-v0.2.118-material-registry-report.md` — v0.2.118 foliage shader materials moved off `window` into an arena-foliage.js module-scope registry; `_grassMat`/`_flowerMat` deprecated to debug aliases.
- `torii-v0.2.119-mirror-accessor-report.md` — v0.2.119 mirror Reflector handle moved off `window` into a mirror.js `getMirror()` accessor; `_mirrorMesh` deprecated to a debug alias. Last functional global decoupled.
- `torii-v0.2.120-vitest-foundation-report.md` — v0.2.120 added Vitest + first unit suites (state machine, event bus, headshot classifier); classifier extracted to a pure `engine/combat/classifier.js`; regression check [11] guards the scaffold.
- `torii-v0.2.121-phase-subscriber-report.md` — v0.2.121 added the first real `EV.PHASE_CHANGE` subscriber: top-level screen visibility centralised into a pure `engine/ui/phaseScreens.js` map applied by one main.js subscriber; imperative title/HUD/pause toggles removed from the transition call sites; tests added.
- `torii-v0.2.122-botagent-report.md` — v0.2.122 began the BotAgent SDK boundary: pure `engine/entities/bot-agent.js` (decision helpers + `decideActions` facade); `bots.js` hot path now consumes the scalar helpers (LOS short-circuit preserved); `tests/bot-agent.test.js` added (54 tests total).
- `torii-v0.2.123-player-boundary-report.md` — v0.2.123 continued the player boundary: movement heading basis (`forwardX`/`forwardZ`/`rightX`/`rightZ`) extracted to `engine/entities/player.js` and wired into the movement tick; module import narrowed to the pure `bodies.js` leaf; `tests/player-boundary.test.js` added (70 tests total).
- `torii-v0.2.124-target-practice-report.md` — v0.2.124 added target-practice combat hit-registration diagnostics: pure `engine/combat/shotDiagnostics.js` miss-reason classifier + per-shot `ToriiDebug.combat.lastShot`/`lastMiss` (aim line vs bullet outcome). Documents the distance-miss root cause (camera-hitscan reticle vs barrel-fired projectile). `tests/shot-diagnostics.test.js` added (83 tests total). Diagnostics only — no gameplay change.
- `torii-v0.2.125-headshot-damage-report.md` — v0.2.125 surgical headshot fix: the bullet now flies the exact camera/crosshair ray (removing the barrel→80 m-convergence parallax that dropped previewed headshots onto the body collider, the cause of "two-shot headshots"). Damage mapping extracted to the pure `engine/combat/damage.js`; `tests/combat-damage.test.js` locks the one-shot-headshot / two-shot-body contract vs `BOT_HP` (92 tests total). Travel-time lead on moving targets documented as remaining work. **NOTE: the camera-origin bullet was superseded in v0.2.126.**
- `torii-v0.2.126-barrel-crosshair-report.md` — v0.2.126 revised the firing rule per user request: bullets ORIGINATE at the gun barrel and fly toward the crosshair target point (camera ray's first hit, or `CONVERGE_DIST` fallback). Pure `engine/combat/aim.js` (`crosshairPoint`/`aimDirection`/`CONVERGE_DIST`) + `tests/aim.test.js`. Keeps the v0.2.125 anti-parallax property (bullet passes through the previewed point) while restoring the gun-barrel muzzle origin. 100 tests / 9 files; headless smoke confirms one-shot headshot / two-shot body.
