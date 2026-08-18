# Torii Quest — Contributor / Agent Handoff

Single-page onboarding for the next contributor — human or AI agent. Keep it current as the codebase moves. Pre-1.0 alpha; no API/behaviour compatibility promise across versions.

**Current version:** v0.2.586-alpha - PER-BONE STICKER COLLIDERS ON BOTS. Prior: v0.2.574-alpha - PER-BONE NPC STICKER COLLIDERS. See §0 for the current snapshot.

**Recent shipped work (newest first):**
- **v0.2.528-alpha - NAP ZONE LAYOUT FIX.** Fixed the NAP zone object layout to be left-to-right as the maintainer specified: leaderboard → torii gate → product panel → mirror, all flush with the curved NAP edge. The NAP zone edge is a CURVE (not a straight line) — each object's z-position must match the edge at its x-position. Previous attempts (v0.2.525–v0.2.527) failed because objects were placed at wrong z-values (not flush), the mirror was too wide (8.12m) and overlapped the torii gate, and the ordering was wrong. Final positions: Leaderboard (-6.5, 32.5) yaw=PI, Torii gate (0, 32) unchanged yaw=PI-PI/4-PI/18, Product panel (5, 31) yaw=PI+0.15, Mirror (9, 28.5) width shrunk to 5m yaw=PI+PI/4 (45° to follow edge curve). Mirror was shrunk from 8.12m to 5m to keep both edges on solid NAP land. Both mirror edges verified on land (h=0.92). NPC (napNpc.js) confirmed working in v0.2.526 console output: walks, loads 18 gesture clips. 2668 tests pass, 21 checks green.
- **v0.2.527-alpha - NAP LAYOUT ATTEMPT (FAILED).** Incorrectly placed mirror at (12.26, 25) — too far around the curve, appeared to cross the NAP/arena boundary. Product panel at wrong z. Leaderboard at wrong z. Angles not updated for new positions. User reported "even worse." Superseded by v0.2.528.
- **v0.2.526-alpha - MIRROR REPOSITION ATTEMPT.** Moved mirror to (0.26, 31) — but this was on top of the torii gate at (0, 32). User reported "nothing has changed" (the mirror was invisible behind/inside the gate). NPC fix confirmed working in this version's console output.
- **v0.2.525-alpha - NAP OBJECT ROTATIONS.** Applied: torii gate +10° CW (YAW_DELTA = -PI/4 - PI/18 = 55° total), leaderboard +5° CCW, product +10° CW. Mirror moved to x=-1. These were correct angle changes but at wrong positions.
- **v0.2.520-alpha - NAP OBJECT REPOSITION + NPC REWRITE.** Moved all NAP objects to z=31 edge. Rewrote napNpc.js with _minY fix, separate GLTFLoader for gesture GLB, fade transitions. NPC starts at (-4, 22), wanders NAP zone using isNapLand() + NAP_BBOX. 2668 tests pass.
- **v0.2.586-alpha - PER-BONE STICKER COLLIDERS ON BOTS.** Extended the per-bone sticker system to bots. Added createBotBoneColliders() in bodies.js that creates ball sensor colliders on all bot skeleton bones, reusing the colliderToBone map with { kind:'bot', bot, bone } entries. BotModel now exposes skinnedMesh ref. bots.js creates bone colliders in _ensureBotColliders (after body+head), syncs them each frame after model.tick()+syncTo() in both _syncBot (SP) and _syncNetBot (MP), parks them at y=-100 on death (_applyKillRender + _syncNetBot dead path), and re-creates on revive. Capsule-to-model upgrade in _attachModelBot also creates bone colliders. castRay() now excludes bone colliders by default when no filterPredicate is passed — prevents combat raycasts from hitting per-bone sensors and breaking damage resolution. stickerNpc.js handles bot bone hits (bone.attach) and bot broad capsule hits (parent to bot.model.root). Bot meshes excluded from Three.js raycaster via userData.isBotMesh flag. 2668 tests pass, 21 checks green.
- **v0.2.466-alpha - SUNRISE SUN FIX.** Retired the entire `_buildBitcoinSun` IIFE (additive canvas-corona sprite scale 38 + NormalBlending PNG ₿ overlay scale 55) - it stacked on the shader disc at (0.85, 0.18, -0.45) and bloomed into the right-side white glare. Sky shader now carries the ONLY sun: disc pow 90->40 rebuilt as `mix(base, vec3(1.0,0.50,0.18), disc*0.8)` (deep orange, no white clamp), corona pow 14->8 * 0.4, wide glow 0.35->0.12, and the dome-wide pow(sunAngle,2.0)*0.18 horizon flush DELETED (left-side glare). Added subtle Japanese rising-sun rays (14 beams, cross-product basis around sunDir, smoothstep-masked near the sun/horizon, *0.12). Zenith gold band 0.45->0.20, shimmer 0.08->0.04. Ambient hue 0xffd9a0->0xffd090, fog hue 0xe6c4a4->0xe6bc94 (density/intensity unchanged). Combat / score publishing untouched.
- **v0.2.465-alpha - SUNRISE ATMOSPHERE POLISH.** Rebalance after the v0.2.464 tone-down went too far on the ring and the sun still read as glare. Ring: coastline neon emissiveIntensity 0.95->1.4 (visibly glowing again, no sky bloom) and ground-wash opacity 0.22->0.28 to keep the ring/ground balance. Sun: sprite + sky-shader sunDir lowered to y=0.18 with depthTest ON so the mountain ridge occludes the lower half of the disc; sprite scale 48->38 (btc 72->55); corona/disc pulled toward amber; shader amber-disc multiplier 2.2->1.4; horizon mix deepened to peach-amber; ambient 0.72->0.85; fog density 0.007->0.008. Combat / score publishing untouched.
- **v0.2.464-alpha - SUNRISE-OF-HOPE ATMOSPHERICS.** Tone down sun glare and redirect arena-ring glow onto the ground. Sky: exposure 1.8->1.2, directional sun 1.8->1.15 amber, fog 0xc8dde8->peach 0xe6c4a4, sky disc 6.0->2.2 warm gold, Bitcoin sprite moved onto the same low-east sunDir and scaled 90->48. Ring: neon emissive 2.2->0.95 plus `coastline-ground-glow` additive ribbon inset 0.7m. Combat / score publishing untouched.
- **v0.2.463-alpha - HANDOFF DOC REFRESH.** Doc-only rewrite of §0/§1/§9 for a clean agent hand-over.
- **v0.2.462-alpha - PEER JOIN APPEARANCE SPEEDUP (warm avatar pool).** Slow peer appearance was NOT the GLB fetch (SW cache-first) - it was the per-avatar BUILD running synchronously on the join path after the download: skeletonClone, a full traverse re-materialising every mesh, computeBoundingBox, mixer.clipAction() for all 18 clips, and the gun bone-attach. Fix: `_prewarmPeerTemplates()` now fully BUILDS one avatar per character into a new `_mpWarmPool` at MP connect; `_createPeerAvatar` hands the pooled instance to the roster (stamping the real peerId) so a peer pops in THIS frame. Cold-build fallback when the pool is empty. `_createPeerAvatar` split into `_buildPeerAvatarObject(character, peer?)` + a thin pool-aware wrapper.
- **v0.2.461-alpha - MIRROR SELF-SHOOT FIX.** Firing while standing still showed plain IDLE in your own mirror (local `tickPlayerModel` gated RUN_SHOOT behind forward/run movement). A PEER standing still already reads as firing via its Run_Forward_Firing shoot one-shot (in-place since the root-motion strip). Fix: `playerModel.js` plays the SAME RUN_SHOOT clip for `isShooting && !moving`, so your mirror-self fires in place exactly like a peer.
- **v0.2.460-alpha - MP IDLE-DROP FIX (Option A: idle players stay connected) + JOIN-DELAY PREWARM.** Peers vanished after a few idle minutes because the server idle-swept any session silent for 60s (`IDLE_DISCONNECT_MS`) and broadcast LEFT, while the client keepalive PINGed only every 25s - a single tab-throttled setTimeout could slip past the reap. Fixed both ends: client `KEEPALIVE_MS` 25s -> 15s (4x margin) and server `IDLE_DISCONNECT_MS` 60s -> 90s (6 missed pings), so an idle player is never dropped. Reconnect `BACKOFF_MS_CAP` 30s -> 2s so a real blip rejoins in ~2s. Plus the first template-only `_prewarmPeerTemplates()` on MP connect. Tests reference the constants by name, so they track the values.
- **v0.2.459-alpha - RUN+SHOOT ANIM FIX + NOSTRICH MASTER RE-BAKE.** RUN_SHOOT never played (single-frame `_isShooting` flag); fixed with a sticky 400ms `_shootUntil` window driving both `tickPlayerModel` and the MP anim hint. nostrich-master.glb re-baked with three `tools/glb_retarget.py` fixes (frame-change matrix was the inverse of intended; added per-bone shortest-arc bind-axis alignment; exact animated-parent local conversion; quaternion hemisphere continuity). Bone-axis deviation vs library now 0-4deg every clip (was 50-180deg), zero flips, root motion 0.000m, Draco 3.66MB. New `tools/glb_pose_compare.py`.

