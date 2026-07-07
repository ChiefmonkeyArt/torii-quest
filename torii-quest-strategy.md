# Torii Quest Strategy & Next Steps

Living document. This will change as we learn.

Source-of-truth split: this file (`torii-quest-strategy.md`) owns vision, core principles, decision rules, and architecture direction. `torii-quest-todo.md` owns the active task queue. `torii-quest-progress.md` is the visual execution dashboard — track bars, sprint status, completed-last-24h, and archive.

Current live game: `https://torii-quest.pplx.app`  
Current live version: `v0.2.113-alpha` (clean source at `v0.2.144-alpha`, not yet published)  
Clean source version: `v0.2.144-alpha` — **PROJECT REFOCUSED onto a 15-hour proof-of-concept route (2026-06-24)**: build the freedom-tech vision fast, avoid polish traps, add retrospective polish once the proof of concept feels right. Shooter is now MAINTENANCE-ONLY unless a bug is demo-breaking; the active MVP is the loop — gateway/NAP-to-NAP preview, Plebeian/Nostr product panel proof, leaderboard preview, and the torii.quest GitHub update-check (see "15-Hour Proof-of-Concept Route" below). Earlier history: **source reconciliation COMPLETE (2026-06-23)**, **foundation sprint COMPLETE (2026-06-23)**, **regression repair pass COMPLETE (2026-06-23)**, **collision/POV tuning COMPLETE (2026-06-23)**, **foundation tuning COMPLETE (2026-06-23)**, **player boundary first slice STARTED (2026-06-23)**, **state-machine groundwork first slice STARTED (2026-06-23)**, **event-bus seam formalised (2026-06-23)**, **bot-hit bridge migrated onto the bus (2026-06-23)**, **foliage shader globals migrated to a module registry (2026-06-23)**, and **mirror handle migrated to a module accessor — last functional global decoupled (2026-06-23)**. The clean source contains all live fixes v0.2.100→v0.2.108, the first SDK boundaries (physics raycast + bodies), `window.ToriiDebug`, hardening, inert NAP/handoff/presence skeletons, the v0.2.111 repair batch, the v0.2.112 hit-detection/look-down POV tuning pass, the v0.2.113 shared combat classifier/reticle, crate impulse, and snappy reload pass, the v0.2.114 player boundary first slice (pure player geometry + spawn + look-down POV math extracted to `engine/entities/player.js`), the v0.2.115 state-machine first slice (explicit `GAME_EVENT`/`TRANSITIONS`/`transition()` + phase predicates in `src/state.js`, all phase call sites routed through the seam), the v0.2.116 event-bus seam (registry convention documented, `EV.PHASE_CHANGE` wired from `state.transition()`, undefined-event regression guard), the v0.2.117 bot-hit migration (`EV.BOT_HIT_BY_PLAYER` from weapons.js → main.js subscriber; `window._onBotHit` deprecated to a forwarding alias; regression check 9), the v0.2.118 foliage-material registry (grass/flower shaders moved off `window` into `arena-foliage.js` — `tickFoliage`/`getGrassMat`/`getFlowerMat`; `_grassMat`/`_flowerMat` deprecated to debug aliases; regression check 10), the v0.2.119 mirror accessor (Reflector handle moved off `window` into `mirror.js` `getMirror()`; `_mirrorMesh` deprecated to a debug alias; regression check 10 extended — last functional global decoupled), the v0.2.120 Vitest foundation (added Vitest + `npm test`; first pure unit suites for the state machine, event bus, and headshot classifier — the classifier extracted to a pure `engine/combat/classifier.js`; regression check 11 guards the scaffold), and the v0.2.121 first real `EV.PHASE_CHANGE` subscriber (top-level screen visibility centralised into a pure `engine/ui/phaseScreens.js` map applied by one main.js subscriber; the imperative title/HUD/pause toggles removed from the transition call sites; `tests/phaseScreens.test.js` added), and the v0.2.122 BotAgent boundary first slice (pure `engine/entities/bot-agent.js` — `BOT_ACTION` constants, decision helpers `engageSpeed`/`steerComponent`/`inEngageRange`/`wantsToShoot`, and a `decideActions(worldState) -> BotAction[]` facade; `bots.js` hot path consumes the scalar helpers with the LOS short-circuit preserved; `decideActions` tested-but-unwired; `tests/bot-agent.test.js` added), and the v0.2.123 player-boundary continuation (movement heading basis `forwardX`/`forwardZ`/`rightX`/`rightZ` extracted to `engine/entities/player.js` and wired into the movement tick; the module's import narrowed to the pure `bodies.js` leaf so it — and its tests — stay free of the Three/Rapier chain; `tests/player-boundary.test.js` added), and the v0.2.124 target-practice combat hit-registration diagnostics (pure `engine/combat/shotDiagnostics.js` aim-vs-outcome miss-reason classifier; per-shot `ToriiDebug.combat.lastShot`/`lastMiss` snapshots recorded in `weapons.js` comparing the camera crosshair ray against the bullet's actual outcome; the distance-miss root cause documented — the reticle is an instantaneous camera hitscan while the bullet is a barrel-fired projectile with offset + travel time; **diagnostics only, no gameplay change**; `tests/shot-diagnostics.test.js` added), and the v0.2.125 headshot parallax fix (root cause of "headshots take two shots" found: the reticle previewed a headshot on the CAMERA ray but the bullet flew the BARREL→80m-convergence line, so muzzle parallax dropped the previewed headshot onto the BODY collider — 3 dmg ⇒ two shots; **honouring the camera-bullet rule**, `player.js shoot()` now fires straight down the camera/crosshair ray (origin = camera +0.30 m forward along the SAME axis), so the bullet line == reticle ray at every distance and a previewed headshot lands as a headshot; no damage value or classifier threshold changed; the damage/kill contract is now locked by a pure `engine/combat/damage.js` + `tests/combat-damage.test.js`; **remaining open work: finite travel time (60 m/s) means the instantaneous reticle still over-promises on fast-moving targets at range — future lead/hit-assist/projectile-prediction**), and the v0.2.126 barrel→crosshair firing rule (per a user revision before publish: bullets must ORIGINATE at the gun barrel, not the camera; the v0.2.125 camera-origin bullet is RETIRED. `player.js shoot()` now casts the camera/crosshair ray to find the aimed point (first hit, or `CONVERGE_DIST` 80 m fallback), spawns the bullet at the barrel via `getGunBarrelWorld`, and fires it **barrel → that crosshair point** through the pure `engine/combat/aim.js` — `crosshairPoint`/`aimDirection`/`CONVERGE_DIST`. The projectile passes through exactly what the reticle classified, so the v0.2.125 anti-parallax property is kept (a previewed headshot lands as a headshot) while the muzzle is back on the gun; convergence now happens at the ACTUAL aimed point at any range, not a fixed distance. Damage contract unchanged; `tests/aim.test.js` added), and the v0.2.127 reload viewmodel feel polish (per user feedback the FP reload should be snappier and synced to the "click down, clack snap back" audio; the old symmetric `sin(progress*π)` hump was replaced by a pure `engine/weapons/reloadPose.js` `reloadDip(p)` curve — quick ease-out DROP, brief HOLD lowered, fast SNAP-BACK through rest into a small overshoot, then SETTLE to rest; `weapons.js _tickGun()` scales the same rest-offsets by the dip; `RELOAD_TIME=1.1` and the reload audio are unchanged so gameplay duration + sync are preserved; `tests/reload-pose.test.js` added), and the v0.2.128 combat hitbox + re-entry fix (manual feedback: headshots only landed when aiming ABOVE the bot on first entry, and hardly any shots connected on a SECOND entry. **Head zone:** the head sphere sat too high — old centre 1.65 + radius 0.22 spanned [1.43,1.87] vs a visible crown ≈1.70, so the sphere's top floated 0.17 m over the head while a crosshair on the face resolved the body cap; lowered `BOT_HEAD_CENTRE_Y_OFFSET` 1.65→1.55 and tightened `BOT_HEAD_RADIUS` 0.22→0.20 → sphere [1.35,1.75] hugging the face/crown, bottom still overlapping the body cap (1.52) so no thread-through gap; the above-head zone was *removed*, not loosened, and shoulder/above shots stay body. **Re-entry:** `initPhysics()` builds a fresh Rapier world each call and the ENTER handler re-ran the whole bootstrap every entry, orphaning the load-time bot colliders (bound to the discarded world) so a re-entered arena had no bot colliders; the ENTER handler now bootstraps physics/colliders/player-body/viewmodels exactly ONCE via an `_arenaBootstrapped` guard so the single world persists across HOME/ENTER, with each entry only `resetRun()` + spawn reset (`resetRun()` was defined but never called before). +7 head-zone cases in `tests/classifier.test.js`), and the v0.2.129 muzzle origin side fix (manual feedback: bullets/tracers appeared to come from the LEFT, not the visible RIGHT-hand gun. Root cause: `getGunBarrelWorld` built the barrel offset basis from the camera's LOCAL quaternion, but the FP camera is a CHILD of `playerObj` which carries the yaw — so the +0.12 right offset pointed in a fixed world direction regardless of facing and the origin/tracer drifted to the wrong side as the player turned. Extracted the barrel math to a pure `engine/weapons/muzzle.js` (`muzzlePoint`/`barrelWorldFromCamera` + `MUZZLE_FORWARD/RIGHT/UP`) and rebuilt the basis from `camera.getWorldQuaternion()` so the +right offset tracks yaw and the muzzle stays on the visible right-hand gun; the barrel→crosshair firing direction is unchanged. `tests/muzzle.test.js` added — locks the +right side convention and the world-quaternion yaw-tracking). The v0.2.130 no-blocker foundation batch then landed the agent-readable structure layer: ARS-1 the JSON-serialisable debug snapshot (pure `engine/debug/snapshot.js` — `ToriiDebug.snapshot()` plus focused `combat.report()`/`physics.report()`, every field read behind `safe()` so the surface never throws even at the title screen or before physics loads; `config` mirrored via a frozen `TUNING` snapshot in `config.js`), ARS-2 the physics interaction API first slice (pure `engine/physics/interactions.js` — allocation-free `nudgeImpulse`/`applyNudge` and the bullet→crate tuning moved off `weapons.js`, which now calls `applyNudge` with its existing scratch), ARS-3 the injectable raycast facade (`engine/physics/raycastService.js` — `createRaycastService` + default `raycastService` wired to the live Rapier layer, surfaced on `ToriiDebug.physics.service`; existing call sites unchanged, migration is a follow-up), and a bounded player-state cleanup (dead `state.paused` removed; pure `canShoot`/`canReload` predicates extracted to `state.js` and adopted by `player.js shoot()`/`startReload()`). ARS-7 added `torii-quest-handoff.md` (repo state, hard constraints, version markers, source-of-truth docs, build/test/check + deploy commands, debug surface, active issues, next-job format). The v0.2.131 foundation batch then landed: ARS-5 the public SDK entrypoint (`src/sdk/index.js` — curated namespace re-exports of the node-safe engine leaf modules only, plus `SDK_VERSION`, a `STABILITY` tier enum, and a frozen `SDK_SURFACE` map tagging each surface `stable`/`experimental`/`internal`, internals forward-declared with `module:null`; no runtime wiring, no scene/WebGLRenderer pull, so it imports clean in node; `tests/sdk.test.js`), the first live RaycastService call-site migration (ARS-3 follow-up — `bots.js` bot-LOS now calls `raycastService.lineOfSight()` instead of importing `hasLineOfSight` directly, LOS short-circuit + behaviour preserved), a further ARS-4 state-machine fold slice (pure `isEngaged`/`needsPointerLock` pointer-lock predicates added to `state.js`, `needsPointerLock()` adopted at the main.js canvas re-lock guard — behaviour-identical; +4 `tests/state.test.js` cases), the approved CMP-1..CMP-16 component-marketplace tasks added to `torii-quest-todo.md` (Later track), and the low-severity Windows-only esbuild dev-server advisory assessed and deferred (the `npm audit fix` would broadly rewrite the rollup/rolldown/lightningcss toolchain — too risky for a dev-only advisory; tracked as ESBUILD-1). The v0.2.132-alpha infrastructure batch then landed: ARS-4 the reload sub-state fold (pure `isReloading`/`tickReload` predicates added to `state.js` — `tickReload(dt)` is the FSM transition that counts the reload timer down, clears the `reloading` flag, and refills the mag, returning whether it completed this tick; adopted in `player.js` (reload tick), `weapons.js` (viewmodel gate), and `main.js`; behaviour-identical; +5 `tests/state.test.js` cases), ARS-3 the weapons/player bullet+aim ray migration (the remaining live raycast call sites — `player.js shoot()` aim ray and the `weapons.js` recordPlayerShot aim/pred + tickWeapons player/bot bullet rays — now route through `raycastService.ray`/`.rayStatic` instead of importing `castRay`/`castRayStatic` directly; behaviour-identical since the default service wraps the same `raycast.js` functions, barrel→crosshair rule preserved; +3 `tests/raycast-service.test.js` production-wiring cases), and the CMP-1/CMP-2 component-economy foundation: `COMPONENTS.md` (the manifest spec — identity/provenance with required author `npub`, bundle-hash integrity, capabilities/permissions, dependencies, assets, config→mount options, optional sats pricing + NIP-57/61 zap splits, Nostr listing-event distribution, and host security/verification rules) plus the machine-checkable slice in pure `src/engine/components/contract.js` (`COMPONENT_CONTRACT_VERSION`, `validateManifest`, `isComponent`, idempotent `defineComponent` mount/unmount wrapper) surfaced via `src/sdk/index.js` as the `component` namespace at the `experimental` tier; `tests/component.test.js` added. The v0.2.133-alpha batch then landed (reconciled onto the published v0.2.132 commit so no v0.2.132 work is dropped): ARS-4 wired the real `GAMEOVER` edge (`GAME_EVENT.END` + a thin `endRun()` helper in `state.js`, PLAYING/DEAD → terminal GAMEOVER; behaviour-preserving since no live caller fires END yet — the named entry point for a future end-of-run screen; +state tests), the ARS-3 final raycast cleanup (the last direct `castRay` consumer — the read-only reticle preview in `targetReticle.js` — migrated to `raycastService.ray`, so no module imports `castRay` outside the service; +injected-fake-world ray/LOS contract tests), and CMP-8 the first reference component (pure node-safe `engine/components/toriiGateway.js` — `createToriiGateway`/`toriiGateway`/`GATEWAY_VERSION` built on `defineComponent`, manifest `kind:'gateway'` + `mountTarget:'scene'` + provenance npub + `gateway:{npub,relay,target,position}` destination block; mount/unmount are symmetric no-op SKELETONS with the portal mesh + Nostr npub/relay n2n handoff as documented TODOs; surfaced via the SDK `toriiGateway` namespace at the experimental tier; `tests/torii-gateway.test.js` added). The v0.2.134-alpha lean-MVP foundation batch then landed the open-world economy seams: GWPROTO-1 the Gateway Protocol draft + pure `engine/gateway/travelIntent.js` URL-handoff helpers, CMP-13 the read-only `engine/components/productDisplay.js` reference component (links OUT to Plebeian.Market, no checkout/pay/zap), and LB-1 the pure unsigned `engine/nostr/leaderboard.js` score-event helpers (kind 30000, no signing/relay). The v0.2.135-alpha component-loader + handoff batch then added CMP-7 the pure `engine/components/registry.js` component loader/registry (local built-ins only, no eval/dynamic-import/remote code), CMP-8 the pure `engine/gateway/gatewayHandoff.js` portal/handoff shell (gateway component → validated travel intent/URL, no navigation/relay/signing), the `engine/components/productPanel.js` read-only product view-model, and LB-1's `engine/nostr/leaderboardPublisher.js` injected publisher adapter (build-only by default, no relay/secrets). The v0.2.136-alpha visible-shells batch then turned that infrastructure into pure render-ready VIEW shells with no side effects: CMP-8 `engine/gateway/gatewayPortal.js` (gateway portal view-model — destination label/prompt/armed debug state + URL preview, never navigates/contacts relays/signs), CMP-13 `engine/components/productPanelShell.js` (read-only product panel layout — `actionable:false` footer + empty `actions[]`, no checkout surface), and LB-1 `engine/nostr/leaderboardView.js` (read-only leaderboard display + build-only `leaderboardPreview` through a no-signer/no-publisher adapter; rejects any non-mock/build mode so there is no 'live'/relay path). All three are node-pure (no THREE/Rapier/DOM/scene imports), surfaced via the SDK at the experimental tier, and preserve the SEC-1/SEC-2/SEC-3 security gates; the actual Three.js portal/panel meshes remain the documented deferred render step. The v0.2.137-alpha safe-hardening batch then landed low-risk handoff/security review follow-ups (no gameplay-risk change): HARD-1 fixed package/runtime version drift (`package.json` was stuck at `0.2.1` while runtime was `v0.2.136-alpha` — bumped to valid semver + a regression-check [5] guard tying `package.json version` to `EXPECTED_VERSION`), HARD-2 marked the unwired mock chat as a non-live preview (disabled + greyed + relabelled), HARD-3 reviewed/documented the required CSP gstatic/DRACO entry, and HARD-4 added pure read-only `engine/debug/shellReport.js` reports over the v0.2.136 shells on `ToriiDebug.shells.*`. The v0.2.138-alpha batch then pivoted the living docs onto the 15-hour proof-of-concept route (shooter maintenance-only; active MVP = the freedom-tech loop) and scaffolded LEAN-5 the torii.quest GitHub update-check architecture: pure node-safe `engine/update/updateCheck.js` (`compareVersions`/`parseRelease`/`evaluateUpdate`/`updateCheckView` + `RELEASE_SOURCE`/`UPDATE_STATUS`) that compares a GitHub-release-shaped manifest's semver tag against the runtime `VERSION` and returns an INERT "update available" view-model (`actionable:false`) — NO network fetch, NO auto-update, NO install; the actual releases-endpoint fetch + the in-world prompt mesh are deferred host steps (see `UPDATE_CHECK.md`). Builds green; all static regression checks pass (`npm run check`); `npm test` green (was 297 tests / 27 files at v0.2.136; +shell-report and +update-check suites since). See `torii-source-reconciliation-report.md`, `torii-foundation-sprint-report.md`, `torii-v0.2.111-regression-repair-report.md`, `torii-v0.2.112-tuning-report.md`, `torii-v0.2.113-foundation-tuning-report.md`, `torii-v0.2.114-player-boundary-report.md`, `torii-v0.2.115-state-machine-report.md`, `torii-v0.2.116-event-bus-report.md`, `torii-v0.2.117-bot-hit-event-report.md`, `torii-v0.2.118-material-registry-report.md`, `torii-v0.2.119-mirror-accessor-report.md`, `torii-v0.2.120-vitest-foundation-report.md`, `torii-v0.2.121-phase-subscriber-report.md`, `torii-v0.2.122-botagent-report.md`, `torii-v0.2.123-player-boundary-report.md`, `torii-v0.2.124-target-practice-report.md`, `torii-v0.2.125-headshot-damage-report.md`, `torii-v0.2.126-barrel-crosshair-report.md`, `torii-v0.2.127-reload-snap-report.md`, `torii-v0.2.128-headzone-reentry-report.md`, `torii-v0.2.129-muzzle-alignment-report.md`, `torii-v0.2.132-infrastructure-report.md`, `torii-v0.2.133-gateway-report.md`, `torii-v0.2.134-lean-mvp-report.md`, `torii-v0.2.135-loader-handoff-report.md`, and `torii-v0.2.136-visible-shells-report.md`.  
Project direction: Torii Quest is an extension of Plebeian.Market, exploring a self-sovereign, federated, decentralised metaverse built on Nostr, Bitcoin, open protocols, free markets, and FOSS developer participation.

