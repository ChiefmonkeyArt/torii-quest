# Torii Quest — Combat / Bot Bug List for Kimi

**Version:** v0.2.607-alpha (3D-title-screen branch not yet in this list — see §6)
**Deployed at:** https://chiefmonkey.art/quest/
**Branch:** `phase0m-menu-shell`
**Reported from:** live single-player play on the owner's own instance (SP local bot AI, NOT the MP server-authoritative path).
**Context:** all of the below was observed by the human player in-browser. Reproduce by playing SP on the live build.

---

## 1. Player shots on bots sometimes do nothing — "hit them multiple times and nothing happens"

**Symptom (verbatim):** "shooting bots is not always 100% accurate... sometimes hit them multiple times and nothing happens."

**How hits resolve (current architecture):**
- SP damage is resolved as **HITSCAN on the camera/aim ray at fire time**, NOT via the travelling projectile (`src/engine/combat/localShot.js` → `resolveLocalHitscan`; `src/weapons.js` lines ~240–285).
- The aim ray is cast with `raycastService.ray(ax,ay,az,adx,ady,adz,DIAG_RANGE, excl)` against the **Rapier physics world** (`src/weapons.js:253`). A hit only registers if the ray resolves a **bot collider** (`hit.bot && hit.bot.alive`).
- The travelling bullet is **cosmetic only** (`b.noDamage = true`, `src/weapons.js:243`); damage must not be double-applied in `tickWeapons`.

**Likely root causes to investigate:**
1. **Collider/mesh mismatch.** The raycast hits the bot's Rapier capsule/sphere colliders, but the player aims at the visible GLB mesh. If the collider is smaller or offset from the mesh (especially during animation), a crosshair squarely on the model can resolve a miss. Colliders are synced in `src/bots.js` `_syncBot` (lines ~600–609) to `state.pos` + foot height each frame via `setBotBodyPos(rapierBody, x, fy+BOT_BODY_CENTRE_Y_OFFSET, z)` + the head body. Check: is `setBotBodyPos` using `setNextKinematicTranslation` (deferred to next physics step → 1-frame lag vs the visual)? Is the foot-height sample `_footY` matching the mesh's actual foot?
2. **`hit.bot.alive` false on a frame the sim considers it still animating its death** → `resolveLocalHitscan` returns `null` (clean miss) even though the player sees a live target. See `localShot.js:17`.
3. **Aim ray blocked by a crate/wall the reticle clears** — the reticle preview (`targetReticle.js`) + the actual aim ray should use the same exclude list; verify the player's own collider is the only exclusion (`_getPlayerCollider()`, `weapons.js:251`).

**Damage model (for reference):** `src/engine/combat/damage.js` — HEADSHOT_DAMAGE=9, BODY_DAMAGE=3, BOT_HP=5. Headshot one-shots; two body shots kill. `applyDamage(hp,dmg)=hp-dmg`.

---

## 2. Headshots don't register 100% of the time

**Symptom (verbatim):** "head shots do not register 100% of the time."

**How headshots classify (current architecture):**
- `src/engine/combat/classifier.js` `classifyHeadshot(px,py,pz,bodyPart,bot)` → true if `bodyPart==='head'` OR the impact point is inside the head sphere (proximity backstop: `HEAD_PROX = BOT_HEAD_RADIUS + 0.05`).
- Bot collider geometry (`src/engine/physics/bodies.js`):
  - Body capsule: `BOT_BODY_HALF_H=0.5`, `BOT_BODY_RADIUS=0.30` → spans y∈[0, 1.60], centre 0.80.
  - Head sphere: `BOT_HEAD_RADIUS=0.30`, `BOT_HEAD_CENTRE_Y_OFFSET=1.55` → spans y∈[1.25, 1.85].
  - **Body + head colliders OVERLAP from y=1.25 to 1.60.**

