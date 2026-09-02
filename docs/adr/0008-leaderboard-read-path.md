# ADR-0008: Leaderboard reads only `kind:30078#d=torii-quest` + `kind:1#t=torii-quest-score`

- **Status:** Accepted
- **Date:** 2026-08-21
- **Deciders:** chiefmonkey
- **Related:** `src/engine/multiplayer/leaderboardAgg.js`,
  `src/engine/multiplayer/scoreReporter.js`,
  `tools/regression-check.mjs` (rule #20)

## Context

Torii Quest publishes match scores to Nostr relays so anyone can read
the leaderboard without a bespoke backend. Two event shapes serve
different purposes:

- **Current standing** — one row per pubkey, replaceable, always the
  latest value.
- **Lifetime history** — one immutable event per match, so aggregates
  can be recomputed independently.

If reader logic accepted more event kinds, the leaderboard would become
an attack surface (a malicious relay could inject arbitrary events and
poison rankings).

## Decision

The leaderboard reader consumes exactly two event shapes:

1. **Current snapshot** — `kind:30078` (NIP-33 parameterised replaceable)
   with `d`-tag `torii-quest`. One per pubkey; if duplicates arrive,
   keep the newest by `created_at`.
2. **Lifetime aggregate** — `kind:1` with `t`-tag `torii-quest-score`.
   Deduplicate by `(pubkey, sessionId)`. Aggregated for lifetime totals.
3. **Fallback** — if no `kind:1` history exists for a pubkey, use the
   `kind:30078` snapshot as the aggregate.

The publisher (`scoreReporter.js`) writes both shapes: `kind:30078` for
the current row and a parallel `kind:1` for history.

No other kinds are read. No other tags are trusted.

## Consequences

- **Enables:** leaderboard is verifiable from any relay; the reader is
  a small, auditable filter.
- **Forecloses:** using arbitrary event kinds for score data; any new
  score-related event kind needs an ADR update.
- **Trade-offs:** the reader must handle both shapes and their fallback;
  this is centralised in `leaderboardAgg.js`.
- **Enforcement:** `tools/regression-check.mjs` rule #20 fails if the
  read path references any other kind or tag combination.

## Alternatives considered

- **Custom relay + REST**: rejected — kills the "runs on any Nostr
  relay" property.
- **Kind:1 only**: rejected — needs full history scan for a current
  standings display; `kind:30078` is O(pubkeys).
- **A single new custom kind**: rejected — Nostr clients can already
  display `kind:1`, giving the game a viral posting surface.

## Notes

`SCORE_FRAME` on the event bus (`EV.SCORE_FRAME`) carries server-
authoritative SCORE frames into the client; the leaderboard reader is
separate and consumes Nostr events, not bus events. Both feed the
same display.