## What We Are Building

Torii Quest is an open world builder built on open protocols, free open-source software, Bitcoin, and Nostr.

The shoot'em up arena is a proof-of-work layer — it is the fun, playable front that draws people in and proves that a decentralised game can be built without custodial identity, platform accounts, or corporate infrastructure. It is also a technical stress test: real-time physics, hit registration, and 3D rendering running in a browser with Nostr identity and Bitcoin rails is a hard problem. Solving it well validates the stack.

The strategic goal is bigger. We are building a self-sovereign, FOSS, Nostr/Bitcoin-powered open world builder and decentralised metaverse layer for Plebeian and Plebeian.Market. That means:

- **Anyone can run a world node.** No central operator controls who gets a space.
- **Players own their identity.** An npub carries reputation, assets, and presence across every node without re-registration.
- **Commerce is non-custodial.** Plebeian.Market listings become spatial objects. Payments move over Bitcoin/Cashu/Nutzap rails without a payment processor in the middle.
- **FOSS is the growth model.** Contributors can add bot behaviours, NAP zones, game modes, shop layouts, and world types without asking permission from a platform.
- **Nostr is the coordination layer.** Discovery, presence, handoff, community chat, event announcements, and asset metadata all move through the relay network.

This is not a game with crypto bolted on. It is a reference implementation of what a free, open, self-sovereign digital world can feel like when built on honest foundations.

