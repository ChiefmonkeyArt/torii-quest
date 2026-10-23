# Sovereign metaverse roadmap (ADR-0147)

The order of work that takes Torii from "Quest plus a gate" to an open, sovereign metaverse. Every step:

- ships as its own release, with the Update-All checklist;
- stays inside the frozen Gate v1 wire format (new fields only as §8 extensions);
- keeps the points frozen.

## Milestone 1: one world format (home from data)

1. **Starter Pack components.** Express the classic arena as `world.json` components:
   - `world.shore`: sea and coastline wall;
   - `nap.zone`: floor, tree and lights;
   - `nap.mirror`;
   - `npc.greeter`: the owner's NPC;
   - `market.products` and `market.auctions` boards: they read the **world owner's** store setting (own, another npub, custom mix, or none);
   - `sign.*` and `arena.crates` (exists);
   - `torii.gateway` (exists): the Gateway Experience frame.
2. **Home loads its own `world.json`.** chiefmonkey-template becomes the full world, not a partial copy.
3. **Parity check.** Screenshot the same viewpoints from the classic arena and the data home. They must match before anything is deleted.
4. **Travel teardown.** Leaving a world stops its board feeds, sockets and textures (fixes the v0.2.920 background-feed leak).
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

1. The location path: `…/quest/w/<npub>/<world-id>` (format to confirm). The back button goes to the previous world.
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
2. **User components:** signed by their author, addressed by hash, run as sandboxed napplets with granted capabilities.
3. **A component library and marketplace** (Lightning, Cashu, Nostr market events).
4. **Virtual market street:** many sellers' stalls in one world (ADR-0145, later).

## Milestone 7: proven open

1. **G3:** a second engine (NGE first) travels both ways through the Gate.
2. **G4:** a NIP draft for the Gate.
3. **FIPS** npub-addressed transport between nodes, as the spike matures.

## Open owner decisions

See ADR-0147, "Open owner decisions": the path format, milestone order, Starter Pack v1 contents, and the component trust policy.
