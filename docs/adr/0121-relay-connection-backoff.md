# ADR-0121: Relay connection back-off (fail-streak cool-down)

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** chiefmonkey
- **Related:** ADR-0081 (single unified relay list), ADR-0094 (server always-on presence beacon), ADR-0120 (node-owned relay as primary event home); files `src/engine/telemetry/relayHealth.js`, `src/nostr.js`

## Context

Every relay interaction `relayReq`/`publishEvent` opens a fresh `WebSocket` per call
(there is no connection pool — ADR-0081's unified list is fanned out with a retry).
The presence scan runs every 10s and the handshake/beacon every 2s, so a relay that is
unreachable *for this client* is re-attempted constantly. Each doomed attempt makes the
browser's native `WebSocket` constructor emit a `WebSocket connection to 'wss://…' failed`
console line — this is emitted by the runtime, not by game code, so no amount of in-code
log filtering can suppress it.

The operator reproduced this live (v0.2.874-alpha, 2026-09-20): a firewall/network path
blocked `wss://relay.damus.io` *on the operator's machine only* (the same relay opened
clean in a neutral sandbox probe on 2026-09-02, and was WRITE-verified). The console was
spammed with damus.io connection failures while the relay stayed healthy for everyone else.

Meanwhile, a related directory defect was also live: the gateway directory's owner-name
enrichment (ADR-0119) cached a null/empty kind:0 lookup for the full 10-min TTL, and the
open directory screen snapshotted once and never re-rendered — so a world whose owner
name resolved a few seconds after the first cold scan stayed frozen on its serial.

## Decision

For relay connections, implement fail-streak "cool-down" back-off: a relay that fails to
open `RELAY_BACKOFF_FAIL_STREAK` (3) times in a row is skipped — *without constructing a
WebSocket* — for `RELAY_BACKOFF_COOLDOWN_MS` (60s). A successful open resets the streak to
zero, so a recovered relay stops cooling down automatically.

Keep `wss://relay.damus.io` (and every other relay) in `DEFAULT_NODE_RELAYS` unchanged —
the relay is healthy; it is only *this client's network path* that is blocked.

For the directory defect, cache a failed/missing owner-profile lookup with a short
negative TTL (30s) instead of the full 10-min TTL, and add an in-place `refreshGatewayScreen`
re-render so an already-open directory updates a row once its owner name resolves.

## Consequences

- **Enables:** a blocked/broken relay stops generating console spam after three failed
  opens, while remaining reachable for every client whose path is healthy; the gateway
  directory shows the owner's displayed name (`BitcoinBekka`) within ~a scan rather than
  pinning the serial for 10 minutes.
- **Forecloses:** nothing for well-behaved relays — a healthy relay never reaches the
  streak threshold. A genuinely-down relay is retried at most roughly once per minute
  instead of once per scan.
- **Trade-offs:** worst-case latency to re-discover a relay that flaps is one cooldown
  window (60s) rather than the next 2/10s scan. Accepted as a strict improvement over
  per-attempt spam for an unreachable relay.
- **Enforcement:** `isRelayCoolingDown` is exported and unit-tested
  (`tests/relay-health.test.js` — threshold, cooldown expiry, reset-on-success, custom
  overrides, URL validation); `refreshGatewayScreen` is unit-tested
  (`tests/gateway-screen-peek.test.js` — no-op-when-closed, in-place re-render, peek
  preservation, canTravel preservation). The back-off guard lives at the top of
  `relayReq`/`publishEvent`, before any socket is constructed.

## Alternatives considered

- **Remove `wss://relay.damus.io` from `DEFAULT_NODE_RELAYS`.** Rejected: the relay is
  write-verified and healthy; removing it would reduce reachability for every operator whose
  network path is fine, and it crosses the relay-list/CSP/installer sync surface
  (`nodeRelays`, `tools/csp.mjs`, `csp-relay-sync`, `v0.2.774-regression`, install scripts).
- **Suppress the console line in code.** Rejected: the warning is emitted by the browser's
  `WebSocket` constructor, not by game code; it cannot be filtered from inside the app.
- **Per-relay reconnection timers / a shared pool.** Rejected as larger than the defect:
  cool-down back-off is a minimal, self-healing change to the existing per-call telemetry
  (ADR-0081's `relayHealth` already records `failStreak`/`lastFail`).

## Notes

- The damus.io failure is operator-machine-specific (a neutral probe opened clean on
  2026-09-02); back-off keeps damus for everyone while silencing the operator's spam.
- Carries the directory fixes (negative-cache TTL + gateway re-render) as the same
  release (v0.2.875-alpha) because the operator's live repro surfaced all three together.