## Vision

Torii Quest starts as a fun browser shoot'em up, but the larger goal is bigger than a game. It is a working prototype of a decentralised digital world where people can move between NAP zones, shops, stalls, art galleries, hangouts, events, duels, communities, and marketplaces without needing a central platform account.

The long-term direction is npub-to-npub and node-to-node. A player owns their identity, carries their reputation and assets through signed Nostr events, trades using Bitcoin/Cashu/Nutzaps where appropriate, and participates in local circular economies that can interoperate with wider global networks.

Torii Quest should become the playful, explorable, spatial layer of the Plebeian ecosystem. Plebeian.Market is commerce and community. Torii Quest can become the embodied, social, federated world where market stalls, art galleries, local groups, and communities can exist as places.

## Core Principles

- **Self-sovereignty first**: npub is the primary identity. No parallel account system should become the source of truth.
- **Bitcoin and Nostr only by default**: value, identity, messaging, presence, discovery, and handoff should prefer Bitcoin/Cashu/Nostr rails before platform-specific infrastructure.
- **Federated, not centralised**: worlds should discover each other through relays and signed metadata, not a mandatory central registry.
- **Fun before ideology**: the shoot'em up must remain fun. The freedom-tech architecture should make the game more meaningful, not make it boring.
- **Incremental structure, no big rewrites**: every task must leave one system cleaner, more testable, or more agent-readable than it found it. No broad speculative rewrites; they create bug cycles, waste handoff context, and break FOSS contributors' understanding of the codebase.
- **FOSS developer growth**: structure the code so other developers can build bots, NAP zones, shops, objects, and game modes without needing permission.
- **Trade-offs over fake certainty**: every path has cost. We should choose the path that maximises freedom, interoperability, playability, and maintainability.
- **SDK evolves with bug fixing**: every meaningful bug fix should either strengthen an SDK/API seam, add a debug hook, add a smoke check, or improve the code index when useful.
- **Index the project as we go**: maintain a lightweight developer/agent index of modules, boundaries, debug hooks, smoke checks, and common fault locations so future work is faster and less repetitive.

## What We Shipped Today

These are now live on `torii-quest.pplx.app`:

- **v0.2.100-alpha**: fixed the Chiefmonkey mirror reflection scale issue.
- **v0.2.101-alpha**: added visible reload feedback.
- **v0.2.102-alpha**: softened gun audio into a more laser-like zap.
- **v0.2.103-alpha**: added Rapier-backed bot bullets.
- **v0.2.104-alpha**: plugged arena boundary/fall-hole escape into the black void.
- **v0.2.105-alpha**: added Rapier line-of-sight gating so bots do not shoot through solid geometry.
- **v0.2.106-alpha**: added dynamic Rapier crates.
- **v0.2.107-alpha**: added a non-hostile Chiefmonkey NPC in the NAP zone using `Stylish_Walk_inplace`.
- **v0.2.108-alpha**: first-person headless Chiefmonkey body (dedicated `chiefmonkey-headless.glb` on layer 2; replaced the old clip-plane leg-clone).
- **v0.2.109-alpha**: source reconciliation build produced from clean source after reverse-porting v0.2.100→v0.2.108.
- **v0.2.110-alpha**: foundation sprint build with physics SDK seams, `window.ToriiDebug`, hardening, NAP metadata, handoff, presence skeletons, and regression tooling.
- **v0.2.111-alpha**: regression repair build: FP neck clipping/POV, footstep drumroll, reflected gun orientation, headshot counting, NAP NPC tree/skin issues, and reload viewmodel animation.
- **v0.2.112-alpha**: collision and POV tuning build: widened bot head/body colliders, removed head/body dead-band, fixed one-frame raycast lag, added layered headshot classification and `ToriiDebug.combat.lastHit`, lowered/arched look-down camera, and made the FP neck clip track camera height.
- **v0.2.113-alpha**: foundation tuning build: shared headshot classifier used by bullets and HUD preview, restored orange/green/👌 target reticle, visible bullet nudges on Rapier crates, and faster clunk-click reload.

The important pattern is that Rapier is now becoming the physical truth layer. Bot bullets, LOS, boundaries, and dynamic crates all move the game toward a real simulation instead of disconnected visual tricks.

**Source reconciliation done (2026-06-23):** all nine fixes above (v0.2.100→v0.2.108) were reverse-ported into clean source by concern (not by minified diff). The follow-on foundation sprint and v0.2.111 regression repair are also source-built and pushed. The clean source is again the source of truth.

## Current Strategic Problem

**Update (2026-06-23): largely resolved for the v0.2.100→v0.2.108 batch.** Source-of-truth divergence was the biggest risk; the reconciliation pass has brought the clean source back up to (and one version past) the live build. The remaining work is to keep the discipline going — publish the source-built artifact after a manual smoke test, then freeze risky dist patching so divergence does not reopen.

The (now historical) risk was source-of-truth divergence.

The working live game had advanced beyond the clean GitHub source. Many valuable fixes existed only in the patched deployed/dist artifact. That was acceptable for emergency iteration, but it is not a healthy long-term development workflow.

If we keep making architectural changes only in the deployed bundle, every new feature becomes harder to reason about, harder to test, harder to review, and easier for AI agents to break. The structure audit concluded that the game already has useful seams, but the workflow is brittle.

## Recommended Path

The best route is a hybrid:

1. **Finish short, safe gameplay tasks in the live artifact only when they are bounded and verifiable.**
2. **Begin source reconciliation immediately after the current gameplay burst.**
3. **Reverse-port the live fixes into clean source.**
4. **Freeze risky dist patching.**
5. **Extract the first real SDK/API boundaries from working code, not theory.**

This preserves momentum while stopping the project from becoming unmaintainable.

## Options Open to Us

### Option A: Finish gameplay burst, then reverse-port source

This is the recommended option.

Benefits:
- Keeps the game improving while enthusiasm is high.
- Lets us use today’s working fixes as proven behaviour.
- Avoids stopping everything for a restructure too early.
- Gives us a clear freeze point after v0.2.107-alpha.

Costs:
- We must be disciplined and stop adding risky architecture in dist.
- Reverse-porting will take focused effort.

Best when:
- We want fun, visible progress now and a clean base soon after.

### Option B: Stop feature work and rebuild source now

Benefits:
- Cleanest engineering path.
- Reduces future bugs sooner.
- Makes SDK/API extraction easier.

Costs:
- Slower visible progress.
- Risk of losing momentum.
- Requires careful reconciliation with live behaviour.

Best when:
- The live game becomes unstable or the next feature requires deep structure.

### Option C: Shadow-port each subsystem as we touch it

Benefits:
- Keeps work incremental.
- Avoids one giant reverse-port.
- Lets each new feature improve source structure.

Costs:
- More context switching.
- Harder to know when the source is truly caught up.

Best when:
- We want to keep building but enforce a rule that every touched system gets cleaned.

### Option D: Keep patching dist indefinitely

Benefits:
- Fastest short-term.

Costs:
- Worst long-term.
- High chance of repeated AI-created bugs.
- Poor for FOSS contributors.
- Bad foundation for SDK/API growth.

Recommendation:
- Avoid this except for emergency hotfixes.

## Now / Next / Later Roadmap

### 15-Hour Proof-of-Concept Route (ACTIVE — v0.2.144)

**The project is refocused onto a 15-hour proof-of-concept.** Build the
freedom-tech vision *fast*, prove the architecture end-to-end, and **avoid polish
traps** — then add **retrospective polish once the proof of concept feels right.**

**Shooter is now MAINTENANCE-ONLY.** Combat already works well enough to
demonstrate the proof-of-work/game layer; do not invest in weapon/feel/hit-reg
polish unless a bug is **demo-breaking** for the PoC. The travel-time-lead item and
similar combat refinements are deferred until after PoC validation.

