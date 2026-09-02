# ADR-0053: Filter stale and handshake records from the gateway directory (v0.2.676-alpha)

- **Status:** Accepted
- **Date:** 2026-08-24
- **Decides:** The gateway directory (`readGateways`) must only ever surface LIVE world
  presence records. It now drops (a) travel handshake events and (b) expired/stale
  presence events before they reach the travel-preview list.

## Context

The gateway panel listed "worlds online" that were clearly not online. A live relay
scan showed **48 records**, every one of them **38–56 days old**, and none carrying an
expiration. Two distinct problems:

1. **Handshake noise.** Travel request/response events (`travelRequest.js`) reuse the
   same `kind:30078` + `torii-gateway` topic as presence records, so `readGateways`
   was treating `req-*`/`res-*` handshake events as if they were worlds.
2. **No liveness.** `readGateways` deduped by address key but never checked the NIP-40
   `expiration` tag. Pre-NIP-40 presence events (published before Phase 0d added
   expiration) carry no expiration at all, so they never drop.

The result was a directory full of dead entries, burying any genuinely live instance
(including the user's own and a friend's).

## Decision

Add a liveness gate to the read path:

- A record is a **handshake** (not presence) when it carries a `state` tag
  (`request`/`accepted`/`denied`) — dropped.
- A record is **expired** when its `expiration` tag is in the past — dropped.
- A record with **no expiration tag** falls back to a grace window
  (`PRESENCE_GRACE_SEC = 3600`, 1 hour) — older records are dropped, so pre-NIP-40
  events can't linger forever.

`readGateways` gains a `nowSec` option (defaults to `Date.now()/1000`) so the gate is
deterministic and unit-testable; `fetchOnlineWorlds` threads it through. The result
report gains a `stale` counter.

## Consequences

- The directory now only lists live worlds (1–2 in practice), so a friend's instance
  is immediately visible instead of buried under 48 dead rows.
- 5 new tests in `tests/gateway-read.test.js` cover expired / handshake / stale /
  live / recent cases; existing read tests pin `nowSec` to keep the frozen demo sample
  "live".
- No change to presence publishing — events already carry NIP-40 expiration by default
  (ADR-0052-era `buildPresenceEvent`); this only fixes the read side.
