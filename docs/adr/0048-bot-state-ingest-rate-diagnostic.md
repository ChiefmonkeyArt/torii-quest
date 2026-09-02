# ADR-0048: BOT_STATE ingest-rate diagnostic — find why client bots are ~12m stale (v0.2.670-alpha)

- **Status:** Accepted (diagnostic deploy)
- **Date:** 2026-08-24
- **Decides:** Add an ingest-rate + per-bot sample-age diagnostic to the ema
  `combat.lastSentShot`, so the next miss ema proves whether the client is
  RECEIVING `BOT_STATE` updates (and the stream is flowing) or the stream has
  stalled — the open question behind the ~12m bot-position desync. No gameplay
  change.

## Context

ADR-0047's rendered-position diagnostic quantified the desync: the client's bots
are ~12m stale relative to the server (e.g. Happy: client `(15.2, 2.94)` vs server
`(3.62, -1.82)`, ~5-10s of bot movement). The server broadcasts `BOT_STATE` at
~15Hz (`BOT_STATE_MS=66`), so the stall is client-side. Two candidate causes:

1. **The client is not receiving `BOT_STATE`** — the stream stalls (network,
   reconnect, or the server's `players.length > 0` gate dropping the sole player
   while in Kami Mode), so `botNetState.sample()` keeps returning the newest old
   sample and the bots freeze.
2. **The client receives updates but fails to apply them** — a bug in
   `ingest`/`sample`/interpolation leaves the render pose stuck even though fresh
   samples arrive.

The existing `lastSentShot.bots` (ADR-0047) shows WHERE the client renders bots,
but not WHETHER the client is still receiving updates. That is the missing piece.

## Decision

Instrument, do not guess. Add a `diagnose(nowMs)` method to the pure
`botNetState` factory that reports, at the moment of the shot:

```
combat.lastSentShot.botNet: {
  ingestCount,      // total BOT_STATE arrays ingested
  lastIngestAge,    // ms since the last ingest (~66ms ⇒ flowing @15Hz; >>1s ⇒ stalled)
  bots: [{ id, sampleCount, newestAge, oldestAge }]  // per-bot sample freshness
}
```

- `botNetState.js` now tracks `_ingestCount` + `_lastIngestAt` on every `ingest`,
  and exposes `diagnose(nowMs)` (pure, unit-testable). `nowMs` is the SAME
  monotonic clock (`performance.now`) that stamps samples, so ages are comparable.
- `bots.js` exposes `getBotNetDiagnostic()` → `_botNet.diagnose(_nowMs())`.
- `arenaRuntime.js` captures it in the `EV.SHOOT` handler (alongside ADR-0047's
  `bots`) and stores it on `sentDiag.botNet`, right before `_mp.sendShot(shot)` —
  so the ingest state is temporally aligned with the shot, NOT with ema-write time
  (which would be confounded by Kami Mode pausing the broadcast).

### How the next ema is read

- `lastIngestAge` ~66ms ⇒ the stream is flowing; the desync is in the client's
  interpolation/apply path (cause 2).
- `lastIngestAge` >> 1s ⇒ the stream stalled (cause 1) — then correlate with the
  server's `players.length > 0` gate and any reconnect in the session.
- Per-bot `newestAge`: if one bot's `newestAge` is ~10s while others are ~100ms,
  that bot's samples stopped advancing while the rest flowed — a per-bot stall.

## Consequences

- 3 new tests (`diagnose` reports counts/ages; large `lastIngestAge` on stall;
  nulls before first ingest). Full suite green.
- No production behaviour change — diagnostic only; `botNet` is only read from the
  ema snapshot.
- `lastSentShot` grows by one `botNet` object (~5 bots × 3 fields — negligible).
