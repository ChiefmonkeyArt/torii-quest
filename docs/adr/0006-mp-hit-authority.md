# ADR-0006: Server-authoritative HIT resolution — no client-HIT rebroadcast

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `server/arena-ws.js`, `src/engine/multiplayer/peerCombat.js`,
  `src/engine/multiplayer/wireProtocol.js`,
  `tools/regression-check.mjs` (rule #17)

## Context

In an early MP experiment, clients broadcast their own HIT frames and the
server relayed them. Cheat vectors were trivial (a client could claim
damage it did not deal), and reconciliation between shooter POV and
victim POV drifted. Trust must live somewhere; naïve client trust makes
the leaderboard meaningless.

## Decision

The **server** is the authority for HIT resolution:

1. Clients send SHOT frames describing what they saw (origin, dir,
   shotTs, claimed target).
2. The server runs `resolveAndBroadcast(shooter, shotMsg)` in
   `server/arena-ws.js`, performing its own hit-registration with
   lag compensation (`LAG_COMP_MS`).
3. Only the server emits authoritative HIT frames via `broadcastToAll`.
4. Clients treat inbound HIT frames as authoritative — they never
   re-broadcast client-computed HITs.

Ancillary advisory frames may travel (e.g. immediate `BOT_HIT` cues for
tracer/flinch), but they never enter the damage ledger. The ledger
consumes only server HIT frames.

## Consequences

- **Enables:** the leaderboard reflects a single verified source of
  truth; anti-cheat has a well-defined surface (the server); lag
  compensation is centralised.
- **Forecloses:** any code path that rebroadcasts a client-claimed HIT
  as authoritative. Client HITs are advisory only.
- **Trade-offs:** perceived latency between shooter POV and confirmed
  HIT is bounded by RTT + `LAG_COMP_MS`. We accept this for integrity.
- **Enforcement:** `tools/regression-check.mjs` rule #17 fails if the
  code path allows a client-HIT to be rebroadcast; asserts
  `resolveAndBroadcast` emits server HIT via `broadcastToAll`.

## Alternatives considered

- **Trusting clients**: rejected — trivially cheatable.
- **Deterministic lockstep**: rejected — over-engineering for a fast
  shooter with independent per-player physics.

## Notes

`PROTOCOL_VERSION = 1`. Additive fields on `PROTOCOL_VERSION=1` are
allowed (ADR-0007's parity concerns aside); a breaking wire change must
increment `PROTOCOL_VERSION` and land in a new ADR.
