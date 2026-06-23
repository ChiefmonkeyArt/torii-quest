# Torii Quest — Code Index

> Lightweight developer/agent index. Keep this practical and update it as systems are touched.
> Purpose: help future debugging, SDK extraction, FOSS contribution, and AI handoff speed.

Current version: `v0.2.120-alpha`  
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
| Event bus | `src/events.js` | Decoupling seam — modules publish/subscribe by name instead of importing each other. `EV` is the canonical registry; `on/off/emit`. Imports nothing (no cycles). v0.2.116 wired `EV.PHASE_CHANGE` (payload `{from,to,event}`) from `state.transition()` and added check 8 (every `EV.<NAME>` reference must be defined here). v0.2.117 migrated the bot-hit bridge onto the bus: weapons.js emits `EV.BOT_HIT_BY_PLAYER` (`{bot,dmg}`), main.js subscribes (`hitBot`+`flashCross`); the legacy `window._onBotHit` global is now a deprecated debug-tap alias that forwards onto the bus, and check 9 forbids internal `window._onBotHit(` calls. v0.2.118 moved the foliage shader materials off `window` into a module-scope registry in `arena-foliage.js` (`tickFoliage`/`getGrassMat`/`getFlowerMat`); v0.2.119 moved the mirror Reflector handle off `window` into a `mirror.js` accessor (`getMirror()`); `window._grassMat`/`_flowerMat`/`_mirrorMesh` remain only as deprecated debug aliases and check 10 forbids internal reads of them. **No functional `window.*` globals remain as internal wiring.** Dormant seams: `PHASE_CHANGE` (no subscriber yet), `WS_PLAYER_HIT`, `WS_CHAT`. |
| Scene/rendering | `src/scene.js`, mirror modules, Three.js renderer | Mirror and first-person camera regressions should be checked manually. |
| Player | `src/engine/entities/player.js` (boundary), `src/player.js` (runtime), `src/firstPersonBody.js`, `playerObj` | v0.2.114 began the boundary: geometry, spawn shape, and look-down POV math now live in `engine/entities/player.js`. Movement tick, combat, lifecycle, and body-state still in `src/player.js` (next slice). |
| Weapons/combat | `src/weapons.js`, `src/engine/combat/classifier.js`, `src/targetReticle.js`, `src/hud.js` | v0.2.113 introduced the shared headshot classifier for bullets and HUD preview. v0.2.120 extracted it into a pure module `engine/combat/classifier.js` (`isInHeadSphere`/`classifyHeadshot` + derived `HEAD_BOTTOM`/`HEAD_PROX`; imports only the geometry constants from `bodies.js`, no Three/Rapier) so it is unit-tested; `weapons.js` re-exports it unchanged. |
| Tests | `tests/*.test.js`, `vite.config.js` (`test` block), `npm test` | v0.2.120 added Vitest (node env). Suites: `state.test.js` (FSM transitions/guards/predicates), `events.test.js` (bus on/emit/off/no-op/ordering), `classifier.test.js` (head-vs-body geometry). Run with `npm test`; `npm run check` stays separate but check [11] statically guards the scaffold exists. |
| Physics | `src/engine/physics/raycast.js`, `src/engine/physics/bodies.js` | Rapier-backed truth layer for LOS, bullets, crates, bodies. |
| Bots/NPCs | bot runtime modules, future `engine/entities/bot-agent.js` | Next extraction target: BotAgent SDK interface. |
| HUD/UI | `src/hud.js`, `index.html` HUD markup/styles | Reticle states: none, close, body, headshot. |
| Audio | `src/audio.js` | Reload is WebAudio-scheduled; no new `setTimeout`. |
| World/NAP | `src/world/napZone.js`, `src/world/handoff.js`, `src/identity/presence.js` | Skeletons exist; formalise after SDK Layer 1. |

---

## SDK/API Boundaries

### Stable or started

