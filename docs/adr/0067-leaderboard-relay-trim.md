# ADR-0067: Trim broken Nostr relays from the gamestr leaderboard and profile-read sets

- **Status**: Accepted
- **Date**: 2026-08-26
- **Deciders**: chiefmonkey (maintainer), Perplexity Computer (agent)
- **Related**: Builds on the Phase 0f/0h gamestr work (`gamestrScore.js`, `gamestrLeaderboard.js`, `gamestrPublisher.js`). No relay-client code changes — only the relay URL lists and the CSP `connect-src` that gates them.

## Context

The maintainer noticed repeated browser-console WebSocket errors while
playtesting and asked whether to keep the current default relay set or switch
to friendlier ones:

> "judging by the web console when inspecting the game we have seen many times
> that relays such as relay.Damus.io, relay.nostr.band and relay.Primal all
> return connection errors... do we persist with these or find friendly
> relays... we can use whatever relay plebeian.market has... also does
> torii.quest have a relay?"

Uploaded console captures confirmed the exact errors:

```
torii-entry.js?v=mt8vvvm1:2 WebSocket connection to 'wss://relay.damus.io/' failed:
torii-entry.js?v=mt8vvvm1:2 WebSocket connection to 'wss://relay.nostr.band/' failed: WebSocket is closed before the connection is established.
```

Before touching any code, every relay in the four source-of-truth lists was
tested empirically — not guessed — by opening a real WebSocket and sending the
exact REQ the game sends, from both the sandbox network and the production VPS
(`23.182.128.118`).

### Test 1 — leaderboard read (`kind: 30762, #game: ['torii-quest']`, the exact query `_refreshGamestrScores()` in `src/main.js` sends over `GAMESTR_RELAYS`)