**Deployed live:** the maintainer deploys manually over SSH with `sudo torii-deploy <tag>` (the update-runner resolves the git tag, builds with `--base=/quest/`, and installs to chiefmonkey.art). **Latest tag pushed: v0.2.528-alpha** (not yet deployed — user runs `sudo torii-deploy v0.2.528-alpha`) - confirm the live version with `curl -s https://chiefmonkey.art/quest/ | grep -o 'v0\.2\.[0-9]*-alpha'`. MVP APPROVED 2026-07-27. Suite `install-quest.sh` tolerates generated-but-tracked files (`public/dashboard.html` + `public/torii-quest-data.json` are rewritten by `npm run build` on every deploy).

---

## 0. Current snapshot (2026-08-17)

- **Version:** v0.2.586-alpha (tag `v0.2.586-alpha`).
- **Live:** https://chiefmonkey.art/quest/ (SHC VPS, Torii Suite install). The maintainer deploys manually with `sudo torii-deploy <tag>`; the update-runner resolves the git tag and builds with `--base=/quest/`.
- **Multiplayer:** LIVE and working (`MP_ENABLED=true` in `src/config.js`). Two-npub in-world play confirmed 2026-08-15: idle players stay connected (v0.2.460), peers appear promptly on join (v0.2.462 warm pool), and mirror self-shoot reads correctly (v0.2.461).
- **Tests:** 2668/2668 across 197 files; `node tools/regression-check.mjs` ALL GREEN at ship time.
- **Nostr score publishing:** DISABLED (`SCORE_PUBLISH_ENABLED=false` in `src/config.js`). Do NOT re-enable until the maintainer explicitly says so - it is for the very end of alpha.
- **Combat values (DO NOT CHANGE):** BOT_HP=5, BODY_DAMAGE=3, HEADSHOT_DAMAGE=9, BOSS_HP=60, BOSS_TARGET_HEIGHT=3.0, BOSS_RADIUS=0.8, BOT_BODY_RADIUS=0.30, BOT_HEAD_RADIUS=0.30, LAG_COMP_MS=300.
- **MP timing model (verified 2026-08-15):** client PING `KEEPALIVE_MS=15_000`, server idle reap `IDLE_DISCONNECT_MS=90_000` (sweep interval still 60s), reconnect backoff `BACKOFF_MS_INITIAL=500` doubling to cap `BACKOFF_MS_CAP=2_000`. On reconnect the WELCOME carries the full roster; `finishAuth` re-broadcasts JOIN to others.

### Known remaining issues (not blockers)
- **Animation clip-choice polish** - minor glitchiness in clip selection/transitions; maintainer deferred this (it is about picking better clips, not a correctness bug).
- **Bot hit inconsistency** - occasional reported inconsistency in bot hit registration.
- **Flaky test** - `tests/` 'a regular bot takes damage and DIES' occasionally fails on first run and passes on re-run (test-isolation flake, not a product bug).

### For the next agent
- The active MVP focus is the 15-hour proof-of-concept route (`torii-quest-strategy.md`); the shooter is maintenance-only unless demo-breaking.
- Read `torii-quest-strategy.md` + `torii-quest-todo.md` + `torii-quest-progress.md` first; use the §10 next-job format.
- Always read code before editing. Root causes in this codebase are found by reading (e.g. parsing GLB binary, tracing the MP wire), not guessing.

### NAP zone object layout (CRITICAL — read before touching NAP objects)

The NAP zone edge is a CURVE (mitsudomoe shape), not a straight line. Each object's z-position MUST match the edge at its x-position. Use `isNapLand(x, z)` + `sampleNapHeight(x, z)` from `src/terrain/tomoeShape.js` / `src/terrain/heightmap.js` to verify positions are on solid land (h > 0.7).

**Current layout (v0.2.528-alpha), left to right, flush with curved edge:**

| Object | Position (x, z) | Yaw | File |
|---|---|---|---|
| Leaderboard | (-6.5, 32.5) | `Math.PI` (face south) | `src/engine/world/proofSurfaceSpecs.js` |
| Torii gate (travel gateway) | (0, 32) | `Math.PI - PI/2` (90° CW, gate plane north-south) | `src/config.js` (TRAVEL_GATE_*) + `src/arena.js` |
| Product panel | (5, 31) | `Math.PI + 0.15` | `src/engine/world/proofSurfaceSpecs.js` |
| Mirror (with frame) | (9, 28.5) | `Math.PI + PI/4` (45°, follows curve) | `src/mirror.js` (MX, MZ, MW, mirror.rotation.y) |

**Key values:**
- `TRAVEL_GATE_X = 0`, `TRAVEL_GATE_Z = 32`, `TRAVEL_GATE_YAW_DELTA = -Math.PI/2` (90° CW, gate plane north-south) (in `src/config.js`)
- Mirror: `MW = 5.0` (shrunk from 8.12m in v0.2.528), `MX = 9`, `MZ = 28.5`, `mirror.rotation.y = Math.PI + Math.PI / 4`
- Anchor positions in `src/engine/world/anchorTransforms.js` must match proofSurfaceSpecs positions
- `ARENA_HALF = 20` (in `src/config.js`)

**Two gates (CRITICAL DISTINCTION):**
1. **Travel gateway** (`torii-gateway-experience.glb`): At (0, 32) in NAP zone with portal ring. This is what the user means by "torii gate" or "Torii Gateway". GLB uses `gate.rotation.y = Math.PI + TRAVEL_GATE_YAW_DELTA`. Procedural fallback uses `fallback.rotation.y = Math.PI / 2 + TRAVEL_GATE_YAW_DELTA` — DIFFERENT base rotation (90° mismatch).
2. **Entrance/gamma markets gate** (`torii-gate.glb`): At bridge position (-24, 3), hardcoded `gate.rotation.y = Math.PI` — NEVER touched by TRAVEL_GATE_YAW_DELTA.

**NAP edge reference (z at each x where height > 0.7):**
x=-12→z=30.5, x=-10→z=31.5, x=-8→z=32.5, x=-6→z=32.5, x=-4→z=32.5, x=-2→z=32.5, x=0→z=32, x=2→z=32, x=4→z=31.5, x=6→z=31, x=8→z=30, x=10→z=28.5, x=12→z=25.5

**NPC (napNpc.js):** Starts at (-4, 22), wanders NAP zone using `isNapLand()` + `NAP_BBOX`. Plays random gesture clips from `chiefmonkey-npc-animations.glb` every 5-10s. Confirmed working in v0.2.526 console output. NPC animations GLB is for NPC ONLY — do NOT add to playable characters.

