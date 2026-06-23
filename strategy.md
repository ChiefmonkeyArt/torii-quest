# Torii Quest Strategy & Next Steps

Living document. This will change as we learn.

Current live game: `https://torii-quest.pplx.app`  
Current live version: `v0.2.113-alpha` (clean source at `v0.2.122-alpha`, not yet published)  
Clean source version: `v0.2.122-alpha` — **source reconciliation COMPLETE (2026-06-23)**, **foundation sprint COMPLETE (2026-06-23)**, **regression repair pass COMPLETE (2026-06-23)**, **collision/POV tuning COMPLETE (2026-06-23)**, **foundation tuning COMPLETE (2026-06-23)**, **player boundary first slice STARTED (2026-06-23)**, **state-machine groundwork first slice STARTED (2026-06-23)**, **event-bus seam formalised (2026-06-23)**, **bot-hit bridge migrated onto the bus (2026-06-23)**, **foliage shader globals migrated to a module registry (2026-06-23)**, and **mirror handle migrated to a module accessor — last functional global decoupled (2026-06-23)**. The clean source contains all live fixes v0.2.100→v0.2.108, the first SDK boundaries (physics raycast + bodies), `window.ToriiDebug`, hardening, inert NAP/handoff/presence skeletons, the v0.2.111 repair batch, the v0.2.112 hit-detection/look-down POV tuning pass, the v0.2.113 shared combat classifier/reticle, crate impulse, and snappy reload pass, the v0.2.114 player boundary first slice (pure player geometry + spawn + look-down POV math extracted to `engine/entities/player.js`), the v0.2.115 state-machine first slice (explicit `GAME_EVENT`/`TRANSITIONS`/`transition()` + phase predicates in `src/state.js`, all phase call sites routed through the seam), the v0.2.116 event-bus seam (registry convention documented, `EV.PHASE_CHANGE` wired from `state.transition()`, undefined-event regression guard), the v0.2.117 bot-hit migration (`EV.BOT_HIT_BY_PLAYER` from weapons.js → main.js subscriber; `window._onBotHit` deprecated to a forwarding alias; regression check 9), the v0.2.118 foliage-material registry (grass/flower shaders moved off `window` into `arena-foliage.js` — `tickFoliage`/`getGrassMat`/`getFlowerMat`; `_grassMat`/`_flowerMat` deprecated to debug aliases; regression check 10), the v0.2.119 mirror accessor (Reflector handle moved off `window` into `mirror.js` `getMirror()`; `_mirrorMesh` deprecated to a debug alias; regression check 10 extended — last functional global decoupled), the v0.2.120 Vitest foundation (added Vitest + `npm test`; first pure unit suites for the state machine, event bus, and headshot classifier — the classifier extracted to a pure `engine/combat/classifier.js`; regression check 11 guards the scaffold), and the v0.2.121 first real `EV.PHASE_CHANGE` subscriber (top-level screen visibility centralised into a pure `engine/ui/phaseScreens.js` map applied by one main.js subscriber; the imperative title/HUD/pause toggles removed from the transition call sites; `tests/phaseScreens.test.js` added), and the v0.2.122 BotAgent boundary first slice (pure `engine/entities/bot-agent.js` — `BOT_ACTION` constants, decision helpers `engageSpeed`/`steerComponent`/`inEngageRange`/`wantsToShoot`, and a `decideActions(worldState) -> BotAction[]` facade; `bots.js` hot path consumes the scalar helpers with the LOS short-circuit preserved; `decideActions` tested-but-unwired; `tests/bot-agent.test.js` added). Builds green; all static regression checks pass (`npm run check`); `npm test` green (54 tests). See `torii-source-reconciliation-report.md`, `torii-foundation-sprint-report.md`, `torii-v0.2.111-regression-repair-report.md`, `torii-v0.2.112-tuning-report.md`, `torii-v0.2.113-foundation-tuning-report.md`, `torii-v0.2.114-player-boundary-report.md`, `torii-v0.2.115-state-machine-report.md`, `torii-v0.2.116-event-bus-report.md`, `torii-v0.2.117-bot-hit-event-report.md`, `torii-v0.2.118-material-registry-report.md`, `torii-v0.2.119-mirror-accessor-report.md`, `torii-v0.2.120-vitest-foundation-report.md`, `torii-v0.2.121-phase-subscriber-report.md`, and `torii-v0.2.122-botagent-report.md`.  
Project direction: Torii Quest is an extension of Plebeian.Market, exploring a self-sovereign, federated, decentralised metaverse built on Nostr, Bitcoin, open protocols, free markets, and FOSS developer participation.

## Vision

Torii Quest starts as a fun browser shoot'em up, but the larger goal is bigger than a game. It is a working prototype of a decentralised digital world where people can move between NAP zones, shops, stalls, art galleries, hangouts, events, duels, communities, and marketplaces without needing a central platform account.

The long-term direction is npub-to-npub and node-to-node. A player owns their identity, carries their reputation and assets through signed Nostr events, trades using Bitcoin/Cashu/Nutzaps where appropriate, and participates in local circular economies that can interoperate with wider global networks.

Torii Quest should become the playful, explorable, spatial layer of the Plebeian ecosystem. Plebeian.Market is commerce and community. Torii Quest can become the embodied, social, federated world where market stalls, art galleries, local groups, and communities can exist as places.

## Core Principles