- **Physics raycast**: `castRay`, `castRayStatic`, `hasLineOfSight`.
- **Physics bodies**: dynamic/static/kinematic/body factory direction; crate collider mapping now supports bullet impulses.
- **Combat targeting**: shared headshot classifier used by both bullet hit result and target reticle preview. Extracted to a pure, dependency-light module `engine/combat/classifier.js` (v0.2.120) and unit-tested.
- **Vitest suite (started v0.2.120)**: `tests/*.test.js`, node env, `npm test`. First seams covered: state machine, event bus, headshot classifier — all pure, no browser/Three/Rapier. Check [11] guards the scaffold.
- **Player boundary (started v0.2.114)**: `engine/entities/player.js` — pure geometry (`EYE`, `BODY_FROM_EYE`), spawn shape (`SPAWN_X/Y/Z`, `SPAWN_YAW`, `PLAYER_SAFE_CORNER`), and allocation-free look-down POV math (`lookDownEyeY`, `lookDownEyeZ`). Stateful tick/combat/lifecycle/body-state still in `src/player.js`.
- **State machine (started v0.2.115)**: `src/state.js` — `GAME_EVENT` event set, frozen `TRANSITIONS` table, `transition(event)`/`canTransition`/`nextPhase`, and phase predicates. The table mirrors the prior `if (phase !== X) return;` guards exactly, so behaviour is unchanged; all 6 call sites (main, player, input, bots, targetReticle, hud) now read via predicates and write via `transition()`.
- **Event bus (live; seam formalised v0.2.116)**: `src/events.js` — `EV` registry + `on/off/emit`. Already the cross-module signalling backbone (HUD, combat, nostr, stats). v0.2.116 documented the registry convention, wired `EV.PHASE_CHANGE` from `state.transition()` (`{from,to,event}`), and added check 8 (no undefined `EV.<NAME>` references). Imports nothing → no dependency cycles.
- **Debug namespace**: `window.ToriiDebug` is the alpha inspection surface.

### Next to extract

- **Player boundary (continue)**: lift the stateful movement/kinematic tick, combat (shoot/reload/recoil), lifecycle (damage/death/respawn), and body-state (`setPlayerBody`/`getPlayerCollider`/`spawnPlayerBody`) behind the boundary; then add dash/zoom shape.
- **State machine (continue)**: first slice landed v0.2.115 (see Stable/started). Remaining: fold the secondary booleans (`reloading`, `pointerLocked`) into derived/guarded state, wire a real `GAMEOVER` edge if an end-of-run screen lands, and add unit tests for the transition table.
- **Event bus / decoupling (continue)**: first slice formalised v0.2.116; bot-hit bridge migrated v0.2.117 (`EV.BOT_HIT_BY_PLAYER`, `window._onBotHit` now a deprecated forwarding alias, check 9); foliage shader materials moved off `window` into a module-scope registry in `arena-foliage.js` v0.2.118 (`tickFoliage`/`getGrassMat`/`getFlowerMat`, deprecated `_grassMat`/`_flowerMat` aliases, check 10); mirror Reflector handle moved off `window` into `mirror.js` `getMirror()` v0.2.119 (deprecated `_mirrorMesh` alias, check 10 extended). **All functional `window.*` globals are now decoupled** — only deprecated debug aliases remain. Remaining: add subscribers for `PHASE_CHANGE` (HUD/audio/presence) and emit `WS_*` from the netcode skeleton when it lands.
- **BotAgent**: `BotAgent.tick(worldState) -> BotAction[]`.
- **Vitest suite (continue)**: first seams landed v0.2.120 (state machine, event bus, classifier). Next: physics raycast/bodies (with injected mock world), BotAgent once extracted, and later kind:0 profile fetch.

---

## Debug Hooks to Use First

| Need | Debug path / check |
|---|---|
| Confirm running version | `window.ToriiDebug.version` and HUD version label |
| Check bot spawn count | `window.ToriiDebug.bots.count` |
| Inspect combat classification | `window.ToriiDebug.combat.lastHit` |
| Check mirror presence | `window.ToriiDebug.world.mirror` |
| Check physics/bodies direction | physics raycast/bodies exports and regression markers |
| Check no god mode | `npm run check` |
| Check no disallowed timers | `npm run check` |
| Check no stale version markers | `npm run check` |
| Run logic unit tests (FSM, bus, classifier) | `npm test` |

---

## Common Fault Index

| Symptom | First places to inspect |
|---|---|
| Headshots/body shots feel wrong | shared classifier in combat path, bot head/body colliders, `ToriiDebug.combat.lastHit`, target reticle state |
| Reticle colour mismatches bullet result | ensure reticle uses same classifier as bullets; avoid duplicated aim math |
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
