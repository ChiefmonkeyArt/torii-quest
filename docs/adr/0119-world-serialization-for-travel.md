# ADR-0119: World serialization for travel (publish half of world-as-data)

- **Status:** Accepted
- **Date:** 2026-09-16
- **Deciders:** chiefmonkey
- **Related:** ADR-0117 (world-as-data travel — this completes its publish half), ADR-0118 (portal live mirror), `src/engine/world/worldSchema.js`, `worldLoader.js`, `worldRenderer.js`, `worldPublisher.js`, `worldResolver.js`, `server/presence/beacon.js`, `src/terrain/heightmap.js`, `worlds/default/world.json`

## Context

ADR-0117 made **world-as-data the travel architecture** and stated "a world is a
content-addressed bundle (`world.json` + its referenced assets) and the owner
publishes a world-reference event so peers resolve the world by npub alone." The
RESOLVE half was built and shipped (v0.2.858 in-place travel, v0.2.859 live
mirror): `worldResolver.resolveWorldByNpub` discovers a signed kind-30078
`torii-world` event, hash-verifies the manifest, and `worldRenderer.buildMinimalWorld`
renders it — no navigation, address bar unchanged.

Live relay probing on 2026-09-16 found the PUBLISH half is **unwired end-to-end**:

1. **Zero `torii-world` reference events exist on any relay.** `worldPublisher.js`
   (`prepareWorldReference` / `publishWorldReference`) is a finished, tested module
   but no runtime code ever calls it. Every travel click therefore fails-closed
   (resolve finds nothing → "nothing happens").
2. **The always-on server beacon (`server/presence/beacon.js`) republishes presence
   with `title: 'Torii Quest'` and no `displayName`, `avatar`, or `wsEndpoint`.** The
   directory label falls back to `title` (identically "Torii Quest" for every
   resident) and the live-mirror tier has no `wsEndpoint` to dial.
3. **The running worlds are the legacy arena (`worlds/default/world.json`, mode
   `arena-shooter`), but travel resolves the data-driven schema** (`version:1`,
   singular `terrain`, `objects`, `sky`, `spawn`). The arena's terrain is
   procedurally generated (three deterministic Mitsudomoe islands in
   `src/terrain/heightmap.js`); combat/bots/NAP bounds live in the legacy config.

The op chose "build the real world, not a placeholder": a node must self-publish
the world a traveller is actually walking into.

## Decision

A node serializes its **running world into a single self-contained, content-addressed
manifest** whose one sha256 pins the entire world (terrain heightfields inlined, not
referenced), then signs and publishes a `torii-world` reference event and stamps the
presence record with `displayName`, `avatar`, and `wsEndpoint`.

Specifically:

1. **Inline the terrain heightfields into `world.json`.** Each zone (arena + NAP) is
   sampled from the deterministic pure `heightmap.js` generator
   (`buildArenaHeightfieldArray` / `buildNapHeightfieldArray`) into a compact numeric
   `heights` array plus `rows`/`cols`/`scale`/`offset`. One blob = one hash = the whole
   world; no multi-blob assembly on resolve, and the hash pins the exact ground the
   traveller will stand on, version-independently.
2. **Extend `worldSchema` to carry the full arena**: `terrain` accepts a *zones* list
   (the three-island layout is not one heightfield), plus `combat` (bot/boss/damage
   config) and `bounds` (arena/NAP geometry) so `arena-shooter` mode survives the trip.
   The existing singular `terrain` + `source` module-path form is preserved for
   locally-shipped worlds.
3. **Serialization is a pure, node-safe translation** (new `src/engine/world/` module):
   legacy `worlds/default/world.json` config + heightmap exports → portable
   `version:1` manifest. No THREE, no DOM, fully unit-testable; the host injects the
   heightfield arrays + config so the pure leaf stays transport-free.
4. **The server beacon publishes the world reference + enriched presence.** The
   resolver (`_gwOpenVisit` → `resolveWorldByNpub`) looks the reference up by the
   presence SIGNER's pubkey (`world.pubkey` = the beacon's persistent instance key when
   the server beacon is enabled), so the beacon CAN sign the reference with its own key
   and it will be found. On enable/pulse the node (a) serializes its active world
   (`worlds/default/world.json` + the sampled tomoe heightfields via
   `buildArenaHeightfieldArray`/`buildNapHeightfieldArray`), (b) uploads the manifest to
   Blossom via a node-safe BUD-11 auth upload (`server/world/blossomUpload.js`), (c)
   signs + publishes the `torii-world` reference (`server/world/worldPublish.js`,
   `beacon.publishWorldOnce`), and (d) stamps `displayName` + `avatar` + `wsEndpoint`
   into the presence event (the directory label + the live-mirror dial). The admin's
   kind:0 name/avatar and the node's `wss://host/mp` endpoint complete the record;
   owner attribution (the `p` tag, used for the directory's human label) is distinct
   from the reference author. Slice 4 SHIPPED in v0.2.861-alpha.

## Consequences

- **Enables:** travel lands a player in the *genuine* destination world (matching
  terrain, objects, lighting, spawn, combat config) rather than a placeholder; the
  live mirror has a real `wsEndpoint` to stream; directory rows show the owner's name.
- **Forecloses:** a world is no longer implicitly "whatever the local build happens to
  render" — it is an explicit, hash-pinned artifact that must round-trip through the
  serializer for its content address to be stable.
- **Trade-offs:** the manifest grows (inlined heightfields ≈ tens–hundreds of KB);
  we accept one Blossom upload per world instead of a lean reference-only event.
- **Enforcement:** serializer + schema changes ship with unit tests covering
  legacy→portable round-trip and hash stability; `npm run check`/`test:release` remain
  green; the beacon publish path is tested node-side with injected transports.

## Alternatives considered

- **Publish a data-driven template (placeholder) per node** — fastest demo, but lands
  travellers in a generic world, undermining the "live mirror" UX. Rejected by the op.
- **Reference the procedural generator by module path** — leanest manifest, but the
  hash then does not pin the ground (a generator change silently changes every world)
  and breaks cross-version travel. Rejected in favour of inlined, hash-pinned heights.
- **Extend to a multi-blob bundle (manifest + separate terrain blob)** — cleaner
  separation but adds multi-blob resolve assembly now, for no v1 benefit over inlining.

## Notes

- `src/terrain/heightmap.js` exports `buildArenaHeightfieldArray()` /
  `buildNapHeightfieldArray()` and full grid metadata (`colsX`, `rowsZ`, `cellW`,
  `cellD`, `gMinX/gMaxX/gMinZ/gMaxZ`). The arena is `targetCell: 0.32`, `amp: 0.5`;
  NAP is `amp: 0.35`.
- `worlds/default/world.json` already holds the legacy `combat`, `bounds`, `spawns`,
  `objects`, `lights`, `foliage`, `portals` — the serializer translates these, adding
  only the inlined heightfields.
- Relay probe (2026-09-16) confirmed the two live operators publish `torii-gateway`
  presence (`d: quest-torii`) with `displayName: null`, `wsEndpoint: absent`, and no
  `torii-world` reference anywhere.