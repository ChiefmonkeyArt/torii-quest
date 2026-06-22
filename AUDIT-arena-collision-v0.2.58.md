# Arena collision audit — v0.2.58-alpha

**Scope**: `src/physics.js`, `src/arena.js`, `src/config.js`, with cross-checks against `src/player.js`, `src/bots.js`, and `src/weapons.js`.

**Headline**: the arena is **mostly solid**, but `physics.js` is dead code. All player/bot/bullet collision runs on hand-rolled JS that reads from the same `config.js` tables `arena.js` builds visuals from. The visual-vs-collision boundary is consistent for the player against walls/crates/obstacles, but there are five real discrepancies worth fixing before the next combat test.

---

## 1. `physics.js` is wired up but never queried

`physics.js` initialises a Rapier 3D world, builds static colliders, and steps every frame, but **no code reads back from it**:

- `main.js` calls `initPhysics()` then `buildArenaColliders(ARENA_HALF, WALL_H)` and ticks `stepPhysics()` each frame.
- `player.js` calls `createKinematic()` for the player and writes `setNextKinematicTranslation()` after the manual XZ clamp + AABB pushout in `player.js:108-158`.
- Nothing reads Rapier intersections, raycasts, or contact events. Bots have no Rapier body at all.

Therefore the Rapier `buildArenaColliders` colliders **do not contribute to gameplay**. The "collision flag enabled" check is moot — Rapier never decides what's solid.

Recommendation: either gut `physics.js` (and the import from `main.js`/`player.js`) or actually replace the manual AABB system with Rapier queries. Today it's overhead with no value.

## 2. `physics.js` wall heights match `WALL_H = 2.6`, but the wall list is **incomplete**

`physics.js:38-46` (the dead code, for completeness):

| Collider | hw | hh | hd | x | y | z | Notes |
|---|---|---|---|---|---|---|---|
| Floor | ARENA_HALF | 0.1 | ARENA_HALF | 0 | -0.1 | 0 | OK |
| North wall | ARENA_HALF+0.3 | WALL_H/2 (=1.3) | 0.25 | 0 | 1.3 | -ARENA_HALF | full height, no gap | 
| South wall | ARENA_HALF+0.3 | 1.3 | 0.25 | 0 | 1.3 | ARENA_HALF | full height, no gap |
| West wall | 0.25 | 1.3 | ARENA_HALF+0.3 | -ARENA_HALF | 1.3 | 0 | full height, no gap |
| **East wall** | **0.25** | **1.3** | **ARENA_HALF+0.3** | **ARENA_HALF** | **1.3** | **0** | **WRONG — solid, no torii gap** |
| 7 cover crates | 0.75 | 0.75 | 0.75 | various | 0.5–1.0 | various | hardcoded — see #5 |

Heights derive from `WALL_H = 2.6`, so they do hit the 2.6 m target. **But** the east wall here is a single solid box across the entire east edge — the torii gap is missing. If you ever did read Rapier back, players couldn't walk through the gate.

## 3. Visual walls (arena.js) vs collidable walls (config.js OBSTACLES) — now consistent

`arena.js:84-128` builds 5 wall boxes from `WALL_H` and `EAST_GAP_HALF`:

| Visual wall | Position (x,z) | Footprint (w×d) | Height |
|---|---|---|---|
| North | (0, -20) | 40.5 × 0.5 | 2.6 |
| South | (0, 20) | 40.5 × 0.5 | 2.6 |
| West | (-20, 0) | 0.5 × 40.5 | 2.6 |
| East-north | (20, -11.7) | 0.5 × 16.6 | 2.6 |
| East-south | (20, 11.7) | 0.5 × 16.6 | 2.6 |

`config.js:71-78` collidable OBSTACLES on the east side:

| Obstacle | (cx, cz) | (hw, hd) | fullH |
|---|---|---|---|
| Bonsai trunk | (26, 0) | 0.55, 0.55 | 4.4 |
| Torii pillar N | (20, -3.0) | 0.4, 0.4 | 2.86 (WALL_H × 1.1) |
| Torii pillar S | (20, 3.0) | 0.4, 0.4 | 2.86 |
| East-north wall seg | (20, -11.7) | 0.25, 8.3 | 2.6 |
| East-south wall seg | (20, 11.7) | 0.25, 8.3 | 2.6 |

The east-wall obstacles match the east-wall visual meshes 1:1 in position, footprint, and height. **No discrepancy** for player collision against the east wall.

