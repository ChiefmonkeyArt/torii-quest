# ADR-0094: Server-Side Always-On Presence Beacon

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** chiefmonkey (+ Perplexity Computer agent)
- **Related:** ADR-0077 (client-side auto-on — this supersedes its "deferred" note), ADR-0081 (single unified relay list), `server/arena-ws.js`, `server/kami/kamiNostr.js` (`publishEventToRelay`), `src/engine/gateway/worldPresence.js` (`buildPresenceEvent`), `src/engine/gateway/gatewayRead.js`, `src/engine/presence/heartbeat.js`, `src/main.js` (`_heartbeatTick`)

## Context

ADR-0077 shipped the heartbeat as **client-side and ephemeral**: the presence
event (kind 30078, topic `torii-gateway`) carries a NIP-40 `expiration` of 20
minutes and is re-published every 10 minutes **only while the owner's browser
tab is open, logged in as admin, with a NIP-07 wallet connected**. Close the tab
and the world vanishes from every gateway within 20 minutes.

The product requirement is explicitly different (Bekka / chiefmonkey): the beacon
must **"just work"** — it activates **automatically from the configured admin
npub** (set at install), then stays **permanently on** (a steady pulse) until the
admin turns it off or the server goes down. No browser tab, no login, no wallet
at all. A purely client-side signer can never satisfy this, because a browser
process cannot run 24/7 and the admin's NIP-07 key lives in a wallet that is only
reachable while the page is open.

Forces:

- **Product:** install → beacon (auto-on from the configured admin npub), forever, until stopped.
- **Security / consent:** the admin's master `nsec` must never live on the
  server. Publishing presence to public relays is already the established,
  admin-consented behaviour (ADR-0077 §forces; the presence event carries only
  "this world is online here", not scores or achievements — which remain
  explicitly button-gated per the consent principle).
