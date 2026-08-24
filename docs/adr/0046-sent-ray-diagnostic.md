# ADR-0046: Sent-ray diagnostic — prove camera-vs-muzzle on miss (v0.2.667-alpha)

- **Status:** Accepted (diagnostic deploy)
- **Date:** 2026-08-24
- **Decides:** Add a `sent` field to the ema `lastShot` recording the ACTUAL
  `buildShotPayload` output that went to the server, so the next ema proves
  whether the camera aim ray or the muzzle ray was sent — the open question in
  the bot "can't hit anything" investigation. No gameplay change.

## Context

v0.2.666 ema + server `SHOT-RESOLVE` log proved bots render fine (models
loaded, scale 1) and the server applies damage correctly when a ray hits. The
"can't hit anything" symptom is real: on-target shots at STATIONARY bots
(dxz=0.00 → NOT a rewind/lag-comp issue) miss by `bodyGap=0.46-0.53m`. That is
the miss BEYOND the 0.35m capsule radius, so the ray passes 0.81-0.88m from the
capsule axis.

The ema `lastShot.aim.kind='bot'` says the camera crosshair ray hit a bot mesh,
but the shot missed. Two candidate root causes:

1. **Server receives the MUZZLE ray, not the camera ray.** The barrel is offset
   from the camera by ~0.5m (parallax); the muzzle ray diverges from the
   crosshair ray by ~0.5m at close range → the 0.47m miss.
2. **Server receives the camera ray, but the body capsule (0.35m) is smaller
   than the visual mesh** — the crosshair lands on an arm/shoulder/edge but the
   torso capsule is 0.8m away → miss.

### What the code already says

- `player.js:355` is the ONLY emitter of `EV.SHOOT`, always passing
  `aimOrigin: _camPos` (camera world position) + `aimDir: _camFwd` (camera
  world direction).
- `peerCombat.buildShotPayload` does `o = aimOrigin || origin; d = aimDir || dir`
  → it PREFERS the camera ray.
- The existing test `tests/multiplayer/peer-combat.test.js:40` already proves
  `buildShotPayload` sends `aimOrigin/aimDir` when present.

So by the code, the camera ray SHOULD be sent. But the server `originY`
(2.46-2.57m) is ambiguous between the barrel (below the ~2.59m eye) and the
camera. The ema `lastShot.origin/dir` records the BULLET line (muzzle), not what
was actually sent to the server — so it cannot settle camera-vs-muzzle.

### Why not widen the capsule (rejected)

The advisor flagged an arithmetic error in an earlier proposal: `bodyGap=0.46m`
is the miss BEYOND the 0.35m radius, so catching those shots by radius alone
needs ~+0.53m forgiveness (effective radius 0.88m) — absurd for a dwarf bot. A
+0.25m forgiveness (effective 0.60m) would not even catch the observed misses.
So hitbox widening is the wrong fix until the ray path is confirmed.

## Decision

Instrument, do not guess. Expose the ACTUAL `buildShotPayload` output as a
**source-of-truth** diagnostic `combat.lastSentShot` in the ema snapshot, with
full muzzle/aim vectors + which ray was used:

```
combat.lastSentShot: {
  ts, viewLag,
  usedAimRay: !!(aimOrigin && aimDir),  // camera ray preferred? (false = muzzle)
  sentOrigin: [x,y,z],                 // what the server received as origin
  sentDir: [x,y,z],                   // what the server received as direction
  muzzleOrigin: [x,y,z],              // bullet-line origin (barrel)
  muzzleDir: [x,y,z],
  aimOrigin: [x,y,z] | null,           // camera origin (eye)
  aimDir: [x,y,z] | null,
}
```

`lastSentShot` is independent of `lastShot` (which is only created inside
`recordPlayerShot` — itself gated on `aimOrigin && aimDir` in arenaRuntime, so
in the `usedAimRay=false` failure case there is NO fresh `lastShot` to stamp
`sent` onto). Writing the diagnostic to its own `_lastSentShot` slot guarantees
it is never stale in exactly the failure case we want to see. For backwards
compat, `lastShot.sent` is still stamped when a `lastShot` exists, but it is a
CONVENIENCE only — the camera-vs-muzzle decision must read `lastSentShot`.

Populated by `setLastSentShot()` + `setLastShotSent()` in `arenaRuntime.js` after
`buildShotPayload` succeeds, right before `_mp.sendShot(shot)`. This resolves
the open question:

- If `usedAimRay=true` AND `sentOrigin ≈ aimOrigin` → camera ray sent → the
  capsule/collider is the issue → implement a **bot-only** collider assist (head
  test first, body test second, bot-only assist third, never peers, preserve
  "1 headshot = kill").
- If `usedAimRay=false` → muzzle ray sent (aimOrigin falsy at runtime despite
  being emitted) → fix the aimOrigin passing. Do NOT widen anything.

The server `SHOT-RESOLVE` log now records rounded origin/dir vectors + the
existing `clientTs=${shotMsg.ts}`, so the ema's `lastSentShot.ts` +
`sentOrigin/sentDir` can be matched numerically against exactly what the server
received for the same shot — confirming the payload wasn't altered in transit.

### Refactor: pure lastShotStore

`weapons.js` pulls in `scene.js` → `WebGLRenderer`, so it cannot be imported in
a node vitest run. Extracted the lastShot store into a pure module
`src/engine/combat/lastShotStore.js` (no three/Rapier/DOM) so `setLastShotSent`
is unit-testable. `weapons.js` imports + re-exports `getLastShot`, `getLastMiss`,
`setLastShotSent`, `getLastSentShot`, `setLastSentShot` so every existing
`from './weapons.js'` import site (`arenaRuntime`, `ToriiDebug`) keeps working
unchanged.

## Consequences

- 2 new tests (`setLastShotSent` stamps the sent payload; records
  `usedAimRay=false` when the muzzle ray is sent). 3217 full suite green.
- No production behaviour change — diagnostic only. The `sent` field is only
  read from the ema snapshot, never gates combat.
- The v0.2.662 `[BOT-DMG]` diagnostic log in `applyBotDamage` is retained for
  one more cycle to cross-reference with the new `sent` data.
- The ema POST RETRY issue (ema didn't reach VPS while flying) is separate +
  still pending.
