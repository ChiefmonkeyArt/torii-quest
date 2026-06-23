# Torii Quest — Progress Dashboard

> Visual execution dashboard. See `strategy.md` for vision and decision rules. See `todo.md` for active tasks.
> Current version: **v0.2.129-alpha** | Live: [torii-quest.pplx.app](https://torii-quest.pplx.app)

---

## Track Overview

Baseline totals are marked **[baseline]** — update them as the project grows rather than doing full archaeology.

### Foundation / Agent-Readable Structure

Tasks: ARS-1 through ARS-7 (7 total) | Done: 0 | In progress: 0 | Remaining: 7

```
[..................................................] 0 / 7
```

Status: not started. Structural layer that enables safe handoff to any agent or FOSS contributor.

---

### Combat / Game Feel

Tracked fixes (v0.2.100–v0.2.129): 30 [baseline] | Done: 30 | Open: 1 (travel-time lead on moving targets)

```
[##################################################] 30 / 30 landed | 1 open edge
```

Major closed: hit-reg parallax, head-zone height, re-entry collider orphan, muzzle side, reload snap, barrel→crosshair aim, reticle/classifier split, v0.2.111 regression batch.

---

### Rapier / Physics

Seams extracted: bodies, raycast | Remaining: RaycastService facade (ARS-3), injected-world tests

```
[######################............................] 2 / ~5 SDK seams
```

---

### SDK / API

SDK boundaries started: 6 (physics raycast, physics bodies, combat classifier, combat damage, combat aim, reload pose) [baseline]
Remaining before Layer 1 complete: player boundary full lift, state machine booleans, BotAgent runtime, sdk/index.js skeleton (ARS-5)

```
[######################............................] 6 / ~12 Layer 1 boundaries
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
| ARS-1 | Foundation | ToriiDebug.snapshot() | pending |
| ARS-2 | Rapier | Physics interaction API (public/internal markers + mock test) | pending |
| ARS-3 | Rapier | RaycastService injectable facade | pending |
| ARS-4 | Foundation | Fold reloading/pointerLocked into guarded FSM | pending |
| ARS-5 | SDK | src/sdk/index.js skeleton with stability tiers | pending |
| ARS-6 | Foundation | CODE_INDEX.md upkeep pass after each ARS task | pending |
| ARS-7 | Foundation | HANDOFF.md template | pending |
| TQ-MANUAL-113 | Combat | Manual smoke test on real hardware | pending |
| PROGRESS-1 | Docs | Formalise / maintain progress.md | in progress |

---

## Completed Last 24h

Items stay here (crossed out) for ~24 hours, then move to Archive below.

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
