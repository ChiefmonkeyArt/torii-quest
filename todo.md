# Torii Quest — Master TODO

> **Source of truth for active tasks.** Update this file whenever tasks are added, changed, completed, removed, or re-prioritised.
> Live site: [torii-quest.pplx.app](https://torii-quest.pplx.app) | Current version: **v0.2.151-alpha**

> Strategy source of truth: `strategy.md`.
> Progress dashboard: `progress.md` — visual track bars, sprint status, completed-last-24h, archive, and update rules.
> Mission: get to fast, safe feature delivery on solid foundations.
> Project purpose: we are building an open world builder on open protocols, FOSS, Bitcoin, and Nostr. The shoot'em up is a proof-of-work/game layer. The strategic goal is a self-sovereign, FOSS, Nostr/Bitcoin-powered open world builder and decentralised metaverse layer for Plebeian/Plebeian.Market.

---

## ACTIVE FOCUS — 15-Hour Proof-of-Concept Route (v0.2.151)

> **The project is refocused onto a 15-hour proof-of-concept.** Build the vision
> fast, prove the architecture, avoid polish traps — then add retrospective polish
> once the proof of concept *feels right*. Everything below is read in that light.

- **Shooter is now MAINTENANCE-ONLY** — do not invest in combat/weapon/feel polish
  unless a bug is **demo-breaking** for the PoC. Combat already works well enough to
  demonstrate the proof-of-work/game layer; further shooter tuning is deferred until
  after PoC validation.
- **The active MVP is the freedom-tech loop**, four demonstrable slices:
  1. **Gateway / NAP-to-NAP preview** — the Torii Gateway portal view + travel-intent
     preview (`gatewayPortal.js`), now VISIBLE on the title screen via the inert
     `gatewayPreview.js` card (v0.2.139); cross-the-gate handoff (LEAN-2 / CMP-8).
  2. **Plebeian / Nostr product panel proof** — read-only product surface over
     `productPanelShell.js`, now VISIBLE on the title screen via the inert
     `productPreview.js` card (v0.2.140 — product identity, price, Nostr seller npub
     ownership proof, Plebeian.Market link as TEXT, "PREVIEW · READ ONLY · NO CHECKOUT"
     badge); in-world product panel MESH is the next slice (LEAN-3 / CMP-13).
  3. **Leaderboard preview** — ranked board from (eventually signed) Nostr events,
     now VISIBLE on the title screen via the inert `leaderboardPreview.js` card
     (v0.2.141 — local/mock rank rows, the kind-30000/#torii-quest score-event proof
     shape, npub signer identity flavour, "PREVIEW · LOCAL MOCK · NO PUBLISH" badge;
     signed:false / published:false). Real signer/relay read is the next slice
     (LEAN-4 / LB1, SEC-1).
  4. **torii.quest GitHub update-check** — pure release/update-check helper + inert
     "update available" view-model (v0.2.138), now VISIBLE on the title screen via the
     inert `updatePreview.js` card (v0.2.142 — running version, sampled latest release,
     update-available/up-to-date/unknown status, GitHub releases path as TEXT, "PREVIEW ·
     MANUAL · NO AUTO-UPDATE" badge; `actionable:false`, deterministic LOCAL sample, no
     fetch). Real read-only GitHub fetch + the in-world prompt MESH are the next slice
     (LEAN-5). Architecture only — no server, no auto-update, no network execution.
- **The four preview cards now read as ONE loop** (v0.2.143) — a title-screen MVP loop
  header (`engine/mvpLoop.js` → `mvpLoopSummary`, SDK `mvpLoop`) frames the four inert
  cards as **Travel → Market → Score → Update**, and each card title carries its step
  (`1 · TRAVEL` … `4 · UPDATE`). Content/CSS/labelling only — `actionable:false`, no
  network/links/actions; rendered via `textContent`. Read-only at `ToriiDebug.shells.mvpLoop()`.
- **In-world proof meshes have a pure spec layer** (v0.2.147) — `engine/world/proofSurfaceSpecs.js`
  defines plain-data LAYOUT/SPEC contracts for the four future proof meshes (gateway
  portal panel, product stall panel, leaderboard board, update prompt board): id,
  loop step + LEAN, the feeding SDK preview namespace + `ToriiDebug.shells` report,
  an in-world anchor in the NAP zone, approximate `{x,y,z}` position + `{w,h,d}` size +
  `yawRad` (PLAIN data, no THREE), and inert invariants. SDK `proofSurfaceSpecs` +
  read-only `ToriiDebug.shells.surfaceSpecs()` (with an `allInert` gate + NAP-zone
  bounds). Spec layer only — no Three/render/gameplay; +9 tests. The mesh pass that
  reads these specs is the next (isolated, non-hot-path) slice.
- **Proof-surface specs are cross-checked against the live registries** (v0.2.148) —
  `engine/debug/proofSurfaceCheck.js` (`checkProofSurfaceSpecs()`, read-only at
  `ToriiDebug.shells.surfaceSpecCheck()`) verifies each spec's `previewSdk` is a real
  SDK experimental namespace and its `shell` is a real `ToriiDebug.shells` report,
  re-asserts the inert invariants, and scans for leaked live-action keys —
  `{ok,errors,warnings,surfaces}`. The guard to run BEFORE the future mesh pass binds
  anything; deterministic, no render/network; +14 tests.
- **Proof-surface anchors now resolve to plain transforms** (v0.2.149) —
  `engine/world/anchorTransforms.js` (`PROOF_SURFACE_ANCHORS` + `resolveAnchorTransform()`/
  `resolveAllAnchors()`, SDK `anchorTransforms` + read-only at
  `ToriiDebug.shells.anchorTransforms()`) is the single source of truth mapping each
  proof-surface `anchor` id to a ground origin + parent/zone hint, and binds a spec to a
  plain transform descriptor (origin/position/`offset`/size/yawRad, with
  `origin+offset===position`) while reporting unresolved anchors. PLAIN data — no
  THREE/render/gameplay; +14 tests. The isolated mesh pass that reads these transforms
  is the next slice.
- **First display-only in-world proof-surface MESH pass landed** (v0.2.150) — split
  into the PURE `engine/world/proofSurfaceRenderPlan.js` (gates on
  `resolveAllAnchors().ok` + `checkProofSurfaceSpecs().ok`, then turns the four specs
  into a plain-data RENDER PLAN of inert panels) and the browser-only adapter
  `engine/world/proofSurfaceMeshes.js` (builds a coloured board + `CanvasTexture` label
  plate per panel EXACTLY ONCE during scene setup, gated on `plan.ok`). Wired into
  `arena.js` `_buildNapZone()` after the bonsai tree; read-only render state at
  `ToriiDebug.shells.surfaceRender()`. DISPLAY-ONLY/INERT — no click/raycast/navigation/
  payments/Nostr/live-data/fetch; no per-frame allocation. +14 tests (pure plan + adapter
  guards). **Next:** anchor↔scene-graph parent binding (attach each panel to its live
  `parent` node) and folding `surfaceRender().ok` into promotion review / regression check.
- **Anchor↔scene-graph PARENT BINDING for the proof-surface boards landed** (v0.2.151) —
  added the PURE `engine/world/proofSurfaceParentBinding.js` (`PARENT_NODE_NAMES`,
  `parentNodeName(parent)`, `parentGroupName(parent)`, `resolveParentBindings(plan)`) that
  maps each panel's `parent` hint to a live scene-graph node name + a named subgroup under
  the `proof-surfaces` root, reporting any `unbound` panels. The render plan now carries
  `parent` on every panel; `proofSurfaceMeshes.js` builds one NAMED subgroup per parent and
  mounts each board there (boards keep their WORLD positions — structural/discoverability
  change only, NO visual change); `arena.js` `.name`s the live `nap-zone-floor` + `torii-gate`
  (fallback + GLB) nodes so `scene.getObjectByName` can find them. Read-only at
  `ToriiDebug.shells.surfaceBindings()`. DISPLAY-ONLY/INERT — no re-parenting onto rotated/async
  live nodes, no click/raycast/navigation/payments/Nostr/live-data; no per-frame allocation.
  +10 tests. **Next:** fold `surfaceRender().ok`/`surfaceBindings().ok` into promotion review /
  regression check, and (only once promotion is sanctioned) the first live proof-surface read.
- **Proof surfaces are now review-symmetric + diffable** (v0.2.146) — the gateway
  preview gained `readOnly:true` so all four MVP proof surfaces expose the same
  `readOnly`+`actionable` invariant pair. Added a pure read-only
  `ToriiDebug.shells.diff(a,b)` (pure `shellsDiff()`) that compares two
  `shells.summary()` outputs and flags the invariant flips that *loosen* inertness —
  the mechanical review checklist for a future preview→live promotion. Debug only —
  no network/actions/DOM/THREE; +6 tests.
- **SDK/debug surfaces are now indexed for handoffs** (v0.2.145) — `SDK_DEBUG_INDEX.md`
  maps the SDK namespaces (by stability tier), the four MVP proof surfaces
  (gateway/product/leaderboard/update previews + the MVP loop) with their SDK
  namespace, `ToriiDebug.shells` report, and inert invariants, where the tests live,
  and how to add a new proof card or promote preview→live. A new read-only
  `ToriiDebug.shells.summary()` (pure `shellsSummary()`) aggregates the four surfaces
  + loop with an `allInert` gate and `network:false`/`autoUpdate:false` flags read
  from the live reports. Docs/debug only — `actionable:false`, no network/actions.
- **Host-side self-hosting is now documented** (v0.2.144) — `VPS_INSTALL.md` covers
  running the static `dist/` build at `torii.quest` on a shared Ubuntu VPS (Caddy or
  Nginx, HTTPS, DNS checklist, min specs), the **manual** GitHub update sequence
  (`git pull` → `npm ci` → `npm run build` → publish a versioned release folder →
  flip the `current` symlink), symlink-based rollback, security notes (no auto-update,
  no shell endpoint, least-privilege deploy user, UFW/SSH basics, backups), and a
  deferred guarded "update button" sketch. Docs only — no server touched, no install,
  no auto-update; aligns with `UPDATE_CHECK.md` §4 and `HANDOFF.md` §7.
- **Retrospective polish AFTER PoC validation** — once the loop demonstrably works and
  *feels right*, circle back for shooter feel, mesh/material polish, and UX refinement.
  Until then, prefer thin vertical slices that advance the loop over polish.

---

## Working Rules

- **Every fix should improve the foundation when useful**: add or strengthen an SDK/API seam, debug hook, smoke check, or code index entry.
- **No big rewrites**: every task must leave one system cleaner, more testable, or more agent-readable than it found it. Incremental slices only; broad speculative rewrites create bug cycles and waste handoff context.
- **SDK evolves from working code**: extract boundaries around systems we touch and prove, not speculative framework layers.
- **Agent/dev efficiency matters**: keep `CODE_INDEX.md`, `ENGINE.md`, `window.ToriiDebug`, regression checks, and handoff reports current enough that future agents can find faults quickly.
- **Agent handoff design**: maintain a clear engine/game split, public APIs per system, `CODE_INDEX.md`, debug snapshots via `ToriiDebug`, tests for every extracted seam, explicit constraints in comments/docs, source-of-truth doc references, and small focused modules. A new agent or developer should be able to locate any fault using repo docs and tests alone, without reading every source file.
- **Cross-agent portability**: structure the repo so another AI or developer can pick up work using docs and tests. DeepSeek, perplexica, routstr, and other operators are plausible future contributors; we do not guarantee any specific agent, but we design so handoff is possible without source archaeology.
- **Rapier is the physical truth layer**: combat, LOS, bot bullets, crates, boundaries, and future interactable objects should converge on reusable Rapier-backed APIs.
- **Cut dead structure**: remove duplicate, stale, or completed structural tasks unless they directly support new features on solid foundations.
- **Prefer FOSS and open protocols**: do not design toward Google, Cloudflare, Microsoft, or Babylon.js dependencies.

---

## Near-Term — Agent-Readable Structure

These tasks build the structural layer that makes the project legible to any agent, contributor, or auditor without source archaeology. Work through them in order; each one enables the next. The goal is not abstraction for its own sake — it is making the codebase handoff-safe so FOSS contributors, future AI operators, and the project itself are not locked into any single session's context.

| # | Category | Task |
|---|----------|------|
| ~~ARS-1~~ | DEBUG | ~~**Debug dump / handoff snapshot** — `ToriiDebug.snapshot()` + `combat.report()`/`physics.report()` via pure `engine/debug/snapshot.js` (JSON-serialisable, safe before init). Shape documented in `CODE_INDEX.md`. **DONE v0.2.130** (`tests/snapshot.test.js`).~~ |
| ~~ARS-2~~ | PHYSICS | ~~**Physics interaction API** — pure `engine/physics/interactions.js` (`nudgeImpulse`/`applyNudge` + crate tuning, allocation-free); crate-nudge tuning moved off `weapons.js`. **DONE v0.2.130** (`tests/interactions.test.js`).~~ |
| ~~ARS-3~~ | PHYSICS | ~~**Rapier raycast service** — injectable `createRaycastService` facade + default `raycastService` in `engine/physics/raycastService.js`, surfaced on `ToriiDebug.physics.service`. **DONE v0.2.130** (`tests/raycast-service.test.js`). *Follow-up v0.2.131:* first live call-site migrated — `bots.js` bot-LOS now calls `raycastService.lineOfSight(...)`. *Follow-up v0.2.132:* the weapon/bullet ray path migrated too — `weapons.js` (player-bullet ray, bot-bullet `rayStatic`, both fire-time diagnostic rays) and `player.js shoot()` (crosshair/aim ray) now call `raycastService.ray(...)`/`.rayStatic(...)` instead of importing `castRay`/`castRayStatic` direct; behaviour-identical (default service wraps the same `raycast.js`), barrel→crosshair rule preserved. +3 default-singleton tests in `tests/raycast-service.test.js`. *Follow-up v0.2.133:* the LAST direct `castRay` consumer migrated — the read-only reticle preview (`targetReticle.js`) now calls `raycastService.ray(...)` (collider forwarded as the exclude arg); no module imports `castRay` outside the service. +injected-fake-world ray/LOS contract block in `tests/raycast-service.test.js`. **ARS-3 raycast migration COMPLETE.**~~ |
| ARS-4 | ARCH | **Player state machine cleanup** — fold `reloading` and `pointerLocked` into the guarded FSM in `src/state.js`. Add tests for the new edges. Remove any remaining direct `state.phase =` writes outside `state.js`. *Partial v0.2.130:* dead `state.paused` removed; pure `canShoot`/`canReload` predicates extracted to `state.js` and adopted by `player.js shoot()`/`startReload()`. *Partial v0.2.131:* pointer-lock fold slice — pure `isEngaged`/`needsPointerLock` predicates added to `state.js` and `needsPointerLock()` adopted at the canvas-click re-lock guard in `main.js`. *Partial v0.2.132:* reload sub-state folded — pure `isReloading` predicate + `tickReload(dt)` transition helper added to `state.js` (the ONE place the reload timer counts down / completes + refills the mag); `player.js tickPlayer` now calls `tickReload`, and the `state.reloading` read sites in `main.js` (anim trigger, player-model tick) + `weapons.js` (viewmodel pose gate) adopt `isReloading()`. Behaviour-identical; `tests/state.test.js` (+5). *Partial v0.2.133:* real `GAMEOVER` edge wired — `GAME_EVENT.END` added (PLAYING/DEAD → terminal GAMEOVER) plus a thin `endRun()` helper (`transition(END)`); behaviour-preserving (no live call site fires END yet, so the endless die→respawn flow is unchanged — the edge is the named entry point for a future end-of-run screen); `tests/state.test.js` (+state tests). Remaining: optionally promote `reloading` to a real PLAYING sub-phase edge; further pointer-lock call-site adoption; fire `endRun()` from an actual end-of-run screen. |
| ~~ARS-5~~ | SDK | ~~**SDK/API skeleton** — `src/sdk/index.js` public entrypoint: curated namespace re-exports of the node-safe engine leaf modules (combat aim/classifier/damage, physics interactions/raycastService, weapons muzzle/reloadPose, botAgent, debug snapshot, ui phaseScreens) + `SDK_VERSION`, a `STABILITY` tier enum, and a frozen `SDK_SURFACE` map tagging each surface `stable`/`experimental`/`internal` (internals forward-declared with `module:null`). No runtime wiring; no scene/WebGLRenderer pull. **DONE v0.2.131** (`tests/sdk.test.js`). Tiers documented in `CODE_INDEX.md`.~~ |
| ARS-6 | INDEX | **CODE_INDEX.md upkeep** — after each ARS task, update `CODE_INDEX.md` to reflect the new module boundary, public API, debug hook, test file, and any known constraints or open edges. The index is the primary agent-handoff document; it must stay current or it becomes misleading. *(Kept open as a standing per-task chore.)* |
| ~~ARS-7~~ | ARCH | ~~**Handoff template** — `HANDOFF.md` created: repo state, hard constraints, version markers, source-of-truth docs, build/test/check + deploy commands, debug surface, active issues, next-job format. **DONE v0.2.130**.~~ |
| PROGRESS-1 | DOCS | **Formalise / maintain `progress.md`** — keep track bars, sprint table, and completed-last-24h current. After each sprint or significant landing, move crossed-out completed items from `todo.md` into the Archive in `progress.md` and update the relevant track bar. Aim for weekly upkeep at minimum. |

---

## Now — Foundation Close-Out

| # | Codebase | Category | Task |
|---|----------|----------|------|
| TQ-MANUAL-113 | TQ | TESTING | **Manual smoke test v0.2.113-alpha** — on real hardware verify head/body classification, reticle states (orange close, green body, green + 👌 headshot), crate bullet nudges, reload clunk-click speed, look-down POV, mirror, reflected gun, NAP NPC, footsteps, bot LOS, and general combat feel. |
| IDX-1 | TQ | INDEX | **Create/maintain dev index** — add a lightweight `CODE_INDEX.md` / index section covering core modules, SDK seams, debug hooks, smoke checks, and where to inspect common faults. This becomes part of every sprint. |
| SDK-1A | TQ | SDK | **Combat targeting seam** — treat the shared hit classifier and reticle preview as the first combat API. Keep bullet outcome and HUD preview on the same source of truth. |
| RELOAD-FEEL | TQ | WEAPON | **Reload viewmodel feel — DONE (v0.2.127).** User feedback: reload should be snappier and synced to the sound ("click down, clack snap back" — quick barrel drop then snap back). The old FP viewmodel reload used a symmetric `Math.sin(progress*π)` hump (slow, peaked mid-reload, mushy). v0.2.127 replaced it with a pure `reloadDip(p)` curve in `engine/weapons/reloadPose.js`: quick ease-out DROP (p<0.12) → HOLD lowered (0.12–0.68, the "clack" window) → fast SNAP-BACK through rest into a small overshoot (0.68–0.86) → SETTLE to rest (0.86–1). Same amplitudes (Y −0.22, Z −0.10, roll −0.6) and same `RELOAD_TIME=1.1` so audio sync + gameplay duration are unchanged; only the visual timing shape changed. Allocation-free scalar (no Three), so no hot-path alloc. Covered by `tests/reload-pose.test.js` (8 tests). **Manual:** verify the gun visibly clicks down fast, holds briefly, then snaps back with a tiny overshoot, in time with the clunk-clunk-click audio. |
| PHYS-1A | TQ | RAPiER | **Crate interaction tuning** — tune bullet impulse strength only after manual testing. Keep impulses behind the physics/raycast/bodies seam. |
| COMBAT-HEADZONE | TQ | COMBAT | **Head-zone height + re-entry hit-reg — FIXED (v0.2.128).** Manual feedback: (1) on first entry body hits register but headshots are "out" — the player could only score by aiming ABOVE the target; (2) on the SECOND game entry hardly any body or head shots connect. **Bug 1 root cause:** the head sphere sat too high — old `BOT_HEAD_CENTRE_Y_OFFSET` 1.65 + `BOT_HEAD_RADIUS` 0.22 spanned [1.43,1.87], but the Banker GLB crown is ≈1.70, so the sphere's top floated 0.17 m ABOVE the visible head while a crosshair on the actual face resolved the body cap (3 dmg). Fix: lower centre 1.65→1.55 (face/eye line) and tighten radius 0.22→0.20 → sphere [1.35,1.75], top hugging the crown, bottom still overlapping the body cap (1.52) so no thread-through gap. NOT loosened — the above-head zone was *removed*; lateral shoulder/above shots stay body (locked by +7 cases in `tests/classifier.test.js`). **Bug 2 root cause:** `initPhysics()` builds a BRAND-NEW Rapier world every call; the ENTER handler re-ran the full bootstrap on every entry, so bots (spawned once at load, colliders bound to the FIRST world) were orphaned in the discarded world and the live world had no bot colliders → "hardly any shots connect" on re-entry. Fix: the ENTER handler now bootstraps physics + colliders + player body + viewmodels exactly ONCE (`_arenaBootstrapped` guard); the single world persists across HOME/ENTER, and each entry only `resetRun()` + `setNextSpawn`/`resetPlayerPos` for a clean fresh run (`resetRun()` was defined in state.js but previously never called). **Manual:** put the crosshair on the bot's FACE (not above) — should one-shot; ENTER → pause → HOME → ENTER again → body and head shots must still register and `ToriiDebug.combat.lastHit` populate. |
| COMBAT-MUZZLE | TQ | WEAPON | **Muzzle/tracer origin side — FIXED (v0.2.129).** Manual feedback: bullets seem to come from the LEFT side, not the RIGHT where the visible gun is. **Root cause:** `getGunBarrelWorld` (weapons.js) built the barrel offset basis from the camera's LOCAL quaternion. But the FP camera is a CHILD of `playerObj`, which carries the YAW (the camera itself holds only pitch), so the local frame ignored yaw — the +0.12 lateral (right) offset pointed in a FIXED world direction regardless of facing, and as the player turned the bullet/tracer origin swung to the wrong (notably LEFT) side. **Fix:** extracted the barrel math to the pure `engine/weapons/muzzle.js` (`muzzlePoint`/`barrelWorldFromCamera` + `MUZZLE_FORWARD=0.30`/`MUZZLE_RIGHT=0.12`/`MUZZLE_UP=-0.10`) and rebuilt the offset basis from `camera.getWorldQuaternion()` so the +right offset tracks yaw and the muzzle stays on the visible right-hand gun. The barrel→crosshair DIRECTION (firing rule from v0.2.126) is unchanged — only the origin side was corrected. Covered by `tests/muzzle.test.js` (11 cases: +right side convention is intentional; `barrelWorldFromCamera` keeps the origin on the camera WORLD-right at every yaw — the local-quaternion regression). **Manual:** face several directions and fire — the tracer must always leave from the right-hand gun barrel, never the left; barrel→crosshair convergence unchanged. |
| COMBAT-HITREG | TQ | COMBAT | **Hit-registration — BARREL→CROSSHAIR FIX LANDED (v0.2.126); travel-time lead still open.** Manual feedback on v0.2.124: "headshots still taking two shots; body shots seem to be working". Root cause: the damage path was already correct (clean headshot 9 dmg vs `BOT_HP` 5 → one-shot; body 3 → two-shot — locked by `tests/combat-damage.test.js` via pure `engine/combat/damage.js`). The real fault was REGISTRATION parallax: the reticle previewed a headshot on the CAMERA ray, but the bullet flew the BARREL→80 m-convergence line, so muzzle parallax dropped a "headshot" onto the BODY collider (3 dmg ⇒ two shots); body shots survived because the torso is bigger. **v0.2.125 first tried a camera-origin bullet** (bullet == camera ray) — fixed parallax but moved the muzzle off the gun. **v0.2.126 (current, per user request) restores the gun-barrel origin:** `player.js shoot()` casts the camera/crosshair ray to find the aimed point (first hit, or `CONVERGE_DIST` 80 m fallback), spawns the bullet at the BARREL (`getGunBarrelWorld`), and fires it **barrel → crosshair point** via the pure `engine/combat/aim.js` (`crosshairPoint`/`aimDirection`). The projectile passes through exactly what the reticle classified, so a previewed headshot lands as a headshot — convergence is at the ACTUAL aimed point at any range. No damage value changed; classifier untouched (body registration not loosened). Covered by `tests/aim.test.js`. **Still open:** finite travel time (60 m/s) means a fast-strafing bot can still leave a small head sphere at range before the projectile arrives — the reticle (instantaneous) over-promises on MOVING targets. Future options: increase `BULLET_SPEED`, add target-lead, a thin at-range hit-assist radius for bots, or make the reticle predict the projectile. Use `ToriiDebug.combat.lastShot` (`reason: 'moved-or-offset'` / `head-to-body`) to confirm before picking. Do NOT blindly loosen head/body thresholds. |

---

## Lean Prototype Sprint (15-hour target)

> Time-boxed sprint to stand up the end-to-end freedom-tech loop as a
> *demonstrable* prototype — thin vertical slices proving the architecture, not
> polish. See `strategy.md` → "Lean Prototype Sprint (15-hour target)". Each slice
> stops at a green checkpoint if it balloons. **Deploy/publish remains a separate
> manual maintainer step — not done by task agents.**

| # | Codebase | Category | Task |
|---|----------|----------|------|
| LEAN-1 | TQ | DEPLOY | **Torii.quest live** — publish the current green source (v0.2.135-alpha) as the canonical live instance. Manual smoke (TQ-MANUAL-113) first; deploy is the maintainer's manual step. |
| LEAN-2 | TQ | NOSTR | **n2n hop** — working spatial handoff between two instances via the Torii Gateway component (cross the gate → arrive in a second zone/node carrying identity). Build on `world/handoff.js` + `toriiGateway.js`; relay-mediated first. **v0.2.134: protocol foundation** (`GATEWAY_PROTOCOL.md` + `travelIntent.js`). **v0.2.135: loader + handoff shell in** — `registry.js` (CMP-7) loads built-in components by id; `gatewayHandoff.js` (CMP-8) turns a gateway component into a validated travel intent / URL (pure return values). **v0.2.136: portal VIEW shell in** — `gatewayPortal.js` (`gatewayPortalView`) produces a render-ready portal view-model (destination label, "Press E to travel" prompt, armed flag, plan errors, display-only URL preview); pure, NO navigation. **v0.2.139: visible preview in** — `gatewayPreview.js` (`gatewayPreviewBlock`) flattens the portal view into an INERT title-screen card (destination/status/relay/intent/URL rows + "PREVIEW · SAFE · INERT" badge); rendered by `main.js` via `textContent` only (no link, no navigation), surfaced read-only at `ToriiDebug.shells.gatewayPreview()`. Still needs the in-world portal MESH + `world/handoff.js` to ACT on the intent (move the player / change the URL) — that step has browser side effects and is the next slice. |
| LEAN-3 | TQ | MARKET | **Product component** — one real Plebeian.Market product-display component (mountable, manifest-described) as the first in-world commerce surface. Reference component on the CMP contract. **v0.2.134: read-only skeleton** (`productDisplay.js`, links out, no checkout). **v0.2.135: view-model shell in** (`productPanel.js` — flat render-ready bag). **v0.2.136: render shell in** (`productPanelShell.js` — ordered panel layout spec: title, body lines, display-only link footer, empty `actions[]`; read-only, no checkout surface). **v0.2.140: visible preview in** — `productPreview.js` (`productPreviewBlock`) flattens the panel shell into an INERT title-screen card (Product/Price/Seller-npub/reward/Marketplace/Link rows + "PREVIEW · READ ONLY · NO CHECKOUT" badge); rendered by `main.js` via `textContent` only (no link, no checkout, no navigation), surfaced read-only at `ToriiDebug.shells.productPreview()`. Needs the in-world panel MESH over the shell + a real listing. |
| LEAN-4 | TQ | NOSTR | **Nostr leaderboard** — minimal score/kill leaderboard sourced from signed Nostr events, proving the social/identity layer end-to-end. Overlaps LB1 (kind:30000). **v0.2.134: pure unsigned helpers** (`leaderboard.js`). **v0.2.135: publisher adapter shape in** (`leaderboardPublisher.js` — injected signer/publisher, build-only by default). **v0.2.136: display + preview shell in** (`leaderboardView.js` — `leaderboardView`/`rankScores` deterministic ranked table + `leaderboardPreview` build-only unsigned-template preview; mock/build modes only, no live/relay mode). **v0.2.141: visible preview in** — `leaderboardPreview.js` (`leaderboardPreviewBlock`) flattens the ranked view into an INERT title-screen card (Mode/Signer/Status/Event framing rows + ranked `#n` rows + "PREVIEW · LOCAL MOCK · NO PUBLISH" badge; surfaces the kind-30000/#torii-quest score-event proof shape + npub identity flavour; signed:false/published:false/actionable:false); rendered by `main.js` via `textContent` only (no sign, no publish, no submit, no fetch), surfaced read-only at `ToriiDebug.shells.leaderboardPreview()`. Needs the real signer (NIP-07, SEC-1) + relay publish/read + the title-screen rank board MESH/HUD. |
| LEAN-5 | TQ | INFRA | **torii.quest GitHub update-check** — architecture so a torii.quest instance can detect when a newer GitHub release exists and surface an inert "update available" prompt (the maintainer still ships manually). **v0.2.138: pure helper + view-model + docs landed** — `engine/update/updateCheck.js` (`parseRelease`/`compareVersions`/`evaluateUpdate`/`updateCheckView` + `RELEASE_SOURCE`) parses a GitHub-release-shaped manifest, compares its semver tag against the runtime `VERSION`, and returns an inert `{status, currentVersion, latestVersion, updateAvailable, notesPreview, releaseUrl, ...}` view-model. **No server, no network fetch, no auto-update execution** — pure compare logic only; the actual `fetch` of the releases endpoint + the in-world prompt MESH/HUD are the deferred next step. `tests/update-check.test.js`. See `UPDATE_CHECK.md`. **v0.2.142: visible preview in** — `engine/update/updatePreview.js` (`updatePreviewBlock`) flattens `updateCheckView` into an INERT title-screen card (Version/Latest/Status/Source/Notes rows + "PREVIEW · MANUAL · NO AUTO-UPDATE" badge; surfaces running version, sampled latest release, update-available/up-to-date/unknown status, GitHub releases path as TEXT; `actionable:false`/`readOnly:true`); rendered by `main.js` via `textContent` only from a DETERMINISTIC LOCAL SAMPLE release (no fetch, no install, no auto-update, no navigation), surfaced read-only at `ToriiDebug.shells.updatePreview()`. `tests/update-preview.test.js`. Needs the real read-only GitHub fetch (CSP `connect-src`, audited) + the in-world prompt MESH/HUD. |

---

## Next — SDK Layer 1: Core Engine Boundaries

| # | Codebase | Category | Task |
|---|----------|----------|------|
| A1-next | TQ/NA | ARCH | **Extract player boundary — IN PROGRESS (v0.2.114 + v0.2.123 slices done).** `src/engine/entities/player.js` now owns the pure player geometry (`EYE`, `BODY_FROM_EYE`), spawn shape (`SPAWN_X/Y/Z`, `SPAWN_YAW`, `PLAYER_SAFE_CORNER`), allocation-free look-down POV math (`lookDownEyeY`/`lookDownEyeZ`), and (v0.2.123) the movement heading basis (`forwardX`/`forwardZ`/`rightX`/`rightZ(yaw)` — pure scalars the movement tick writes into its scratch vectors); the module's import was narrowed to the pure `engine/physics/bodies.js` leaf so it stays free of the Three/Rapier chain. `src/player.js` consumes them and re-exports `PLAYER_SAFE_CORNER`. Covered by `tests/player-boundary.test.js`. **Remaining:** lift the stateful movement/kinematic tick, combat (shoot/reload/recoil), lifecycle (damage/death/respawn) and body-state (`setPlayerBody`/`getPlayerCollider`/`spawnPlayerBody`) behind the boundary, then add WASD+dash, zoom, iFrames, spectator shape. Next pure slices: play-area clamp + reload/respawn timing math. Nostr Arena absorbs the old v0.6 player extraction intent without old version clutter. |
| 8 | TQ/NA | ARCH | **State machine — IN PROGRESS (v0.2.115, first slice done).** `src/state.js` now defines the explicit FSM: `GAME_EVENT`, a frozen `TRANSITIONS` table mirroring the prior phase guards exactly, `transition()`/`canTransition()`/`nextPhase()`, and predicates (`isTitle/isPlaying/isPaused/isDead/isGameover/isLive`). All 6 call sites (main, player, input, bots, targetReticle, hud) read via predicates and write via `transition()`; regression check 7 guards against direct `state.phase =` writes outside `state.js`. **Remaining:** fold secondary booleans (`reloading`, `pointerLocked`) into guarded state, wire a real `GAMEOVER` edge if/when an end-of-run screen lands, and keep the old A2 circular-dependency/ecash-wallet warning in scope. (Transition-table unit tests landed v0.2.120 — `tests/state.test.js`.) |
| 9 | TQ/NA | ARCH | **Event bus / decoupling — IN PROGRESS (v0.2.118, foliage globals migrated).** `src/events.js` is the live decoupling backbone (`EV` registry + `on/off/emit`, imports nothing → no cycles). v0.2.116 documented the registry convention, wired `EV.PHASE_CHANGE` (`{from,to,event}`) from `state.transition()`, and added regression check 8. v0.2.117 migrated the bot-hit bridge: weapons.js emits `EV.BOT_HIT_BY_PLAYER` (`{bot,dmg}`), main.js subscribes; `window._onBotHit` is now a deprecated forwarding alias and check 9 forbids internal calls. v0.2.118 moved the foliage shader materials off `window` into a module-scope registry in `arena-foliage.js` (`tickFoliage(dt)` ticks uTime per-frame allocation-free; `getGrassMat`/`getFlowerMat` accessors injected into ToriiDebug). v0.2.119 moved the mirror Reflector handle off `window` into a `mirror.js` `getMirror()` accessor (injected into ToriiDebug). `window._grassMat`/`_flowerMat`/`_mirrorMesh` remain only as deprecated debug aliases and check 10 forbids internal reads. **No functional `window.*` globals remain as internal wiring.** v0.2.121 added the first real `PHASE_CHANGE` subscriber: main.js drives top-level screen visibility (title/HUD/pause modal) from a pure `engine/ui/phaseScreens.js` map, replacing the imperative `classList` toggles scattered across the ENTER/PAUSE/RESUME/HOME call sites (behaviour-preserving; covered by `tests/phaseScreens.test.js`). **Remaining:** add further `PHASE_CHANGE` reactions (audio/presence), and emit `WS_*` once netcode lands. Required before Nostr, wallet, multiplayer, and NAP features scale. |
| B2-TQ | TQ | SDK | **Extract BotAgent interface — IN PROGRESS (v0.2.122, first slice done).** `src/engine/entities/bot-agent.js` now holds the pure decision math: `BOT_ACTION` constants (move/shoot/idle/interact/speak), scalar helpers `engageSpeed`/`steerComponent`/`inEngageRange`/`wantsToShoot`, and a `decideActions(worldState) -> BotAction[]` facade in the `BotAgent.tick` shape. `bots.js`'s `tickBots()` consumes the allocation-free scalar helpers (LOS short-circuit preserved: cheap `inEngageRange()` still gates the expensive `hasLineOfSight()`); `decideActions` is unit-tested but unwired (allocates per call). Covered by `tests/bot-agent.test.js`. **Remaining:** migrate the stateful runtime (movement tick, shoot/cooldown, blowback/death/respawn, world-state shaping) behind the boundary; wire `decideActions` once it can run off the hot path. |
| 14 | TQ/NA | TESTING | **Start Vitest unit suite — IN PROGRESS (v0.2.120, first slice done).** Vitest added (node env, `npm test`; config in `vite.config.js`). Pure seams covered: state machine (`tests/state.test.js` — legal/illegal transitions, guards, predicates), event bus (`tests/events.test.js` — on/emit/off, no-subscriber no-op, ordering, fan-out), the headshot classifier (`tests/classifier.test.js` — head-vs-body geometry), extracted to a pure `src/engine/combat/classifier.js` so it tests without Three/Rapier/browser, the phase→screen-visibility map + PHASE_CHANGE subscriber integration (`tests/phaseScreens.test.js`, v0.2.121), the BotAgent decision helpers + `decideActions` facade (`tests/bot-agent.test.js`, v0.2.122), the player heading basis + look-down POV math (`tests/player-boundary.test.js`, v0.2.123), the shot-diagnostics aim-vs-outcome miss classifier (`tests/shot-diagnostics.test.js`, v0.2.124), the combat damage/kill contract (`tests/combat-damage.test.js`, v0.2.125 — head/body damage + kill threshold vs `BOT_HP`), the barrel→crosshair aiming helper (`tests/aim.test.js`, v0.2.126 — `crosshairPoint`/`aimDirection`/convergence + barrel-fired bullet passes through the aimed point), and the reload viewmodel pose curve (`tests/reload-pose.test.js`, v0.2.127 — `reloadDip` "click down, clack snap back": drop/hold/snap-back/settle phases, rest at p=0 and p=1, overshoot bounds), and (v0.2.128) +7 head-zone realignment cases in `tests/classifier.test.js` (face shot scores; crown ~1.70 still in; above-crown 1.85/1.95 NOT head; torso stays body; lateral shoulder not promoted; outright head-collider resolve still wins), and (v0.2.129) the muzzle side convention in `tests/muzzle.test.js` (barrel +right offset is intentional; `barrelWorldFromCamera` keeps the origin on the camera WORLD-right across yaws — the local-vs-world quaternion regression). 126 tests / 11 files. Regression check [11] guards the scaffold; `npm run check` stays separate from `npm test`. **Remaining:** physics raycast/bodies (inject a mock world), FSM `GAMEOVER` edge if it lands, and later kind:0 profile fetch. |
| CI-1 | TQ/NA | TESTING | **Fold bot health into checks** — do not keep a separate daily bot-health task. Cover boot, bot count, no JS exceptions, version marker, debug namespace, and critical markers in CI/smoke checks. |

---

## Next — SDK Layer 2: Identity, NAP Zones, and Handoff

| # | Codebase | Category | Task |
|---|----------|----------|------|
| 20 | TQ | NOSTR | **kind:0 profile sync manager** — `identity/profile.js`, fetch from primary relay on login, broadcast to all relays, use latest profile picture as player avatar, handle relay sync latency. |
| NAP-formalise | TQ | ARCH | **Formalise NAP zone module** — promote the NAP metadata skeleton into a working boundary: NIP-style metadata, pure builders, validators, decoration hooks. |
| HANDOFF | TQ | ARCH | **World handoff demo** — promote handoff skeleton to a local same-browser NAP-to-NAP demo before networked/node-to-node transport. |
| PRESENCE | TQ | NOSTR | **Presence/discovery prototype** — discover online zones and players via relay-friendly metadata without central platform accounts. |
| DECOR-1 | TQ | NAP ZONE | **Player-decorated NAP zone foundation** — define wallpaper/poster/object placement manifest before building the full editor. JPEG/PNG wallpaper upload comes after the module boundary is stable. |

---

## Later — Fun Features on Solid Ground

| # | Codebase | Category | Task |
|---|----------|----------|------|
| W1 | TQ | UI/UX | **Gate Modal** — Torii Gate social popup with following/follower avatars, online rings, open events, and JOIN buttons. Depends on presence/identity. |
| CF1 | TQ/NA | GAMEPLAY | **Combat feedback checklist** — screen-shake, weapon kick, hit-markers, damage vignette, bot hit flash. Keep dt-driven, no new unapproved timers. |
| R2 | TQ/NA | WEAPON | **Immersive reload mechanic** — mag-eject geometry and hip-fire lock during reload. Do after weapons boundary is cleaner. |
| LB1 | TQ/NA | NOSTR | **Persistent leaderboard** — kind:30000 read/write, top 10, title screen rank, relay-native identity. Depends on identity boundary. **v0.2.134: pure score-event helpers landed** (`engine/nostr/leaderboard.js`, SDK `leaderboard`; `buildScore`/`validateScore`/`buildScoreEventTemplate`, kind 30000 + indexable tags, headshots≤kills; unsigned template only; `tests/leaderboard.test.js`). **v0.2.135: publisher adapter shape landed** (`engine/nostr/leaderboardPublisher.js`, SDK `leaderboardPublisher`; `createLeaderboardPublisher({sign,publish})` — INJECTED signer/publisher deps, build-only by default, captures dep failures without throwing, no relay/secrets in-module; `tests/leaderboard-publisher.test.js`). **v0.2.136: read-only display + preview shell landed** (`engine/nostr/leaderboardView.js`, SDK `leaderboardView`; `leaderboardView`/`rankScores`/`accuracyLabel` build a deterministic ranked table [score→kills→headshots tie-break], `leaderboardPreview` drives the build-only publisher [no signer/publisher] to return UNSIGNED templates only; modes are `mock`/`build` — a `live`/relay mode throws by construction; `tests/leaderboard-view.test.js`). Remaining: the real signer (NIP-07 / nsec) + relay read, top-10 + title-screen rank board MESH/HUD. |
| 21 | TQ/NA | HUD | **2D mini-map** — live player and bot positions. |
| V1 | TQ/NA | GAMEPLAY | **Contrail plane** — low-poly flyby, permanent contrail, shootable hitbox, falling reward crate. |
| G1 | TQ/NA | ASSET | **gun.glb** — proper compact sidearm model, compressed textures, swap into viewmodel/world gun, add to precache if applicable. |
| B1 | NA | GAMEPLAY | **Kill feed + death counter** — Nostr Arena-specific unless pulled into Torii Quest later. |
| B2-NA | NA | GAMEPLAY | **Bot visual behaviour polish** — patrol/chase animation polish and obstacle avoidance for Nostr Arena. Separate from Torii Quest BotAgent SDK work. |
| NPC-PERSONAL | TQ | NPC/AI | **Personal NPCs (future).** Spawn personal/companion NPCs built from a player's own GLB avatar, later driven by an AI "brain" (e.g. customer-service / concierge persona in a NAP zone). Builds on the NAP Chiefmonkey NPC skeleton + the BotAgent boundary; defer until the player-GLB pipeline and BotAgent runtime are stable. Chiefmonkey spelling: capital C, lowercase m, one word. |

---

## Later — Economy, Markets, and Infrastructure

| # | Codebase | Category | Task |
|---|----------|----------|------|
| 19 | TQ | ECASH | **NIP-60 eCash wallet** — NIP-07 auth, live sat balance, arena stakes, signed eCash transfers. Do after identity/world foundations. |
| 6 | TQ | NAP ZONE | **Live Nostr auctions** — kind:30402/16, NIP-17 order flow, auction podium, Lightning/eCash payment. |
| 7 | TQ | NAP ZONE | **Host-configurable shop stalls** — stalls manifest, Nostr listing metadata, stall geometry per vendor. |
| 3 | TQ | NAP ZONE | **NAP Zone video chat** — private WebRTC, encrypted signalling, self-hostable STUN/TURN path. |
| 4a | TQ | INFRA | **Self-hosted coturn TURN server** — each arena host can run their own TURN server. |
| 4b | TQ | INFRA | **Nostr relay as ICE candidate** — track/propose relay/wss extension ideas. |
| 12 | TQ/NA | PERFORMANCE | **WebGPU renderer** — Three.js WebGPU backend behind feature flag. |
| 13 | TQ/NA | BUNDLE | **Bundle treemap audit** — rollup visualizer, unused Three.js extras, asset-size review. |
| 22 | TQ/NA | INFRA | **GitHub weekday scan** — optional scheduled scan of open issues/PRs when the project has enough contributor activity to justify it. |
| FORGE-1 | TQ | ASSET | **Torii Asset Forge (validator-first)** — prompt-to-game-ready asset pipeline. Build the durable piece first: a `torii.asset`-aware **validator + converter** (geometry/scale/units sanity, poly/texture budgets, MIME/format, GLB draco/meshopt, npub provenance + hash — same manifest as Digital Assets). Drive generation via curated **external AI presets** (treated as untrusted input that must pass the validator); pay with **routstr / NIP-60 (Cashu) credits**. **Scope guard:** NOT a rigging/animation/training engine — v1 is static/prop/scenery assets only. See `strategy.md` → "Torii Asset Forge". |
| ENVKIT-1 | TQ | ASSET | **Torii Environment Kit** — budgeted environment building blocks: (a) lightweight low-poly **GLB scenery forms** (rocks/fences/stalls/torii/foliage clumps) with declared poly/texture budgets, droppable as scene/zone components; (b) **WebP/JPG sky + backdrops** (image-based, not heavy cubemaps) with resolution budgets; (c) **grass as a layered illusion** (billboard/illusion technique like the arena foliage shader, with explicit density / draw-distance / frame-budget knobs). Budgets are part of the manifest/validator contract so a dropped-in environment can't silently wreck frame rate. See `strategy.md` → "Torii Environment Kit". |

---

## Later — Component Economy / Marketplace

> **Vision source of truth:** `strategy.md` → "Reusable Components Library and Community Marketplace". These are the approved CMP-1..CMP-16 work items. **NOT immediate sprint** — they unlock only after the SDK boundary (ARS-5), identity, and NAP-zone foundations are stable. A *component* is a self-contained, droppable world module with a `mount(scene, options)` / `unmount()` lifecycle, explicit dependency metadata, and a signed Nostr distribution manifest with bundle-hash verification. Build the contract + loader first (CMP-1..CMP-7), then reference components (CMP-8..CMP-13), then the marketplace/economy layer (CMP-14..CMP-16).
>
> **Spec landed (v0.2.132):** `COMPONENTS.md` documents the full manifest spec (identity, provenance/npub, bundle hash, capabilities, deps, assets, config→mount options, pricing/free/sats, zap splits, Nostr listing events, security/verification rules). The machine-checkable slice ships in `src/engine/components/contract.js` (pure, node-tested) and is surfaced via `src/sdk/index.js` as the `component` namespace (tier: experimental).

| # | Codebase | Category | Task |
|---|----------|----------|------|
| CMP-1 | TQ | SDK | ✅ **Component module contract** (v0.2.132) — pure `mount(scene, options)` / `unmount()` lifecycle with idempotent `mounted` bookkeeping, `isComponent` shape check, and `defineComponent` wrapper that fails fast on a bad contract. Shipped in `src/engine/components/contract.js`, surfaced via the SDK `component` namespace, contract-tested in `tests/component.test.js`. Lives behind the ARS-5 SDK boundary; no runtime coupling until the loader (CMP-7) lands. |
| CMP-2 | TQ | NOSTR | ◑ **Component manifest format** (spec + validator landed v0.2.132) — `COMPONENTS.md` §2 defines the manifest (author `npub`, semver, declared deps, asset-bundle ref + `bundle hash`, capability tier, pricing/zap split); `validateManifest()` in `contract.js` checks required fields + provenance + pricing rules (tested). **Remaining:** builder helper and the `torii.asset`→component extension wiring once the loader/Nostr event work (CMP-5/CMP-7) lands. |
| CMP-3 | TQ | SDK | **Dependency declaration + resolution** — components declare deps as explicit metadata (engine API tier, other components, asset bundles); a pure resolver checks availability/version-compat before mount. |
| CMP-4 | TQ | SECURITY | **Bundle hash verification before mount** — verify the fetched bundle hash against the signed manifest hash before any code runs; refuse mismatch. Pure hash-compare seam first; wiring follows the loader. |
| CMP-5 | TQ | NOSTR | **Signed component event** — publish/parse a signed Nostr component event (NIP-78 kind 30078 or a Torii-specific kind) carrying the CMP-2 manifest; verify author signature. |
| CMP-6 | TQ | NOSTR | **Relay-based discovery** — query relays for component listing events, filter by kind/author/tag, dedupe by latest version. Discovery is relay-native, no central index. |
| CMP-7 | TQ | SDK | ◑ **Component loader / registry** (local skeleton landed v0.2.135) — `src/engine/components/registry.js` (`createRegistry`/`createBuiltinRegistry`/`builtinRegistry`) indexes KNOWN built-in component factories by id/kind, probes + validates each on register, and `load(id, config)` returns a FRESH contract-valid instance (re-validating manifest + contract version), degrading safely on unknown/incompatible ids. **LOCAL ONLY — no eval, no dynamic import, no remote fetch** (the security boundary). Surfaced via the SDK `registry` namespace (experimental); `tests/registry.test.js`. **Remaining:** the *runtime mount host* part — fetch a verified bundle (CMP-4), resolve deps (CMP-3), call `mount`/`unmount` (CMP-1) with failure isolation so a bad component can't crash the world, and dep/signature/hash enforcement (CMP-5). |
| CMP-8 | TQ | NAP ZONE | ◑ **Reference component — n2n node jumper / Torii gateway** (skeleton landed v0.2.133) — the canonical first component: a Torii gateway that hands off to another node/zone. `src/engine/components/toriiGateway.js` (`createToriiGateway`/`toriiGateway`/`GATEWAY_VERSION`) built on the `defineComponent` contract proves the mount/unmount lifecycle end-to-end; manifest carries `kind:'gateway'`, `mountTarget:'scene'`, provenance npub, and a `gateway:{npub,relay,target,position}` destination block. Surfaced via the SDK `toriiGateway` namespace (experimental); `tests/torii-gateway.test.js`. **v0.2.135: handoff shell landed** — `src/engine/gateway/gatewayHandoff.js` (`gatewayDestination`/`planGatewayTravel`/`gatewayTravelUrl`) turns a gateway component's destination block into a validated travel intent / URL string (pure return values; NO navigation/relay/signing); `tests/gateway-handoff.test.js`. **v0.2.136: portal VIEW shell landed** — `src/engine/gateway/gatewayPortal.js` (`gatewayPortalView`/`destinationLabel`/`shortKey`/`PORTAL_PROMPT`) turns a gateway component + traveller context into a render-ready portal view-model (status ready/invalid/not-a-gateway, armed flag, destination label, relay, interaction prompt, plan errors, display-only `urlPreview`); pure, NO navigation/relay/signing; SDK `gatewayPortal` (experimental); `tests/gateway-portal.test.js`. **Remaining:** the portal MESH at `options.position` over the view-model and ACTING on the intent — crossing the gate → hand the player's identity off to the destination node via `npub`/`relay`, wiring `world/handoff.js` (this step has browser side effects, deliberately deferred). |
| CMP-9 | TQ | NOSTR | **Reference component — live chat** — NIP-28/29 public/group chat panel as a droppable component. |
| CMP-10 | TQ | NAP ZONE | **Reference component — video chat** — WebRTC video panel component (depends on the NAP video-chat infra, items 3/4a/4b). |
| CMP-11 | TQ | NOSTR | **Reference component — art frame** — wall frame that renders a Plebeian gallery feed. |
| CMP-12 | TQ | NAP ZONE | **Reference component — live auction panel** — auction podium component over kind:30402/16 (depends on item 6). |
| CMP-13 | TQ | NOSTR | ◑ **Reference component — product display / browser** — single-product display and a multi-product browser over NIP-15 stalls. **v0.2.134: read-only single-product skeleton landed** (`engine/components/productDisplay.js`, SDK `productDisplay`; safe `validateProduct`; no checkout/pay/zap; `tests/product-display.test.js`). **v0.2.135: panel view-model shell landed** (`engine/components/productPanel.js`, SDK `productPanel` — `productPanelViewModel`/`priceLabel` produce a flat render-ready bag; `tests/product-panel.test.js`). **v0.2.136: panel render shell landed** (`engine/components/productPanelShell.js`, SDK `productPanelShell` — `productPanelShell` produces an ordered panel layout spec: title, body lines [Price/Seller/reward], a DISPLAY-ONLY link footer `actionable:false`, and an always-empty `actions[]`; read-only, no checkout/pay/zap/open-external action; `tests/product-panel-shell.test.js`). Remaining: the in-world panel MESH over the shell, the multi-product browser, and real NIP-15 stall fetch. |
| CMP-14 | TQ | ECASH | **Marketplace listing + sats pricing** — signed Nostr listing events for components with sats pricing (Lightning / Cashu / Nutzap); relay-based marketplace discovery reuses CMP-6. |
| CMP-15 | TQ | ECASH | **Revenue-share via Zap splits** — optional author/host revenue-share using Zap splits (NIP-57 / NIP-61) encoded in the listing. |
| CMP-16 | TQ | NOSTR | **Versioning, forks & remixes** — new events supersede prior versions (latest-wins by hash), forks/remixes carry original-author `npub` attribution, all bundle hashes verified. |
| GWPROTO-1 | TQ | NOSTR | **Nostr Spatial Gateway Protocol (open protocol path)** — lift the spatial handoff out of the Torii client into a commons spec. Stages: (1) build out the CMP-8 gateway's portal mesh + handoff trigger — *portal VIEW shell landed v0.2.136 (`gatewayPortal.js`); the MESH + acting on the intent remain*; (2) ✅ **`GATEWAY_PROTOCOL.md` DRAFT landed v0.2.134** (relay-first hybrid discovery, URL handoff MVP, world/zone/gateway identity, travel-intent fields, return path, signed-event future, security tiers, NIP path; "component is code, protocol is agreement") + pure `engine/gateway/travelIntent.js` URL-handoff helpers (SDK `travelIntent`; `tests/travel-intent.test.js`); (3) interop demo across two independent instances (one non-Torii consumer); (4) propose as a NIP (spatial hop / world handoff). See `strategy.md` → "Nostr Spatial Gateway Protocol". Feeds LEAN-2. Remaining: stages (1), (3), (4) + the signed-event upgrade (§6 of the spec). |

---

## Security Follow-Up (v0.2.135 review)

These are pre-wiring gates — no action needed now, but must be resolved before the listed features go live. **v0.2.136 preserves all three gates:** the new view/render shells are pure and inert — `gatewayPortal.urlPreview` is a display-only string (no navigation, SEC-2 intact), `productPanelShell.footer` is `actionable:false` with an empty `actions[]` (no clickable/fetched URL, SEC-3 intact), and `leaderboardView.leaderboardPreview` runs the publisher build-only with no signer/relay (SEC-1 intact).

| # | Codebase | Category | Blocker / Gate |
|---|----------|----------|-----------------|
| SEC-1 | TQ | NOSTR | **Leaderboard signer consent gate** — before wiring `leaderboardPublisher` to a real NIP-07 signer or live relay publish, require explicit user consent before any live signing or relay publish action. `leaderboardPublisher` is currently pure/injected and not wired to live publish; keep it that way until consent UX is in place. |
| SEC-2 | TQ | NOSTR | **Handoff event verification gate** — before `world/handoff.js` acts on live relay data, add cryptographic verification / signing-layer checks for incoming handoff events. Do not act on an unverified travel intent from the wire. |
| SEC-3 | TQ | SECURITY | **Product URL validation tightening** — before `productDisplay`/`productPanel` URLs are made clickable or fetched, replace the current regex-only `https://` check with `URL`-object parsing to validate scheme, host, and structure. Regex alone is insufficient for untrusted input. |

---

## Safe Hardening / Handoff Legibility (v0.2.137 review)

Low-risk follow-ups from the security/handoff review — no gameplay-risk change.

| # | Codebase | Category | Status |
|---|----------|----------|--------|
| HARD-1 | TQ | TOOLING | ✅ **Package/runtime version drift fixed** (v0.2.137) — `package.json` was stuck at `0.2.1` while runtime `VERSION` was `v0.2.136-alpha`. Bumped `package.json` to valid semver `0.2.137-alpha` (no leading `v`) and added regression-check [5] guard tying `package.json version` to `EXPECTED_VERSION` (v-stripped) so they can't drift again. |
| HARD-2 | TQ | UI | ✅ **Mock chat marked non-live** (v0.2.137) — the chat `#chat-input`/`#chat-send` are an unwired static preview (no JS handler, no networking). Disabled both, greyed them out (`:disabled` CSS), retitled placeholder to "chat preview — not live", header to "LIVE CHAT (preview)", and added a comment so no one mistakes it for a transmitting surface. Still non-transmitting; no networking added. |
| HARD-3 | TQ | SECURITY | ✅ **CSP gstatic entry reviewed + documented** (v0.2.137) — `connect-src https://www.gstatic.com` is REQUIRED: DRACOLoader fetches its decoder from `gstatic.com/draco/versioned/decoders/1.5.6/` at runtime (`arena.js`, `weapons.js`). Documented in the index.html CSP comment as required; NOT removed, NOT broadened. |
| HARD-4 | TQ | DEBUG | ✅ **Shell debug reports added** (v0.2.137) — `engine/debug/shellReport.js` (`gatewayReport`/`productReport`/`leaderboardReport`/`buildShellReport` + safe demo fixtures) surfaced on `ToriiDebug.shells.{gateway,product,leaderboard,report}`. Read-only over the v0.2.136 shells: no signer, no relay/publish, no navigation. `tests/shell-report.test.js`. |

---

## Open / Parked

| # | Category | Task |
|---|----------|------|
| NIP46-1 | BUG | **Primal remote signer — pubkey not returned** — external blocker. Keep visible; real fix requires Primal NIP-46 compliance. |
| TP1 ⏸ | GAMEPLAY | **Touchpad / laptop controls — PARKED** — revisit after core gameplay and pointer-lock controls are stable. |
| ESBUILD-1 ⚠ | DEPS | **esbuild dev-server advisory (GHSA-g7r4-m6w7-qqqr) — DEFERRED (v0.2.131).** Low severity; arbitrary file read only when running the esbuild **dev server on Windows** — irrelevant to this Linux/CI build and to the production `dist/` artifact (no dev server in prod). `npm audit fix` was assessed and **rejected as unsafe/broad**: it rewrites the whole rollup/rolldown/lightningcss/vite toolchain and adds dozens of platform-specific binaries — high regression risk for a cosmetic dev-only advisory. Revisit when bumping Vite as part of a deliberate toolchain upgrade, not as a drive-by fix. |

---

## Removed / Archived

| # | Decision |
|---|----------|
| A2 | **Removed as standalone.** Merged into state machine, event bus, and BotAgent extraction notes. |
| B3 | **Removed.** Redundant with ToriiDebug, smoke tests, and CI. If needed, it belongs inside CI, not as a separate scheduled task. |
| Old v0.6 migration tables | **Archived.** Useful history, but not active Torii Quest execution guidance. Recover from Git/session history if needed. |
| Completed v0.2.100–v0.2.113 repair items | **Archived.** Keep reports and strategy history, but do not leave completed/debugged work in the active TODO. |

---

## Critical Rules

- **Version bump on EVERY deploy** — `v0.2.xxx-alpha`, max 999.
- **godMode = false** — NEVER deploy true.
- **No new `setTimeout`** except existing allowed cases: nostr.js WebSocket close and hud.js kill-feed.
- **No new `Vector3` / `Matrix4` in hot paths** — reuse scratch objects.
- **Comments use “nostrich” not “ostrich”.**
- **Chiefmonkey** — capital C, lowercase m, one word.
- **Debug tools ship unconditionally** in alpha.
- **ESC = instant pause**, overriding everything.
- **Panel-locked cursor click NEVER fires weapon.**
- **Bullets originate at the gun BARREL and are aimed THROUGH the crosshair** (barrel → crosshair target point on the camera ray; pure `engine/combat/aim.js`). Updated v0.2.126 — supersedes the old "bullets fire from CAMERA position" rule (the v0.2.125 camera-origin experiment is retired). The projectile must still pass through the exact point the reticle previews so a headshot preview lands as a headshot.
- **Use source, not patched dist**, except emergency hotfixes.
- **Deploy preview + publish live every version** when shipping to `torii-quest.pplx.app`.
- **No GitHub push every micro-version unless asked**; current instruction allows pushing completed v0.2.113/docs.
- **Prefer FOSS/open protocols**; do not recommend Google, Cloudflare, Microsoft, or Babylon.js.