- **Identity / discovery:** the gateway already lists every *live* kind-30078
  `torii-gateway` event and classifies it as Friends / Follows / Games by mapping
  the world to an **owner pubkey** (today: the event's `pubkey` = the signer).
  For the beacon to appear under the admin's Friends/Follows, the event must be
  attributable to the admin's pubkey — not to a random server key.

## Decision

The multiplayer `arena-ws` server holds a **dedicated beacon keypair** and runs a
**server-side republish loop** (every `HEARTBEAT_INTERVAL_MS` = 10 min) that signs
and fan-out-publishes the instance's presence event to the unified relay list
(ADR-0081) for as long as the beacon is enabled. The beacon state (key, `enabled`
flag, admin pubkey, last-publish timestamps) is **persisted to disk** (root-owned,
`0600`) so a server restart resumes the pulse automatically. Activation is
**automatic and config-driven** — it turns on the first time the server boots with
an admin npub configured (`QUEST_ADMIN_NPUB`), requiring no login, no session
token, and no wallet. The admin's nsec never lives on the server at all, and no
new signing scheme is invented.

Concretely:

1. **Beacon keypair + state file.** On first activation the server generates a
   secp256k1 keypair (via `nostr-tools` `generateSecretKey`/`getPublicKey`) and
   writes `{ version, pubkey, secretKey, enabled, activatedAt, adminPubkey,
   lastPublishedAt, lastError }` to `/opt/torii-quest/mp/beacon-state.json` with
   mode `0600` (atomic tmp+rename), owned by the `torii-quest` service user
   (the dir already exists and is service-writable; `ReadWritePaths=/opt/torii-quest`
   is already in the systemd unit).

2. **Presence event shape.** The server builds the *same* presence model the
   client built (mirrors `buildPresenceEvent`): `kind:30078`, `d=quest-torii`,
   `t=torii-gateway`, `zoneType=arena`, `title=Torii Quest`, `website` from the
   new `QUEST_PUBLIC_URL` env, `relays` from the new `QUEST_NODE_RELAYS` env
   (falling back to `DEFAULT_NODE_RELAYS`), NIP-40 `expiration` 20 min — **plus**
   two attribution fields so readers resolve the admin:
   - `["p", <adminHex64>]` tag (canonical "owner" marker), and
   - `content.npub` = the admin's bech32 npub (display; already supported).
   The event's `pubkey` is the **beacon key** and the signature is a valid
   BIP-340 sig by that key (via `finalizeEvent`), so strict relays accept it.

3. **Republish loop.** A `setInterval`/recurring timeout in `arena-ws.js` (gated
   on `enabled` and a non-empty relay list) publishes the signed event to every
   relay using the existing server-side publisher (`publishEventToRelay`, reused
   from `server/kami/kamiNostr.js`); a per-relay failure is recorded but never
   stops the loop. This is the one place `setInterval` is acceptable server-side
   (the client-side "no new timers" invariant does not apply to Node).

4. **Activation — automatic from the configured admin npub.** On boot the server
   calls `beacon.autoEnable()`: if an admin npub is configured (`QUEST_ADMIN_NPUB`)
   and the beacon has **never** been activated (`activatedAt` unset), it generates
   + persists the key, sets `enabled: true`, and publishes immediately (then on
   the 10-min cadence). **No login, no session token, no wallet** — the configured
   admin identity alone is enough, so a fresh install is discoverable the moment
   the server starts. An admin who explicitly turned it off (`enabled: false`
   with `activatedAt` already set) is **not** re-enabled on a later boot.

5. **Stop / resume.** `POST /mp/admin/beacon { action: 'off' | 'on' }` (same
   admin gate) flips `enabled` and persists. `off` stops the loop permanently
   until the admin re-enables; the presence event's NIP-40 expiry then drops the
   world from the directory within 20 min.

6. **State read.** `GET /mp/admin/beacon` returns `{ enabled, activatedAt,
   pubkey, adminPubkey, lastPublishedAt, lastError }` — public read of non-secret
   state (mirrors `/mp/admin/update-capability`), so the client can render the
   beacon state (and the heartbeat toggle remains the admin's on/off switch).

7. **Client heartbeat becomes a fallback, server is the source of truth.** When
   the server beacon is `enabled`, the client's `_heartbeatTick` does **not** also
   publish (no duplicate presence from a second key). The existing client-side
   publish remains only as a degraded fallback (e.g. the admin npub is not yet
   configured, or the server loop is down) so an otherwise-ownerless instance can
   still show up while its operator is actively playing.

8. **Reader ownership resolution.** `extractGatewayFromEvent` resolves the world's
   **owner pubkey** from the `["p", <hex64>]` tag when present, falling back to the
   event's `pubkey` (for client-signed legacy events). `partitionGatewaySections`
   / `candidateFriendOwners` classify on that owner, so a beacon-signed event is
   attributed to the admin and lands in the correct Friends/Follows bucket.

Consent note: activation is the install-time act of configuring one's admin npub
(`QUEST_ADMIN_NPUB`) — a deliberately opted-in, self-describing "world is online"
presence, not scores, achievements, or identity beyond what the client already
published. The admin can revoke at any time via the heartbeat toggle. This
satisfies the standing principle: nothing is published that the operator is not
aware of, and every publish surface retains an explicit off switch.

## Consequences

- **Enables:** a truly permanent, no-browser, no-login, no-wallet heartbeat —
  install → beacon until stopped or the box dies. Restarts resume automatically.
  Friends/Follows/Games attribution for server-signed worlds.
- **Forecloses:** the client-only heartbeat as the *primary* path; "the admin must
  keep a tab open" as an assumption. Raw NIP-26 delegation is not used (see
  Alternatives) — attribution is via the `p` tag, which is advisory (same trust
  level as the reader's existing `trust: 'unverified'` posture: anyone can already
  list themselves in the directory).
- **Trade-offs:** the directory's owner-vs-signer binding is loosened for
  beacon-signed events (a malicious node could assert another npub in `p`); this
  matches the reader's existing "list every live record, don't verify sigs"
  behaviour and is accepted. The server now holds a secret (the beacon key) — it
  is not the admin's key, is scoped to presence only, lives in a `0600`
  root-owned file, and is revocable by deleting the state file + re-deploying.
- **Enforcement:** new unit tests for the beacon state machine (auto-activate /
  stop / persist / resume, key persistence, presence-event shape + `p` tag), the
  `GET/POST /mp/admin/beacon` admin gate (session-token only, fail-closed), the
  reader's owner-resolution, and the relay publisher re-use. Regression-check
  gate remains 21/21.

## Alternatives considered

- **NIP-26 delegated signer (true crypto delegation).** The event carries
  `pubkey = delegatee` with a `delegation` tag, so the delegatee (server) signs
  but the reader must *resolve the delegator* — the exact same reader change the
  `p`-tag approach needs — plus a delegation token that a **NIP-07-only** wallet
  cannot produce (the token is a Schnorr sig over a non-event string; `signEvent`
  only signs event IDs). Rejected: strictly more complexity and a new token
  scheme for no reader-side benefit, and it cannot be created from a plain browser
  extension signer.
- **Store the admin's `nsec` on the server.** Rejected outright: violates the
  consent/freedom-tech principle; the server must never hold the admin's master key.
- **Keep the client-side heartbeat and accept the gap.** Rejected: it is the
  exact behaviour the product requirement overrides.

## Notes

- Reuse, don't reinvent: `server/kami/kamiNostr.js` already ships a clean,
  injectable `publishEventToRelay(url, event, { WebSocketCtor, timeoutMs })` relay
  EVENT publisher — the beacon loop reuses it verbatim. `nostr-tools` (`^2.24.3`)
  is already a server dep (`generateSecretKey`/`getPublicKey`/`finalizeEvent`).
- New env seams read by `arena-ws.js`: `QUEST_NODE_RELAYS` (comma-separated wss
  list, falls back to `DEFAULT_NODE_RELAYS`) and `QUEST_PUBLIC_URL` (origin for
  the presence `website` field). The installer can inject both from the same
  `DOMAIN`/relay values it already writes to `.env`; defaulting to the curated
  relays keeps fresh installs zero-config.
- The beacon state file is deliberately separate from `.env` and never committed;
  it is mutable runtime state, not configuration.