# ADR-0047: Rendered bot-position diagnostic — expose the client/server desync (v0.2.668-alpha)

- **Status:** Accepted (diagnostic deploy)
- **Date:** 2026-08-24
- **Decides:** Add the client's RENDERED bot positions (interpolated `pose.x/z`) to
  the ema `combat.lastSentShot` snapshot at shot time, so a miss ema can be diffed
  against the server `SHOT-RESOLVE` log's `cur=(x,z)`/`rew=(x,z)` to expose the
  client/server bot-position desync. No gameplay change.

## Context

ADR-0046 answered the camera-vs-muzzle question: in all 8 new ema, `usedAimRay=true`
and `sentOrigin` exactly equals `aimOrigin`, and the server `SHOT-RESOLVE` `o=(...)`
matches to the decimal. **The camera ray is sent, unaltered.** So the miss is NOT a
camera-vs-muzzle bug, and ADR-0046's "bot-only collider assist" branch is moot.

But the server log reveals the real problem. For the "shooting Grumpy next to box"
ema, the SAME camera ray (`o=(-7.53,3.06,-17.63)`, `d=(-0.32,-0.27,0.91)`):

- **Client** aim raycast hits a bot at **6.36m** → point ≈ `(-9.57, -11.84)`.
- **Server** says the nearest bot (Grumpy) is at `(-8.00, -9.68)` and the ray
  **misses by `bodyGap=1.68m`** (`headHorz=2.05m`, `headVert=-0.79m`).

The client has a bot collider sitting ~2.7m from where the server's Grumpy actually
is, and there is no server bot at that spot at all. That is why the client shows a
green reticle + "headshot" while the server records a clean miss.

### What is ruled out

- **Not** camera-vs-muzzle (ADR-0046 confirmed camera ray sent).
- **Not** a capsule-radius issue — a ~2m lateral miss cannot be fixed by widening a
  0.35m collider (consistent with ADR-0046's "why not widen" rejection).
- **Not** rewind timing — `viewLag = interpDelay(100ms) + oneWay(~128ms)`, so the
  server rewind lands at `client_now − 100ms`, exactly the client's render time. For
  the observed slow bots (0.61 m/s, `dxz=0.14`), that is a ~0.06m error, not ~2m.

### Candidate causes (unranked)

1. **Stale interpolation** — the `BOT_STATE` stream stalls, so `botNetState.sample()`
   keeps returning the newest old sample while the server's bot walks on; the client
   collider freezes, the server's bot does not.
2. **Phantom collider** — a bot died/despawned but its collider was not parked/removed,
   leaving a hit target where the server has no bot (matches the "disappearing bots"
   and "floating labels" notes).
3. **Missed snap on teleport** — a bot moved >3m and the client lerped instead of
   snapping (SNAP_DIST=3m).

## Decision

Instrument, do not guess. Capture the client's RENDERED bot positions at shot time
into `combat.lastSentShot.bots`, so a single miss ema gives a direct client-vs-server
diff per bot id.

```
combat.lastSentShot.bots: [
  { id, x, z, alive, hp },   // client's interpolated render pose (x/z rounded 2dp)
  ...
]
```

- `snapshotBotPositions(bots)` — a NEW pure function in
  `src/engine/combat/lastShotStore.js` (no three/Rapier/DOM), unit-testable in node.
  Maps each bot wrapper's `state` + `pos` (the interpolated `pose.x/z` synced in
  `bots.js` `_syncNetBot`) to `{id,x,z,alive,hp}`.
- `arenaRuntime.js` calls it in the `EV.SHOOT` handler and stores the result on the
  `sentDiag` (alongside the ADR-0046 vectors), right before `_mp.sendShot(shot)` — so
  the bot positions are temporally aligned with the shot.
- `toriiDebug.js` `getBotRenderStates` (ADR-0045) also gains `x`/`z` so the ema's
  `snapshot.bots` array (ema-write time) carries positions too, complementing the
  shot-time capture.

### How the next ema is read

For a miss ema, diff `combat.lastSentShot.bots` (client) against the server
`SHOT-RESOLVE` line for the same `clientTs` (`cur=(x,z)` / `rew=(x,z)`):

- If a bot id's client `x/z` differs from the server's `cur`/`rew` by ~1.5-3m →
  desync confirmed; the magnitude + direction tells us which cause (stale vs phantom
  vs missed-snap).
- If they MATCH but the shot still missed → the desync is not the cause; re-examine
  the collider geometry/raycast itself.

## Consequences

- 2 new tests (`snapshotBotPositions` maps + rounds; returns `[]`/nulls safely).
- No production behaviour change — diagnostic only; `bots` is only read from the ema.
- `lastSentShot` grows by one `bots` array (~5 bots × 5 fields — negligible).
- The ADR-0046 "bot-only collider assist" branch is superseded: the data points to a
  position desync, not a collider-radius shortfall. Do NOT implement the collider
  assist until the desync is confirmed/eliminated.