The active MVP is the end-to-end freedom-tech loop — thin vertical slices proving
the architecture, not polishing it. Each slice is "thin but real": a demonstrable
path through the whole stack beats any one polished subsystem. Anything that
balloons stops at a green checkpoint and is logged in `torii-quest-todo.md`; track status in
`torii-quest-progress.md`. Deploy/publish remains a separate manual maintainer step.

1. **Torii.quest live** — get the current green source published and reachable as
   the canonical live instance (separate manual deploy step; not done by task
   agents).
2. **Gateway / NAP-to-NAP hop (LIVE track — re-pointed v0.2.251)** — the real
   node-to-node spatial hop, not a placeholder second zone. A player sees **who is
   online** (live world-presence events read from Nostr relays via the existing
   `gatewayRead.js` kind-30078 / `torii-gateway` topic read path), picks a hosted
   world, the two instances run a **signed travel-request/confirm handshake**
   (NIP-07, SEC-2), and the player **jumps into the destination's hosted game on
   their VPS carrying their npub** (cross-origin navigation to a handshake-
   verified URL, SEC-3). This promotes the gateway from inert preview to the live
   n2n primitive described in `GATEWAY_PROTOCOL.md` §6 (signed spatial event).
   Phased: **P0** presence/who's-online (live relay read + publish our own) →
   **P1** signed handshake (SEC-2) → **P2** cross-host jump carrying npub (SEC-3) →
   **P3** two-instance interop proof. The URL-handoff MVP helpers
   (`travelIntent.js`, v0.2.134) and the read-proof (`gatewayRead.js`, v0.2.164)
   are the foundation; the portal mesh + KeyF confirm seam (v0.2.181–v0.2.184)
   already drives a same-origin `/#/zone/` hop today and becomes the launch
   surface for the live list.
