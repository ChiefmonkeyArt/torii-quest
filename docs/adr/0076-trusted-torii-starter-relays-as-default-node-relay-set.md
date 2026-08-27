# ADR-0076: Trusted Torii Starter Relays as Default Node-Relay Set

- **Status:** Accepted
- **Date:** 2026-08-27
- **Deciders:** chiefmonkey (+ Perplexity Computer agent)
- **Related:** ADR-0067 (leaderboard relay trim), `src/engine/presence/nodeRelays.js`, `src/engine/settings/relayPanel.js`, `src/main.js` (`_nodeRelaysForPublish`, `_homepageStubState`)

## Context

The Torii Quest heartbeat publishes node presence (a kind:1012 liveness event)
to the operator's **node-relay set** — read by `readNodeRelays()` from
`localStorage['torii.node.relays']` + `<meta name="torii-relays">`. That reader
was **deliberately** configured-only: it returns `[]` when nothing is set, and
the caller (`_publishPresenceOnce`) treats `[]` as `blocked:no-node-relay` and
publishes **nothing**. This was an explicit public-relay regression guard —
presence events are operator-identity-bearing, so silently publishing them to
big public relays (damus/nos.lol/nostr.band/primal) was forbidden.

The cost of that guard: a **fresh install has no node relays at all**, so the
heartbeat is permanently `blocked:no-node-relay` until the operator manually
adds relays in the Relay settings tab. This blocks the product vision of a
zero-config Torii gateway: a new admin (e.g. Bekka) installs, logs in, and
their node should immediately beacon + be discoverable by other Torii instances
so a **gateway jump** between instances is testable. "Users should never have
to go looking for relays."

Verified relay availability at the WebSocket level (REQ + EOSE) on 2026-08-27:

| Relay | WS result | Notes |
| --- | --- | --- |
| `wss://main.relay.gamestr.io` | OK | gaming notes + presence (Torii ecosystem) |
| `wss://relay.plebeian.market` | OK | marketplace presence (Torii ecosystem) |
| `wss://nos.lol` | OK | general, fast — but named as a "public relay" by the guard |
| `wss://relay.staging.plebeian.market` | OK | staging — not for prod defaults |
| `wss://relay.damus.io` | 503 ERR | currently down — unsuitable as a default |

The gate **read** path (`fetchOnlineWorlds`) already merges
`[..._nodeRelaysForPublish(), ...RELAYS]`, so once the publish set includes the
starter relays, other instances querying the same relays will discover the node.
Both `wss://main.relay.gamestr.io` and `wss://relay.plebeian.market` are already
in the Caddy `connect-src` CSP, so no CSP change is required.

## Decision

Provide a curated, frozen **`DEFAULT_NODE_RELAYS`** set of trusted Torii-ecosystem
starter relays (`wss://main.relay.gamestr.io`, `wss://relay.plebeian.market`),
and a new **`readEffectiveNodeRelays(opts)`** helper that returns the operator's
configured relays if any, **else** the curated defaults. Wire
`_nodeRelaysForPublish()` to use `readEffectiveNodeRelays` (so both the heartbeat
publish and the gate read path pick up the starters). Leave `readNodeRelays()`
configured-only and untouched — the effective-defaults fallback is an explicit,
separate, auditable seam, not a silent change to the guarded reader.

This is a **product decision change**: the node-presence model moves from
"private/explicit — publishes nothing until the operator configures relays" to
"public discovery beacon — publishes to trusted Torii starter relays by default
on a fresh install." The operator can still override via the Relay settings tab.

The Relay settings tab surfaces this transparently: when no custom relays are
configured it shows a "Starter relays active" banner + read-only default rows
(badge `STARTER`); when the operator saves their own set, the removable list
returns (badge `N CONFIGURED`).

## Consequences

- **Enables:** zero-config gateway discovery — a fresh install beacons + is
  discoverable immediately; the gateway-jump test path between two instances
  is unblocked without operator relay setup.
- **Forecloses:** "presence publishes nothing by default on a fresh install."
  A fresh install now publishes operator presence to the curated starter relays
  on the first owner publish. This is the intended trade.
- **Trade-offs:** `nos.lol` was deliberately **excluded** from heartbeat
  defaults — it is verified live and already used for Gamestr score fanout, but
  the existing guard explicitly names it as a public relay. For the least
  controversial Phase 1, `nos.lol` stays in `GAMESTR_RELAYS` (scores) only and
  out of heartbeat presence. An operator who wants more publish redundancy can
  add `nos.lol` (or any wss relay) per-instance via the Relay tab. `damus.io`
  was excluded — currently returning 503.
- **Enforcement:** `nodeRelays.test.js` locks (1) defaults returned when nothing
  configured, (2) operator config overrides defaults, (3) defaults are wss-only
  and contain none of the named public relays, (4) a fresh copy is returned (the
  frozen constant cannot be mutated), (5) no throw when storage throws. The
  `readNodeRelays` "never falls back to public RELAYS" guard + its tests remain
  green (configured-only semantics unchanged).

## Alternatives considered

- **Silently fall back inside `readNodeRelays`.** Rejected: it would mutate the
  guarded reader's meaning after extensive comments/tests asserting "returns []
  when none configured" — hidden behavioural drift.
- **Auto-seed defaults into `localStorage` on first owner login.** Rejected:
  browser-local, timing-sensitive, doesn't mean "the instance is configured,"
  and confuses cross-device gateway testing. Explicit effective defaults are
  cleaner and reversible.

## Notes

This ADR only removes the `blocked:no-node-relay` block. The heartbeat will
**not** "always beat" until the separate Phase 2 change (auto first-publish on
owner login — the first publish is still explicit via the toggle today), and it
will not be truly permanent/server-side until a later delegated/server signer
design. See the Phase 1 plan for the gateway-jump test path.
