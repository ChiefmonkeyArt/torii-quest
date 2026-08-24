# ADR-0051: Wrap the pointer-lock yaw to [-π, π] before it reaches the wire (v0.2.673-alpha)

- **Status:** Accepted (bug fix)
- **Date:** 2026-08-24
- **Decides:** Normalise the player's yaw angle to [-π, π] on read (`getYaw()`), so the
  `MOVE` message's `rot` field never exceeds the server's `ROT_ABS = 2π` bound. This
  stops the server from rejecting the client's movement messages with `BAD_FIELD`
  after a full 360° turn.

## Context

While verifying ADR-0050 live, the server log showed a flood of rejections:

```
[arena-ws] bad message from 15fde4a6d559da238f7e7502 BAD_FIELD
```

0 occurrences before the ADR-0050 deploy, 1656 in the ~10 minutes after — roughly
18/second, i.e. **every** throttled `MOVE` message. The client was moving and shooting
normally (the `SHOT-RESOLVE` log showed valid origins and working hit detection), but
its movement was being silently dropped by the server.

The cause is in `src/input.js`. The pointer-lock yaw accumulates without bound:

```js
_yaw -= e.movementX * SENS;   // never wrapped
```

`_pitch` is clamped to ±π/2.1 in the same handler, but `_yaw` is not wrapped, so after
a full 360° turn it exceeds 2π. The server's `isRot2` check rejects any `|rot| > 2π`:

```js
ROT_ABS: Math.PI * 2,   // wireProtocol.js
const isRot2 = (v) => v.every((n) => isFiniteNum(n) && Math.abs(n) <= LIMITS.ROT_ABS);
```

`playerObj.rotation.y = getYaw()` (player.js) is the unwrapped value, and the `MOVE`
send (`arenaRuntime.js`) forwards it verbatim as `rot: [playerObj.rotation.y, 0]`. Once
the player spins past 2π, every subsequent `MOVE` is rejected until the yaw drifts back
in range — so the server stops tracking the player's position for the rest of the
session. It is a pre-existing bug (the accumulation code predates ADR-0050); the extra
turning during post-fix testing simply triggered it.

## Decision

Normalise on read rather than mutate the accumulator. Add a pure `wrapAngle` helper to
`src/input.js` and apply it in `getYaw()`:

```js
export function wrapAngle(a) {
  const TAU = Math.PI * 2;
  a = a % TAU;
  if (a > Math.PI) a -= TAU;
  if (a < -Math.PI) a += TAU;
  return a;
}
export function getYaw() { return wrapAngle(_yaw); }
```

The internal `_yaw` stays continuous (so mouse-look never snaps), while every consumer
— `MOVE` rot, the ema's stored yaw, and the fly camera — sees a wrapped value. Sine and
cosine are periodic, so wrapping is visually identical; no consumer relied on the
unwrapped value.

## Consequences

- `MOVE` messages are accepted again after any number of full turns; the server keeps
  tracking the player's position.
- No protocol change; the server's strict `ROT_ABS` validation is preserved.
- Adds 6 tests (`tests/input-yaw-wrap.test.js`) covering `wrapAngle` boundaries, many
  full turns, and `getYaw`/`setYaw` round-tripping.
- The `BAD_FIELD` log spam (1656 rejections) disappears.
