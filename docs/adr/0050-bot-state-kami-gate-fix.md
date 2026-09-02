# ADR-0050: Decouple BOT_STATE broadcast from the Kami Mode roster gate (v0.2.672-alpha)

- **Status:** Accepted (bug fix)
- **Date:** 2026-08-24
- **Decides:** Stop the server from silencing `BOT_STATE` when the sole player is in
  Kami Mode. The bot-brain roster still excludes Kami Mode sessions (bots ignore the
  admin), but the broadcast gate now keys off the authed-session count, not the
  roster length. This is the root-cause fix for the ~12m bot-position desync and the
  "bots won't die" symptom.

## Context

ADR-0048 proved the client's `BOT_STATE` stream stalls (`lastIngestAge` 4–7s at shot
time). ADR-0049 exonerated the client: the WebSocket never dropped (`closeCount=0`)
and the main thread never froze (`heartbeat.maxGap` 2.8s one-time, `lastGap` 5–12ms
at shot time). The stall is server-side.

The server's bot loop broadcast `BOT_STATE` only when `players.length > 0`, and the
`players` array **excluded Kami Mode sessions** (ADR-0032, "bots ignore the admin"):

```js
if (isKamiActive(sess)) continue;   // Kami Mode player dropped from the roster
players.push(...);
...
if (players.length > 0 && ...) { broadcastToAll({ t: MSG.BOT_STATE, ... }); }
```

So when the owner (the only session) entered Kami Mode to hang an ema, `players.length`
dropped to 0 and the server went silent for the whole Kami Mode session. The client's
bots froze; on exit the player aimed at stale positions (bots move 2.2 m/s, so 4–7s
= 9–15m of drift — matching the ~12m desync ADR-0047 measured).

## Decision

Decouple the two concerns. Extract the per-tick roster build and the broadcast
decision into a pure, testable module (`server/bots/botStateGate.js`):

- `buildBotTickRoster(sessions, deps)` returns `{ players, authedCount }`:
  - `authedCount` counts **every** authed session (Kami Mode or not).
  - `players` is the bot-brain roster and still **excludes** Kami Mode sessions, so
    "bots ignore the admin" is unchanged.
- `shouldBroadcastBotState({ authedCount, now, lastAt, botStateMs })` gates the
  broadcast on `authedCount > 0` (not `players.length > 0`).

`arena-ws.js` now calls these instead of the inline loop. Bots still ignore the admin
in Kami Mode; the `BOT_STATE` stream simply keeps flowing so the client never goes
stale.

## Consequences

- Fixes the desync at the source (no more client-side workarounds needed).
- No protocol change; `BOT_STATE` payload is unchanged.
- Adds 10 tests (`tests/multiplayer/bot-state-gate.test.js`) covering the roster/gate
  split and the throttle.
- The ADR-0048/0049 diagnostics (`botNet`, `conn`) remain in place to confirm the fix
  live: after this deploy, `lastIngestAge` should stay ~66ms even across Kami Mode.