**Likely root causes:**
1. **Overlap region picks body, not head.** When the aim ray enters through the overlapping band, Rapier's closest-collider pick can resolve `bodyPart='body'` for a genuine head shot. The proximity backstop (`isInHeadSphere`) is meant to catch this, but it only fires if the impact point is within `HEAD_PROX` (0.35m) of the head CENTRE in 3D — a shot clipping the top-back of the head sphere can fall outside that radius while still being a headshot visually.
2. **Head sphere is fixed-offset from the foot, not the animated head.** `BOT_HEAD_CENTRE_Y_OFFSET=1.55` is a constant above `state.pos`. The GLB head bobs/animates; the collider does not track the bone. A shot on the visual head (e.g. during a shooting/hit animation lean) can miss the static head sphere.
3. **Per-bone colliders exist (v0.2.575)** — `createBotBoneColliders` / `syncNpcBoneColliders` (`src/physics.js`, imported in `bots.js:30`). These may be intended to fix exactly this. Verify they are (a) actually created for SP model bots, (b) synced to the animated bones each frame, and (c) included in the raycast. If they are parked below the floor (see `_syncNetBot` lines ~513–519, which parks visual-only colliders at y=-100) — confirm the SP path (`_syncBot`) is NOT parking them.

---

## 3. Bots disappear "like it freezes" then reappear

**Symptom (verbatim):** "the bots disappear like it freezes and they reappear."

**How bots render (current architecture):**
- SP: `tickBots(dt)` → `sim.tick(dt, [playerState])` then `_syncBot` per bot (`src/bots.js:347–361, 562`).
- **LOD** (`src/lod.js`): `< 15m` = full (AnimationMixer running); `>= 15m` = frozen (mixer skipped, model still visible but anim frozen); `>= 35m` = **hidden** (mesh `.visible=false`).

**Likely root causes:**
1. **LOD flicker at a threshold.** A bot hovering around 35m from the player will flip `hidden`↔`frozen` every frame as the player/bot moves a few cm → the bot pops in/out. Same at 15m (anim freeze/thaw is less visible but still a hitch). This matches "disappear + reappear" precisely. **Fix: add hysteresis** (separate show/hide thresholds, e.g. hide at 35m, re-show at 30m).
2. **Frame freeze (dt spike) → bot positions jump.** See §4 — if dt is unclamped, a stalled frame produces a huge dt; the bot sim advances a large distance in one step, the mesh snaps to the new position → looks like "freeze then reappear somewhere else."
3. **Bot AI stuck → pathfinding snap/teleport.** `src/engine/entities/botSim.js` movement (lines ~370–465) — if the bot hits a stuck state + the navigation resets, it can teleport to a new waypoint. Inspect the movement/state machine for a "stuck → snap" recovery path.
4. **Death anim hide timing.** `_syncBot` hides the model exactly on the frame the death anim finishes (`bots.js:573` `if (bot._prevDying && !st._isDying) bot.model?.hide()`). If the death flag toggles mid-fight (a hit re-triggering the dying state), the bot can flicker hidden. Verify `_isDying` is strictly monotonic through death.

---

## 4. Game froze, then bullets stopped rendering — "zero bullets could be seen... still made the sound of shooting"

**Symptom (verbatim):** "at one point the game froze for a bit... then eventually zero bullets could be seen... it still made the sound of shooting but I could not see bullets or tell if they were hitting."

**How bullets render (current architecture):**
- Bullet pool: `src/weapons.js` `_pool` / `_active` (lines ~109–184). `spawnBullet()` reuses a pooled bullet object (tapered cylinder `THREE.Mesh` + tip + optional halo) or creates a new one; sets `b.mesh.visible = true` + pushes to `_active`.
- `tickWeapons(dt, playerPos)` (line 304) advances each bullet: `b.mesh.position.addScaledVector(b.vel, dt)`, decrements `b.life`, removes when `b.life<=0 || b.mesh.position.y < 0`, returns to pool (`b.mesh.visible=false; _pool.push(b)`).
- Bullet speed/life: `BULLET_SPEED`, `BULLET_LIFE` from `src/config.js`.

