# ADR-0126: FIPS two-node background presence

Status: Accepted. Implementation and primary-node rollout approved on 24 September 2026. Two-operator production acceptance remains separate from installing this first slice.

## Decision

Add FIPS as a Suite-managed node transport, not a player feature. Keep the existing signed kind-30078 `torii-gateway` heartbeat and its home relay unchanged. Quest reads at most one operator-pinned remote heartbeat over FIPS first, with ordinary WSS fallback, and exposes the latest valid event to the existing world directory through a non-blocking same-origin snapshot.

The broader direct-first/collector-assisted architecture remains proposed. Applesauce adoption, collectors, automatic mutual discovery, world assets over FIPS and multiplayer over FIPS are outside this release.

## Identity and consent

- The FIPS key is a fresh, persistent node transport key. It is not the operator's personal key or the existing heartbeat key.
- One root-owned introduction pins transport npub, beacon pubkey, owner pubkey, zone ID and public world URL. Verify that introduction with the operator out of band; a self-asserted `p` tag is not authorization.
- Existing discovery-on/off behavior is unchanged. Public world heartbeat reads need no reciprocal permission, social relationship or private-presence handshake.
- No writes to another node's relay, no player tracking and no operator key upload. Each operator approves installation on their own VPS.
- This direct-UDP proof uses one configured transport peer. It does not turn mutual follows into mesh routing permissions and does not claim general NAT traversal or automatic bootstrap.

## Boundaries and budgets

The node reader polls every 30 seconds, without overlapping polls. Each route gets a 2.5-second deadline, at most eight frames, 32 KiB total and an 8 KiB event limit. One latest heartbeat is held in RAM; it is not written to the local relay or a new database.

The receiver recomputes event ID and Schnorr signature, pins signer/owner/world, rejects duplicate critical tags, enforces a maximum 20-minute TTL and 60-second future-clock tolerance, and preserves original expiry during failure. It rejects WSS redirects and non-public resolved fallback addresses. Only root-owned, non-group/world-writable configuration supplies destinations.

Suite uses pinned FIPS v0.5.1 release binaries verified against embedded SHA-256 checksums. The daemon gets a 192 MiB memory ceiling and 20% of one CPU; the isolated relay proxy gets 64 MiB and 10%. These are initial protective ceilings, not measured steady-state use or a performance guarantee. FIPS logs use an 8 MiB volatile journal namespace; no profiler write directory is granted. Installation requires 256 MiB free headroom and removes its temporary package.

Only the npub-derived mesh IPv6 address on port 7778 fronts the existing public strfry relay. A default-deny FIPS-interface firewall shields wildcard-bound admin services and host forwarding. The main HTTPS proxy is not re-bound or made dependent on FIPS. Host/provider firewall rules must permit the intentional UDP transport port 2121; the installer does not weaken a host firewall.

## Player experience and storage

No new player controls or network terminology. The browser consumes a bounded same-origin snapshot without awaiting FIPS on startup, travel or rendering paths. Existing world loading and multiplayer remain unchanged.

This integration downloads no visited-world assets, pins no remote worlds and does not replicate general relay history. Existing strfry retention and browser/world-loading storage behavior are separate concerns and are not claimed to have a new global quota.

## Release gate

Unit/security tests and the production build are necessary but insufficient. The isolated two-node test must demonstrate actual mesh receipt, outage, recovery, persistent identity and firewall isolation. Then both independently approved VPS deployments must verify their real strfry heartbeat exchange and a timed resource/storage soak.

Before player acceptance, compare baseline/healthy/failed FIPS on the same scene, device and route: p95 frame time no more than 5% worse, no additional >50 ms input stall, and gate readiness/arrival no more than 100 ms worse at p95. These are provisional acceptance thresholds, not measurements. Repeat enough matched trials to distinguish noise; fail or review any regression.

Do not mark the release fully accepted until GitHub main, release tags and the approved live node agree and all applicable tests are recorded. A draft PR is not a deployment.

## Upstream references

The transport implementation follows the [FIPS v0.5.1 configuration contract](https://github.com/jmcorgan/fips/blob/v0.5.1/docs/reference/configuration.md), [npub-to-address CLI](https://github.com/jmcorgan/fips/blob/v0.5.1/docs/reference/cli-fipsctl.md), and [mesh firewall guidance](https://github.com/jmcorgan/fips/blob/v0.5.1/docs/how-to/enable-mesh-firewall.md). These are upstream mechanisms; Torii's one-peer and presence budgets are application policy, not an upstream endorsement.