- **Self-sovereignty first**: npub is the primary identity. No parallel account system should become the source of truth.
- **Bitcoin and Nostr only by default**: value, identity, messaging, presence, discovery, and handoff should prefer Bitcoin/Cashu/Nostr rails before platform-specific infrastructure.
- **Federated, not centralised**: worlds should discover each other through relays and signed metadata, not a mandatory central registry.
- **Fun before ideology**: the shoot'em up must remain fun. The freedom-tech architecture should make the game more meaningful, not make it boring.
- **Progressive fixes that work**: ship small, testable improvements. Avoid broad speculative rewrites that create repeated bug cycles.
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

### Now

- **Source reconciliation**: ✅ DONE (2026-06-23) — v0.2.100 through v0.2.108 reverse-ported into clean source. See `torii-source-reconciliation-report.md`.
- **Foundation sprint**: ✅ DONE (2026-06-23) — SDK boundaries, ToriiDebug, hardening batch, and world/identity skeletons landed at v0.2.110-alpha. See `torii-foundation-sprint-report.md`.
- **Regression repair**: ✅ DONE (2026-06-23) — v0.2.111-alpha fixed FP neck clipping, footstep cadence, reflected gun roll, headshot classification, NAP NPC placement/materials, and reload viewmodel animation. See `torii-v0.2.111-regression-repair-report.md`.
- **Collision/POV tuning**: ✅ DONE (2026-06-23) — v0.2.112-alpha tightened head/body detection and refined look-down camera/body arc. See `torii-v0.2.112-tuning-report.md`.
- **Foundation tuning**: ✅ DONE (2026-06-23) — v0.2.113-alpha tightened headshot classification, restored target feedback, added crate bullet nudges, and made reload faster/snappier. See `torii-v0.2.113-foundation-tuning-report.md`.
- **Player boundary (first slice)**: ✅ DONE (2026-06-23) — v0.2.114-alpha extracted pure player geometry, spawn shape, and look-down POV math into `engine/entities/player.js`; `src/player.js` consumes the seam with no behaviour change. Stateful tick/combat/lifecycle/body-state remain to be lifted in a later slice. See `torii-v0.2.114-player-boundary-report.md`.
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
- **Plebeian.Market spatial layer**: map shops, stalls, product displays, auctions, community boards, and galleries into the world.
- **Bitcoin/Cashu/Nutzap economy**: rewards, tips, paid events, trade, and local circular economies without custodial accounts.

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
9. 🚧 Extract the player boundary — first slice done in v0.2.114 (geometry + spawn + look-down POV in `engine/entities/player.js`); next, lift the stateful movement tick, combat, lifecycle, and body-state behind the seam.
10. 🚧 Implement explicit state machine — first slice done in v0.2.115 (`GAME_EVENT`/`TRANSITIONS`/`transition()` + predicates in `src/state.js`, all phase call sites routed through the seam); transition-table unit tests landed v0.2.120 (`tests/state.test.js`); next, fold `reloading`/`pointerLocked` into guarded state and wire a real `GAMEOVER` edge.
11. 🚧 Implement event bus / decoupling — seam formalised in v0.2.116; bot-hit bridge migrated in v0.2.117 (`EV.BOT_HIT_BY_PLAYER`, `window._onBotHit` deprecated, check 9); foliage shader globals migrated in v0.2.118 (`arena-foliage.js` registry — `tickFoliage`/`getGrassMat`/`getFlowerMat`, `_grassMat`/`_flowerMat` deprecated, check 10); mirror handle migrated in v0.2.119 (`mirror.js` `getMirror()`, `_mirrorMesh` deprecated, check 10 extended) — **all functional `window.*` globals now decoupled**; first real `PHASE_CHANGE` subscriber added in v0.2.121 (top-level screen visibility via pure `engine/ui/phaseScreens.js`); next, add further `PHASE_CHANGE` reactions (audio/presence), and emit `WS_*` when netcode lands.
12. 🚧 Extract BotAgent interface — first slice done in v0.2.122 (pure `engine/entities/bot-agent.js`: decision helpers + `decideActions` facade; scalar helpers wired into `bots.js`, LOS short-circuit preserved; `tests/bot-agent.test.js`). Remaining: migrate the stateful tick/shoot/blowback runtime behind the boundary.
13. 🚧 Start Vitest with one test per extracted boundary — first slice done in v0.2.120 (Vitest + `npm test`; suites for the state machine, event bus, and headshot classifier; classifier extracted to a pure `engine/combat/classifier.js`; check 11 guards the scaffold); phase→screen map added v0.2.121, BotAgent helpers added v0.2.122 (54 tests / 5 files); next, add raycast/bodies tests with an injected mock world, then kind:0 profile fetch as those seams land.
14. Formalise NAP zone metadata/decor hooks.
15. Build a local NAP-to-NAP handoff demo.

## Open Questions

- Should the first NAP-to-NAP jump be same-browser/local, relay-mediated, or node-to-node?
- What should be the minimum player state carried between zones?
- Should NAP zone decoration be stored as Nostr events, local manifests, or both?
- Which NIPs should be treated as first-class dependencies for asset metadata, chat, private messaging, and Nutzaps?
- How much multiplayer authority do we need before money, reputation, or rankings are involved?
- How directly should Torii Quest read/write Plebeian.Market listing data?

## Working Recommendation

Build the best fun arena shooter we can, but treat every stable system as a future SDK boundary.

The game brings people in. NAP zones make it social. Nostr makes it sovereign. Bitcoin makes trade real. FOSS makes it grow beyond one team. The near-term engineering job is to keep those ambitions from collapsing into brittle code by moving from patched dist back to clean, modular source.

Bitcoin and Nostr only, baby.
