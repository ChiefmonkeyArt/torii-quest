# ADR-0122: World-reference owner attribution (beacon-signed `p` tag)

- **Status:** Accepted
- **Date:** 2026-09-20
- **Deciders:** chiefmonkey
- **Related:** ADR-0117 (world-as-data travel), ADR-0119 (world serialization for travel), ADR-0094 (server always-on presence beacon), ADR-0120 (node-owned relay as primary event home); files `src/engine/world/worldReference.js`, `src/engine/world/worldResolver.js`, `src/engine/world/worldPublisher.js`, `server/world/worldPublish.js`, `server/presence/beacon.js`, `tests/world/world-resolver.test.js`

## Context

ADR-0117 introduced the `torii-world` kind-30078 world-reference event: a content
address (the sha256 of the world.json manifest) plus relays, discovered by the owner's
npub so travel resolves a world without a URL. The discovery half
(`discoverWorldReference`) filtered relays with `authors: [ownerNpubHex]` — the
assumption being that the reference is signed by the owner's key (the client/NIP-07
publish path).

ADR-0119 added a server-side publish half: the always-on presence beacon (ADR-0094)
serializes the active world and publishes the watermark reference with the **beacon's own
key**, not the owner's. That created an asymmetry: the presence event already stamps the
owner as a canonical `["p", <admin>]` tag (ADR-0094 §2), but the world-reference did not.
The result (reproduced live on v0.2.877-alpha, 2026-09-20): `discoverWorldReference(owner)`
returned null, `resolveWorldByNpub` failed `no-reference`, the live mirror never built, and
the gate-only peek showed a blank preview even though the terrain code was correct (proven
by a pose sweep rendering terrain from every camera angle).

## Decision

Extend the world-reference contract to carry the same canonical owner marker presence
already uses. `buildWorldReferenceUnsigned` accepts an optional `owner` (hex64) and stamps
`["p", <owner>]` when valid; `parseWorldReference` surfaces an `owner` field (the `p` tag
when it differs from the signer, otherwise the signer). `discoverWorldReference` drops the
`authors`-scoped filter in favour of a topic-only filter, then attributes each verified +
parsed candidate to the requested hex when the event's signer OR any `p` tag matches it,
picking the newest attributed event. The beacon passes `owner: admin` when an admin npub is
configured (omitting it in node-identity mode, where the beacon key itself is the world
identity).

## Consequences

- **Enables:** beacon-signed world references are discoverable by the owner's npub, so the
  gate-only peek and walk-through travel work for every server-enabled node — the exact
  blank-preview defect is closed.
- **Forecloses:** reliance on the reference author being the owner. Discovery no longer
  assumes `event.pubkey === owner`.
- **Trade-offs:** discovery query is topic-scoped with a slightly higher limit (200) and an
  attribution pass rather than relay-side author scoping. Owner attribution via a `p` tag is
  attestable by any signer; this matches the existing ADR-0094 trust model (a configured
  beacon is the operator's own server authority attesting ownership), and the reference's
  signature is still verified so a relay cannot forge/tamper an event.
- **Enforcement:** unit tests lock the `p`-tag mint + parse (world-resolver, world-publisher,
  beacon) and the discovery attribution paths (beacon-signed via `p` tag, client-signed via
  author, foreign-reference rejection, newest-valid-wins with bad-sig/malformed skipped).

## Alternatives considered

- **Keep `authors` scoping and sign references with the owner key on the server.** Rejected:
  the server does not hold the owner's secret key (sovereign identity stays in the client),
  and reusing it would break the separation ADR-0094 already established.
- **Carry the owner in the manifest instead of the event tags.** Rejected: discovery must
  resolve the event before reading the manifest, so the attribution has to live on the event.
- **Dual relay query (authors + `#p`).** Rejected: relay `#p` tag filtering is not uniformly
  honoured, and a single topic-scoped query with a client-side attribution pass is simpler,
  correct, and bounded by the limit.

## Notes

Relay forensics on 2026-09-20 showed the owner's reference events signed by two different
beacon keys over successive versions (v0.2.872 `935c63d9…`, v0.2.877 `3ae0fad8…`), while the
presence events carried the `p`-tag attribution — confirming the asymmetry, not a relay loss.
Re-publish after deploy is automatic: the beacon re-pulses the reference (with the new `p`
tag) on its next cadence, so no manual relay cleanup is required.