**Likely root causes:**
1. **UNCLAMPED dt after a freeze (highest probability).** No `Math.min`/dt cap was found in the rAF loop (`src/main.js` lines ~1879, 2090, 2120) nor in `state.js`. After a tab/GC stall, `dt` can be huge (e.g. 0.5–2s). `addScaledVector(b.vel, dt)` then teleports the bullet `BULLET_SPEED * dt` metres in one frame → it's instantly off-screen or below the floor → removed (`y<0`) → the player sees the muzzle-flash + hears the shot but no tracer. The hitscan damage is resolved at fire time (`weapons.js:258`) so it *may* still apply, but the visual is gone — matching "could not tell if they were hitting." **Fix: clamp dt in the main loop** (e.g. `dt = Math.min(dt, 1/20)` or `0.1`) before `tickWeapons`/`tickBots`/physics step.
2. **Bullet pool exhaustion / bad state.** If bullets are not being returned to `_pool` (e.g. a code path sets `remove=false` but never pushes back, or `b.mesh.visible` stays false on a recycled object), the pool drains → no visible bullets. Audit every `remove=true` path + the pool-return at line 451–452.
3. **WebGL context loss after the freeze.** A long stall can trigger a context-loss event; meshes/materials survive but rendered output freezes. Check for a `webglcontextlost` handler — if absent, add one that recreates the renderer.

---

## 5. Cross-cutting: is dt clamped anywhere?

**Finding:** grep for `Math.min(...dt)`, `MAX_DT`, `clamp.*dt`, `dt >` in `src/main.js` + `src/engine/state.js` returned **nothing**. The main rAF loop (`src/main.js:1879` boot, `2090` shell, `2120` preload) computes dt without a visible cap. The arena runtime loop (likely `src/engine/arenaRuntime.js` or `arena.js`) should be audited for the same. **This is the single most likely shared root cause for §3 (bot snap) + §4 (bullet vanish).** Clamp dt at the top of the sim step.

---

## 6. (DEFERRED — lower priority, "work on this later") 3D title scene is too basic

**Symptom (verbatim):** "the 3d scene needs work... it's pretty basic... it should resemble more the game itself and possibly have chiefmonkey in there... lets work on this later."

**Current state (v0.2.607, NOT yet deployed as of this writing):**
- `src/engine/homepage/titleScene.js` mounts `mountHomepageScene` behind `#screen-title` (z-index -1, transparent title bg, lazy three import, unmount on leaving TITLE phase).
- `src/engine/homepage/homepageScene.js` builds: starfield (Points, 2000), a simple torii gate (cylinders + boxes), ground disc, fog, ambient+point+rim lights, slow camera orbit + star counter-rotation + emissive pulse.
- The v0.2.607 build that IS deployed had the scene behind the Gateway-setup modal only + too dark; the title-screen mount + brightening (emissive 1.35/1.9, brighter lights, denser starfield, z-index -1) is built + tested (2906 tests green) but **not yet pushed/deployed** — see commit pending on `phase0m-menu-shell`.

**Deferred ask (for later, not Kimi-now):** make the scene resemble the actual arena (floor, lighting mood, maybe a bot silhouette) + add a chiefmonkey character/avatar in the scene. Parked per user instruction.

---

## Repro / verification notes for Kimi

- Reproduce in **SP** (single player, local bot AI) on the live build — the MP path uses server-authoritative bots + `botNetState.js` interpolation, which is a different code path (`shouldApplyLocalBotDamage(netMode)` returns `!netMode`).
- Key files: `src/weapons.js` (bullet pool + hitscan), `src/engine/combat/{localShot,damage,classifier}.js`, `src/engine/physics/bodies.js` (collider geometry), `src/bots.js` (`_syncBot` collider/mesh sync + LOD), `src/lod.js` (LOD thresholds), `src/engine/entities/botSim.js` (SP bot AI/movement), `src/engine/entities/botNetState.js` (MP interpolation — not the SP path).
- **Start with §5 (dt clamp)** — it's the cheapest fix + likely explains both §3 and §4.
- **Then §3.1 (LOD hysteresis)** — cheap, high-confidence fix for the pop-in.
- §1/§2 (hit registration) are harder; verify per-bone colliders are live + synced in SP before deeper changes.