The **north/south/west walls are NOT in OBSTACLES** — they rely on the XZ clamp at `player.js:108-118` (`nx = Math.max(-ARENA_HALF + PR, nx)` etc.). This clamp is correct but only constrains the player. There is no per-axis pushout for those walls, so something moving with momentum will visually pop rather than slide. Functionally solid, mechanically inconsistent with the east wall.

## 4. Bots do NOT pushout against OBSTACLES

`bots.js:111` only iterates `CRATES`:

```js
for (const [cx, cz, hw, hd] of CRATES) {
```

`OBSTACLES` is never imported or used. Real consequences:

- Bots can walk through the bonsai trunk (visual + lore problem in the NAP zone — but bots aren't supposed to enter NAP, so moot in practice).
- Bots can walk through the torii pillars (cosmetic — pillars are at z=±3 just inside the gap, bots are blocked from leaving the arena at NAP_X anyway, so they'd never hit the pillars in normal play).
- Bots can walk through the east-wall segments — but `bots.js:108-110` already clamps bots to `[-ARENA_HALF+BOT_R, ARENA_HALF-BOT_R]` on both axes, so this never triggers either.

Verdict: **latent inconsistency, currently unreachable**. If bots are ever allowed to follow the player into NAP, this becomes a real bug.

## 5. Bullet wall sweep ignores wall height

`weapons.js:101-118` sweeps the bullet segment against the four arena planes (with the east-gap exception). It checks XZ position but **never checks `y` against `WALL_H`**. A bullet arcing above the 2.6 m wall registers as a wall hit at the wall's XZ plane.

At `BULLET_SPEED = 60` m/s with `GRAVITY = -25` … bullets in this game are not actually subject to gravity (see `weapons.js` integrator — they travel in straight lines). So the practical impact is small: a high-pitched shot only hits the wall if the bullet line would pierce that plane anyway. But the sweep mathematically treats the walls as infinitely tall, while the visuals top out at 2.6 m. Bullets fired from a crate top at a steep angle, or from the NAP zone aiming back over the wall, will hit invisible geometry.

Suggested fix: in `sweepWalls`, after computing `hy = p0.y + (p1.y - p0.y) * t`, reject the hit when `hy > WALL_H`.

## 6. Other inconsistencies worth noting

- **`config.js:2`**: `VERSION = 'v0.2.54-alpha'` is stale. Display strings now live in `index.html` (currently v0.2.58-alpha), but if anything ever reads the exported `VERSION` it'll show a four-version-old number. Either delete the export or keep it in lockstep.
- **`physics.js:46`**: Rapier cover crates are hardcoded with a different set than `config.js CRATES` — only 7 boxes, no overlap of geometry with the actual 9-crate `CRATES` table. Another reason to delete the dead Rapier code.
- **`OBSTACLES` torii-pillar height is `WALL_H * 1.1` = 2.86**. The torii GLB itself is much taller, but the pillar collider only needs to block at player height (≤ 1.7 m eye). Fine for now; just flagging that the magic 1.1 was sized against the old WALL_H=3.52 (= 3.87 m pillar) and got shortened to 2.86 along with the wall reduction. If you ever want pillars taller than the wall, switch to a hardcoded value.
- **Corner pillars (arena.js:120-127)** are 0.8 × 0.8 × (WALL_H+0.5) = 3.1 m tall visual meshes with **no collider** in either CRATES, OBSTACLES, or physics.js. The XZ clamp keeps the player away from the arena corner XZ, so they can't physically enter the pillar — but a bullet can pass right through them visually.

---

## Quick checklist for the next combat test

| Check | Result |
|---|---|
| `WALL_H = 2.6` everywhere it's read | ✅ (arena.js, OBSTACLES east-wall segs, weapons.js bullet kill height, physics.js dead code) |
| Every visual wall has a matching collidable boundary for the **player** | ✅ (east-wall via OBSTACLES, others via XZ clamp) |
| East wall is solid from both sides | ✅ (fixed v0.2.57) |
| Torii pillars block player ingress at the gate | ✅ |
| Bots collide with OBSTACLES | ❌ — bots only check CRATES (currently moot) |
| Bullets respect wall height | ❌ — `sweepWalls` is wall-plane-infinite-Y |
| Rapier world contributes to gameplay | ❌ — dead code |
| Corner pillars have colliders | ❌ — visual only |
| `config.js VERSION` matches live | ❌ — stale at v0.2.54-alpha |

**Bottom line for combat test**: the arena IS solid from the player's perspective. The remaining items are either dead code (Rapier), cosmetic (bullets-over-wall, corner pillars), or latent-but-unreachable (bots vs OBSTACLES) — none of them will let a player escape the arena or fall through the floor mid-fight.
