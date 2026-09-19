# ADR-0120: Node-Owned Relay as Primary Event Home

- **Status:** Accepted
- **Date:** 2026-09-19
- **Deciders:** chiefmonkey (+ Computer agent)
- **Related:** ADR-0076 (trusted starter relay set), ADR-0081 (single unified relay list), ADR-0094 (server-side always-on presence beacon), ADR-0104 (beacon relay coverage — whose "Retirement" note anticipated this), ADR-0111 (FIPS as founding-layer transport), `GATEWAY_PROTOCOL.md`, `docker-compose.yml` / `strfry.conf` / `Caddyfile` (`/relay` sidecar), `src/engine/presence/nodeRelays.js`, `server/presence/beacon.js`, `server/arena-ws.js`, `tools/csp.mjs`

## Context

Two parallel sessions converged independently on the same architecture: instead of relying on
a shared set of third-party relays to carry node presence, **each Torii node should run its
own relay and publish its own heartbeat to it**, so friends can check the node's relay
directly. This ADR combines those findings and pins the technical substrate.

Three concrete findings make the idea immediately actionable:

1. **The node's own relay already exists — it is strfry, and it is already shipped.**
   The self-hosting kit (`docker-compose.yml`) runs a **strfry** relay sidecar
   (`ghcr.io/hoytech/strfry`, C++), configured by `strfry.conf`, reverse-proxied by Caddy as
   `wss://$DOMAIN/relay`. strfry natively supports NIP-40 (expiration) — it is in strfry's
   supported-NIP list — so a node's own relay honours presence expiry out of the box. **What
   is missing is wiring:** the beacon does not publish presence to it, the gateway does not
   read from it, and the presence event does not advertise it as the node's home relay.

2. **The shared Plebeian relay has a NIP-40 gap, and it is khatru (not strfry).**
   `relay.plebeian.market` is a repo-owned **khatru** relay (Go,
   `fiatjaf.com/nostr/khatru`) in `PlebeianApp/market`'s `deploy-simple/relay`. Its
   `relay.OnEvent` chain (`ValidateKind → RejectEventsWithBase64Media →
   RejectUnprefixedNostrReferences`) applies no expiration policy, so it serves expired
   `kind:30078` `#t=torii-gateway` events days after their 20-minute TTL. A live probe
   returned events 9.7–15.6 days stale on `relay.plebeian.market` while nos.lol / routstr /
   primal / snort / nostr.mom served the same authors' fresh (<2 min) events. This is why a
   node can appear, then vanish or linger stale, in the gateway directory. That fix belongs
   to Plebeian as a separate upstream issue (not this repo; not urgent).

3. **Layering (from the parallel session, already consistent).** FIPS is the
   **reachability/transport** layer (how a peer finds a NAT'd node by npub — ADR-0111); the
   relay is the **event/storage** layer; **Applesauce-clients** (NDK → applesauce-loaders)
   are **application plumbing** above the relay. These three complement, not replace, each
   other.

## Decision

**Each Torii node owns its own relay — the already-shipped strfry sidecar at
`wss://$DOMAIN/relay` — as the primary home for its signed presence events. The beacon
publishes to it first, the gateway reads it first, and the presence event advertises it so
peers can check the node directly. The curated `DEFAULT_NODE_RELAYS` remain a bootstrap
seed for stranger-discovery, not the authoritative presence store. The missing Plebeian
relay NIP-40 fix is tracked as an upstream issue, not a Torii code change.**

Clarifying, because several tracks are drafting in parallel:

- **"Publish at home" is primary.** A node's own relay is the canonical publication point
  (its *outbox*), not merely one more relay in a broadcast mesh. This restores operator
  control over retention and expiry — the exact property that failed on
  `relay.plebeian.market`.
- **Own relay is strfry, already shipped.** No new relay software is adopted and no new
  binary is added to the installer. The work is wiring the existing sidecar into the
  presence publish + read + advertise paths, plus declaring it the primary relay.
- **Mutuals are read-biased and consent-gated.** The preferred flow is *collect* (read
  selected friends' home relays and cache their original signed events), not
  *republish-to-everyone*. Following someone back does not grant storage on, or publish
  rights to, their infrastructure. This defers the O(n) write fan-out and
  unbounded-crawler failure modes.
- **Expiry is enforced by the own relay.** strfry already honours NIP-40, so a dead node
  falls out of its own relay's directory within its TTL. The client keeps its independent
  local expiry check (`_presenceLive`) regardless of any relay's behaviour.
- **Bootstrap stays, demoted.** `DEFAULT_NODE_RELAYS` remain a *seed* for finding a node
  before you know its relay. The node's own relay is primary.
- **Plebeian remains in the default list.** The operator owns `relay.plebeian.market`; it is
  kept. Its stale-index behaviour is an upstream khatru issue, filed separately and not
  blocking this work.

## Consequences

- **Enables:** operator-controlled retention and expiry; presence that survives any one
  third-party relay's staleness; "check my relay directly" for friends; no new relay
  software (strfry is already in the kit); a clean path to FIPS transport (the node already
  has a relay for FIPS to reach — ADR-0111).
- **Forecloses:** treating the curated default list as the authoritative presence store;
  "republish my heartbeat to every mutual's relay" as the default write model; adopting a
  third relay implementation for the node's own relay.
- **Trade-offs:** the node's own relay becomes load-bearing (presence depends on the sidecar
  being up). A shared relay remains necessary for *bootstrap* discovery, which is why the
  Plebeian relay's index bug still matters even under an own-relay model. Heartbeat freshness
  ≠ reachability: a cached announcement is shown as "recent heartbeat", not "connection
  verified".
- **Enforcement:** unit tests cover own-relay derivation + ordering (own relay first in both
  publish and read paths, advertised in the presence event), a CSP-sync test asserts every
  `DEFAULT_NODE_RELAYS` host appears in `connect-src` (preventing the relay/CSP drift that
  hid 4 of 7 relays from the browser), and the gateway reader keeps its local expiry check.

## Alternatives considered

- **Adopt khatru (or applesauce-relay) for the node's own relay.** Rejected: strfry is
  already shipped, already NIP-40-capable, and needs no new language/toolchain in the
  installer. khatru is Plebeian's shared-relay choice and is not imported here.
- **Republish to all mutual relays (the user's earlier idea).** Rejected as the *default*:
  O(n) redundant write fan-out, implicit infrastructure use without consent, and it does not
  fix staleness (a stale relay still serves a stale row). Kept as an explicit, peer-consented
  mirror mode only.
- **Keep the curated default list as primary.** Rejected: it is the exact failure diagnosed
  (a foreign relay keeps a stale index).
- **Store the admin nsec on the node relay for signing.** Rejected (ADR-0094): the beacon
  uses a scoped, revocable, presence-only keypair; the sovereign key stays in the operator's
  signer.

## Notes

- **Accepted** (2026-09-19) after the operator converted the topic from discussion to action:
  the own-relay wiring ships in this same PR (v0.2.873-alpha).
- Not touched by this ADR: `DEFAULT_NODE_RELAYS` content (plebeian stays, per the operator's
  explicit instruction) and any Plebeian contract/custody code (read-only boundary holds).
- The Plebeian relay's khatru NIP-40 gap is filed as an upstream issue with a repro; it is
  not a Torii code change and is not urgent (the projects are not yet merged, and Torii's own
  relay sidesteps it).
- FIPS is alpha (ADR-0111): the own-relay path ships on ordinary HTTPS/WebSocket first, with
  FIPS as the opt-in transport; the browser reaches the node via the staged bridge.