**User's layout instructions (verbatim):**
- "from left to right the correct layout is, leaderboard, torii gate, product panel, mirror"
- "flushed with the edge of the nap zone"
- Mirror and frame treated as one grouped object
- Torii gate and glow ring treated as one grouped object
- "to the right" = right-hand side when facing north toward the NAP zone edge
- The NAP zone edge curves — "flush with the edge" means each object sits at the correct z for its x

---

## 1. What this is

A browser arena shooter — Three.js (WebGL) render, Rapier3D (WASM) physics, Nostr identity, Bitcoin/ecash (fake sats in alpha). Vite build. Pure ES modules. GPL-3.0.

- **Live:** https://chiefmonkey.art/quest/ (SHC VPS, Torii Suite install — the ONLY live host). Multiplayer runs on the VPS at `wss://chiefmonkey.art/mp` (root-level same-origin, nginx → `torii-arena-ws.service` on `127.0.0.1:8788`). The old pplx.app publish (`quest-torii.pplx.app`) is a stale fallback whose backend sandbox is down — do NOT treat it as live.
- **Active focus:** 15-hour proof-of-concept route (`torii-quest-strategy.md` → "15-Hour Proof-of-Concept Route"; `torii-quest-todo.md` → "ACTIVE FOCUS"). Shooter is maintenance-only; the active MVP is the freedom-tech loop — gateway/NAP-to-NAP preview, Plebeian/Nostr product panel proof, leaderboard preview, torii.quest update-check (LEAN-1..LEAN-5).
- **Multiplayer architecture (current):** server-authoritative hit resolution on a single wire (`PROTOCOL_VERSION=1`). Pure server modules under `server/combat/` (snapshotRing, capsuleModel, rayVsCapsule, damageTable, hpLedger, hitResolver); arena-ws keeps a per-peer snapshot ring, rewinds to the shot timestamp (clamped to `LAG_COMP_MS=300`), damages via a parity-locked table (head=9, body=3), broadcasts `HIT`/`KILL` to ALL, and issues `RESPAWN` to the victim after `RESPAWN_MS=3000`. Client `sendHit` is a no-op; `wsClient` handles `RESPAWN` and `arenaRuntime` warps the player + resets HP. Auth is a per-session NIP-42 (kind:22242) challenge, OR a server-issued session token from a single NIP-98 (kind:27235) login sign (v0.2.375) so players sign once at login and never in-game. Peer avatars load via a DRACOLoader-equipped GLTFLoader and are pre-built into a warm pool at MP connect (v0.2.462).
- **Nostr score/leaderboard publishing (MP-3):** the code LANDED (v0.2.366) but is intentionally DISABLED — `SCORE_PUBLISH_ENABLED=false` in `src/config.js`. Do NOT re-enable until the maintainer explicitly says so (it is for the very end of alpha). Server broadcasts an authoritative `SCORE` frame on peer disconnect; each peer signs its OWN row via nip07 and publishes kind:30078 (`d=torii-quest`) + kind:1 (`t=torii-quest-score`). Modules: `server/combat/scoreLedger.js`, `src/engine/multiplayer/scoreReporter.js`, `src/engine/multiplayer/leaderboardAgg.js`, `src/ui/leaderboardPanel.js`.

## 2. Standing operating rules (project-wide, across all Torii repos)

1. Each Torii app lives in a fully separate GitHub repo (`torii-quest`, `torii-continuum`, `torii-de`, `torii-base`, `torii-suite`). Files carry ONLY that repo's project name — Quest files say "quest", never "continuum" or "de". Never cross-name.
2. Bump the version on EVERY change — including doc-only changes, comment tweaks, filename renames, typo fixes.
3. Push everything to GitHub immediately via a PR that lands on `main`. No local-only work.
4. Never publish device names, hostnames, or local machine identifiers to GitHub. Use generic terms like "your local machine".

## 3. Hard constraints (do NOT break these)

Enforced by `npm run check` (`tools/regression-check.mjs`).

1. **Version bump on every deploy.** Every marker in §4 matches `EXPECTED_VERSION`.
2. **`godMode` stays `false`** in `src/config.js`. Never commit `true`.
3. **No new `setTimeout`** except the two allowed sites (`nostr.js` WS-close, `hud.js` kill-feed).
4. **No new `Vector3`/`Matrix4` in hot paths.** Reuse module-scope scratch vars. Modules with no `three` import are exempt.
5. **Spelling:** comments say "nostrich" (never "ostrich"); character is "Chiefmonkey" (exact case).
6. **Debug tools ship unconditionally** — `window.ToriiDebug` is intentional in public alpha.
7. **ESC = instant pause**; a click that only re-locks a panel-locked cursor must never fire the weapon.
8. **Firing:** bullets originate at the gun barrel and aim through the crosshair (camera ray finds aim point; barrel→point is the bullet line).
9. **`state.phase` is written ONLY in `state.js`** (via `transition()`). Others read predicates (`isPlaying()` etc.).
10. **No internal use** of deprecated globals `window._onBotHit`, `window._grassMat`, `window._flowerMat`, `window._mirrorMesh` — kept as documented debug taps only.
11. **Split modules by concern, not line count.**
12. **Do not name** Google, Cloudflare, Microsoft, or Babylon.js in docs.

## 4. Version markers (bump together)

| File | Location |
|---|---|
| `src/config.js` | `export const VERSION` |
| `index.html` | `#version-label`, `#ver` |
| `package.json` | `"version"` — semver form, no leading `v` |
| `tools/regression-check.mjs` | header comment, `EXPECTED_VERSION`, stale-version guard regex (flag the PREVIOUS version) |
| `src/engine/dashboard/toriiQuestData.js` | `TORII_QUEST_VERSION` (pinned to `config.js`) + `metrics` "Source version" + "Tests" test-count row |
| `public/sw.js` | `CACHE_VERSION` literal (`tq-<version>`) — copied verbatim by Vite; check [5] fails if stale |
| `MVP_APPROVAL_STATE.json` | `version` — generated by `npm run approval:state -- --write`; test asserts it tracks `config.js` |
| `torii-quest-{strategy,todo,progress,handoff}.md` | "Current version" lines |

**NOT version markers — do NOT bump:**
- `MVP_PLAYTEST_RESULTS.md` — the human tester fills the build cells with what they actually tested; committed baseline is `not-run`.
- `LIVE_SMOKE_STATE.json` — records the DEPLOYED build a live smoke observed; legitimately lags `config.js`.
- `DASHBOARD_SMOKE_STATE.json` — same rule for the dashboard smoke.

## 5. Source of truth

**Code:**
- `src/config.js` — all constants and tuning. No scattered magic numbers.
- `src/state.js` — the ONLY place game phase changes; FSM table + weapon predicates.
- `src/main.js` — wiring only; no game logic.
- `src/sdk/index.js` — public SDK entrypoint. Curated node-safe re-exports, `SDK_VERSION`, `STABILITY` tiers, frozen `SDK_SURFACE` tier map. Only re-export modules that never transitively import `scene.js`.
- `engine/` — extracted mostly-pure SDK seams (debug, physics, combat, entities, ui, weapons). Prefer adding pure logic here so it stays node-testable.
- `CODE_INDEX.md` — file-by-file map. Update when adding/moving a module.

**Docs (project-scoped, this repo only):**
- `torii-quest-strategy.md` — vision + decision rules.
- `torii-quest-todo.md` — active task queue.
- `torii-quest-progress.md` — execution dashboard.
- `torii-quest-handoff.md` — this file.
- `VPS_INSTALL.md` — self-hosting the static build at torii.quest.
- `UPDATE_CHECK.md` — manual update-check safety boundary.
- `NOSTR_ARENA_MASTER_TODO.md` — archival history only; not an active queue.

