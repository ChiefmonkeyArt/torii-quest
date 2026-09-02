# ADR-0049: WebSocket open/close + main-thread heartbeat diagnostic — split the BOT_STATE stall cause (v0.2.671-alpha)

- **Status:** Accepted (diagnostic deploy)
- **Date:** 2026-08-24
- **Decides:** Add a connection-lifecycle + main-thread-heartbeat diagnostic to the
  ema `combat.lastSentShot.conn`, so the next miss ema proves WHY the `BOT_STATE`
  stream stalls (ADR-0048) — the socket dropped, or the main thread froze. No
  gameplay change.

## Context

ADR-0048's ingest-rate diagnostic answered the *what*: at the moment of a miss, the
client had gone **4–7 seconds without receiving a single `BOT_STATE` message**
(`lastIngestAge` = 4301ms, 6896ms, 5970ms across three miss ema; one ema showed
44ms, proving the stall is intermittent). Bots move at 2.2 m/s, so 4–7s of stale
positions = 9–15m of drift — exactly the ~12m desync ADR-0047 measured.

The stream stalls **client-side** (the server broadcasts `BOT_STATE` at ~15Hz). Two
candidate causes remain, and they need different fixes:

1. **WebSocket drop/reconnect** — the socket dies and takes seconds to re-dial
   (backoff capped at 2s, but a failed dial or a NIP-42 re-auth prompt can stretch
   the gap). During the gap no `BOT_STATE` arrives.
2. **Main-thread freeze** — a long synchronous task / GC / render hitch blocks the
   event loop, so the `onmessage` handler (which drives `ingestBotState`) never runs
   even though the socket is healthy and messages are buffered.

Both produce the same `lastIngestAge >> 1s` signature, so ADR-0048 cannot tell them
apart. That is the missing piece.

## Decision

Instrument, do not guess. Add a pure `createConnectionDiagnostics(now)` factory
(`src/engine/diagnostics/connectionDiagnostics.js`) with two independent signals,
snapshotted at shot time into `combat.lastSentShot.conn`:

```
conn: {
  ws: {
    state,             // current WS_STATE (idle/connecting/authenticating/connected/closed)
    stateAge,          // ms in the current state
    connectAttempts,   // transport dials
    openCount,         // transport onopen
    closeCount,        // transport onclose
    reconnectCount,    // reconnect schedules
    lastCloseCode, lastCloseReason,
    lastCloseAge,      // ms since the last socket close (small ⇒ just dropped)
    lastOpenAge,       // ms since the last socket open
    connectedAge,      // ms since the protocol last reached CONNECTED
  },
  heartbeat: {
    lastGap,           // ms since the previous rAF tick
    maxGap,            // largest rAF gap seen (large ⇒ main thread froze)
    stallCount,        // rAF gaps > 250ms
  },
}
```

Wiring:

- `wsClient.js` emits `socket_connect` / `socket_open` / `socket_close` (transport
  level), alongside the existing `state` and `reconnect_scheduled` events.
- `multiplayerHost.js` fans those into `recordConnect` / `recordOpen` /
  `recordClose` / `recordReconnect` / `recordState`.
- `loop.js` calls `heartbeat()` at the top of each rAF tick, so the gap between
  ticks exposes a main-thread freeze.
- `arenaRuntime.js` captures `getConnectionDiagnostic()` into `sentDiag.conn` at
  shot time (same monotonic `performance.now` clock as `botNet`).

## Read plan (how to interpret the next ema)

At a miss where `botNet.lastIngestAge >> 1s`:

- **`ws.lastCloseAge` small** (≈ the stall length) → the socket dropped and
  re-dialed. Fix the reconnect path (backoff, re-auth, keepalive).
- **`heartbeat.maxGap` large** (≈ the stall length) → the main thread froze. Find
  the blocking task (GC, a synchronous loop, a heavy render).
- **Neither** → the stall is elsewhere (e.g. the server's `players.length > 0`
  gate dropping the sole player while in Kami Mode) — the next diagnostic.

## Consequences

- Adds one pure module + 9 tests; no gameplay change.
- `conn` rides the existing `lastSentShot` ema payload, so no protocol change.
