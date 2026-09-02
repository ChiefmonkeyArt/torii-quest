# ADR-0104: Beacon relay coverage — refresh DEFAULT_NODE_RELAYS to writable set only

> Note: this ADR number was 0103 in the branch, bumped to 0104 during rebase because a
> parallel session landed a different ADR-0103 (character/mixamo bone-name fix) first.

- **Status:** Accepted
- **Version target:** v0.2.746-alpha
- **Depends on:** [ADR-0076](0076-trusted-torii-starter-relays-as-default-node-relay-set.md) (the earlier curated default list), [ADR-0081](0081-single-unified-relay-list.md) (single relay-list surface).
- **Related:** none.

## Context

A live read-side probe from an external sandbox showed that only 2 of the 5
default node relays returned our `kind:30078` presence events:

- `wss://nos.lol` — fresh events, ~190 s old.
- `wss://relay.routstr.com` — fresh events, ~190 s old.
- `wss://relay.plebeian.market` — stale (~21 h old).
- `wss://main.relay.gamestr.io` — nothing in the last 24 h.
- `wss://relay.vertexlab.io` — nothing in the last 24 h.

The server-side beacon (`server/arena-ws.js` + `server/presence/beacon.js`)
reported `lastError: null` and a fresh `lastPublishedAt`, but that state is
overwritten on every publish so we could not see per-relay outcomes from
the beacon logs alone.

To get ground truth we wrote `tools/relay-probe.mjs`: connects to each
relay with a **throwaway** keypair, publishes a real `kind:30078` event
with `["d","quest-torii-probe"]`, waits for the `OK` frame, then issues a
`REQ` for the same author+kind and checks the event round-trips. Two of
the five explicitly rejected the write:

| Relay                            | Verdict  | Reason                                                     |
| -------------------------------- | -------- | ---------------------------------------------------------- |
| `wss://main.relay.gamestr.io`    | REJECTS  | `blocked: kind 30078 not allowed`                          |
| `wss://relay.plebeian.market`    | ACCEPTS  | round-trips                                                |
| `wss://relay.routstr.com`        | ACCEPTS  | round-trips                                                |
| `wss://nos.lol`                  | ACCEPTS  | round-trips                                                |
| `wss://relay.vertexlab.io`       | REJECTS  | `unsupported kind: we only support kinds 5312 to 5315: 30078` |

Two observations:

1. `main.relay.gamestr.io` is a policy-restricted relay: it accepts the
   gamestr-native `kind:30762` leaderboard event (which is why we keep it in
   `src/engine/gamestr/gamestrScore.js`) but blocks generic addressable
   events. It was never going to accept `kind:30078`.
2. `relay.vertexlab.io` is a DVM (Data Vending Machine) relay that only
   accepts kinds 5312–5315. The previous comment in `nodeRelays.js` calling
   it a "NIP-45 profile aggregator" was wrong.

Both are dead weight for the node-presence use case: they will never accept
our writes, no matter how many retries.

## Decision

Refresh `DEFAULT_NODE_RELAYS` in `src/engine/presence/nodeRelays.js` to
contain **only relays verified to accept + round-trip `kind:30078`**:

```js
export const DEFAULT_NODE_RELAYS = Object.freeze([
  'wss://relay.plebeian.market',   // marketplace presence (Torii ecosystem)
  'wss://relay.routstr.com',       // routstr network relay (Torii ecosystem)
  'wss://nos.lol',                 // popular general relay
  'wss://relay.damus.io',          // major general relay — added by ADR-0104
  'wss://relay.primal.net',        // major general relay — added by ADR-0104
]);
```

Removed:

- `wss://main.relay.gamestr.io` — kept in `gamestrScore.js` for
  `kind:30762`, removed from the presence list.
- `wss://relay.vertexlab.io` — removed everywhere in the presence path.

Added:

- `wss://relay.damus.io` — verified writable + round-tripping.
- `wss://relay.primal.net` — verified writable + round-tripping.

Also commits `tools/relay-probe.mjs` so this list stays maintainable. The
probe is a small self-contained node script; run
`node tools/relay-probe.mjs` any time the default list changes or you
suspect coverage has degraded. The probe uses a throwaway keypair so it
never affects production identity.

## Consequences

- **Coverage rises from 2/5 to 5/5** for the presence-publish path. Every
  default relay now accepts our writes.
- **Discovery improves** for readers on damus.io and primal.net (huge
  general relays with wide audience overlap).
- **Configured operators are unaffected.** The change only touches the
  fallback default list; anyone who has typed relays into the Node ▸
  Relays tab already overrides this list per ADR-0081.
- **gamestr leaderboard reads are unaffected.** They live on a separate
  hardcoded list inside `src/engine/gamestr/gamestrScore.js`, which still
  targets `main.relay.gamestr.io` for the kind:30762 events that relay
  actually serves.
- **No security-model change.** Relay set stays wss-only,
  operator-identity-bearing, and every publish still requires the
  explicit user opt-in gates from ADR-0081.

## Follow-ups

- If a future probe run shows any of the current 5 has degraded to
  reject-mode, swap it out via a new patch bump and cite ADR-0104.
- Consider making the probe a CI job that runs weekly against
  `DEFAULT_NODE_RELAYS` and opens an issue if any entry regresses. Not
  blocking; captured here for later.

## Retirement

When the game moves to per-topic relay hints published as NIP-65 kind:10002
"relay lists" (so each operator advertises their preferred write set and
readers follow those hints), the curated default list becomes a bootstrap
seed only, and this ADR is superseded by whatever ADR governs the NIP-65
migration.