**Safe edits to the four continuity docs** go through `npm run md:patch` (`tools/mdPatch.mjs`): whitelist-confined, per-file capability map (handoff is append-only; `replace` is rejected), `.bak` backup before every edit, no network, no arbitrary writes. The `note` action appends a timestamped bullet under the file's default heading — e.g. `npm run md:patch -- note torii-quest-progress.md "shipped X"`.

## 6. Build / test / check commands

```bash
npm install
npm run dev                 # local dev server (vite)
npm run build               # production build → dist/
npm run check               # static regression guardrails (tools/regression-check.mjs)
npm test                    # vitest — FULL unit suite (node env)

# Test profiles (v0.2.173) — deterministic curated file lists in tools/testProfiles.mjs
npm run test:fast           # ~5 core files, innermost edit→test loop
npm run test:foundation     # ~16 files, broader confidence (fast ⊆ foundation)
npm run test:release        # build + FULL vitest + check + bundle:report + handoff:status
                            # THE release gate — profiles never replace it

# Visibility / readiness tools (read-only, network-free, exit 0; NOT gates)
npm run handoff:status      # one-glance snapshot: version/pkg sync, git commit, live URL, checks, docs, reports, bundle
npm run release:status      # single READY/NOT-READY/INCOMPLETE verdict aggregating ship signals
npm run release:status:json # same verdict as JSON (or: node tools/release-readiness.mjs --json)
npm run handoff:summary     # concise brief for the next agent/model
npm run docs:stale          # advisory stale-doc detector (drift catcher; NOT in `check`)
npm run bundle:report       # advisory built-bundle size baseline
npm run zones:check         # verifies /zone/* SPA-fallback docs + dist layout (also regression-check [15])
npm run vps:dry-run         # local pre-deploy readiness checklist; exits non-zero on blocking FAIL only
npm run release:meta        # release/update metadata for the future torii.quest update-checker
npm run release:dry-run     # local GitHub MVP release dry-run; runs NO git tag/push/gh release
```

**Green** = build + check + test all pass. Docs/status drift is guarded by check `[14]`; the continuity docs must carry the current version or `npm run check` fails.

Tests run in node (`vite.config.js` → `environment: 'node'`). `WebGLRenderer` is created at module load in `scene.js`, so any module that transitively imports `scene.js` (`player.js`, `weapons.js`) CANNOT be imported in a node test. Write new logic as a pure module (no `three`/Rapier/DOM import) to keep it testable — see `engine/debug/snapshot.js`, `engine/physics/interactions.js`, `engine/physics/raycastService.js` for the pattern.

Optional headless smoke (not in CI): `npm i -D puppeteer-core`, drive Chrome with swiftshader flags against `npm run preview`, click `#btn-enter`, inspect `window.ToriiDebug.snapshot()`.

## 7. Deploy / publish (task agents may publish when explicitly instructed)

Deploy target is the pplx.app subdomain `quest-torii.pplx.app`. Build artifact is `dist/` (`npm run build`). **Maintainer shortcut: "bump and push" = bump version, update the live site quest-torii.pplx.app, and push everything to GitHub.**

**Task agents SHOULD ship end-to-end when the maintainer says "go", "publish it", "bump and push", or similar.** The pipeline is: green gate (build + check + vitest + release:status) → commit → PR → squash-merge to main → `npm run build` → deploy_website → publish_website (with site_id `93507979-679f-4aac-949d-20a4a33d7352`) → smoke test the live URL. Old handoff rule that maintainer publishes is superseded as of v0.2.365.

**publish_website shape (locked):** `project_path=/home/user/workspace/torii-quest/dist`, `dist_path=/home/user/workspace/torii-quest/dist`, `app_name='Torii Quest'`, `port=5000`, `run_command='node server/arena-ws.cjs'`, `install_command='npm install --omit=dev --no-audit --no-fund'`. Requires `dist/package.json` to exist with `ws` runtime dep — created if missing.

**Self-hosted VPS at torii.quest** is the eventual target but Sovereign Hybrid Compute VPS is currently paused — do NOT reference Namecheap or any other provider.

**Pre-publish security review is REQUIRED** — run subagent with `/home/user/workspace/skills/website-building/website-publishing/security_subagent_prompt.md` against `dist/`. Address BLOCK findings automatically; surface WARN findings to maintainer.

**Self-hosting the static build at `torii.quest`** (shared Ubuntu VPS — Caddy/Nginx + HTTPS, DNS checklist, manual GitHub update sequence, symlink rollback, security posture): see `VPS_INSTALL.md`. No server is touched from this repo.

**SPA `/zone/<slug>` deep-link rewrite (REQUIRED for hard-refresh).** The `zoneRoute` parser gives `/zone/<slug>` a safe client-side interpretation, but it only runs after `index.html` + JS have loaded. A static host will 404 on a cold hard-refresh to `/zone/<slug>` unless configured to fall back to `index.html`:
- **Nginx:** `location / { try_files $uri $uri/ /index.html; }`
- **Caddy:** `try_files {path} /index.html`
- **Static CDN / object storage:** set SPA/404 fallback document to `index.html`

Keep CSP unchanged. Same-origin in-app navigation (`history.pushState`) is unaffected. `npm run zones:check` verifies the docs describe the fallback and that `dist/` has no file shadowing `/zone/*`. Full checklist: `ZONE_FALLBACK_READINESS.md`; concrete server blocks in `VPS_INSTALL.md` §6a/§6b/§11.

## 8. Debug surface

`window.ToriiDebug` (ships in alpha):
- `.snapshot()` — one JSON-serialisable object: version, phase, run state, player pos, combat last shot/hit/miss, physics+crate summary, tuning. Safe anytime.
- `.combat.report()` / `.physics.report()` — focused JSON sub-reports.
- `.shells.*()` — read-only reports over the SDK view shells + preview blocks (gateway, product, leaderboard, updatePreview, mvpLoop, hostTransport, gatewayActivation, gatewayPortalActivation, summary, diff, surfaceSpecs, surfaceGate, …). No signer, relay, publish, navigation, checkout, or fetch. See `SDK_DEBUG_INDEX.md`.
- `.physics.service` — injectable RaycastService facade (`ray`/`rayStatic`/`lineOfSight`).
- `.bots`, `.player`, `.physics`, `.world`, `.fx`, `.combat`, `.identity`.

## 9. Active issues / open edges

> **READ FIRST (2026-08-15):** the entries below are HISTORICAL, from the July pplx.app→VPS migration era (v0.2.366–v0.2.375). The bugs they describe (backend sandbox 503, peer avatars invisible/T-posed, idle-drop reconnect loops, ENTER-ARENA freeze, "LIVE vX until Suite redeploy") are all RESOLVED and superseded. Multiplayer is live and working on the VPS — see §0 for the current snapshot and the current known-issues list. Keep these entries only as a record of how the wire protocol, auth, and peer-avatar pipeline were built; do not act on their "pending redeploy" framing.