3. **Plebeian / Nostr product panel proof** — one real Plebeian.Market
   product-display component (mountable, manifest-described) as the first commerce
   surface in-world, over `productPanelShell.js` (read-only render shell landed
   v0.2.136); now VISIBLE on the title screen via the inert `productPreview.js`
   card (v0.2.140 — `productPreviewBlock`, `textContent`-only, shows product
   identity/price/Nostr seller npub/Plebeian.Market link as TEXT, "PREVIEW · READ
   ONLY · NO CHECKOUT" badge, never navigates/fetches/transacts). Still needs the
   in-world product panel MESH + a real listing.
4. **Leaderboard preview** — a minimal score/kill leaderboard sourced from
   (eventually signed) Nostr events, proving the social/identity layer end-to-end;
   now VISIBLE on the title screen via the inert `leaderboardPreview.js` card
   (v0.2.141 — `leaderboardPreviewBlock`, `textContent`-only, shows local/mock rank
   rows, the kind-30000/#torii-quest score-event proof shape, the npub signer
   identity flavour, "PREVIEW · LOCAL MOCK · NO PUBLISH" badge; signed:false /
   published:false, never signs/publishes/fetches). Still needs the real signer
   (NIP-07, SEC-1) + relay publish/read + the in-world rank board MESH/HUD.
5. **torii.quest GitHub update-check** — architecture so a torii.quest instance can
   detect when a newer GitHub release exists and surface an inert "update available"
   prompt (the maintainer still ships manually). Pure helper + view-model + docs
   landed v0.2.138 (`engine/update/updateCheck.js`, `UPDATE_CHECK.md`); now VISIBLE
   on the title screen via the inert `updatePreview.js` card (v0.2.142 —
   `updatePreviewBlock`, `textContent`-only, shows the running version, a sampled
   latest release, the update-available/up-to-date/unknown status, and the GitHub
   releases path as TEXT, "PREVIEW · MANUAL · NO AUTO-UPDATE" badge; `actionable:false`,
   driven by a deterministic LOCAL sample release, never fetches/installs/navigates).
   Still needs the real read-only releases fetch (CSP-gated, audited) + the in-world
   prompt mesh.

**The four preview cards now read as ONE loop** (v0.2.143) — a pure `engine/mvpLoop.js`
(`mvpLoopSummary`, SDK `mvpLoop`) provides a title-screen header that frames the four
inert cards as the **Travel → Market → Score → Update** loop, and each card title
carries its step number (`1 · TRAVEL` … `4 · UPDATE`). Content/CSS/labelling only —
`actionable:false`, no network/links/actions, rendered via `textContent`; read-only at
`ToriiDebug.shells.mvpLoop()`. This sharpens the PoC narrative without any mesh/server
work; the per-slice "still needs" items above are unchanged.

**Host-side self-hosting is now documented** (v0.2.144) — `VPS_INSTALL.md` describes
how a maintainer runs the static `dist/` build at `torii.quest` on a shared Ubuntu
VPS (Caddy or Nginx, automatic/Certbot HTTPS, DNS checklist, minimum specs), the
**manual** GitHub update sequence (`git pull` → `npm ci` → `npm run build` → publish a
versioned release folder → atomically flip the `current` symlink), symlink-based
rollback, and the security posture (no auto-update, no shell endpoint, least-privilege
deploy user, UFW/SSH hardening, backups), plus a deferred guarded "update button"
architecture. This is **docs only** — no server is touched, nothing is installed, and
no auto-update exists; it aligns with `UPDATE_CHECK.md` §4 and `torii-quest-handoff.md` §7 and
supports the "Torii.quest live" slice above.

**Retrospective polish AFTER PoC validation** — once the loop demonstrably works
and *feels right*, circle back for shooter feel, mesh/material polish, and UX.

### Now

- **Source reconciliation**: ✅ DONE (2026-06-23) — v0.2.100 through v0.2.108 reverse-ported into clean source. See `torii-source-reconciliation-report.md`.
- **Foundation sprint**: ✅ DONE (2026-06-23) — SDK boundaries, ToriiDebug, hardening batch, and world/identity skeletons landed at v0.2.110-alpha. See `torii-foundation-sprint-report.md`.
- **Regression repair**: ✅ DONE (2026-06-23) — v0.2.111-alpha fixed FP neck clipping, footstep cadence, reflected gun roll, headshot classification, NAP NPC placement/materials, and reload viewmodel animation. See `torii-v0.2.111-regression-repair-report.md`.
- **Collision/POV tuning**: ✅ DONE (2026-06-23) — v0.2.112-alpha tightened head/body detection and refined look-down camera/body arc. See `torii-v0.2.112-tuning-report.md`.
- **Foundation tuning**: ✅ DONE (2026-06-23) — v0.2.113-alpha tightened headshot classification, restored target feedback, added crate bullet nudges, and made reload faster/snappier. See `torii-v0.2.113-foundation-tuning-report.md`.
- **Player boundary (first slices)**: ✅ v0.2.114 + v0.2.123 (2026-06-23) — v0.2.114 extracted pure player geometry, spawn shape, and look-down POV math into `engine/entities/player.js`; v0.2.123 added the movement heading basis (`forwardX`/`forwardZ`/`rightX`/`rightZ(yaw)`) wired into the movement tick and narrowed the module's import to the pure `bodies.js` leaf (no Three/Rapier). `src/player.js` consumes the seam with no behaviour change; covered by `tests/player-boundary.test.js`. Stateful tick/combat/lifecycle/body-state remain to be lifted in a later slice. See `torii-v0.2.114-player-boundary-report.md`, `torii-v0.2.123-player-boundary-report.md`.
- **State machine (first slice)**: ✅ DONE (2026-06-23) — v0.2.115-alpha added the explicit FSM in `src/state.js` (`GAME_EVENT`, frozen `TRANSITIONS` table mirroring the prior phase guards, `transition()`/`canTransition()`/`nextPhase()`, predicates). All 6 phase call sites (main, player, input, bots, targetReticle, hud) now read via predicates and write via `transition()`; regression check 7 forbids direct `state.phase =` writes outside `state.js`. Behaviour-preserving by construction. Remaining: fold `reloading`/`pointerLocked` booleans into guarded state, wire a real `GAMEOVER` edge when an end-of-run screen lands, and add transition-table unit tests. See `torii-v0.2.115-state-machine-report.md`.
- **Event bus (seam formalised)**: ✅ DONE (2026-06-23) — v0.2.116-alpha. `src/events.js` was already the live cross-module signalling backbone; this slice documented the `EV`-registry convention, wired `EV.PHASE_CHANGE` (`{from,to,event}`) from `state.transition()` as a zero-subscriber instrumentation seam (behaviour-preserving), and added regression check 8 (every `EV.<NAME>` reference must be defined in the registry). `events.js` imports nothing → no dependency cycles. See `torii-v0.2.116-event-bus-report.md`.
- **Event bus (bot-hit migration)**: ✅ DONE (2026-06-23) — v0.2.117-alpha. Migrated the `window._onBotHit` weapons→main bridge onto the bus: weapons.js emits `EV.BOT_HIT_BY_PLAYER` (`{bot,dmg}`, per-shot plain payload) instead of calling the global; main.js subscribes via `on()` and runs the identical side effects (`hitBot(bot,dmg)` + `flashCross()`), so bot damage/flash/kill handling and `ToriiDebug.combat.lastHit` are unchanged. `window._onBotHit` is preserved ONLY as a deprecated debug-tap alias that forwards onto the bus (console/tester compatibility); regression check 9 forbids any internal `window._onBotHit(` call so the bridge can't be re-introduced. See `torii-v0.2.117-bot-hit-event-report.md`.
- **Foliage shader-material registry**: ✅ DONE (2026-06-23) — v0.2.118-alpha. Moved the grass + wildflower shader materials off `window._grassMat`/`_flowerMat` into a module-scope registry inside `arena-foliage.js`. main.js now advances their uTime via `tickFoliage(dt)` (module-scope refs, no `window`, allocation-free per-frame) instead of two inline global reads; ToriiDebug surfaces them via the injected `getGrassMat()`/`getFlowerMat()` accessors. The `window._grassMat`/`_flowerMat` globals remain ONLY as deprecated debug aliases (still assigned at build, documented in toriiDebug.js); regression check 10 forbids any internal READ of them while allowing the alias assignment. Behaviour-identical (grass/flower animation unchanged). See `torii-v0.2.118-material-registry-report.md`.
- **Mirror handle accessor — last functional global decoupled**: ✅ DONE (2026-06-23) — v0.2.119-alpha. Moved the mirror `Reflector` handle off `window._mirrorMesh` into the existing `mirror.js` module-scope ref (`_mirrorRef`, already used by `tickMirror`'s throttle) and exposed it via a new `getMirror()` accessor, injected into ToriiDebug (`ToriiDebug.world.mirror`). The throttle path was already module-internal, so the only internal reader was ToriiDebug; `window._mirrorMesh` is now assigned purely as a deprecated debug alias and regression check 10 (extended) forbids internal reads. Mirror reflection / player-reflection scale / reflected gun all unchanged. **This was the last functional `window.*` global used as cross-module wiring — the global-decoupling effort is complete.** Remaining decoupling work is now forward-looking: real `PHASE_CHANGE` subscribers (HUD/audio/presence) and `WS_*` emits when netcode lands. See `torii-v0.2.119-mirror-accessor-report.md`.
- **Manual smoke test**: manually verify v0.2.113/v0.2.114/v0.2.115/v0.2.116-alpha on real hardware, especially head/body classification via `ToriiDebug.combat.lastHit`, reticle states (orange close, green body, green + 👌 headshot), crate nudges, reload clunk-click timing, chest/feet view, no neck interior, NAP NPC pose/materials, mirror, footsteps, movement/jump/respawn feel, look-down POV, and the full phase loop (ENTER → ESC pause → resume → home, death → respawn).
- **Freeze dist architecture changes**: only emergency hotfixes should go directly into dist after the freeze.
- **Agent/Developer Efficiency Index**: start and maintain a lightweight project index so future agents can locate modules, SDK seams, debug hooks, and regression checks quickly.
- **FP body integration**: ✅ DONE — implemented via the dedicated `chiefmonkey-headless.glb` (layer-2 FP body), superseding the planned `chiefmonkey17-fp.glb` clip-plane approach.
- **Debug API cleanup**: ✅ DONE — `window.ToriiDebug` namespace (`engine/debug/toriiDebug.js`). All former functional globals are now DEPRECATED debug aliases only: `_onBotHit` (v0.2.117, → event bus), `_grassMat`/`_flowerMat` (v0.2.118, → foliage registry), and `_mirrorMesh` (v0.2.119, → `mirror.js` `getMirror()`). Internal code routes through the bus / module accessors, all surfaced under ToriiDebug via injected accessors; regression checks 9 + 10 forbid internal reads/calls of the deprecated globals.
- **Safety hardening batch**: ✅ DONE — Nostr avatar URL validation (https-only), kill-feed `innerHTML` replaced with safe DOM, avatar placeholder empty `src` removed, and a conservative enforced CSP subset shipped with the full header policy documented for Report-Only rollout.

### Next

- **Rapier SDK boundary**: ✅ DONE — `engine/physics/raycast.js` (`castRay`/`castRayStatic`/`hasLineOfSight`); `physics.js` re-exports so behaviour is identical.
- **Bodies SDK boundary**: ✅ DONE — `engine/physics/bodies.js` (kinematic/dynamic/bot/static/crate factories + collider maps); `physics.js` re-exports.
- **Combat targeting seam**: ✅ STARTED — bullet classification and HUD target preview now share the same headshot classifier. This should evolve into a small combat targeting API instead of duplicated aim logic.
- **Agent/Developer Efficiency Index**: start `CODE_INDEX.md` or equivalent. Include module map, common debug flows, `window.ToriiDebug` paths, smoke checks, and SDK boundaries.
- **BotAgent interface**: formalise NPC/bot behaviour so Chiefmonkey, bankers, and future community bots can be plugged in. (First slice STARTED v0.2.122 — pure `engine/entities/bot-agent.js`: `BOT_ACTION` constants, decision helpers `engageSpeed`/`steerComponent`/`inEngageRange`/`wantsToShoot`, and a `decideActions(worldState) -> BotAction[]` facade; `bots.js` hot path consumes the scalar helpers, LOS short-circuit preserved. Remaining: migrate the stateful tick/shoot/blowback runtime behind the boundary.)
- **NAP zone module**: ⏳ SKELETON — `world/napZone.js` defines the metadata format (NIP-78 kind 30078) + pure builders/validators. Decoration persistence + federation still to do.
- **World handoff stub**: ⏳ SKELETON — `world/handoff.js` defines the handoff event shape + serialize/verify/resolve (local only, no transport). Presence/discovery skeleton is `identity/presence.js` (disabled by default).

### Later

- **Mass player mode**: explore relay/WebSocket presence, remote player transforms, and event rooms.
- **Duels and events**: add structured game modes that can be hosted by a NAP zone owner.
- **User-decorated NAP zones**: let players decorate their own zone with wallpapers, objects, GLBs, signs, stalls, and art.
- **Plebeian.Market spatial layer**: map shops, stalls, product displays, auctions, community boards, and galleries into the world — delivered as mountable components.
- **Bitcoin/Cashu/Nutzap economy**: rewards, tips, paid events, trade, and local circular economies without custodial accounts.
- **Reusable components library**: ship the first reference components (n2n node jumper, art frame, live chat, product display) and the component manifest format. (First reference component — the Torii Gateway skeleton — landed v0.2.133; read-only product display landed v0.2.134; v0.2.135 added the component loader/registry (`registry.js`, local built-ins only) and the product panel view-model. Next is the gateway portal mesh + acting on the handoff, then the interop demo per the Nostr Spatial Gateway Protocol path.)
- **Open-protocol gateway**: `GATEWAY_PROTOCOL.md` DRAFT + pure URL-handoff helpers landed v0.2.134; v0.2.135 added the `gatewayHandoff` shell (gateway component → validated travel intent/URL). Next: act on the intent in `world/handoff.js` + a portal mesh to move the player, then prove it cross-world with an interop demo and propose it as a NIP (see Nostr Spatial Gateway Protocol under NAP-to-NAP Travel).
- **Torii Asset Forge**: validator-first prompt-to-game-ready asset pipeline (external AI presets + routstr/NIP-60 credits + `torii.asset` validator/converter; not a rigging engine).
- **Torii Environment Kit**: budgeted lightweight GLB scenery + WebP/JPG skies + illusion-grass building blocks.
- **Community marketplace**: open Nostr-native listing layer where builders publish components for free or for sats.

## Engineering Plan

### Source Reconciliation

Goal: make the clean source the source of truth again.

Steps:

1. Identify the closest clean source baseline.
2. Diff the live `v0.2.107-alpha` artifact against that baseline.
3. Reverse-port fixes by concern, not by minified diff:
   - mirror/player scale
   - reload feedback
   - gun audio
   - Rapier bot bullets
   - boundary/fall recovery
   - LOS raycast
   - dynamic crates
   - NAP Chiefmonkey NPC
4. Rebuild from source and compare behaviour to live.
5. Publish a source-built `v0.2.108-alpha` only after smoke tests pass.

### Testing and Guardrails

Add a repeatable smoke checklist:

- Boot to title without page errors.
- Enter arena and reach PLAYING state.
- Confirm version marker.
- Confirm `godMode` is false.
- Confirm `setTimeout` count only includes approved exceptions.
- Confirm player bullets fire from camera.
- Confirm mirror scale remains correct.
- Confirm reload feedback works.
- Confirm bot bullets and LOS run without errors.
- Confirm boundary/fall recovery.
- Confirm crates spawn and sync.
- Confirm Chiefmonkey NPC loads and animates.

Add future automated checks:

- Boot/play Playwright test.
- Feature-marker grep test.
- No accidental `godMode=true`.
- No unapproved `setTimeout`.
- No hot-path `new Vector3` or `new Matrix4`.
- Basic frame error log check.

## Proposed Source Module Map

```text
src/
  main.js
  scene/
    scene.js
    lighting.js
    arena.js
    mirror.js
  engine/
    physics/
      world.js
      raycast.js
      bodies.js
      sensors.js
    entities/
      entity.js
      bot-agent.js
      npc.js
      player.js
    debug/
      torii-debug.js
  gameplay/
    weapons.js
    bullets.js
    bots.js
    crates.js
    nap-zone.js
    duels.js
    events.js
  identity/
    nostr.js
    profile.js
    presence.js
  world/
    registry.js
    handoff.js
    instance.js
    remote-players.js
  economy/
    wallet.js
    nutzaps.js
    drops.js
  assets/
    manifest.js
    glb-registry.js
  ui/
    hud.js
    chat.js
    menus.js
```

This map should not be built all at once. It is the direction of travel. Extract modules only when the working game has proven the need.

## SDK, API, and Index Strategy

The SDK should grow from stable internal systems.

The rule going forward is: **every bug fix and feature pass should leave the code easier to extend than it found it**. That does not mean abstract everything. It means that when a system becomes reliable, reused, or important for debugging, we either expose a small API seam, add a debug hook, add a smoke check, or add an index entry.

The first index should be lightweight:

- `CODE_INDEX.md` or equivalent: current module map, ownership by concern, public/semi-public APIs, and common fault locations.
- Debug registry: `window.ToriiDebug` paths for player, bots, combat, physics, world, NPCs, and version.
- Smoke/regression map: what `npm run check` verifies and what still needs manual hardware testing.
- SDK boundary notes: what is stable enough for contributors and what remains internal.

This gives future agents and FOSS contributors faster fault-finding without building a heavy abstract framework too early.

First SDK layer:

- `engine/physics/raycast.js`
  - `castRay(origin, direction, maxToi, world)`
  - `hasLineOfSight(from, to, world)`

- `engine/physics/bodies.js`
  - `createDynamicBody(shape, position, options)`
  - `createStaticBody(shape, position, options)`
  - `createSensor(shape, position, handlers)`

- Combat targeting / HUD preview
  - shared headshot/body classifier
  - camera-forward target preview
  - one source of truth for bullet result and HUD state

- `engine/entities/bot-agent.js`
  - `BotAgent.tick(worldState) -> BotAction[]`
  - Actions: `move`, `shoot`, `idle`, `interact`, `speak`

Second SDK layer:

- `identity/nostr.js`
  - `getPublicKey()`
  - `signEvent(event)`
  - `loadProfile(npub)`

- `world/handoff.js`
  - `createHandoffEvent({ fromWorld, toWorld, playerState })`
  - `verifyHandoffEvent(event)`
  - `spawnFromHandoff(event)`

- `world/registry.js`
  - publish world metadata
  - discover online NAP zones
  - subscribe to presence

Third SDK layer:

- Asset references with Nostr metadata.
- GLB ownership and attribution tied to npubs.
- Community modules for shops, art galleries, markets, events, and hangouts.
- Bitcoin/Cashu/Nutzap rails.

## Agent-Readable Structure and Cross-Agent Portability

### Why This Matters

Torii Quest is a FOSS project with a vision that extends well beyond any single development session. Future contributors may be human developers, open-source communities, or AI agents operating under different operators. If the codebase requires reading every source file to understand what is happening, handoff fails every time. The structural work being done here is not internal housekeeping — it is a prerequisite for the open world we are trying to build.

Specifically:

- **Reduces source archaeology.** A new agent or developer should be able to find a fault or understand a system from `CODE_INDEX.md`, the test suite, and `ToriiDebug` — not from reading 3,000 lines of `main.js`.
- **Makes changes local.** Well-bounded modules with clear public APIs mean a fix to the physics layer does not silently break the combat layer. This matters for AI agents especially, which do not always know what they do not know.
- **Allows faster debugging.** `ToriiDebug.snapshot()`, `ToriiDebug.combat.lastHit`, `ToriiDebug.combat.lastShot`, and similar hooks give any incoming session an instant read on runtime state. Without these, every debug session starts from scratch.
- **Supports FOSS contributors.** An external contributor building a NAP zone, a custom bot, or a game mode needs a stable SDK entry point and enough documentation to work without asking the core team. A well-indexed, well-tested codebase is that entry point.
- **Avoids vendor lock-in.** Clean module boundaries and open protocol integrations (Nostr, Bitcoin, Rapier, Three.js) mean the project does not depend on any single AI provider, cloud vendor, or proprietary runtime. This is consistent with the self-sovereign ethos of the project itself.

### Agent Handoff Design

Every system should be structured so an incoming agent can orientate quickly. The practical elements:

- **Clear engine/game split**: `src/engine/` contains reusable, game-agnostic systems (physics, entities, combat math, debug tools). `src/gameplay/`, `src/scene/`, and `src/` contain the game-specific orchestration that consumes them. An agent touching combat mechanics should not need to understand the Nostr relay layer.
- **Public APIs per system**: each `engine/` module declares a stable public surface (JSDoc `@public`) and marks internal helpers (`@internal`). Callers import from the public surface; they do not reach into implementation details.
- **`CODE_INDEX.md`**: the primary handoff document. Updated after every structural task. Contains the current module map, public API list, `ToriiDebug` paths, test file locations, known constraints, and common fault locations. If `CODE_INDEX.md` is stale, it is worse than no index.
- **Debug snapshots**: `window.ToriiDebug` exposes enough runtime state that any session can diagnose a fault without needing to add logging. The `ToriiDebug.snapshot()` function should serialise the full current state to a plain object that can be logged or reported.
- **Tests as contracts**: every extracted seam has a test file that specifies its expected behaviour. These tests are the specification for any future agent or contributor. When a test breaks, the contract was violated; when a test passes, the contract holds.
- **Explicit constraints in code**: rules that are non-obvious (no `new Vector3` in hot paths, bullets originate at the barrel, `godMode` must be false in production) are stated in both the source file comments and the Critical Rules section of the TODO. They should not live only in one place.
- **Source-of-truth references**: every module's comment header should state which doc is its source of truth. `state.js` points to the FSM table in strategy. `CODE_INDEX.md` points to individual modules. Session reports point to both. No orphaned context.
- **Small focused modules**: a module that does one thing is easy to hand off. A 3,000-line orchestrator is not. The extraction work (player boundary, state machine, event bus, bot-agent, combat seams) is directly in service of this.

### Cross-Agent Portability

The repo structure should let another AI operator or developer pick up work using docs and tests alone, without requiring access to a specific provider's memory or session history.

DeepSeek, perplexica, routstr, and other open or self-hosted AI operators are plausible future contributors to this project. We do not promise compatibility with any specific agent or make architectural decisions based on any one provider's capabilities. What we do commit to is a repo structure where:

- `CODE_INDEX.md` + `torii-quest-handoff.md` give enough context to start a new session productively.
- The test suite verifies the invariants a new agent must not break.
- `ToriiDebug` gives the agent runtime visibility without requiring a guided tour.
- The `src/sdk/index.js` entry point gives a bounded surface for external contributions.
- Nostr and Bitcoin dependencies are kept explicit and documented, not buried in implementation details.

This is also consistent with avoiding vendor lock-in at the infrastructure level. A codebase that only works well when a specific AI provider drives it is as fragile as one that only works on a specific cloud platform.

### Near-Term Structural Tasks

See the `Near-Term — Agent-Readable Structure` section in `torii-quest-todo.md` for the ordered task list (ARS-1 through ARS-7):

1. **ARS-1**: Debug dump / handoff snapshot (`ToriiDebug.snapshot()`).
2. **ARS-2**: Physics interaction API (public surface markers, mock-world test).
3. **ARS-3**: Rapier raycast service (injectable facade, breaks direct Rapier coupling).
4. **ARS-4**: Player state machine cleanup (fold `reloading`/`pointerLocked` into FSM).
5. **ARS-5**: SDK/API skeleton (`src/sdk/index.js` with stability tiers).
6. **ARS-6**: `CODE_INDEX.md` upkeep (updated after every ARS task).
7. **ARS-7**: Handoff template (`torii-quest-handoff.md` or `CODE_INDEX.md` handoff section).

## NAP Zone Strategy

NAP zones should become peaceful, player-owned, programmable social spaces.

Core features:

- Owner npub.
- Zone metadata event.
- Decoration manifest.
- Community chat.
- Private chat links.
- Shop/stall/gallery layout.
- Portal/handoff destination.
- Rules/policy statement.
- Optional local economy settings.

Player decoration:

- Upload wallpaper image, initially JPEG or PNG.
- Apply wallpaper to selected surfaces.
- Add signs, posters, product panels, art frames.
- Place GLB objects.
- Use NIP-style metadata to tie GLB assets to npubs.

The NAP zone is the bridge between game and marketplace. It can be a home, shop, gallery, clubhouse, local market, event space, or portal.

## NAP-to-NAP Travel

Goal: hop from my NAP zone into someone else's NAP zone who is online.

Minimum viable flow:

1. User enters their NAP zone.
2. Game discovers online worlds/zones from Nostr relay metadata.
3. User selects a destination NAP zone.
4. Client creates a signed handoff event:
   - event version
   - player npub
   - source zone
   - destination zone
   - player display state
   - optional inventory/state pointer
   - timestamp
   - signature
5. Destination instance verifies the event.
6. Player spawns at the destination entry point.
7. Presence updates so others can see them.

Important trade-off:

- Direct peer-to-peer/node-to-node is powerful but harder.
- Relay-mediated handoff is easier and more Nostr-native.
- Start relay-mediated, design so node-to-node can be added later.

### Nostr Spatial Gateway Protocol (n2n spatial hop as an open protocol)

The NAP-to-NAP handoff above should be lifted from a Torii-internal mechanism
into an **open, documented protocol** so any Nostr/Bitcoin world — not just Torii
Quest — can interoperate. The handoff is fundamentally a *spatial* Nostr event
(cross a gate in world A, arrive in world B carrying your identity and state), so
it belongs to the commons, not to one client.

Staged path (each stage is independently useful):

1. **Reference component (landed v0.2.133):** the Torii Gateway
   (`src/engine/components/toriiGateway.js`) is the concrete reference
   implementation — a droppable gate whose manifest carries the destination
   (`gateway: { npub, relay, target, position }`). v0.2.135 added the pure
   `src/engine/gateway/gatewayHandoff.js` shell that maps that destination onto a
   validated travel intent / URL (`gatewayDestination`/`planGatewayTravel`/
   `gatewayTravelUrl`), and the `src/engine/components/registry.js` loader that
   discovers + validates local built-in components before load. Still a skeleton:
   the mount-time portal mesh + acting on the intent in `world/handoff.js` are the
   next build.
2. **`GATEWAY_PROTOCOL.md` (DRAFT landed v0.2.134):** the wire format is now
   extracted into a standalone, implementation-independent spec — relay-first
   hybrid discovery, the URL-handoff MVP, world/zone/gateway identity, the travel
   intent (to/from/return/spawn/zoneType/relays/player/state), the return path,
   the signed spatial-handoff event as the trust upgrade, layered security tiers,
   and the NIP path. Pure helpers for the URL-handoff MVP shipped alongside it
   (`src/engine/gateway/travelIntent.js`). Still to do: the signed-event
   implementation (§6) and validating it cross-world.
3. **Interop demo:** prove the protocol across two independent instances (a Torii
   gate handing off to a second world that only implements `GATEWAY_PROTOCOL.md`),
   so the spec is validated by a non-Torii consumer, not just our own client.
4. **Possible NIP:** once the format is stable and demonstrated cross-world,
   propose it as a NIP (spatial hop / world handoff) so the wider Nostr ecosystem
   can adopt it. Attribution travels with the npub; integrity with the event
   signature — consistent with the component economy's provenance rules.

This makes the gateway a freedom-tech primitive: the metaverse layer is a graph
of independently-owned worlds linked by signed spatial events, with no central
router. See `COMPONENTS.md` (CMP-8 reference component) and the CMP loader/handoff
tasks in `torii-quest-todo.md`.

## Multiplayer, Events, and Duels

The shoot'em up should remain excellent fun.

Possible game modes:

- **Casual arena**: current core loop, improved.
- **Duels**: one-on-one opt-in matches, NAP-zone challenge flow.
- **Events**: scheduled community battles, art openings, market nights.
- **Mass player hangouts**: less shooting, more presence, chat, decoration, and trade.
- **Local tournaments**: community-hosted with Nostr event announcements.

Trade-off:

- Authoritative multiplayer is more secure but needs infrastructure.
- Client/relay multiplayer is more decentralised but easier to spoof.
- For freedom-tech alpha, start with social presence and opt-in trust, then add stronger verification where money or ranking matters.

## Digital Assets and GLB/Npub Ownership

We should promote NIP-style patterns that tie `.glb` files and asset metadata to npubs.

Goals:

- A model, texture, poster, product display, or art object can be attributed to an npub.
- Worlds can reference assets by signed metadata rather than bundling everything.
- Asset manifests can include hashes, MIME types, fallback URLs, license, creator npub, and usage terms.
- Players can carry owned or attributed assets between compatible worlds.

Minimum manifest shape:

```json
{
  "v": 1,
  "kind": "torii.asset",
  "creator": "npub...",
  "type": "model/gltf-binary",
  "hash": "...",
  "url": "https://...",
  "license": "GPL-3.0-or-compatible",
  "name": "Chiefmonkey Stall Sign"
}
```

### Torii Asset Forge (prompt-to-game-ready assets, validator-first)

A pipeline that turns a text prompt into a **game-ready, compatibility-validated**
asset — *not* a full in-house rigging/generation engine. We orchestrate external
AI, then own the part that makes assets actually usable in-world: validation and
conversion.

Principles:

- **Validator-first, not generator-first.** The valuable, durable piece is a
  `torii.asset`-aware **validator + converter** (geometry sanity, scale/units,
  poly/texture budgets, MIME/format, GLB draco/meshopt, npub provenance + hash) —
  the same manifest shape as Digital Assets above. Generation is swappable; the
  compatibility contract is ours.
- **External AI via presets.** Drive third-party prompt-to-3D / texture services
  through curated presets (style, budget, target slot) rather than building a
  model. Treat their output as untrusted input that must pass the validator.
- **Paid with freedom-tech credits.** Pay for generation via **routstr** /
  **NIP-60 (Cashu) credits** so the forge stays self-sovereign and has no
  platform account dependency.
- **Scope guard.** No rigging/animation engine, no bespoke trainer. If an asset
  needs rig/animation it is out of v1 scope; v1 is static/prop/scenery assets
  that pass the validator and drop straight into the component/asset economy.

### Torii Environment Kit (lightweight scenery + skies + illusion-grass)

A small kit of performance-budgeted environment building blocks so worlds look
good cheaply on the web:

- **Lightweight GLB scenery forms** — a curated set of low-poly primitives/props
  (rocks, fences, stalls, torii forms, foliage clumps) with declared poly/texture
  budgets, usable as `mountTarget: 'scene'`/`'zone'` components or raw assets.
- **WebP/JPG sky + backdrops** — image-based skies/backdrops (not heavy cubemap
  pipelines) for fast load and low memory; declared resolution budgets.
- **Grass as a layered illusion** — density/distance/performance-budgeted grass
  built as layered billboard/illusion techniques (cf. the existing arena foliage
  shader) rather than per-blade geometry, with explicit density, draw-distance,
  and frame-budget knobs.

All three kit pillars carry explicit budgets so a dropped-in environment can't
silently wreck frame rate — the budgets are part of the manifest/validator
contract, consistent with the Asset Forge.

## Community, Chat, and Commerce

Torii Quest should support community building, not just combat.

Directions:

- Community group chat via Nostr.
- Private chat via Nostr-compatible encrypted messaging.
- Market stall conversations.
- Local boards for announcements and events.
- Gallery openings and creator showcases.
- Reputation and identity tied to npub, not a central platform.

Commerce direction:

- Plebeian.Market listings can become spatial objects.
- A shop can be walked around.
- A product can be inspected.
- A creator can host people in their zone.
- Payment should remain non-custodial and Bitcoin/Cashu-native.

## Reusable Components Library and Community Marketplace

The open world builder needs more than a game engine and a relay network. It needs a shared library of spatial components that node operators can compose into spaces, and a marketplace where community builders can publish and trade those components.

### What a Component Is

A component is a self-contained, droppable module that adds a specific experience to a NAP zone or world space. It exposes a mount API consistent with the Torii SDK boundary conventions (`mount(scene, options)` / `unmount()`) and declares its dependencies (Nostr relays, Bitcoin/Cashu rails, external data feeds) as explicit metadata, not implicit globals.

Components are distributed as signed Nostr events (NIP-78 kind 30078 or a Torii-specific kind) referencing a versioned asset bundle. The author npub is part of the manifest. The bundle hash is verified before mounting.

### Reference Components

These are the first concrete targets — each illustrates a distinct category of component:

**Navigation / presence**
- **n2n node jumper / Torii gateway experience**: a portal UI that reads live world registry data from Nostr relays, lists reachable nodes, and executes a signed handoff event when the user steps through. The n2n jumper is both a useful component and the reference implementation of the handoff protocol.

**Communication**
- **Live chat**: NIP-28 or NIP-29 group chat rendered spatially inside a NAP zone. No custodial server; messages move through relays.
- **Video chat**: peer-to-peer video call triggered by proximity or invitation, using WebRTC with an optional Nostr-native signalling channel. No platform account required.

**Commerce / Plebeian integration**
- **Art frame (Plebeian gallery feed)**: a framed display that pulls listed art from Plebeian.Market via its open API and renders it in-world. Clicking through opens the listing.
- **Live auction panel**: streams active Plebeian.Market auction state in real time and lets a player bid without leaving the world. Payment flows over Bitcoin/Cashu/Nutzap rails.
- **Single product display**: a spatial product card for one SKU — image, title, price, buy action. Parameterised by a Plebeian.Market listing ID or a signed Nostr product event (NIP-15).
- **Product browser**: a navigable shelf or grid of products fetched from a Plebeian stall or Nostr marketplace feed. Supports filtering by category, price, and creator npub.

**Discovery / social**
- **Game finder**: lists active game instances and NAP zone events published to relays. Lets players hop directly to a live game or scheduled event.

**Space archetypes**
- **Hangout module**: a social space with seating geometry, ambient audio, group chat, and presence indicators. No commerce or combat; the emphasis is on being together.
- **Gallery module**: blank-wall space with configurable art frames, lighting presets, and a visitor log. Suitable for artist showcases and community exhibitions.
- **Shop / stall module**: a commerce-first layout with product displays, a pay-by-Nostr counter, and a host NPC slot. Connects to a Plebeian.Market stall or any NIP-15-compatible store.
- **Community-built modules**: any contributor can publish a component to the marketplace. The only structural requirements are the mount API, a signed manifest, and a declared dependency list.

### Marketplace Model

The component marketplace is an open listing layer built on Nostr and Bitcoin, not a managed platform.

- **Listing**: a builder publishes a signed Nostr event that describes the component (name, version, mount API, dependencies, bundle URL, hash, preview image, license, creator npub). The event is the listing.
- **Discovery**: node operators and world builders browse the marketplace by querying relays for component listing events. Curation can be layered on top by trusted npubs publishing curated lists — no central gatekeeper is required.
- **Pricing**: the creator sets the price in sats (via a Lightning invoice or Cashu token in the listing event) or marks the component as free. Free components are zero-friction installs. Paid components gate the bundle URL or decryption key behind a payment proof.
- **Payment rail**: Lightning, Cashu, or Nutzap. No fiat payment processor. The transaction is between the buyer's wallet and the creator's wallet; the marketplace takes no cut by default.
- **Revenue share (optional)**: a component can declare a revenue-share manifest that distributes a percentage of each sale to contributors via Zap splits (NIP-57 / NIP-61). This is opt-in and enforced by convention, not by a platform.
- **Versioning and updates**: components publish new versions as new events. Node operators pin a version or subscribe to updates. Hash verification prevents silent replacement.
- **Forks and remixes**: because components are FOSS and signed manifests are public, any builder can fork a component, publish it under their own npub, and offer it under a new name or price. Attribution to the original npub is baked into the manifest.

### Modular Economic Layer

This is the economic structure the component library makes possible:

- **Builders** create reusable world components — 3D modules, experience widgets, commerce integrations — and publish them to the marketplace. Income comes from sat-denominated sales or donations; no platform approval gate.
- **Node owners** compose spaces by mounting components into NAP zones. They pay builders in sats for premium components and get immediate, verifiable installs. A node owner can run a gallery, a game, a market, a hangout, or a hybrid, all from the same SDK primitives.
- **Users** trade, discover art, bid at auctions, browse products, and move between spaces using their npub alone. Commerce is non-custodial. Presence is relay-native. No account migration.
- **The relay network** carries discovery, presence, handoff events, marketplace listings, and chat. No central server coordinates the flow; any relay that speaks the relevant NIPs is a valid participant.

This layer turns Torii Quest from a game with an open-world ambition into a deployable economic primitive: anyone can build a space, charge for it, move between spaces, and trade inside them, all without asking permission from a platform.

### Fit With Existing Strategy

The component marketplace is the practical realisation of several commitments already in this document:

- The **Third SDK layer** (asset references, GLB/npub ownership, community modules for shops/galleries/events) is what the component library delivers.
- The **Later roadmap** items (Plebeian.Market spatial layer, Bitcoin/Cashu/Nutzap economy, user-decorated NAP zones) are all delivered as components, not as monolithic features.
- The **FOSS developer growth** principle — contributors build game modes, NAP zones, shops, and objects without permission — is the supply side of the marketplace.
- The **Digital Assets and GLB/Npub Ownership** manifest format (`torii.asset`) is extended to cover components: same signed-event, hash-verified, npub-attributed pattern.
- The **n2n handoff protocol** is a component itself — the node jumper is both the reference implementation of world travel and a distributable module any node operator can mount.

Components do not require a new architecture. They are the point at which the SDK boundary work, the Nostr identity layer, the Bitcoin payment rails, and the NAP zone decoration system converge into a distributable unit.

## Debug API and Agent Index

Alpha debug tools should ship, but they should become deliberate.

Replace scattered globals:

```js
window._botsRef
window._onBotHit
window._chiefNpc
window._grassMat
```

With:

```js
window.ToriiDebug = {
  version,
  bots: { list, count, damage },
  player: { position, resetToArena },
  physics: { raycast, bodies },
  world: { napZones, crates },
  npc: { chiefmonkey }
}
```

This is both cleaner for developers and safer for public alpha. It also becomes documentation for future SDK boundaries.

The debug API should now be paired with a living index:

- **Module index**: where each system lives and which files are safe extension points.
- **Fault index**: mirror issues, headshot classification, reload, footstep cadence, NAP NPC, Rapier crates, and service worker/version problems.
- **Debug index**: exact `ToriiDebug` paths and what they prove.
- **Regression index**: which checks are automated, which require manual playtesting, and which markers must exist in `dist`.

This is the practical “indexer” path: build a useful map now, then automate more of it later if it proves valuable.

## Hardening Backlog

These are not urgent blockers, but should be cleaned before wider promotion:

- Add CSP policy.
- Validate Nostr avatar URLs before assigning `img.src`.
- Replace kill-feed `innerHTML` with safer DOM construction.
- Remove or replace default avatar `src="index.html"`.
- Consider SRI hashes for bundled scripts.
- Document relay privacy expectations.
- Add a basic privacy note for Nostr profile lookups.

## Decision Rules

Use these rules to avoid repeated AI-created bugs:

- If a change touches architecture, prefer source over dist.
- If a change is a tiny gameplay hotfix, dist patching is acceptable until the freeze.
- If a change affects identity, handoff, multiplayer, wallet, or economy, do not patch minified dist.
- If the patch cannot be tested headlessly or manually, do not publish it as a structural change.
- If a system has been used in three places, extract it.
- If a system is only imagined, document it but do not abstract it yet.

## Immediate Next Steps

1. ✅ FP body integrated via `chiefmonkey-headless.glb` (layer-2 FP body).
2. ✅ Source reconciliation for v0.2.100 through v0.2.108 completed.
3. ✅ Reverse-ported live fixes by concern (clean source modules, not minified diff).
4. ✅ Extracted Rapier raycast and bodies seams.
5. ✅ Created `window.ToriiDebug`.
6. ✅ Added first combat targeting seam via shared classifier + reticle preview.
7. Manually smoke test live `v0.2.113-alpha`.
8. Create the lightweight Agent/Developer Efficiency Index.
9. 🚧 Extract the player boundary — slices done in v0.2.114 (geometry + spawn + look-down POV) and v0.2.123 (movement heading basis) in `engine/entities/player.js`; next, lift the stateful movement tick, combat, lifecycle, and body-state behind the seam.
10. 🚧 Implement explicit state machine — first slice done in v0.2.115 (`GAME_EVENT`/`TRANSITIONS`/`transition()` + predicates in `src/state.js`, all phase call sites routed through the seam); transition-table unit tests landed v0.2.120 (`tests/state.test.js`); `pointerLocked` folded into `isEngaged`/`needsPointerLock` predicates (v0.2.131) and `reloading` folded into `isReloading`/`tickReload` (v0.2.132); real `GAMEOVER` edge wired in v0.2.133 (`GAME_EVENT.END` + `endRun()`, terminal — no live caller yet; fire it from a future end-of-run screen).
11. 🚧 Implement event bus / decoupling — seam formalised in v0.2.116; bot-hit bridge migrated in v0.2.117 (`EV.BOT_HIT_BY_PLAYER`, `window._onBotHit` deprecated, check 9); foliage shader globals migrated in v0.2.118 (`arena-foliage.js` registry — `tickFoliage`/`getGrassMat`/`getFlowerMat`, `_grassMat`/`_flowerMat` deprecated, check 10); mirror handle migrated in v0.2.119 (`mirror.js` `getMirror()`, `_mirrorMesh` deprecated, check 10 extended) — **all functional `window.*` globals now decoupled**; first real `PHASE_CHANGE` subscriber added in v0.2.121 (top-level screen visibility via pure `engine/ui/phaseScreens.js`); next, add further `PHASE_CHANGE` reactions (audio/presence), and emit `WS_*` when netcode lands.
12. 🚧 Extract BotAgent interface — first slice done in v0.2.122 (pure `engine/entities/bot-agent.js`: decision helpers + `decideActions` facade; scalar helpers wired into `bots.js`, LOS short-circuit preserved; `tests/bot-agent.test.js`). Remaining: migrate the stateful tick/shoot/blowback runtime behind the boundary.
13. 🚧 Start Vitest with one test per extracted boundary — first slice done in v0.2.120 (Vitest + `npm test`; suites for the state machine, event bus, and headshot classifier; classifier extracted to a pure `engine/combat/classifier.js`; check 11 guards the scaffold); phase→screen map added v0.2.121, BotAgent helpers added v0.2.122, player heading basis added v0.2.123, shot-diagnostics miss classifier added v0.2.124, combat damage/kill contract added v0.2.125 (`tests/combat-damage.test.js`, pure `engine/combat/damage.js`), barrel→crosshair aiming helper added v0.2.126 (`tests/aim.test.js`, pure `engine/combat/aim.js`) (100 tests / 9 files); next, add raycast/bodies tests with an injected mock world, then kind:0 profile fetch as those seams land.
14. 🚧 Combat hit-registration — **barrel→crosshair fix LANDED v0.2.126**. Diagnostics landed v0.2.124 (pure `engine/combat/shotDiagnostics.js` + `ToriiDebug.combat.lastShot`/`lastMiss`). Manual feedback ("headshots still take two shots; body shots work") pinned the root cause to REGISTRATION parallax, not damage: the reticle previewed a headshot on the CAMERA ray but the bullet flew the BARREL→80m-convergence line, so muzzle parallax dropped the previewed headshot onto the BODY collider (3 dmg ⇒ two shots; torso survived because it's bigger). v0.2.125 first tried a camera-origin bullet (bullet == camera ray) — fixed parallax but moved the muzzle off the gun. **v0.2.126 (per user revision before publish) restores the gun-barrel origin:** `player.js shoot()` casts the camera/crosshair ray for the aimed point (first hit, or `CONVERGE_DIST` 80 m fallback), spawns the bullet at the barrel (`getGunBarrelWorld`), and fires it **barrel → crosshair point** via the pure `engine/combat/aim.js` (`crosshairPoint`/`aimDirection`). The projectile passes through exactly what the reticle classified, so a previewed headshot still lands as a headshot, and convergence is at the ACTUAL aimed point at any range. No damage value or classifier threshold changed; damage/kill contract locked by `engine/combat/damage.js` + `tests/combat-damage.test.js`; aiming locked by `tests/aim.test.js`. **Remaining open:** finite travel time (60 m/s) means the instantaneous reticle still over-promises on fast-moving targets at range — future options: raise `BULLET_SPEED`, target-lead, a thin at-range hit-assist radius, or a projectile-predicting reticle. Use `ToriiDebug.combat.lastShot` to confirm before picking; do NOT blindly loosen head/body thresholds.
15. Formalise NAP zone metadata/decor hooks.
16. Build a local NAP-to-NAP handoff demo.

## Open Questions

- Should the first NAP-to-NAP jump be same-browser/local, relay-mediated, or node-to-node?
- What should be the minimum player state carried between zones?
- Should NAP zone decoration be stored as Nostr events, local manifests, or both?
- Which NIPs should be treated as first-class dependencies for asset metadata, chat, private messaging, and Nutzaps?
- How much multiplayer authority do we need before money, reputation, or rankings are involved?
- How directly should Torii Quest read/write Plebeian.Market listing data?

## Working Recommendation

Build the best fun arena shooter we can, but treat every stable system as a future SDK boundary and every structural task as an investment in the wider open world.

The game brings people in. NAP zones make it social. Nostr makes it sovereign. Bitcoin makes trade real. FOSS makes it grow beyond one team. The agent-readable structure work makes it maintainable across sessions, contributors, and operators.

The shoot'em up is the proof-of-work layer. The prize is a self-sovereign, open, FOSS, Nostr/Bitcoin-powered world builder and decentralised metaverse layer for Plebeian and Plebeian.Market — one that no single company owns, no central server controls, and any developer or AI agent can contribute to from the repo alone.

Bitcoin and Nostr only, baby.
