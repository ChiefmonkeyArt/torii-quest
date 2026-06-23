# Nostr Arena — Master Todo
> **Source of truth for all tasks.** Update this file whenever tasks are added, changed, or completed.
> Live site: [nostr-arena.pplx.app](https://nostr-arena.pplx.app) | Current version: **v0.6.144-alpha**

> Torii Quest gateway fork/session note: [torii-quest.pplx.app](https://torii-quest.pplx.app) is currently **v0.2.111-alpha**. Clean source reconciliation, foundation sprint, and the v0.2.111 regression repair pass are complete and pushed to GitHub. Strategy source of truth: `Strategy-&-Next-Steps.md`.

---

## Pending

| # | Category | Task |
|---|----------|------|
| 8 | POST-VITE | State machine — replace ad-hoc booleans with explicit FSM in `src/state.js` |
| 9 | POST-VITE | Event bus — decouple modules via `src/events.js` |
| 12 | POST-VITE | WebGPU renderer — Three.js WebGPU backend behind feature flag |
| 13 | BUNDLE | rollup-plugin-visualizer treemap — full bundle audit, unused Three.js extras |
| 14 | TESTING | Vitest unit suite — sat balance, bot respawn, key states, Nostr kind:0 fetch |
| 19 | ECASH | NIP-60 eCash wallet real-money arena stakes — NIP-07 browser extension auth, fetch live sat balance, stake 100 sats to enter arena, signed eCash token transfers on hit/kills between players |
| 20 | NOSTR | Kind:0 profile sync manager — fetch kind:0 from primary relay on login, broadcast to all connected relays, use latest profile picture as player avatar, handle relay sync latency in multiplayer |
| 21 | HUD | 2D mini-map — add a 2D mini-map to the HUD showing live player and bot positions |
| 22 | INFRA | GitHub weekday morning scan — scheduled task every weekday morning, scan ChiefmonkeyArt/nostr-arena and report open issues and PRs |
| A1 ✅ | ARCH | **main.js modular migration plan** — Steps 1–7 complete: `safe-zones.js` (v0.6.136), `scene-setup.js` (v0.6.139), `lighting.js` (v0.6.140), `arena-objects.js` (v0.6.141), `nap-zone.js` (v0.6.142), `asset-loader.js` (v0.6.143), `input.js` (v0.6.144). Next: `player.js` (v0.6.145). |
| A1-next | ARCH | **Extract player.js** — movement tick, velocity, WASD+dash, zoom, iFrames, spectator cam, death/respawn (v0.6.145) |

| B1 | GAMEPLAY | **Kill feed + death counter** — Implement a persistent kill feed and death counter tracking system for bot NPC encounters. Ensure every hit and kill event broadcasts to local session state correctly even when the player is moving fast. Display these metrics on the death screen when the player dies. Redeploy to nostr-arena.pplx.app. |
| B2 | GAMEPLAY | **Bot NPC behaviour refactor** — Smooth out patrol and chase animations, add raycast-based obstacle avoidance so bots do not walk into the checker walls, and synchronise their movement speed with the player's strafing and running speed so combat feel is balanced. Redeploy to nostr-arena.pplx.app. |
| B3 | INFRA | **Daily 8am bot health check** — Every morning at 8am, check nostr-arena.pplx.app deployment status, run a headless browser test confirming at least 5 bot NPC entities are rendered and not frozen or hidden by shader errors. Flag only if bot count < 5 or main shader fails to compile. Notify via Nostr DM (NIP-04 encrypted kind:4) or in-app notification only if a regression is detected — no third-party services. |
| A2 | ARCH | **State + event bus refactor** — Restructure main.js by migrating shared mutable state into a central state object and implementing an event bus for inter-module communication. Provide a concrete migration of the bot AI section to bot-ai.js with state sync, and define the architectural pattern that will simplify adding Nostr-based ecash wallet and other complex features without circular dependencies. |
| 3 | NAP ZONE | NAP Zone video chat — private WebRTC, presence-aware NIP-04 encrypted kind:25050 signalling, Nextcloud/Framasoft STUN, coturn fallback on host VPS |
| 4a | INFRA | Self-hosted coturn TURN server — each arena host runs coturn on their VPS |
| 4b | INFRA | Nostr relay as ICE candidate — track NIP proposal for relay/wss extension |
| 6 | NAP ZONE | Live Nostr auctions — kind:30402/16, NIP-17 order flow, auction podium, Lightning/eCash payment |
| 7 | NAP ZONE | Host-configurable shop stalls — stalls.json, kind:30402/30405, stall geometry per vendor |
| W1 | UI/UX | **Gate Modal — Torii Gate social popup** — Modal that appears when standing at the Torii Gate showing: (1) avatar grid of online Nostr followers/following with coloured ring indicators (dashed purple = in-arena, solid green = online, orange = away); (2) open events list with player counts, sat pot, and JOIN buttons; (3) tab navigation (Following / Followers / Open Events). Four concept designs produced — **Concept 04 (Feudal Scroll × Cyberpunk Terminal)** selected: lacquer dark background + red scanline texture, torii arch SVG above modal, nostr purple ring variants, red/purple duality, monospace data aesthetic. Self-contained component — fires Nostr relay query on open, closes on ESC, click-outside, or close button. Panel-locked: clicking inside modal NEVER fires weapon. |
| G1 | ASSET | **gun.glb** — Create a proper gun model to replace the current procedural black block/stick placeholder. Design brief: compact semi-auto pistol / futuristic sidearm aesthetic that fits the arena-shooter / cyberpunk-feudal theme. Draco-compress + WebP textures. Swap into `src/weapons.js` gunBody/gunBarrel/gunGrip viewmodel. Add to `PRECACHE_ASSETS` in `public/sw.js`. |
| V1 | GAMEPLAY | **Contrail plane** — Low-poly plane flies across arena at ~100u altitude every 90–180s on a random heading. Leaves a permanent white `Line` contrail that slowly drifts sideways (wind) — **no fading, stays for the entire game session**. Multiple planes = criss-crossing lines at random angles accumulating in the sky. If the plane is shot down, the contrail stops exactly at the hit point — a truncated line marking the kill, visible to everyone for the rest of the session. Shootable hitbox — on hit, spawns a slow-falling supply crate landing in the arena (reward: explosive rounds 30s / big sat bonus / full HP). Spatial conflict hotspot. Distant engine SFX fades in/out. `triggerShake()` on hit. Self-contained `src/plane.js` module ~150 lines. |
| R2 | WEAPON | **Immersive reload mechanic** — Add a mag-eject/reload animation using a secondary geometry group for the magazine (slides out during dip phase, back in during snap phase). Lock player to hip-fire (no zoom) for the duration of the reload. Makes reload feel weightier and physically distinct from simple position shifts. Build on the 3-phase carry-low animation added in v0.6.183-alpha. |
| LB1 | NOSTR | **Persistent leaderboard** — Read/write player stats to Nostr kind:30000 replaceable events on public relays (total sats earned, kill count, npub). Aggregate top 10 players by querying connected relays on game load. Display on the title screen before a session starts: ranked table showing avatar, name (kind:0), kills, and sats earned. Returning players see their own rank and delta vs last session highlighted. No central server — fully relay-native. New module `src/leaderboard.js`. |
| NIP46-1 | BUG | **Primal remote signer — pubkey not returned** — Primal's NIP-46 implementation is non-compliant: it does not respond to `get_public_key` requests and does not include the user pubkey in the `connect` response (only echoes the secret). Workaround: v0.6.238 prompts for npub once and caches in `localStorage`. Real fix requires Primal to implement `get_public_key` or include the user pubkey in their connect response. GitHub issue filed. |
| TP1 ⏸ | GAMEPLAY | **Touchpad / laptop controls — PARKED** — WASD + trackpad causes a freeze on arena entry (suspected pointer lock stall on integrated GPU / Mesa). Game currently requires **WASD + external mouse**. [GitHub issue #20](https://github.com/ChiefmonkeyArt/nostr-arena/issues/20) filed. Will revisit after core gameplay is stable. |
| CF1 | GAMEPLAY | **Combat feedback checklist** — Draft and implement a full combat-feel pass: (1) **Screen-shake on hit** — configurable intensity (small shake when hitting a bot, bigger shake when taking damage); (2) **Weapon kick animation** — gun body recoils back/up on each shot, snaps forward with ease-out (distinct from the reload carry-low, should fire every shot); (3) **Hit-marker effects** — crosshair flashes/expands on confirmed hit, distinct colour for headshots; (4) **Damage vignette pulse** — red edge vignette pulses proportional to damage received; (5) **Bot hit flash** — bot mesh briefly flashes white on bullet impact. Integration plan: all mechanics wired into game-loop alongside the v0.6.183-alpha reload animation — no new setTimeout, dt-accumulator driven. |


---

## Completed — Torii Quest Gateway Regression Repair (v0.2.111-alpha)

| # | Category | Task | Version |
|---|----------|------|---------|
| TQ111-1 | BUG | **First-person body / neck POV** — looking down no longer shows inside the headless neck. Enabled local clipping, added a body clip plane below the eye, and pushed the FP body forward so the view reads as chest → feet. Manual visual tuning still recommended on real hardware. | v0.2.111 |
| TQ111-2 | BUG | **Footstep drumroll** — walk/beat audio now gates on measured horizontal speed plus jump/land hysteresis, preventing rapid drum-roll playback while idle or blocked. No new timers. | v0.2.111 |
| TQ111-3 | BUG | **Mirror gun orientation** — world/reflection gun rolled around its barrel axis so the handle points down in mirror view. | v0.2.111 |
| TQ111-4 | BUG | **Headshot counting regression** — headshot detection now uses a deterministic dual test: explicit head collider OR impact height above the bot body-capsule top. Camera-origin bullet path unchanged. | v0.2.111 |
| TQ111-5 | GAMEPLAY | **Crates** — pushable crates verified as still present; no crate code changed in this repair pass. Continue playtesting feel. | v0.2.111 |
| TQ111-6 | BUG | **NAP Chiefmonkey walking into tree** — NPC moved clear of bonsai and switched to an idle-first clip so it reads as a stationary greeter rather than walking into scenery. | v0.2.111 |
| TQ111-7 | BUG | **NAP Chiefmonkey skin splitting** — NPC materials patched opaque/depth-writing to prevent skinned mesh tearing from blended alpha handling. Scale policy preserved. | v0.2.111 |
| TQ111-8 | BUG | **Reload animation feedback** — FP gun viewmodel now visibly dips/rolls during reload via dt/state progress, making reload state obvious again. | v0.2.111 |

## Completed — Torii Quest Gateway Foundation Sprint (v0.2.100–v0.2.110-alpha)

| # | Category | Task | Version |
|---|----------|------|---------|
| TQ100 | BUG | **Mirror/player reflection scale** — Chiefmonkey player reflection no longer appears massive in the west-wall mirror. | v0.2.100 |
| TQ101 | UI/UX | **Reload visual feedback** — ammo/crosshair reload state made visible. | v0.2.101 |
| TQ102 | AUDIO | **Gun audio polish** — softened clanky gun sound into warmer laser-like zap. | v0.2.102 |
| TQ103 | PHYSICS | **Rapier-backed bot bullets** — bot bullet geometry moved onto Rapier raycast/swept query helper seed. | v0.2.103 |
| TQ104 | BUG | **Arena boundary/fall-hole fix** — player clamped to valid arena footprint with fall recovery to prevent black-void escape. | v0.2.104 |
| TQ105 | PHYSICS | **Bot LOS raycast** — bots gate firing on Rapier line-of-sight, preventing shots through solid geometry. | v0.2.105 |
| TQ106 | PHYSICS | **Dynamic crates** — four kickable Rapier crates with body/mesh sync; future `engine/physics/bodies.js` seed. | v0.2.106 |
| TQ107 | NAP ZONE | **Chiefmonkey NAP NPC** — non-hostile NAP-zone Chiefmonkey using `Stylish_Walk_inplace`/fallback animation. | v0.2.107 |
| TQ108 | PLAYER | **Headless FP body** — `chiefmonkey-headless.glb` integrated so the player can see Chiefmonkey body/feet when looking down. | v0.2.108 |
| TQ109 | INFRA | **Source reconciliation** — live v0.2.100→v0.2.108 fixes reverse-ported into clean source. | v0.2.109 |
| TQ110 | ARCH | **Foundation sprint** — `engine/physics/raycast.js`, `engine/physics/bodies.js`, `window.ToriiDebug`, hardening batch, NAP metadata, handoff/presence skeletons, and regression tooling landed. | v0.2.110 |

## Pending — Torii Quest Gateway Manual Smoke / Next Fun-Feature Gate

| # | Category | Task |
|---|----------|------|
| TQ-MANUAL-111 | TESTING | Manually test live `v0.2.111-alpha` on real hardware: look-down neck/feet view, reflected gun handle-down, headshot counting, reload dip, NAP NPC pose/materials, footstep cadence, crates, mirror, bot LOS, and general combat feel. |

## Completed — Bug Fixes (v0.6.124)

| # | Category | Task | Version |
|---|----------|------|---------|
| F1 | BUG | **Nostr login broken** — `renderFederationPanel()` accidentally dropped during v0.6.122 dynamic-import refactor. `ReferenceError` on click → button showed "⚠ Login failed" and reset. Restored full function to `main.js`. | v0.6.124 |
| F2 | BUG | **Login button stuck disabled** — `startFederationDiscovery()` called without `.catch()` inside async login handler; federation errors propagated to outer `catch` and re-disabled the button. Fixed with `.catch()` on the fire-and-forget call + explicit `btn.disabled = false` on success path. | v0.6.124 |
| F3 | PERF | **SW install slow** — `PRECACHE_ASSETS` included 4 large player GLBs (~3.5MB: chiefmonkey5, player-chiefmonkey, augustink, banker-spanker) blocking SW install. Moved to lazy cache-on-use via existing `cacheFirst` fetch handler. SW now only precaches ~4MB of critical assets. | v0.6.124 |


## Completed — Bug Fixes (v0.6.133)

| # | Category | Task | Version |
|---|----------|------|---------|
| F5 | BUG | **instanced-bots: shader compile error** — `RawShaderMaterial` in Three.js r165 auto-prepends `position`, `normal`, `uv`, `instanceMatrix`, `projectionMatrix`, `viewMatrix` — original shader redeclared all of these causing GLSL compile failure → nothing rendered. Fixed: removed all duplicate attribute/uniform declarations from vertex shader. | v0.6.133 |
| F6 | BUG | **instanced-bots: synchronous bone bake blocked load** — 114 frames × `AnimationMixer.setTime()` was running synchronously on the main thread, stalling GLB load by several seconds. Fixed: entire bake deferred via `setTimeout(0)`; `initInstancedBots()` returns `true` immediately; `_ready` set async after bake completes. | v0.6.133 |
| F7 | BUG | **instanced-bots: premature glbGroup hide** — `initInstancedBots()` now always returns `true` (async design), so the GLB load callback's `if (_ibOk) { bot.glbGroup.visible = false }` block was hiding all GLBs before bake completed → no characters visible. Fixed: removed the premature-hide block entirely; per-frame `_ibIsReady()` check in `updateBot()` handles the GLB→instanced transition automatically. | v0.6.133 |
| F8 | BUG | **instanced-bots: broken `ambientCol` uniform** — `lDir.map((_, i) => ...)` now correctly produces `[0.35, 0.35, 0.45]` vec3 for ambient lighting. | v0.6.133 |
| F9 | BUG | **Missing nostriches after bake** — removing the premature init-block activation in v0.6.133 meant bots were never registered into the `InstancedMesh` (only `reviveBot()` activated instances, and that only fires on respawn). Fixed: `_ibWasReady` flag + one-shot sweep in the update loop. First frame `_ibIsReady()` is true, all alive bots are bulk-activated via `activateInstance()` + `setInstanceAnim('walk')`. | v0.6.134 |

---

## Completed — Perf Optimisations (v0.6.132)

| # | Category | Task | Version |
|---|----------|------|---------|
| P3 | PERF | **GPU-instanced skinning — bone texture atlas** — New module `src/instanced-bots.js`. All bot animation frames pre-baked into a 96×114 RGBA32F `DataTexture` (171 KB VRAM) at load time. Single `InstancedMesh` (64-instance capacity) with custom `RawShaderMaterial` replaces 5 individual `SkinnedMesh` clones — **1 draw call** for all nostriches. Per-instance `instanceFrameIndex` float attribute drives vertex texture fetch in GLSL. `tickInstancedBots(dt)` replaces all `AnimationMixer.update()` calls — O(N) frame index advance vs O(N × bones) bone matrix upload. Graceful fallback to GLB pipeline on WebGL1 or missing float-texture support. Kill/revive hooks wired to `setInstanceAnim('die'/'walk')`. | v0.6.132 |
| P3b | PERF | **VoxelInstancedRenderer** — `initVoxelInstanced()` creates 6 `InstancedMesh` parts (head/body/arms/legs) for remote players and future world-scale entities. CPU walk-swing via per-instance phase float. Supports 256 simultaneous voxel characters at 6 draw calls total. Exposed via `window._voxelInstanced` for multiplayer module integration. `tickVoxelInstanced(dt)` called each frame. | v0.6.132 |

---

## Completed — Perf Optimisations (v0.6.131)

| # | Category | Task | Version |
|---|----------|------|---------|
| P1 | PERF | **Mixer animation throttle** — all 5 bot `mixer.update(dt)` calls throttled to 30Hz (every other frame via `getLoopFrame() % 2`, passing `dt×2`). Same pattern as grass/wind uniforms. Dying Augustink boss keeps full-rate ticks (death anim must stay smooth). ~15% skeletal CPU saving. | v0.6.131 |
| P2 | PERF | **Adaptive shadow culling on bots** — `_tickAdaptiveShadow()` called every 30 frames. If `window._dbgFT > 20ms`, sets `castShadow=false` on all bot `glbGroup` meshes + Augustink boss. Re-enables automatically when frame time drops below threshold. `window._augustinkGroup` exposed for traversal. | v0.6.131 |

---

## Completed — GC / Performance Fixes (v0.6.125–v0.6.126)

| # | Category | Task | Version |
|---|----------|------|---------|
| F4 | BUG | **Crash on init: `_up` not defined** — `const _up = new Vector3(0,1,0)` was inside grass IIFE block scope; wildflower block (separate scope) referenced it → `ReferenceError` → module crash → permanent "INITIALISING…" freeze. Fixed: promoted to module level. | v0.6.125 |
| G5 | PERF | **Full GC audit — per-shot allocations eliminated** — (1) `spawnMuzzleFlash()` created `new PointLight` + `requestAnimationFrame` closure per shot → pooled `_muzzlePool[4]`, dt-faded via `_tickFadeLights()` in game loop. (2) `playKill()` `createConvolver()` per kill → `_convPool[2]` round-robin pre-allocated in `_bakeBuffers()`. (3) `bullets.js` `fadeFlash`/`fadeImpact`/`fadeE` rAF closures (3 new functions per shot/impact/explosion) → all replaced with `_registerFade()` dt-based system. (4) `playerShoot()` `_shootOrigin.clone()` per shot → `_muzzlePos` scratch Vector3. (5) `spawnBullets/spawnBotImpact/spawnBulletExplosion` `particles.push({...})` object literal allocations → `_particleEntryPool[64]` + `_mainEntryPool[64]` round-robin. (6) `new Vector3` in crate explosion + dust spawners → `_crateExpVel` scratch. | v0.6.130 |
| D5 | DEBUG | **Global error capture** — `window.onerror` + `window.onunhandledrejection` handler captures stack trace, full game state snapshot, bot states, recent player actions, FPS/frame-time into `_errBuf[30]` circular buffer. `window._errDump()` pretty-prints to console. | v0.6.130 |
| D6 | DEBUG | **Stress-test room** — `window._debugStress(50)` spawns 50 extra nostriches, mounts stats.js FPS/MS/MB overlay, runs frame-spike logger (>20ms threshold). `window._spikeDump()` prints spike table. `window._debugStressOff()` tears down and restores normal bot count. | v0.6.130 |
| G4 | BUG | **Audio GC double-kill freeze** — `playKill()` synthesized a fresh `AudioBuffer` (13,230 floats stereo + `ConvolverNode`) on every call. Two kills in one Banker Spanker swing = two main-thread buffer allocations = freeze. Fixed: `_bakeBuffers(ac)` called once inside `ensureAudio()` — all noise/impulse buffers pre-allocated as module-level refs; all play functions reuse refs with zero buffer allocation during gameplay. Also fixed: `bot.mesh.position.clone()` in `_triggerBsSwing` melee loop replaced with `_spawnDmgPos` scratch; `spawnCasing()` per-shot `new CylinderGeometry/MeshBasicMaterial/Mesh/Vector3` replaced with 8-slot round-robin `_casingPool`/`_casingVelPool`; `playerShoot()` `const dir = new Vector3()` replaced with `_shootDir` scratch. | v0.6.129 |
| G3 | BUG | **Banker Spanker freeze on pickup/use** — three causes: (1) `banker-spanker.glb` (864KB Draco) had `visible=false` at load; Three.js deferred GPU buffer upload until first visible render = main-thread stall on pickup. Fixed: force a 1×1 offscreen render into `WebGLRenderTarget` immediately after GLB loads to pre-warm all GPU buffers. (2) `_spawnSpankerPickups()` allocated 4× Group/Mesh/Geo/Mat/PointLight per crate break mid-game. Fixed: pre-allocated pool of 4 reusable objects at startup; crate break just resets positions/velocities. (3) `spawnParticles(new Vector3(...))` in bullet update hot path. Fixed: reuses `_spawnDmgPos` scratch. | v0.6.128 |
| G2 | PERF | **Bot draw call reduction** — each `SkeletonUtils.clone()` was duplicating geometry + material objects onto the GPU (5× identical VBOs). Fixed: first clone caches `_botSharedGeo` + `_botSharedMat`; subsequent 4 clones swap in the shared objects. Each bot keeps its own `Skeleton` for independent animation. Also: 5 invisible placeholder `BoxGeometry` meshes removed from scene after GLB attaches (were burning frustum checks every frame). Scale/offset now computed once (`_botScaleVal`, `_botOffsetY`) — 8 `Box3` traversals reduced to 2. | v0.6.127 |
| G1 | PERF | **Bullet/particle GC pauses** — `spawnBullet` was allocating 3× `new Vector3`, 1× `new Quaternion`, 1× `.clone()`, 1× `new PointLight` (flash), 1× `new PointLight` (bot) per shot; `spawnParticles` 6× `new Vector3` per impact; `spawnBotImpact` 14× `new Vector3` + 1× `new PointLight`; `_getBulletDeps()` rebuilt a new object on every call. Fixed: module-level `_bUp`/`_bNorm`/`_bQ` scratch vars; `_velPool` (32× pre-allocated `Vector3` round-robin); PointLight pools `_flashLightPool[8]`, `_botLightPool[8]`, `_impactLightPool[4]`, `_explosionLightPool[4]`; `_getBulletDeps()` → singleton cache `_bulletDepsCache`. Zero heap allocations per shot at steady state. | v0.6.126 |

---

## Completed — Optimisation Sprint (v0.6.119–v0.6.123)

| # | Category | Task | Version |
|---|----------|------|---------|
| 1 | SIZE | Draco + WebP compress `chiefmonkey5.glb`: 8.2MB → 848KB (90%) | v0.6.120 |
| 1b | SIZE | Draco + WebP compress `banker-spanker.glb`: 8.4MB → 864KB (90%) | v0.6.120 |
| 2 | PERF | Lazy-load NAP zone — stalls + podium deferred to first entry via `_buildNAPGeometryOnce()` | v0.6.122 |
| 3 | BUNDLE | Code-split Nostr/federation — `nostr-federation.js` dynamic import, separate lazy chunk | v0.6.122 |
| 4 | PERF | Shadow map off in NAP zone — `dirLight.castShadow = !inNAP` on transition | v0.6.120 |
| 6 | PERF | Aurora dome vertex reduction — `SphereGeometry` 32,16 → 24,12 (44% fewer verts) | v0.6.121 |
| 7 | PERF | Grass/flower `uTime` throttled to 30Hz (every 2nd frame, dt×2 to maintain speed) | v0.6.121 |
| 7b | PERF | Wind direction uniform throttled to every 4th frame | v0.6.121 |
| 8 | PERF | Bullet-bot collision: `Math.sqrt` replaced with squared distance comparison | v0.6.121 |
| 9 | PERF | Bot AI distance-based culling — bots <25u tick every 4th frame, ≥25u every 8th | v0.6.121 |
| 10 | PERF | debug-capture ring buffer rewritten with `Float32Array` + `Uint8Array` — zero GC per frame | v0.6.123 |
| 11 | PERF | `new Vector3`/`new Matrix4` inside InstancedMesh loops promoted to module-level scratch | v0.6.121 |
| 12 | UX | GLB loading progress — ASCII bar `[████░░░░░░] 80%`, all 5 GLB names labelled | v0.6.122 |
| 13 | PERF | SW precache: added `chiefmonkey5.glb` + `banker-spanker.glb` to `PRECACHE_ASSETS` | v0.6.119/120 |

---

## Completed — Debug / Glitch Capture (v0.6.117–v0.6.118)

| # | Category | Task | Version |
|---|----------|------|---------|
| D1 | DEBUG | Debug overlay — keys state (W/A/S/D + arrows as 0/1), velocity, speed, lock, frame dt | v0.6.117 |
| D2 | DEBUG | CSV telemetry — `window._debugCSV = true` logs rows to console at 1/s | v0.6.117 |
| D3 | DEBUG | Stuck-key glitch capture — auto-saves 10s ring buffer to localStorage when key=1 + speed≈0 for 150ms | v0.6.118 |
| D4 | DEBUG | Download button — red ⬇ button appears after first capture, triggers JSON export | v0.6.118 |

---

## Completed — Character & Visual fixes (v0.6.109–v0.6.116)

| # | Category | Task | Version |
|---|----------|------|---------|
| C3 | BUG | Removed lobby entirely — 53-line div from `index.html`, 298 lines from `main.js` | v0.6.110 |
| C4 | BUG | Bot revival race — `launchArena()` async setTimeout caused bots invisible on start | v0.6.110 |
| C5 | BUG | Compass labels flickering — replaced Sprites with PlaneGeometry Mesh per wall face | v0.6.111/112 |
| C6 | BUG | Mirror reflection — replaced static MeshStandardMaterial with Three.js `Reflector` | v0.6.112 |
| C7 | BUG | Player voxel body visible in FPS — moved voxel group to layer 1 | v0.6.113 |
| C8 | BUG | All character disappearances root cause — GLBs fetched via `HTTP_URL` (port 8001) cold-start 503. Fixed: all GLB fetches now use relative paths from S3 | v0.6.114 |
| C9 | BUG | Augustink frozen arms-out — index-based clip selection replaced with name-matching `/walking/i` | v0.6.115 |
| C10 | BUG | Player not in mirror — `mirror.camera.layers.enable(1)` | v0.6.115 |
| C11 | BUG | Green voxel blocks in mirror alongside Chiefmonkey — removed all `buildPlayerMesh()` calls | v0.6.116 |

---

## Completed — Stability (v0.6.119)

| # | Category | Task | Version |
|---|----------|------|---------|
| S1 | STABILITY | GLB retry logic — `loadGLBWithRetry()` wraps all 5 loaders, 3× retries with 1.5s/3s/6s backoff | v0.6.119 |

---

## Completed — Earlier versions

| # | Category | Task | Version |
|---|----------|------|---------|
| 2 | WEAPON | Banker-Spanker — GLB designed, melee mechanic with left/right swing arc, proximity trigger, hit SFX, emissive materials | v0.6.97 |
| 16 | PLAYER | Player character system — Chiefmonkey as default GLB, character picker UI, custom GLB upload via IndexedDB | v0.6.84 |
| 15 | SIZE | GLB optimisation — gltf-transform Draco compression + WebP textures at build time | v0.6.84 |
| C1 | CHARACTER | Augustink3.glb — replaced old model, Draco-compressed, character picker headshot rendered from GLB | v0.6.85 |
| C2 | BUG | Augustink circular base — SW cache-first serving old cached GLB, fixed by version bump + precache | v0.6.86 |
| 1 | HOLD | GitHub repo ChiefmonkeyArt/nostr-arena — public, 14 issues created, initial commit | v0.6.83 |
| 87 | PLAYER | Replaced Minecraft-style box character with Chiefmonkey GLB — pivot/scale fix, walk animation synced to movement | v0.6.84 |
| 99 | AI | Bot personality system — RUSHER/CAMPER/FLANKER/SNIPER archetypes | v0.6.56 |
| 100 | BUG | FREEZE FIX — `psight` scope bug causing TypeError on every non-AI frame | v0.6.56 |
| 101 | NPC | Chiefmonkey walk fix — StylishWalk/in-place wired correctly | v0.6.57/58 |
| 60 | FEDERATION | Instance Registry — server.js publishes kind:30078, 60s heartbeat | v0.6.22 |
| 61 | FEDERATION | Instance Discovery — client subscribes kind:30078, builds kind:30078, builds state.knownInstances | v0.6.22 |
| 62 | FEDERATION | Federated Portal Gate — purple/blue torii at south wall | v0.6.24 |
| 63 | FEDERATION | Cross-Arena Teleport — VISIT button, remote WS connection | v0.6.24 |
| 4 | STABILITY | GLB error handling — onError callbacks on all loaders | v0.5.51 |
| 5b | STABILITY | Multiplayer WS reconnect — exponential backoff (1s → 30s cap) | v0.5.62 |
| 10 | SECURITY | Nostr pubkeys / safeSrc() sanitised before DOM injection | v0.5.62 |
| 11 | SECURITY | WebSocket auth — HMAC-SHA256 challenge/response | v0.5.62 |
| 12 | SECURITY | Content-Security-Policy header on all server.js responses | v0.5.61 |
| 13 | EFFICIENCY | Bullet object pool — 25 pre-allocated meshes | v0.5.60 |
| 14 | EFFICIENCY | Bot AI throttled to every 4 frames — 75% CPU reduction | v0.5.60 |

---

## Key Files

| File | Purpose |
|------|---------|
| `src/main.js` | Primary game file (~4745 lines) |
| `src/scene-setup.js` | Renderer, camera, scene, bloom pipeline — extracted v0.6.139 |
| `src/lighting.js` | Lights, day/night cycle, rain, lightning — extracted v0.6.140 |
| `src/arena-objects.js` | Floor, neon grid, instanced grass, wildflowers — extracted v0.6.141 |
| `src/nap-zone.js` | NAP zone, compass labels, mirror, marketplace, panels, hotspot, detection — extracted v0.6.142 |
| `src/asset-loader.js` | sharedDraco, loadGLBWithRetry, initLoadingScreen, initGLBLoaders (all 5 GLB builders) — extracted v0.6.143 |
| `src/input.js` | keys, initInput, tryDash, tickDash, setZoom, isZoomed, getIFrames, getDashVelX/Z — extracted v0.6.144 |
| `src/config.js` | All constants — GATEWAY_GAP, arena dims, WS URLs, godMode |
| `src/state.js` | Shared mutable state + FSM |
| `src/game-loop.js` | rAF loop, render, tickNostrich, napZoneTickFns |
| `src/multiplayer.js` | WebSocket client, remote player management |
| `src/player-character.js` | Character picker, custom GLB upload, IndexedDB storage |
| `src/federation.cjs` | Nostr signing, kind:30078 registry |
| `src/debug-capture.js` | Stuck-key glitch capture, typed-array ring buffer |
| `server.js` | Node.js WS + HTTP server, port 8001, GLB_FILES |
| `vite.config.js` | Vite build config + dev proxy rules |
| `dist/` | Vite build output — deployed to S3 |
| `public/` | Static assets (GLBs, wall-texture.jpg, player-chiefmonkey.glb) |
| `public/sw.js` | Service worker — cache-first for GLBs, versioned cache key |
| `stalls.json` | Host-configurable shop stalls |
| `scripts/compress-glb.mjs` | Draco + WebP texture compression script |

---

## CI Pipeline

```
Lint & Format → TypeScript check → Vite Build → Server smoke test → Deploy (main only)
```

## Deploy Commands

```bash
# Version bump — replace XX with old, YY with new
sed -i 's/v0.6.XX-alpha/v0.6.YY-alpha/g' src/main.js index.html public/sw.js src/config.js src/bots.js src/game-loop.js src/federation.cjs src/player-character.js src/debug-capture.js
sed -i 's/na-v0.6.XX-alpha/na-v0.6.YY-alpha/g' public/sw.js
npm run build          # Vite production build → dist/
npm run dev            # Hot-reload dev server at localhost:5173
npm run lint           # ESLint src/
npm run format         # Prettier src/ + server.js
npm run typecheck      # tsc --noEmit
```

## Critical Rules

- **Version bump on EVERY deploy** — sed across `src/main.js`, `index.html`, `public/sw.js`, all `src/*.js`, `src/federation.cjs`
- **godMode = false** in `src/config.js` — NEVER deploy true
- **nostrich** not ostrich — all code comments and variables
- **Chiefmonkey** — capital C, lowercase m, one word, always
- **should_validate: false** always on deploy (debug overlay triggers validator)
- **#56 kind:1 broadcast** — PERMANENTLY PAUSED, removed from queue forever
- **Panel-locked click NEVER fires weapon**
- **SW precache rule** — every new GLB added to `public/` MUST also be added to `PRECACHE_ASSETS` in `public/sw.js`
- **NEVER recommend Google/big tech** — FOSS and open source only