- **QA-MP-BLOCKER-1 — peer discovery verified at the protocol level on chiefmonkey.art/quest/ (2026-07-13; full in-world ENTER path NOT exercised in headless).** A simulated two-npub live test against the production install confirmed the wire-level handshake and cross-client peer visibility: two isolated browser contexts, each performing a real NIP-07 nostr-login with a distinct burner npub, both opened `wss://chiefmonkey.art/mp` → received `HELLO` (`serverVersion: v0.2.366-alpha`, `protocolVersion: 1`) → sent `AUTH` (NIP-01 kind-22242, BIP-340 schnorr, challenge-bound via `window.nostr.signEvent`) → server accepted (WELCOME returned). **B's `WELCOME.roster` contained A**, and **A received a `JOIN` frame for B** (`{id, npub, pos, rot, character}`). So the auth gate, roster fan-out, and JOIN broadcast are confirmed working on the live install.
- **v0.2.375-alpha — session-token arena auth ("1 sign at login, 0 signs in-game"); LIVE v0.2.370-alpha until a Suite redeploy picks up v0.2.375 (bump `TORII_QUEST_REF`).** The arena authed with a per-session NIP-42 (kind:22242) challenge. Because that challenge is anti-replay it CANNOT be cached, so every arena entry and every reconnect re-prompted the NIP-07 signer; combined with the score-publish sign and the login presence-publish sign, players hit ~5 signer prompts. Fix: the player signs ONE NIP-98 (kind:27235) HTTP-auth event at login and receives a server-issued opaque bearer token the arena WS reuses. **SERVER** — new PURE `server/auth/sessionTokens.js` (node-testable; injectable clock/RNG/stores): one-time-use challenges (TTL 60s, delete-on-consume), tokens (TTL 8h) stored as `sha256(token)` ONLY — the raw token is returned once and never stored or logged. Two plain-HTTP endpoints added to `server/arena-ws.js`: `GET …/mp/auth-challenge` → `{challenge,ttl}` and `POST …/mp/session` → `{token,npub}` after `verifyLoginEvent` (kind 27235, matching `challenge` tag, `u`+`method:POST` tags, hex64 pubkey, real schnorr via the shared `verifyNostrEventSig`). A new `finishAuth(sess,{npub,pubkey})` unifies the WELCOME + JOIN broadcast for BOTH the new `AUTH_TOKEN` branch (`verifyToken` → hex pubkey) and the unchanged NIP-42 `AUTH` branch. `sessionTokens.cleanup()` runs on the existing idle-sweep interval. **CLIENT** — new `src/engine/multiplayer/sessionAuth.js`: `resolveMpHttpBase()` derives the HTTP base from the SAME `MP_WS_PATH` mount the WS URL uses (mirrors `multiplayerHost.resolveUrl`'s PORT_SENTINEL logic — NEVER a hard-coded `/mp`); sessionStorage token store (`tq.mp.sessionToken`); `loginForSessionToken()` fetches a challenge, signs ONE kind:27235 event scoped to `POST /session`, exchanges it for a token, stores it, returns `{token,npub}` or null. `src/nostr.js` `nostrLogin()` tries the token flow (only when `window.nostr.signEvent` exists), then falls back to `getPublicKey()`. `wsClient.js` sends `{t:AUTH_TOKEN, token}` on HELLO when `getSessionToken()` returns one and NEVER calls `signAuth` in that case; on `AUTH_FAIL` for a token it calls `clearSessionToken()`, closes, and the reconnect (now tokenless) drives the NIP-42 `signAuth` path — one fallback prompt, then normal play. `multiplayerHost.js`/`arenaRuntime.js` thread `getSessionToken`/`clearSessionToken` (backed by the sessionStorage helpers). **PRESENCE** — the auto presence-publish on `EV.NOSTR_LOGIN` in `src/main.js` was removed (presence is WS-roster only now). In-game score signs were already zero: `createScoreReporter` is never invoked; the manual "PUBLISH MY SCORE" leaderboard button is user-initiated and left intact. `AUTH_TOKEN` is additive on `PROTOCOL_VERSION=1` (old clients drop it via the UNKNOWN_TYPE guard). Verified: `npm run build`, `npm run check`, `npm test` all green; new `tests/multiplayer/session-tokens.test.js` (challenge/token lifecycle + real-schnorr verify + raw-token-not-stored), `session-auth.test.js` (HTTP-base derivation, storage, one-sign login), AUTH_TOKEN cases in `wire-protocol.test.js`, and token-auth + AUTH_FAIL-fallback cases in `ws-client-state.test.js`. **NGINX (torii-suite v0.7.6-alpha):** `installers/install-quest.sh` `/mp` fragment split into exact-match plain-HTTP locations for `/mp/auth-challenge` + `/mp/session` (the login handshake) plus the existing Upgrade proxy for the arena socket — a `map`-based `$connection_upgrade` is illegal inside the server-scoped fragment, so the path split carries both transports. **Source-only — do NOT touch the VPS while the Continuum session is active.** Not closed until a real-browser retest shows exactly one signer prompt at login and zero on arena entry/reconnect/death.
- **v0.2.374-alpha — peer combat wired client-side (server-authoritative); LIVE v0.2.370-alpha until a Suite redeploy picks up v0.2.374.** The server already ran authoritative combat (`MP_MODE='authoritative'` in `server/arena-ws.js`: `SHOT` → `resolveAndBroadcast` → `HIT`/`KILL` via lag-compensated peer snapshots), but the client had two dead wires: the `EV.SHOOT` handler never called `_mp.sendShot`, and `_mpEmit` only handled `mp_respawn`, so inbound `HIT`/`KILL` were dropped. Players therefore could not damage each other. Fix: two seams in `src/arenaRuntime.js`, both delegating to a new PURE `src/engine/multiplayer/peerCombat.js` (no three/DOM — unit-testable, keeps the runtime a thin wiring layer). **OUTBOUND** — the `EV.SHOOT` handler sends `_mp.sendShot({origin,dir,ts})` for every arena shot when `_mp.selfId` is set and the player is inside the arena (`shouldSendShot({playerX,napX,selfId})`); it prefers the AIM ray (`aimOrigin`/`aimDir`, camera-through-crosshair) so server hit-detection matches what the shooter saw, falling back to the muzzle `origin`/`dir` (`buildShotPayload`), serialising each `Vector3` to a `[x,y,z]` array. The server no-ops when the shot resolves no peer. **INBOUND** — `_mpEmit` calls `createPeerCombat(...)` first; it returns `true` for `mp_shot`/`mp_hit`/`mp_kill` (and `false` so `mp_respawn` still falls through intact): `mp_shot` `{id,origin,dir,ts}` is VISUAL ONLY — a muzzle spark + short tracer at the peer origin via `fx.js` (`spawnSpark`/`spawnRicochet`, auto-ticked by `tickFx` inside `tickWeapons`), skips our own echoed shot, and runs NO local hit detection (server is authoritative); `mp_hit` `{id,targetId,dmg,zone}` applies `takeDamage(dmg)` only when `targetId === selfId` and `flashCross()` when we are the shooter (wire shooter field is `id`, per `wireProtocol` MSG.HIT map — NOT `shooterId`); `mp_kill` `{shooterId,victimId}` runs the transition-guarded `killPlayer()` when `victimId === selfId` (it increments `state.deaths` exactly once — a no-op if `takeDamage` already killed us this frame, so no double-count) and scores `state.kills++` + an `addKill('Fragged a rival')` killfeed line when `shooterId === selfId`. Local bot hits remain a SEPARATE client-side path (`EV.BOT_HIT_BY_PLAYER` → `hitBot`): a single shot may both hit a bot locally AND resolve a peer hit server-side — expected, not deduped; every arena shot sends `SHOT` (the server ignores bot-only shots). NO wire-protocol change. Verified: check green, build green, tests green; new `tests/multiplayer/peer-combat.test.js` covers the outbound gate/payload (aim-ray arrays, NAP + falsy-selfId suppression, muzzle fallback) and the inbound gating (`mp_shot` visual-only + self-echo skip, `mp_hit` damage only on `targetId===selfId`, `mp_kill` death only on `victimId===selfId` + `kills++` on shooter side). Bots stay client-side (a later MP milestone; NOT bundled here). **Source-only — pending a Suite redeploy that includes v0.2.374 (bundles v0.2.371 DRACOLoader + v0.2.372 keepalive + v0.2.373 avatar transform + this); do NOT touch the VPS while the Continuum session is active.** Not closed until a real-browser two-npub retest shows one player damaging + killing the other with correct HUD/killfeed/respawn.
- **v0.2.373-alpha — peer avatars rendered high in the sky, backwards, and T-posed fixed (peer avatarLoader returned the raw `gltf.scene`); LIVE v0.2.370-alpha until a Suite redeploy picks up v0.2.373.** After the v0.2.371 DRACOLoader fix peers became visible, but appeared ~4-5 body-heights UP, FACING 180° away, and in a static T-POSE (bind pose, no animation). Root cause: the peer `avatarLoader` in `src/arenaRuntime.js` resolved the RAW `gltf.scene` with none of the setup `playerModel.js`/`botModel.js` apply — (1) chiefmonkey6.glb geometry sits well above its origin (large `gMinY`), so with no feet offset the model floated at its authored height (and `sendMove` broadcasts eye-height Y ≈ 1.7, compounding it); (2) the GLB is authored facing +Z while game-forward is −Z, so with no `rotation.y = π` the avatar faced backwards; (3) no `THREE.AnimationMixer`, so the skeleton stayed in bind-pose (T-pose). Fix (mirror `botModel.js` + the `playerModel.js` transform): load chiefmonkey6.glb ONCE into a module-level template (scene + clips + geometry `gMinY`), then per peer `SkeletonUtils.clone` it into a wrapper `THREE.Group` (remoteAvatars sets the wrapper transform) with `model.position.y = -gMinY - 1.7`, `model.rotation.y = Math.PI`, opaque materials + `frustumCulled = false`, and an `AnimationMixer` playing `Idle_03` (looped; falls back to `animations[0]` with a warn) ticked once to leave bind-pose. The wrapper exposes `obj.update(dt)` → `mixer.update(dt)`; `remoteAvatars.tick(renderTime)` now derives a clamped wall-clock `dt` (skipping the first tick) and calls `entry.obj.update(dt)` each frame. NO movement-based clip switching (IDLE only; WALK-on-move noted as MP-1.5); NO `sendMove`/wire change. Verified: check green, build green, tests green; new `remote-avatars.test.js` cases assert `tick` drives `obj.update(dt)`, skips the first tick, clamps a large gap, and is safe without an `update()`. **Source-only — pending a Suite redeploy that includes v0.2.373 (bundles the v0.2.371 DRACOLoader + v0.2.372 keepalive + this transform/animation fix); do NOT touch the VPS while the Continuum session is active.** Not closed until a real-browser two-npub retest shows both avatars standing on the ground, facing correctly, and idling.
- **v0.2.372-alpha — repeating NIP-07 signer-prompt loop on the pause/idle screen fixed (client keepalive PING); LIVE v0.2.370-alpha until a Suite redeploy picks up v0.2.372.** On the pause/idle screen a paused client sends no MOVE frames, so the connection goes silent. The server idle-drops silent sessions after 60s (`IDLE_DISCONNECT_MS` in `server/arena-ws.js`) and never initiates its own PING, while `wsClient.js` only sent a PONG in reply to a server PING (which never came). So a paused session was dropped at ~60s → `onclose` → `_scheduleReconnect` → reconnect → fresh `HELLO`/NIP-42 challenge → `signAuth` → **another NIP-07 signer prompt**, looping every ~60s. Fix (client-side, minimal): `wsClient.js` now sends a keepalive `{ t: MSG.PING, ts: now() }` every 25s (`KEEPALIVE_MS`) while CONNECTED, started in the WELCOME handler and cleared in `disconnect()` and `onclose` (recursive `setTimeoutFn`, single-instance guard). NO server change and NO session-token/auth-caching scheme (NIP-42 challenges are per-session + anti-replay); a *genuine* network drop still reconnects + re-auths — future hardening would be a server-issued session token. Verified: `npm run check`, `npm run build`, `npm test` all green; new keepalive unit tests in `tests/multiplayer/ws-client-state.test.js`. **Source-only — pending a Suite redeploy that includes v0.2.372 (bundles the v0.2.371 DRACOLoader peer-visibility fix + this keepalive fix); do NOT touch the VPS while the Continuum session is active.**
- **v0.2.371-alpha — H4 peer-visibility fixed (peer-avatar GLTFLoader was missing a DRACOLoader); LIVE v0.2.370-alpha (CSP freeze fixed) until Suite redeploy picks up v0.2.371.** With the v0.2.370 fix deployed, anonymous ENTER ARENA now BOOTS on chiefmonkey.art/quest/, but **two players still cannot see each other** in the arena. Root cause: `src/arenaRuntime.js` built the peer-avatar `GLTFLoader` (`_mpGltf`) WITHOUT a `DRACOLoader`, unlike every other loader that touches `chiefmonkey6.glb` (`playerModel.js`, `botModel.js`, `arena.js`, `firstPersonBody.js`). `chiefmonkey6.glb` is Draco-compressed, so `_mpGltf.load(assetUrl('/chiefmonkey6.glb'))` REJECTED (Draco mesh cannot decode) for every peer → `remoteAvatars.upsert()` caught the reject and DELETED the roster entry (`remoteAvatars.js`) → peer avatars never rendered. Wire-level peer discovery already works (`peerJoin`→`roster.upsert` in `multiplayerHost.js`; verified in QA-MP-BLOCKER-1), so this was purely the loader. Fix (minimal, targeted): give `_mpGltf` a `DRACOLoader` mirroring `playerModel.js` (`new DRACOLoader()` + `setDecoderPath(assetUrl('/draco/'))` + `setDRACOLoader`), and add a `console.warn('[mp] avatar_load_error', …)` on load failure so future GLB errors are visible. NO capsule fallback added. Verified: build green, checks green, tests green. **Source-only fix — pending a Suite redeploy that includes v0.2.371 (the maintainer must bump the Suite Quest ref to v0.2.371-alpha or the merge commit, then redeploy with `--base=/quest/`); do NOT touch the VPS while the Continuum session is active.** H4 NOT closed until a real-browser two-npub retest on the redeployed build shows both avatars in-world.
- **v0.2.370-alpha — base-aware pinned-entry import fixed (ENTER ARENA no longer freezes under the `/quest/` mount); LIVE still v0.2.366-alpha until Suite redeploy.** A real-browser test on chiefmonkey.art/quest/ (v0.2.369-alpha, Brave + Firefox) found the pre-auth menu responsive but clicking **ENTER ARENA froze the session** before any canvas/frame — the arena never booted. Root cause: the vite CSP plugin (`vite.config.js`) emitted the pinned-entry URL **root-relative** (`/assets/torii-entry.js?v=<stamp>`) for BOTH the inline bootstrap `import()` and every chunk's back-reference import of the entry. Under the Suite's `--base=/quest/` build those URLs 404 at host root; because `arenaRuntime.js` statically imports the entry, ENTER ARENA's `import('./arenaRuntime.js')` graph load REJECTED and the arena never started (live symptom: freeze). Fix: the plugin now captures the resolved deploy base (`configResolved`) and emits `${base}assets/torii-entry.js?v=<stamp>` (`/quest/…` on the Suite, `/…` at root) via a single `entryUrl(base)` helper, applied to the inline import, the removal regexes, and the chunk rewrite. `tools/regression-check.mjs` [16] base-agnostic; new deterministic regression `tests/quest-base-entry.test.js` does a real `--base=/quest/` build and asserts every `torii-entry.js?v=` URL carries the `/quest/` base, is byte-identical (single module instance), and that no static entry `<script>` survives. Verified: `--base=/quest/` build emits `/quest/assets/torii-entry.js?v=<stamp>` everywhere; puppeteer ENTER-ARENA repro on a clean `/quest/` server boots the arena (frames advance, no "Failed to fetch dynamically imported module"). 2269/2269 tests, checks green. **Source-only fix — the Suite installer is pinned at `TORII_QUEST_REF=v0.2.367-alpha`, so the maintainer must first bump the Suite Quest ref to v0.2.370-alpha (or the merge commit), then a Suite redeploy (which builds with `--base=/quest/`) will include it; do NOT touch the VPS while the Continuum session is active on the shared host.** No gameplay/physics/CSP-policy/Nostr change; the v0.2.369 assetUrl fix is untouched.
- **v0.2.369-alpha — root-relative asset paths fixed (graphics + peer-avatar visibility); LIVE still v0.2.366-alpha until Suite redeploy.** A real-browser two-npub test (Firefox + Brave) on chiefmonkey.art/quest/ confirmed the arena loads and peers auth/join, but **no `.glb` models load** (bots fall back to capsule "pills") and **peer avatars never appear** (players can't see one another) — the peer-avatar `avatarLoader` has no fallback on GLB failure. Root cause: all `GLTFLoader.load('/foo.glb')`, `setDecoderPath('/draco/')`, and `TextureLoader.load('/bitcoin-b.png')` in `src/` were **root-relative**; under the `/quest/` mount they 404 at host root (confirmed: root 404, `/quest/` 200). Fix: new `src/assetUrl.js` helper (`${import.meta.env.BASE_URL}${name}`, mirroring `audio.js`) applied across 8 source files (8 GLB loads, 6 Draco paths, 1 texture, `char.file`); `tools/regression-check.mjs` [16] now requires `assetUrl('/draco/')` and FAILS on any bare root-relative `.load('/...glb|png|…')`. Verified: a `--base=/quest/` build inlines `/quest/` + passes all GLB args to the helper; 2264/2264 tests, 20/20 checks. **Source-only fix — the Suite installer is pinned at `TORII_QUEST_REF=v0.2.367-alpha`, so the maintainer must first bump the Suite Quest ref to v0.2.369-alpha (or the merge commit), then a Suite redeploy (which builds with `--base=/quest/`) will include it; do NOT touch the VPS while the Continuum session is active on the shared host.** H4 NOT closed until a real-browser retest on the redeployed build shows both avatars in-world. SW follow-up (non-blocking): `public/sw.js` registration + precache are still root-relative and don't register under `/quest/`; the game loads via network regardless.
  - **NOT confirmed in this test:** the full in-world arena render + roster visualisation via the app's normal `ENTER ARENA` → `boot()` path. Under headless software-WebGL (swiftshader) the arena's render loop starves the async NIP-07 callback, so `signEvent` does not resolve before the 10s `AUTH_TIMEOUT_MS` when driven through the full 3D flow; the test therefore drove the AUTH handshake directly in-page (same `wss://chiefmonkey.art/mp`, same `window.nostr` shim) to isolate the protocol path. This is a **headless test-environment limitation, not proven to be free of a product-side rendering/roster-visualisation issue (H4)** — re-verify the full ENTER→in-world path on real GPU hardware before closing H4.
  - H2 (MP not eagerly loaded) and H3 (silent AUTH rejection) are not implicated by this test (both peers authed and received WELCOME/JOIN), but were not directly exercised through the ENTER button either.
  - The original pplx.app symptom was solely the broken pplx.app backend sandbox (still 503), now bypassed by the SHC VPS install. Full evidence in `torii-quest-todo.md` §QA-MP-BLOCKER-1.
- **Deployment conventions — chiefmonkey.art (Torii Suite install; source of truth: `torii-quest-todo.md` → “Deployment conventions — chiefmonkey.art”).** Quest is live via the **Torii Suite** installer (`torii-suite` v0.7.0-alpha), NOT the ad-hoc Caddy bundle. Frontend mounts at the path prefix **`/quest/`** (root `/` 404s — no launcher mounted yet). Multiplayer WS is the root-level same-origin **`wss://chiefmonkey.art/mp`** (no `/port/5000/mp` sentinel on the VPS path — that sentinel is pplx.app-sandbox-only; `multiplayerHost.resolveUrl()` resolves to `wss://chiefmonkey.art/mp`). Backend is the hardened systemd unit **`torii-arena-ws.service`** (`User=torii-quest`, `127.0.0.1:8788`, `NoNewPrivileges`/`ProtectSystem=strict`); nginx `location /mp` → `127.0.0.1:8788` (WS upgrade) via `/opt/torii/nginx-fragments/quest-mp.conf`. Apps mount as path prefixes via fragments in `/opt/torii/nginx-fragments/<app>.conf` under one domain; the shared parent `/opt/torii` stays `root:root 0755` (world-traversable) — NEVER re-own/re-mode it (v0.2.30 permission-regression fix). Siblings: Continuum `/continuum/` (agent `127.0.0.1:8787`, API `/api/`), Plebeian `/plebeian/`. A Continuum session is actively managing onboarding on this shared host — do NOT touch shared nginx/parent-dir config while that work is in flight. Suite installer: `curl -fsSL https://raw.githubusercontent.com/ChiefmonkeyArt/torii-suite/v0.7.0-alpha/bootstrap.sh | sudo bash`; pinned `TORII_QUEST_REF=v0.2.367-alpha` (live `arena-ws` advertises v0.2.366-alpha in HELLO — the live build predates the v0.2.369-alpha source bump; cosmetic, no functional impact).
- **Travel-time lead on fast-moving targets** — bullets are hitscan-aimed but projectile-flown; long shots on strafing bots can trail. Tracked in `torii-quest-todo.md`.
- **pplx.app backend sandbox BROKEN (2026-07-11; SECONDARY host, now bypassed by chiefmonkey.art — kept as fallback).** v0.2.366-alpha published to quest-torii.pplx.app via `publish_website` (status:published, `visibility_setting: Public`). Static frontend serves (HTTP 200) but the **backend sandbox is not running** — `/port/5000/healthz` returns empty 503 in ~0.2s (fast rejection, not a cold start; a 90s-timeout probe still 503s in 0.198s). WS upgrade OPENs at the proxy but no HELLO arrives. Server code is verified healthy: clean-room replication of the exact production boot (`npm install --omit=dev` → `node server/arena-ws.cjs` PORT=5000) gives `/healthz` 200 `{"ok":true,"version":"v0.2.366-alpha"}` + WS `HELLO` in 7ms. Two republishes did not change the 503. Residual platform-side backend-hosting degradation from the 32h bridge outage (diagnostic `9a174646`). **Decision (2026-07-11): move the live backend to the SHC VPS at chiefmonkey.art** (single-origin, VPS_INSTALL.md §16) — bypasses the broken pplx.app backend entirely. Ready-to-run deploy bundle built: `torii-quest-vps-deploy-v0.2.366-alpha.tar.gz` (dist + Caddy site block + systemd unit + idempotent `deploy.sh`; CSP baked from the build with inline-script sha `8RxbohhIbgMGQaBj0CcykJ4wbu0FIyUvCrGVRHXu8xE=`). VPS was paused — unpause first; DNS (apex + www A records → VPS) confirmed by maintainer. Once up: `sudo bash deploy.sh` → smoke `wss://chiefmonkey.art/mp` (expect HELLO v0.2.366-alpha) → two-npub test.
- **ESBUILD-1** (deferred) — low-severity dev-server-only esbuild advisory. `npm audit fix` pulls a broad rolldown/vite chain, deemed too risky for alpha. Tracked WARN in `torii-quest-todo.md`.
- ~~**SEC-1 (mandatory gate on `leaderboardPublisher`)**~~ — **LANDED v0.2.355-alpha.** The `createLeaderboardPublisher({ sign, publish, gate })` adapter no longer treats `gate` as optional: `gate` DEFAULTS to `verifyPublishGate` (the crypto-verified SEC-1 gate), so any live publisher inherits real BIP-340 verification + the consent check by default. An explicit `gate: null` combined with a wired `publish` is a SEC-1 CONSTRUCTION ERROR — `publishScore` fails closed on every call, never signs, never publishes, and returns `ok:false` with a `SEC-1: publish is wired without a gate` error. The build-only path (no publisher) still needs no gate. This closes the earlier bypass where a caller could wire `{ sign, publish }` without a gate and quietly ship stub-signed or unverified events to a relay. Tests: 5 new cases across `tests/leaderboard-publisher.test.js` (mandatory-gate fail-closed describe block) and `tests/leaderboard-publish-gate.test.js` (the old "backward compatible" bypass test flipped to two fail-closed assertions). Consent gating for the real signer/relay wiring landed earlier (v0.2.257 publishGate, v0.2.277 real BIP-340, v0.2.285 live NIP-07); v0.2.355 removes the last opt-out path.
- ~~**SEC-2 (handoff verification on `world/handoff.js`)**~~ — **LANDED v0.2.356-alpha.** The traveller-side handoff skeleton (`src/world/handoff.js`) now runs real BIP-340 schnorr verification before it hands a caller a spawn descriptor. New `verifyHandoffCrypto(h, { expectedPlayerPubkey, now, requireFresh })` composes the pure structural pre-flight (schema/namespace/freshness) with a re-derived NIP-01 event id + `schnorr.verify(h.sig, h.id, h.player)` under the traveller's hex64 pubkey, mirroring the SEC-2 gateway gate in `engine/gateway/handoffVerify.js` and the SEC-1 leaderboard gate. `resolveHandoffSpawn(h, destZoneMeta, { expectedPlayerPubkey })` is the choke-point: the `expectedPlayerPubkey` opt is REQUIRED (must be hex64) and the crypto verdict must be trusted, so an unsigned envelope, a tampered body, a wrong-key signature, or an envelope naming a different traveller returns null. New helpers `deriveHandoffId(h)` (pure, so signer + verifier agree on what the sig commits to) and `signHandoffEvent(h, sk)` (test/demo convenience, injected sk only) round out the module. Tests: 32 new cases in `tests/world-handoff.test.js` covering constants, factory shape, structural verify parity, id derivation, sign+verify round-trip, malformed opts, identity mismatch, tampered body, stub sig, wrong-key sig, freshness gate, resolveHandoffSpawn fail-closed matrix, and serialize/deserialize sig preservation. Historical crypto SEC-2 in the gateway path (`handoffVerify.js`, live-signature verify) landed earlier at v0.2.252 (structural) and v0.2.263 (real BIP-340); v0.2.356 completes SEC-2 on the traveller/arrival side. **Note:** live relay ingest still requires the maintainer to wire `resolveHandoffSpawn` into whatever transport lands `h` — the module has no relay layer yet.
- ~~**SEC-3 (product URL validation)**~~ — **LANDED v0.2.354-alpha.** `productDisplay.isSafeHttpUrl` (the shared validator both `productDisplay` and the `productPanel` view-model use) is now a WHATWG `URL`-object parser: it trims + rejects any embedded whitespace, tries `new URL(s)`, and only accepts a result whose `protocol === 'https:'` and whose `hostname` is non-empty. The old regex `^https:\/\/[^\s]+$` accepted malformed inputs like `https://` and `https:javascript:…`; the parser refuses them and normalises the permissive-but-safe cases (`https:host`, `https:///host`, `HTTPS://`) to a real https host, so a listing can no longer smuggle a non-https scheme through us. Tests: 6 new cases in `tests/product-display.test.js` locking scheme/host enforcement, malformed rejection, WHATWG normalisation behaviour, and non-string safety.

## 9.5. Active task / next steps (2026-08-17)

**PENDING DEPLOY:** v0.2.586-alpha is pushed to GitHub (tag `v0.2.586-alpha`) but NOT yet deployed to the VPS. The user needs to run:
```
sudo truncate -s 0 /var/log/torii-quest-update.log && sudo torii-deploy v0.2.586-alpha
```

**WHAT WAS DONE THIS SESSION:**
1. v0.2.520: Repositioned all NAP objects to z=31 edge. Rewrote napNpc.js (NPC walking + gestures). 2668 tests pass.
2. v0.2.521–v0.2.525: Iterative rotation adjustments (torii gate, leaderboard, product panel, mirror). Multiple failed attempts due to wrong positions and not following the curved edge.
3. v0.2.526: Mirror at (0.26, 31) — on top of torii gate. User reported "nothing has changed."
4. v0.2.527: Mirror at (12.26, 25) — too far around curve, crossed NAP/arena boundary. User reported "even worse."
5. v0.2.528: Correct layout — all objects flush with curved edge, left to right: leaderboard → torii gate → product panel → mirror. Mirror shrunk to 5m, rotated 45° to follow curve. Both edges verified on land.

**WHAT TO VERIFY AFTER DEPLOY:**
- All four objects visible in correct left-to-right order along the NAP edge
- Mirror not overlapping any other object
- Mirror angled to follow the curve (45° from south)
- NPC (chiefmonkey) walking and doing gestures in NAP zone
- Torii gate at (0, 32) with its glow ring, rotated 55° CW

**IF THE LAYOUT STILL LOOKS WRONG:**
1. Check browser console for `[arena] travel-gateway GLB unavailable` — if present, the fallback gate shows at a different angle (Math.PI/2 base vs Math.PI for GLB)
2. Hard refresh (Ctrl+Shift+R) to bypass service worker cache
3. Verify the deployed version: `curl -s https://chiefmonkey.art/quest/ | grep -o 'v0\.2\.[0-9]*-alpha'`
4. Check `src/mirror.js` for MW, MX, MZ values
5. Check `src/engine/world/proofSurfaceSpecs.js` for panel/leaderboard positions
6. Check `src/config.js` for TRAVEL_GATE_* values
7. Use `isNapLand(x, z)` + `sampleNapHeight(x, z)` to verify any new positions are on solid land

**DEPLOY PIPELINE:**
- Push: `git push origin main --tags` with `api_credentials=["github"]`
- Deploy on VPS: `sudo truncate -s 0 /var/log/torii-quest-update.log && sudo torii-deploy <version>`
- The `torii-deploy` script writes a JSON request to `/opt/torii-quest/mp/update-requests/`, an update-runner service picks it up, does git fetch + checkout by TAG (not branch), builds, and logs result
- MUST create git tag for each version: `git tag v0.2.XXX-alpha && git push origin v0.2.XXX-alpha`
- Repo: `https://github.com/ChiefmonkeyArt/torii-quest.git`
- Live URL: https://chiefmonkey.art/quest/
- VPS: ubuntu@chiefmonkey
- SSH key NOT available from sandbox — print deploy command for user to run manually
- dist/ is in .gitignore — VPS builds from source via `npm run build`
- Service worker: network-first for JS/CSS/HTML, cache-first for GLBs/images/fonts

**VERSION MARKER FILES (bump ALL on each version):**
MVP_APPROVAL_STATE.json, NEXT_ACTION_STATE.json, index.html, public/dashboard.html, public/sw.js, public/torii-quest-data.json, server/arena-ws.js, src/config.js, src/engine/dashboard/toriiQuestDashboardData.js, tests/torii-quest-dashboard.helpers.test.js, tests/torii-quest-dashboard.model.test.js, tests/torii-quest-dashboard.render.test.js, tests/torii-quest-dashboard.sdk.test.js, tools/regression-check.mjs, torii-quest-handoff.md, torii-quest-progress.md, torii-quest-todo.md, package.json, dist/index.html

---

## 10. Next-job format

When picking up work, state it as:

```
TASK:        <one line>
VERSION:     bump v0.2.<n> → v0.2.<n+1>-alpha
CONSTRAINTS: (default = all of §3; note any the task explicitly relaxes)
SCOPE:       files expected to change; split by concern
DONE WHEN:   build + check + test green; docs (§5) updated; version markers (§4) bumped
DEPLOY:      NO (maintainer publishes) unless explicitly instructed
```

Keep changes incremental and reversible. If scope balloons, stop at a green checkpoint and report what remains rather than half-landing a broad rewrite.
