# Torii Quest — Progress Dashboard

> Visual execution dashboard. See `strategy.md` for vision and decision rules. See `todo.md` for active tasks.
> Current version: **v0.2.133-alpha** | Live: [torii-quest.pplx.app](https://torii-quest.pplx.app)

---

## Track Overview

Baseline totals are marked **[baseline]** — update them as the project grows rather than doing full archaeology.

### Foundation / Agent-Readable Structure

Tasks: ARS-1 through ARS-7 (7 total) | Done: 5 | In progress: 0 | Remaining: 2

```
[####################################..............] 5 / 7
```

Status: ARS-1 (snapshot tooling), ARS-2 (interactions API), ARS-3 (RaycastService), ARS-7 (HANDOFF.md) landed in v0.2.130; ARS-5 (`src/sdk/index.js` public entrypoint + stability tiers) landed in v0.2.131. Remaining: ARS-4 (FSM fold — partial: v0.2.130 canShoot/canReload + v0.2.131 isEngaged/needsPointerLock pointer-lock predicates + v0.2.132 `isReloading`/`tickReload` reload sub-state fold + v0.2.133 real `GAMEOVER` edge `GAME_EVENT.END`/`endRun()`), ARS-6 (ongoing CODE_INDEX upkeep). ARS-3 follow-up: bot-LOS call-site migrated to the facade in v0.2.131; weapons/player bullet+aim ray call-sites migrated to `raycastService.ray`/`.rayStatic` in v0.2.132; the last direct `castRay` consumer (reticle preview) migrated in v0.2.133 + injected-world tests added — ARS-3 cleanup done.

---

### Combat / Game Feel

Tracked fixes (v0.2.100–v0.2.129): 30 [baseline] | Done: 30 | Open: 1 (travel-time lead on moving targets)

```
[##################################################] 30 / 30 landed | 1 open edge
```

Major closed: hit-reg parallax, head-zone height, re-entry collider orphan, muzzle side, reload snap, barrel→crosshair aim, reticle/classifier split, v0.2.111 regression batch.

---

### Rapier / Physics

Seams extracted: bodies, raycast, RaycastService facade (ARS-3, consumed by bot LOS + weapons/player bullet+aim rays as of v0.2.132 + the reticle preview as of v0.2.133; injected-fake-world tests added v0.2.133; no direct `castRay` consumers remain) | ARS-3 raycast migration COMPLETE

```
[##############################################....] 5 / ~5 SDK seams
```

---

### SDK / API

SDK boundaries started: 6 (physics raycast, physics bodies, combat classifier, combat damage, combat aim, reload pose) [baseline] + `src/sdk/index.js` public entrypoint (ARS-5, v0.2.131) + component contract (`engine/components/contract.js`, CMP-1/2, v0.2.132) + first reference component (`engine/components/toriiGateway.js`, CMP-8, v0.2.133)
Remaining before Layer 1 complete: player boundary full lift, BotAgent runtime, grow the SDK surface as boundaries stabilise

```
[############################......................] 8 / ~12 Layer 1 boundaries
```

---

### Nostr / Plebeian / Open-World

Skeletons present: NAP zone module, world handoff, presence | Formalised: 0

```
[####......................................................] 0 / 5+ formalised (skeletons only)
```

Blocked on: SDK Layer 1 close-out, identity boundary, kind:0 profile sync.

---

### Deployment / VPS / Update System

Source reconciliation: done | Source is build truth: yes | Live published version: v0.2.113-alpha
Clean source ahead of live by: 16 versions (v0.2.129 source vs v0.2.113 live)

```
[#########################.........................] source clean, live behind
```

Next: manual smoke test v0.2.113+ → publish source-built artifact to `torii-quest.pplx.app`.

---

## Active Goals

1. Close out **ARS-1 through ARS-7** — agent-readable structure layer. Enables safe cross-session, cross-agent handoff.
2. **Lift source-built artifact to live** — publish v0.2.129 (or latest passing smoke test) to `torii-quest.pplx.app`.
3. **Player boundary full extraction** — movement tick, combat, lifecycle, body-state behind the seam.
4. **BotAgent runtime migration** — wire `decideActions`, migrate stateful tick/shoot/blowback.
5. **Formalise NAP zone + handoff** — promote skeletons to working boundaries before Nostr/world features scale.

---

## Current Sprint

| # | Track | Task | Status |
|---|-------|------|--------|
| ARS-1 | Foundation | ToriiDebug.snapshot() / combat.report() / physics.report() | done (v0.2.130) |
| ARS-2 | Rapier | Physics interaction API (pure interactions.js + mock tests) | done (v0.2.130) |
| ARS-3 | Rapier | RaycastService injectable facade (+ bot-LOS call-site migrated v0.2.131) | done (v0.2.130) |
| ARS-4 | Foundation | Fold reloading/pointerLocked into guarded FSM + GAMEOVER edge | partial — canShoot/canReload + isEngaged/needsPointerLock + isReloading/tickReload (v0.2.132) predicates extracted; real GAMEOVER edge (`END`/`endRun()`) wired v0.2.133 |
| ARS-3+ | Rapier | Weapons/player bullet+aim ray migration to RaycastService | done (v0.2.132); reticle preview migrated + injected-world tests v0.2.133 → ARS-3 cleanup done |
| CMP-1/2 | SDK/Nostr | Component contract + manifest spec (`COMPONENTS.md`, `contract.js`, SDK `component`) | done (v0.2.132) |
| CMP-8 | SDK | First reference component — Torii gateway skeleton (`toriiGateway.js`, SDK `toriiGateway`) | done (v0.2.133) |
| ARS-5 | SDK | src/sdk/index.js skeleton with stability tiers | done (v0.2.131) |
| ARS-6 | Foundation | CODE_INDEX.md upkeep pass after each ARS task | ongoing |
| ARS-7 | Foundation | HANDOFF.md template | done (v0.2.130) |
| TQ-MANUAL-113 | Combat | Manual smoke test on real hardware | pending |
| PROGRESS-1 | Docs | Formalise / maintain progress.md | in progress |

---

## Completed Last 24h

Items stay here (crossed out) for ~24 hours, then move to Archive below.

- ~~v0.2.133-alpha gateway batch (reconciled onto published v0.2.132 — no v0.2.132 work dropped) — ARS-4 real `GAMEOVER` edge (`GAME_EVENT.END` + `endRun()` in state.js, PLAYING/DEAD → terminal GAMEOVER; behaviour-preserving, no live caller yet; +state tests); ARS-3 final raycast cleanup (reticle preview `targetReticle.js` → `raycastService.ray`, no direct `castRay` consumers remain; +injected-fake-world ray/LOS tests); CMP-8 first reference component `engine/components/toriiGateway.js` (`createToriiGateway`/`toriiGateway`, skeleton no-op lifecycle, manifest kind:'gateway'/mountTarget:'scene', SDK `toriiGateway` experimental namespace; `tests/torii-gateway.test.js`). +15 tests (200 total / 17 files)~~
- ~~v0.2.132-alpha infrastructure batch — ARS-4 reload sub-state fold (`isReloading`/`tickReload` pure predicates in state.js, adopted in player.js/weapons.js/main.js; +5 state tests); ARS-3 weapons/player bullet+aim ray migration to `raycastService.ray`/`.rayStatic` (behaviour-identical, barrel→crosshair preserved; +3 service-wiring tests); CMP-1 `COMPONENTS.md` manifest spec (identity/provenance/npub, bundle hash, capabilities, deps, assets, config→mount options, pricing/zap split, Nostr listing events, security rules); CMP-2 `src/engine/components/contract.js` pure lifecycle contract (`validateManifest`/`isComponent`/`defineComponent`, idempotent mount/unmount) surfaced via SDK `component` namespace (experimental tier); `tests/component.test.js` (+14 tests). +22 tests (185 total / 16 files)~~
- ~~v0.2.131 foundation batch — ARS-5 `src/sdk/index.js` public SDK entrypoint (curated node-safe re-exports + `SDK_VERSION`/`STABILITY`/frozen `SDK_SURFACE` tier map; `tests/sdk.test.js`); ARS-3 follow-up: bot-LOS call-site migrated to `raycastService.lineOfSight()`; ARS-4 pointer-lock fold (`isEngaged`/`needsPointerLock` predicates in state.js, adopted at the main.js canvas re-lock guard; +4 state tests); CMP-1..16 component-marketplace tasks added to todo.md (Later track); esbuild dev-server advisory assessed + deferred (audit fix too broad). +11 tests (163 total / 15 files)~~
- ~~v0.2.130 no-blocker foundation batch — ARS-1 `engine/debug/snapshot.js` (`ToriiDebug.snapshot()`/`combat.report()`/`physics.report()`); ARS-2 `engine/physics/interactions.js` (pure `nudgeImpulse`/`applyNudge`, crate nudge tuning moved off weapons.js); ARS-3 `engine/physics/raycastService.js` (injectable facade on `ToriiDebug.physics.service`); FSM slice `canShoot`/`canReload` predicates in state.js (dead `state.paused` removed); ARS-7 `HANDOFF.md`; +26 tests (152 total / 14 files)~~
- ~~v0.2.129 muzzle origin side fix — `engine/weapons/muzzle.js`; `camera.getWorldQuaternion()` so barrel tracks yaw; +11 muzzle tests (126 total / 11 files)~~
- ~~v0.2.128 head-zone lowered (centre 1.65→1.55, radius 0.22→0.20); `_arenaBootstrapped` guard fixes re-entry collider orphan; +7 classifier tests~~
- ~~v0.2.127 reload snap viewmodel — pure `engine/weapons/reloadPose.js`; +8 reload-pose tests~~
- ~~v0.2.126 barrel→crosshair aim — pure `engine/combat/aim.js`; `tests/aim.test.js` (100 tests / 9 files)~~
- ~~v0.2.125 headshot damage extracted — `engine/combat/damage.js`; one-shot headshot / two-shot body contract locked~~
- ~~v0.2.124 shot diagnostics — `engine/combat/shotDiagnostics.js`; `ToriiDebug.combat.lastShot/lastMiss`~~
- ~~v0.2.123 player movement heading basis extracted to `engine/entities/player.js`; import narrowed to pure `bodies.js` leaf~~
- ~~v0.2.122 BotAgent SDK boundary first slice — pure `engine/entities/bot-agent.js`; BotAgent scalar helpers wired into bots.js~~
- ~~v0.2.121 first PHASE_CHANGE subscriber — screen visibility centralised in `engine/ui/phaseScreens.js`~~
- ~~v0.2.120 Vitest added; state machine, event bus, headshot classifier suites~~
- ~~v0.2.119 mirror handle accessor — last functional window.* global decoupled~~
- ~~v0.2.118 foliage shader materials moved off window into module-scope registry~~
- ~~v0.2.117 bot-hit bridge migrated onto event bus (EV.BOT_HIT_BY_PLAYER)~~
- ~~v0.2.116 event-bus seam formalised; EV.PHASE_CHANGE wired~~
- ~~v0.2.115 state-machine first slice — explicit FSM in state.js~~
- ~~v0.2.114 player boundary first slice — pure geometry/spawn/look-down POV math~~
- ~~progress.md created and added to todo.md, strategy.md, CODE_INDEX.md~~

---

## Archive

Completed items older than ~24h live here. Newest first.

### v0.2.100 – v0.2.113 — Foundation and Source Reconciliation (2026-06-23)

- Source reconciliation (v0.2.100–v0.2.108) reverse-ported into clean source by concern.
- v0.2.109 source reconciliation build.
- v0.2.110 foundation sprint: physics SDK seams, ToriiDebug namespace, hardening, NAP/handoff/presence skeletons, regression tooling.
- v0.2.111 regression repair: FP neck clipping, footstep drumroll, reflected gun roll, headshot classification, NAP NPC, reload viewmodel.
- v0.2.112 collision/POV tuning: widened bot head/body colliders, look-down camera arc, ToriiDebug.combat.lastHit.
- v0.2.113 foundation tuning: shared classifier for bullets + HUD, reticle restored, crate bullet nudges, faster reload.
- Safety hardening batch: CSP header, Nostr avatar URL validation, kill-feed innerHTML → safe DOM.
- All functional window.* globals decoupled across v0.2.117–v0.2.119.

---

## Update Rules

1. **Completed todo items** stay crossed out in `todo.md` for roughly 24 hours so context is preserved in active sessions.
2. After ~24 hours, move them from the "Completed Last 24h" section here into Archive, grouped by date or sprint.
3. `todo.md` should remain focused on active and near-term work only — no graveyard of old completions.
4. `progress.md` (this file) is the visual execution layer. `strategy.md` owns vision and decision rules. `todo.md` owns the active task queue.
5. Update track bars when a seam is extracted, a sprint block closes, or a major fix lands. Exact counts are less important than directional accuracy.
6. Version the Archive entries by sprint or date cluster — avoid per-version archaeology.
7. Do not list Google, Cloudflare, Microsoft, or Babylon.js anywhere in this file.
