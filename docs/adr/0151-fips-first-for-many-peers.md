# ADR-0151: FIPS first for many peers

- **Status:** Accepted (2026-11-10, owner: "Accept and build"). Built in v0.2.939-alpha with torii-suite v0.9.51-alpha. Owner direction before: "FIPS on by default across all apps", "Suite first, then apps", then "Write the Quest FIPS ADR".
- **Date:** 2026-11-09
- **Deciders:** chiefmonkey
- **Related:**
  - ADR-0126 (FIPS two-node background presence), which this widens and does not replace;
  - ADR-0111 (FIPS as founding-layer transport), ADR-0120 (node-owned relay), ADR-0147 (sovereign metaverse), ADR-0148 (one node, every home, Proposed), ADR-0149 (connect-src), ADR-0150 (napplet hosts: FIPS node-side only);
  - torii-suite `docs/adr-0001-fips-on-every-install.md` (Accepted, v0.9.47-alpha), torii-suite `fips/render-config.mjs`;
  - torii-continuum `docs/adr-fips-default.md` (Proposed: peer introductions in one paste);
  - `server/presence/fipsPresence.js`, `server/arena-ws.js`.

## Context

ADR-0126 made FIPS a node transport, not a player feature: Quest reads at most **one** operator-pinned peer's signed `torii-gateway` heartbeat over FIPS first, with WSS fallback, and shows it in the world directory through the `/mp/node-presence` snapshot.

Since Suite ADR 0001, every Suite install runs a FIPS node by default. The one-peer cap is now the main limit: a node can see one other world over the mesh and every other world only over the public relays. The cap is enforced in two places: `fipsPresence.js` (`peers.length > 1` is refused) and the Suite's `render-config.mjs`.

Adding peers today means hand-editing root JSON on both nodes. The Continuum ADR proposes a signed introduction card that writes `/etc/torii/fips/peers.json`; this ADR covers what Quest does with more than one peer.

Browsers can't use FIPS (no browser or WebAssembly build upstream), so every player-facing connection stays as it is.

## Decision

**Quest reads the heartbeat of up to 8 operator-introduced peers, each over FIPS first with WSS fallback, within one fixed overall budget.**

1. **Peer cap 1 → 8.** `peers.json` stays version 1 with the same per-peer fields, pins and checks (signer, owner, world, TTL, clock tolerance, no redirects, public fallback addresses only). It must stay root-owned and not group- or world-writable. The Suite's `render-config.mjs` raises the same cap in the same release.
2. **One budget, not eight.** Peers are polled one at a time, round-robin, at most one in flight. Each peer is read about every 30 seconds while at most 8 are configured, with the ADR-0126 limits per read (2.5 s deadline, 8 frames, 32 KiB, 8 KiB event). A peer that keeps failing backs off (60 s, 120 s, up to 10 min) so it can't use up the others' turns.
3. **RAM only.** Quest holds the latest valid heartbeat per peer in memory (at most 8 × 8 KiB). Nothing is written to the relay or disk.
4. **The snapshot carries all of them.** `/mp/node-presence` keeps its `events` array, now with one entry per live peer (at most 8), plus a `peers` count. The world directory merges them with relay results as it already does, so a world seen both ways appears once. A page from before this release refuses a list longer than one and simply shows the relay results, so nothing breaks while it updates.
5. **Nothing new for players.** No network terminology, controls or waiting. The page never awaits FIPS on startup, travel or rendering.
6. **Still out of scope.** No automatic discovery: peers are only added by an operator, through the Continuum introduction or by hand. No world assets, multiplayer or general relay replication over FIPS.

## Consequences

- **Enables:** a node sees its friends' worlds over the mesh without relying on public relays or DNS for that read; operators add peers without SSH once the Continuum side ships.
- **Forecloses:** an open-ended peer list; more than 8 needs a new ADR (and probably the collector idea ADR-0126 left proposed).
- **Trade-offs:** one bad peer can delay another by at most one read deadline (2.5 s) per round. Total traffic stays within 8 small reads per 30 s.
- **Enforcement:** tests for the cap (8 accepted, 9 refused in Quest and in the Suite), round-robin and no overlap, backoff, per-peer pins, snapshot list and de-duplication, the old single-peer shape, and a regression-check rule that the cap is 8 in both places. The ADR-0126 release gate (p95 frame no more than 5% worse, no extra input stalls) is rerun with 8 configured peers, 4 of them unreachable.

## Implementation notes (v0.2.939-alpha)

- `server/presence/fipsPresence.js`: `MAX_PEERS = 8`, duplicate peers refused (same transport name, or same heartbeat signer and zone), peer file limit 4 → 8 KiB (8 peers fit with room), per-peer RAM state, a round-robin cursor, one timer at `POLL_MS / peers` and backoff 60 s, 120 s, 240 s, 480 s, then 10 min.
- `src/engine/presence/nodePresenceClient.js`: `MAX_PEER_EVENTS = 8`, response limit 8 × 8 KiB + 2 KiB.
- `server/presence/beacon.js`: the public `/mp/admin/beacon` capability also returns `zoneId` and `website`, so the Continuum introduction card can be checked against what the node really publishes (torii-continuum `docs/adr-fips-default.md` §4).
- `createReloadingFipsPresence()` (used by `server/arena-ws.js`) checks the peer file every 30 s and swaps in the new list without restarting the game server, so adding or removing a peer never drops players. A bad new file leaves the reader empty with its error, as at startup.
- Regression check [22] pins the cap in both files and the round-robin timer.

## Alternatives considered

- **Keep one peer.** Leaves FIPS installed everywhere but useful for one neighbour.
- **No cap.** Unbounded polling and memory on small home nodes (ADR-0148).
- **Automatic discovery (peers find each other through relays).** Larger trust and privacy change; stays outside, as ADR-0126 said.
- **Parallel polling.** Faster, but up to 8 sockets at once on small devices; round-robin is enough at 30-second freshness.
