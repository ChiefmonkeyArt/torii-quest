# Sovereign metaverse roadmap (ADR-0147)

The order of work that takes Torii from "Quest plus a gate" to an open, sovereign metaverse. Every step:

- ships as its own release, with the Update-All checklist;
- stays inside the frozen Gate v1 wire format (new fields only as §8 extensions);
- keeps the points frozen.

## Milestone 1: one world format (home from data)

1. **Starter Pack components** (full pack, owner-approved; catalogue `src/engine/components/starterPack.js`). Express the classic arena as `world.json` components:
   - `world.shore`: sea and coastline wall;
   - `nap.zone`: floor, tree and lights;
   - `nap.mirror`;
   - `npc.greeter`: the owner's NPC;
   - `market.products` and `market.auctions` boards: they read the **world owner's** store setting (own, another npub, custom mix, or none);
   - `sign.*` and `arena.crates` (exists);
   - `torii.gateway` (exists): the Gateway Experience frame.

   Built one group at a time, each its own release:
   - **Group 1, done in v0.2.923:** `world.island` (both ground meshes + heightfields), `world.sea`, `world.coastline` (wall + its colliders); `arena.crates` now gated too.
   - **Group 2, done in v0.2.925:** `nap.zone`, `nap.tree`, `nap.mirror`, `npc.greeter`.
   - **Group 3, done in v0.2.926:** `sign.board`, `market.products`, `market.auctions` (`plebeian.product-display` is data-world only).
   - **Group 4, done in v0.2.927:** `world.foliage`, `world.bridge`, `torii.gate`. `torii.gateway` is always built (how a world joins the metaverse); `game.arena` waits for M5 (server-authoritative combat).
2. **Home loads its own `world.json`.** **Started in v0.2.923:** the home reads `worlds/home/world.json` at boot. Its `components` list decides which migrated pieces are built; pieces not migrated yet are always built. A missing or invalid file falls back to the copy bundled in the app (v0.2.924), then the full pack, and `world.island` is always kept. Operators customise by creating `data/worlds/home/world.json`, which updates never overwrite. Next: visitors build from the same description, so chiefmonkey-template stops being a partial copy.
3. **Parity check.** Screenshot the same viewpoints from the classic arena and the data home. They must match before anything is deleted.
4. **Travel teardown.** Leaving a world stops its board feeds, sockets and textures (fixes the v0.2.920 background-feed leak). **Done in v0.2.922.**
5. **Retire the classic arena.** Delete `buildArena()`'s home path; keep the mirror builder only as long as it's needed.

## Milestone 2: the Gateway Experience napplet

1. **Extract the doorway** into a napplet (`nap-torii-world` gate surface): directory, selection, peek controls, enter/cancel, status, arrival card. It runs sandboxed (`allow-scripts`, network denied).
2. **Trusted gate services** in the host shell:
   - heartbeat publish and read with signature checks;
   - world resolution with hash checks;
   - the signed travel ticket;
   - the socket switch.
   The napplet only *asks*: `gate.peek(npub)`, `gate.enter(npub)`.
3. **Quest engine adapter:** places the torii and draws the peek window and arrival.
4. **Portability proof:** mount the same napplet in the engine-free reference world (`conformance/gateway-v1/reference-world/`).
5. **Restyling:** a world author can theme the doorway napplet without gaining any authority.

## Milestone 3: location and links

1. The location path: `…/quest/w/<npub>/<world>` (owner-approved). The back button goes to the previous world.
2. Opening a link in your own Quest joins that world (Enter mode).
3. **Automatic mode choice.** A destination with a Torii world description gets Enter; others get the Gate v1 Hand-off. A §8 extension lets a heartbeat point at its world description and say which modes it supports.

## Milestone 4: one persona

1. **One signed avatar record** pointing to the `.glb` by its hash (Blossom), checked by the Character Forge validator and quality tiers.
2. **Presence:** sign in on arrival, close on leaving. One session at a time (ADR-0115), shown in the directory.
3. **Opt-in following:** friends can follow you between worlds (live-following).

## Milestone 5: live worlds

1. **Signed world versions:** the owner's node announces a new version, and present visitors re-fetch it by hash and apply it.
2. **Edit propagation:** the owner's edits appear for everyone in the world within seconds.
3. **Offline view:** when an owner's node is off, a cached copy can be viewed but not played.

## Milestone 6: the builder and the component marketplace

1. **Kami-mode world builder:** place, configure and publish Starter Pack components.
2. **User components:** anyone may publish (owner-approved). Signed by their author, addressed by hash, run as sandboxed napplets with granted capabilities. The COMPONENTS.md §7 checks run in every visitor's client.
3. **A component library and marketplace** (Lightning, Cashu, Nostr market events).
4. **Virtual market street:** many sellers' stalls in one world (ADR-0145, later).

## Milestone 7: proven open

1. **G3:** a second engine (NGE first) travels both ways through the Gate.
2. **G4:** a NIP draft for the Gate.
3. **FIPS** npub-addressed transport between nodes, as the spike matures.

## Open owner decisions

All resolved (2026-10-23): the `/quest/w/<npub>/<world>` path, M1 first, the full Starter Pack, and anyone may publish signed components.