| Relay | Result |
|---|---|
| `wss://main.relay.gamestr.io` | **OK — 5 events**, ~600–1038ms |
| `wss://relay.nostr.band` | **TIMEOUT**, 8s, both networks — relay is down |
| `wss://relay.damus.io` | **503 Service Unavailable** on this exact REQ |
| `wss://relay.primal.net` | **NOTICE: "ERROR: bad req: unindexed tag filter"** — rejects `#game` |
| `wss://nos.lol` | Connects, 0 events (doesn't index `#game` either, but no error) |
| `wss://relay.plebeian.market` | Connects, 0 events (marketplace relay, no leaderboard data — expected) |

Six additional "reliable" public relays (`relay.nostr.net`, `nostr.oxtr.dev`,
`nostr.bitcoiner.social`, `relay.snort.social`, `nostr.mom`, `nostrue.com`)
were also tried against the same tag-filtered query: all six either timed out
or returned 500/503. General-purpose public relays are not a good fit for
gamestr's parameterized leaderboard reads.

### Test 2 — profile read (`kind: 0`, a known author, the query `nostr.js` sends over `RELAYS`)

| Relay | Result |
|---|---|
| `wss://relay.damus.io` | OK — 1 event, ~280ms |
| `wss://nos.lol` | OK — 1 event, ~470ms |
| `wss://relay.primal.net` | Connects, 0 events |
| `wss://relay.nostr.band` | TIMEOUT, 8s |

### `torii.quest`

Not the user's domain and not a relay. `torii.quest` / `relay.torii.quest` /
`nostr.torii.quest` all resolve to an unrelated IP range and fail SSL
handshake; public search shows the domain belongs to an "Abiotic Factor" DLC
portal world, unrelated to this project. No relay exists there. No strfry (or
any Nostr relay) process runs on the VPS today.

### gamestr.io

`gamestr.io` is a NIP-133-descended decentralized gaming-leaderboard protocol.
Its reference implementation (`github.com/nosdav/gamestr`) documents `kind
33334`; the live gamestr.io service actually uses `kind 30762` (an
addressable-replaceable event), which is what this codebase already targets
(`GAMESTR_KIND = 30762` in `gamestrScore.js`, predating this ADR). Its
authoritative relay, `wss://main.relay.gamestr.io`, is the only relay in the
current set that reliably serves this game's leaderboard reads.

## Decision

Trim, don't replace wholesale — keep only relays that empirically work for the
query each list is actually used for, and fix a latent CSP gap in the process.
Do **not** touch `PLEBEIAN_RELAYS` in `config.js` (still points at
`relay.staging.plebeian.market`): that's the marketplace auction reader's
concern, it currently targets a staging test auction, and switching it to
`relay.plebeian.market` (prod) is out of scope for a relay-connectivity fix and
could silently break the auction panel if the same auction doesn't exist on
prod. Self-hosting a strfry relay to become the sole authoritative leaderboard
source (removing the third-party dependency on gamestr.io entirely) is
deferred as a follow-up — noted in the todo file, not built here.

1. **`src/engine/gamestr/gamestrScore.js` — `GAMESTR_RELAYS`**: `[main.relay.gamestr.io, relay.damus.io, nos.lol, relay.nostr.band, relay.primal.net]` → `[main.relay.gamestr.io, nos.lol]`. Removes the one dead relay (nostr.band) and the two that actively error on this exact query (damus 503, primal NOTICE-rejects the tag). Keeps nos.lol as a write-fanout companion since it accepts the REQ cleanly (0 events, no error).
2. **`src/nostr.js` — `RELAYS`** (profile reads): `[relay.damus.io, nos.lol, relay.nostr.band, relay.primal.net]` → `[relay.damus.io, nos.lol]`. Both tested with a real `kind:0` query and returned events; nostr.band timed out and primal returned nothing.
3. **`tools/csp.mjs` — `connect-src`**: rebuilt as the exact union of every `wss://` endpoint the app now opens at runtime: `main.relay.gamestr.io`, `relay.damus.io`, `nos.lol`, `relay.staging.plebeian.market`, `relay.plebeian.market` (the last two because `marketStall.js` uses both). This *adds* `main.relay.gamestr.io`, which was missing from CSP entirely before this change — a pre-existing latent bug where the leaderboard's own authoritative relay wasn't allow-listed. Drops `relay.nostr.band` and `relay.primal.net`, which are no longer connected to from anywhere in the app.

## Consequences

- Leaderboard reads/writes go through fewer, but working, relays — console
  noise from the two erroring endpoints (damus 503, nostr.band timeout) stops.
- Profile reads keep two relays that both empirically returned data; the two
  removed ones contributed nothing (timeout / empty).
- CSP now explicitly allows the leaderboard's own relay — closes a gap where a
  strict CSP enforcement point could have silently blocked gamestr score
  fetches.
- `PLEBEIAN_RELAYS` (staging) is untouched; this ADR does not change
  marketplace behaviour.
- Single point of failure risk: `main.relay.gamestr.io` is now the only relay
  serving leaderboard reads reliably. If it goes down, the in-app leaderboard
  falls back to its existing best-effort empty state (`_refreshGamestrScores`
  already catches and no-ops on relay failure) rather than erroring — no
  behavioural regression, just an empty leaderboard until it recovers.
  Self-hosting a relay removes this dependency; tracked as a follow-up, not
  built in this change.

## Alternatives considered

- **Query fix instead of relay trim** (drop the `#game` tag filter, filter
  client-side): would let `nos.lol` and other non-tag-indexing relays return
  usable events too. Rejected for this change to keep the diff small and
  behaviourally conservative; worth revisiting if `main.relay.gamestr.io`
  proves unreliable over time.
- **Self-host strfry now**: most robust long-term fix (no third-party
  dependency), but a materially bigger task (VPS relay install, config,
  installer integration). Deferred — noted as a todo, not built here.
- **Switch `PLEBEIAN_RELAYS` to prod**: rejected — out of scope for a
  leaderboard-relay fix and risks breaking the existing staging test auction
  without separate verification.
