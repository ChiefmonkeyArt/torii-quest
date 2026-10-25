# ADR-0147: Sovereign metaverse architecture: the Gateway Experience at the centre, every world as data

- **Status:** Accepted (2026-10-23, v0.2.922): "Approve ADR-0147 and use the proposed /quest/w/<npub>/<world> path. Use the full Starter Pack and allow anyone to publish signed components." Each roadmap step ships as its own release, with its own ADR where it changes established behaviour.
- **Date:** 2026-10-23
- **Deciders:** chiefmonkey
  - "Shouldn't all worlds be data driven?"
  - "When I visit another person's world I expect to be in their world … seeing their world directly as they intend it."
  - "When multiple people visit a person's world they must all see that world as the instance owner, the creator, intended, in real time."
  - "I want the best architecture for a genuine metaverse that we all run from our own machines first but our unique digital persona and .glb file remains unique, a single version."
  - "Place a greater mention on the Torii gateway experience, the napplet … it's kind of pivotal to the entire metaverse."
- **Related:**
  - ADR-0143 (the Gate is the product), ADR-0144 (Gate v1 frozen), ADR-0146 (Gate licensing);
  - ADR-0117 (world-as-data travel), ADR-0119 (world serialization), ADR-0125 (full arena builder for the mirror);
  - ADR-0115 (single instance), ADR-0116 (signed travel token);
  - ADR-0057/0058/0082 (napplet shell, surfaces, game host), ADR-0111 (founding stack / FIPS);
  - ADR-0145 (NAP Zone market);
  - `GATEWAY_PROTOCOL.md`, `docs/design/sovereign-metaverse-roadmap.md`.

## Context

Quest has grown two world builders and two travel paths, and the owner asked what the *best* architecture is.

- **Two world builders.**
  - The **classic arena** (`buildArena()`) draws the home world from code.
  - The **data-driven world** (`buildMinimalWorld()` from a signed `world.json`) is drawn whenever a player travels.
  - So a visitor to chiefmonkey.art sees an incomplete copy (gate, crates, coastline) without the NAP Zone, mirror, NPC or market boards. That breaks "everyone sees the world as its owner intends."
- **Two travel paths.**
  - Quest → Quest travel resolves the owner's npub to a signed world reference, hash-verifies the manifest, and swaps the world in place, after a peek through the gate window.
  - Gate v1 (frozen, ADR-0144) is the universal path: a hardened https hand-off with `?torii-traveller=`. It is the only path another engine (e.g. NGE, Java) can use.
- **The doorway is still built into Quest.** The directory, peek, enter and arrival are app code, not the portable napplet that ADR-0143 and the napplet notes describe.
- **Why the address bar didn't change:** ADR-0117 rejected an iframe because of pointer-lock and keyboard pain, re-downloads, re-login and duplicate characters, and recorded "the address bar never changes" as a hard requirement. On review, the URL is not cosmetic. In a browser, the address decides whose code runs and what it can touch.

## Decision

### 1. The Torii Gateway Experience is the centre of the metaverse

The Gateway Experience is the one thing every world has: the in-world torii (the `torii.gateway` component and `torii-gateway-experience.glb`) plus the doorway napplet inside it. It is where:

- **worlds are discovered:** the signed heartbeat directory;
- **a destination is previewed:** the live peek through the gate opening;
- **consent happens:** "enter Bekka's world?", with what identity and what it will see;
- **identity crosses between worlds:** a signed travel ticket, one live session;
- **travel mode is chosen:** enter in place, or hand off (§3);
- **arrival is greeted:** spawn at the destination's gate, with the owner's label.

Because it's in every world, it carries the network effect: a world joins the metaverse by including the Gateway Experience, whatever engine it runs.

**Its boundary** (from the napplet architecture notes, now binding):

| Part | Runs where | Owns | Never owns |
|---|---|---|---|
| Doorway napplet (`nap-torii-world` gate surface) | Sandboxed `srcdoc` iframe, `allow-scripts` only, network denied | Directory UI, selection, peek controls, enter/cancel, status, arrival card | Keys, signing, relays, sockets, travel authority |
| Trusted gate services (host shell) | The engine's trusted side | Heartbeat publish and read with signature checks, world resolution and hash checks, signed travel ticket, socket switch, FIPS (node-side) | UI |
| Engine adapter | Each engine (Quest: Three.js; native: small SDK) | Placing the torii in the world, drawing the peek window, the arrival pose | Protocol rules |

The napplet *asks* (`gate.peek(npub)`, `gate.enter(npub)`). The trusted services check, sign and act. A world author can restyle the doorway napplet without being able to steal a key or force a trip.

### 2. Every world is data, including home

- A world is a **signed, versioned world description** published by its owner's npub. It is content-addressed (sha256 via Blossom) and made of **components** with settings.
- **The owner's own world loads from that same description.** What the owner sees is exactly what visitors see; there is no special copy per person.
- The **classic arena retires.** Its pieces become the **Starter Pack** of components:
  - shore, sea and coastline;
  - NAP Zone, tree and mirror;
  - greeter NPC;
  - PRODUCT board and AUCTION board;
  - signs, crates and the Gateway Experience.
- **The owner's settings travel with the world.** The market boards show the shop the *world owner* configured: own products, another npub, a custom mix, or no shop at all (the store source from ADR-0145). Never the visitor's.

### 3. One gate, two travel modes, chosen automatically

| Mode | When | What happens | Address bar |
|---|---|---|---|
| **Enter** (world-as-data) | The destination publishes a Torii world description your engine can draw | Peek, then an in-place swap, then join the owner's live server | Same site; the path shows the location, e.g. `…/quest/w/npub1…/<world>` |
| **Hand-off** (Gate v1) | The destination is another engine or site, or has no description | Hardened https hand-off with `?torii-traveller=`; identity through the player's own signer | Changes to the destination's site |

- **Enter** keeps your keys inside your trusted client and gives seamless travel. Worlds can't run code on your machine except inside sandboxed napplets.
- **Hand-off** gives the destination total freedom (its own code and engine) and is how the open network reaches beyond Quest.
- The location path makes visits linkable and bookmarkable, makes the back button work, and lets a friend open the link in their own Quest to join.

### 4. Live worlds: everyone sees the same thing in real time

- The **owner's node is authoritative** for its world's live state: players, physics and combat authority, chat.
- **World edits are pushed live.** A new signed world version is announced, and present clients re-fetch it by hash and apply it.
- **Offline worlds:** when an owner's node is off, a cached copy may be viewed but not played.

### 5. One persona, everywhere you are

- **Identity:** the npub. Keys stay in the player's signer (browser extension, remote signer, later hardware). They are never given to a world.
- **Avatar:** one signed avatar record pointing to the `.glb` by its hash. Every world loads the same file, validated against the Character Forge quality and size rules.
- **Presence:** you sign into a world's server on arrival; leaving closes the connection. One live session at a time (ADR-0115) means there is never a duplicate you.
- **Following:** an opt-in "where I am" status lets friends follow you.
- **Cross-world items:** owned through signed records, not stored in any one world.

### 6. Run from your own machine first

- Quest is the player's **metaverse browser**: on their own machine first (browser or PWA now, a desktop app later), with a VPS for always-on worlds and the phone as a client.
- **Networking:**
  - Nostr relays (including the node's own relay) for identity, discovery and messages;
  - Blossom for files;
  - WebSocket now, WebRTC or FIPS later, for live play.

### 7. Builder and component marketplace (later)

- **A Kami-mode world builder:** place, configure and publish Starter Pack components.
- **Shared libraries:** user-made components are signed by their author, addressed by hash and run as sandboxed napplets with only the capabilities they're granted.
- **A component marketplace** is part of the economy layer (Lightning, Cashu, Nostr market events).

## Consequences

- **Enables:**
  - visitors see the world exactly as its owner intends, in real time;
  - one world format for home, travel, preview and the builder;
  - an embeddable, portable Gateway Experience: the thing other engines adopt;
  - linkable locations;
  - a path to user-generated components and their marketplace.
- **Forecloses:**
  - new features that exist only in the classic arena: they must arrive as components;
  - worlds running unsandboxed code inside a visitor's client;
  - the doorway napplet holding keys or sockets.
- **Trade-offs:**
  - migrating the classic arena to components is a large, careful job with a visual parity check;
  - sandboxed components can do less than raw code, until capabilities widen;
  - the owner's node has authority in its own world, so it could cheat there. Signed records keep cross-world items honest.
- **Changes earlier decisions:**
  - Relaxes ADR-0117's "the address bar never changes" to **"the site never changes during Enter; the path shows where you are."**
  - Makes ADR-0143's doorway napplet the *centre* of the design.
  - Leaves the Gate v1 wire format (ADR-0144) unchanged. Hand-off is v1 as frozen; new fields (a world-description pointer, the travel modes a world supports) arrive as §8 extensions.
- **Enforcement:**
  - The roadmap order lives in `docs/design/sovereign-metaverse-roadmap.md` and the todo.
  - Each step lands with tests. Milestone 1 includes a parity screenshot check: home from data must match the classic arena before the classic code is deleted.
  - The Gate v1 conformance suite keeps running unchanged.

## Alternatives considered

- **Keep two builders (classic home, data for visitors):** visitors keep seeing a different world, and every feature is built twice. Rejected.
- **Hand off every trip, never Enter:** whatever site you land on runs its own code with your signer, and travel means a reload. Kept for other engines, rejected as the only mode.
- **Load the other world in an iframe:** pointer-lock and keyboard pain, double downloads, re-login (ADR-0117). Rejected again.
- **Keep the doorway built into Quest:** it can't be embedded by other engines, which defeats ADR-0143. Rejected.

## Owner decisions (2026-10-23)

1. **Location path:** `…/quest/w/<npub>/<world>` (as proposed).
2. **Milestone order:** M1 (home from data + Starter Pack) first, as proposed. The owner raised no objection.
3. **Starter Pack v1:** the **full Starter Pack**. Every classic arena piece becomes a built-in component, catalogued in `src/engine/components/starterPack.js`:
   - `world.island`, `world.sea`, `world.coastline`, `world.bridge`, `world.foliage`;
   - `torii.gate`, `torii.gateway`;
   - `nap.zone`, `nap.tree`, `nap.mirror`, `npc.greeter`;
   - `sign.board`, `market.products`, `market.auctions`;
   - `plebeian.product-display`, `arena.crates`, `game.arena`.
4. **Component publishing: anyone may publish signed components.** There is no approved list. Safety comes from the visitor's client, not from gatekeeping:
   - every third-party component passes the COMPONENTS.md §7 checks before mounting: author signature, bundle hash, asset hashes, declared capabilities;
   - it runs only as a sandboxed napplet with the capabilities it declared and the world owner granted;
   - a world owner chooses which components their world includes, and a visitor can block a component for themselves;
   - built-in Starter Pack components are vetted engine code shipped in the build.

## Milestone 1 progress

- **v0.2.922:** Starter Pack catalogue; travel teardown stops the market boards.
- **v0.2.923:** the home loads its own world description, `worlds/home/world.json` (`src/engine/world/homeWorld.js`):
  - its `components` list gates every migrated piece, in the builder and in physics;
  - unmigrated pieces are always built;
  - the file is fail-safe: a missing, invalid, oversized (64 KB) or over-long (256 entries) file gives the full pack, and the ground (`world.island`) is always kept;
  - group 1 (`world.island`, `world.sea`, `world.coastline`) is built through **host-backed built-in components** (`starterPackComponents.js`), which keep the registry free of THREE. `mount` calls the host's builder from `ctx.hostBuilders[id]`; with no builder it is a reported no-op.
  - Checked headless: the full file reproduces the classic home; a file listing only island, NAP Zone and gateway drops the sea, coastline and crates with no errors.
- **v0.2.924:** the shipped home description is **bundled into the app**:
  - why: on a VPS, `/quest/worlds/` is the operator's own `data/worlds/` (seeded once by torii-suite, only `default/`, never overwritten), so v0.2.923's new file returned 404 live and the home fell back silently;
  - load order: the operator's `data/worlds/home/world.json` (their override) → bundled description (`source: 'bundled'`, a 404 is normal and silent) → full pack;
  - a torii-suite follow-up may seed missing templates without overwriting; it isn't needed for correctness.
- **v0.2.925, group 2:** `nap.zone` (zone accent light), `nap.tree` (tree + trunk collider via `OBSTACLE_OWNERS`), `nap.mirror`, `npc.greeter`. The mirror and the deferred greeter build are gated in `arenaRuntime` by the same plan. The NAP no-combat rule stays on: the game server enforces it and will follow the world description once servers read it (M5). Checked headless: trimmed → no light, tree or mirror, no errors.
- **v0.2.926, group 3:** `sign.board` (all NAP signboards), `market.products` and `market.auctions`, each optional on its own:
  - `initMarketBoards3d({products, auctions})`: without `market.products` the stall stays a plain sign;
  - with no AUCTION board there are no bid subscriptions (no sockets);
  - the VIEW prompts appear only for boards that exist (`marketBoardHas`);
  - both boards need `sign.board`;
  - `plebeian.product-display` is placed by data worlds; the classic home has none.
  - Checked headless: auctions only, no signs, and full all behave correctly with no errors.
- **v0.2.927, group 4:**
  - `world.foliage`: the async grass build is gated in `arenaRuntime`;
  - `world.bridge`: meshes + both deck colliders;
  - `torii.gate`: mesh, light and the two pillar colliders via `OBSTACLE_OWNERS`.
  - **Always on:**
    - `torii.gateway`: the Gateway Experience is how every world joins the metaverse (§1);
    - `game.arena`: combat is server-authoritative, so the client can't drop it alone; it follows the description in M5 when servers read it.
  - The Starter Pack is now 16 of 17 built-in components.
  - Checked headless: a bare island (ground, sea, signs) builds with no errors; full = classic.
- **v0.2.930, travel teardown removes physics too.** Found while preparing visitor parity: leaving the classic home swept its meshes but left its physics behind. In the destination that meant invisible ground, shore wall, crates, obstacles and bridge decks, plus 4 visible push-around crates.
  - `bodies.collectStatics` / `removeStatics` record and remove exactly the home's statics; `physics.disposeArenaColliders`;
  - `dynamicCrates.disposeDynamicCrates` frees bodies as well as meshes; the push-around crates join `arena.crates`.
  - Headless: Rapier colliders 1,210 → 2 after travel (player + the destination's platform), 0 crates.
  - The test seam `ToriiDebug.world.visit(id)` travels to a bundled same-origin world (schema-validated).
- **v0.2.931, visitors build the owner's Starter Pack island.** The published world now carries `base: 'starter-island'`, the home description's `components` and `owner` (the configured owner's hex key).
  - **Schema:** an unknown `base` or a bad `owner` is dropped, not an error, so newer worlds still render on older clients.
  - **Back-compat:** the manifest keeps its inline terrain, sea and foliage, so older clients still render it as plain data.
  - **Server:** reads the home description with the browser's planner (env `QUEST_HOME_WORLD_JSON_PATH` → operator `data/worlds/home/world.json` → release copy → bundled).
  - **Client:** the visitor's Quest builds the island with the same engine code as home, from that world's list (`_buildVisitedStarterIsland`), with colliders, crates, foliage, mirror and greeter as listed.
  - **Boards:** they show the destination owner's store (`setBoardOwnerOverride`) or stay off when no valid owner is given; never the visitor's own shop. Cached listings are neither shown nor saved while visiting.
  - **Home-only behaviour stays at home:**
    - the Plebeian Market portal (it opens this node's market);
    - local bots and combat when the world leaves out `game.arena`;
    - a greeter that's left out is hidden and its sticker sensor switched off.
  - **Homecoming:** a classic home reloads; a data home rebuilds in place.
  - **Leak fix:** the mirror's reflection render target is now freed on travel (`disposeMirror`).
  - **Trust:** `owner` is asserted by the world's publisher (beacon-signed reference). At worst a world shows someone else's public listings; signatures on listings are still verified.

- **v0.2.932, classic home path retired (M1.5); `game.arena` follows the description.**
  - **The home is a world:** `worlds/home/world.json` says `base: 'starter-island'`. A description without `base` is still read as an island, so existing operator files keep working. `loadHomeWorld` returns the home as a world as well as its plan.
  - **One island builder:** boot, visits and homecoming all run the same helpers (`_islandScene`, `_islandPhysics`, `_islandFoliage`, `_islandMirror`, `_islandNpc`, `_islandPortal`). `buildArena()` is now only the Starter Pack builder; there is no separate home path.
  - **Homecoming:** rebuilds the island in place; the page reload is gone. Multiplayer is pointed back at this node's socket, which fixes a data-world home re-joining the visited server.
  - **Parity check (M1.3):** headless, the v0.2.931 boot and the v0.2.932 boot have identical scene inventories (126 meshes, 1,210 colliders, 67 named objects, both boards). Home rebuilt after a visit matches home booted.
  - **Leaks fixed by the parity check:**
    - signboards were never rebuilt after travel (also missing for visitors in v0.2.931); now `disposeProofSurfaceMeshes` runs on teardown;
    - a data world's platform collider survived into an island as an invisible slab;
    - the NAP market portal mesh floated in other worlds.
  - **Combat:** the client runs no bots and takes no shots when the active world leaves out `game.arena` (home or visit). The server runs its game zone only when the home description includes `game.arena`. Both read the same file, so they always agree.
  - **Not in scope:** a home that is a whole data world (not an island) needs portable terrain assets, so it waits for the builder (M6). The `torii-world` meta flag stays a developer override.

- **v0.2.933, world links (M3.1–M3.2).**
  - **The path:** `<app root>w/<npub>[/<world>]`, e.g. `/quest/w/npub1…/torii-quest`. Parsed and built by `src/engine/location/worldPath.js`. The npub must be a well-formed bech32 npub and the world id a lowercase slug (`[a-z0-9][a-z0-9_-]{0,63}`); anything else is ignored (fails closed). No world id means "this owner's current world".
  - **The shell:** the inline bootstrap computes the app root (the path before `/w/npub1`) and imports the entry bundle and icons from there, so a deep link loads the same shell. The VPS already serves `index.html` for any `/quest/…` path.
  - **The address bar follows the player:** walking through 入 pushes the world path; coming home pushes the app root. Back/Forward replays it: back to home rebuilds home in place (`returnHome()`, re-dialling this node's socket); back to a world reopens the gateway pre-peeked at it and the player presses 入 (travel stays gate-only, as since v0.2.867). Worlds resolved this session are cached (hash-verified, 32 max), so that peek is instant.
  - **Opening a link:** after ENTER, the gateway screen opens pre-peeked at the linked world. The player still presses 入; a URL alone never moves anyone. A link to this node's own world does nothing.
  - **One world per link:** the resolver takes an optional `worldId` and keeps only references whose `d` tag matches.
  - **Published URLs:** presence `website`, the gateway spawn URL and the live probe now use the app URL, never the link the tab happens to be on.
  - **Found, not fixed here:** 入 looks armed before the peek resolves, so an early press does nothing (the M2 napplet adds a host-confirmed "ready"). The repo CSP's `connect-src` lists fixed relays only; where it is enforced, Blossom manifests and other nodes' relays are blocked. chiefmonkey.art (nginx) sends no CSP header. Owner decision needed.
  - **Not yet:** automatic mode choice (M3.3: Enter for Torii worlds, Gate v1 hand-off for others).

- **v0.2.934, the Gateway napplet (M2).**
  - **The doorway is a napplet:** the directory, the "looking at" bar, 入 and ✕ run in a same-origin iframe with `sandbox="allow-scripts"` (opaque origin: no storage, no cookies, no parent DOM) and their own CSP (`connect-src 'none'`, no images, no frames, no forms). The canonical source is the 0BSD kit folder `conformance/gateway-v1/napplet/`; Quest ships it at `<base>napplets/gateway/`.
  - **The host keeps all authority:** heartbeat reads, world resolution with hash checks, the travel ticket and the socket switch stay in the shell. The napplet only asks (`gate.peek {key}`, `gate.enter`, `gate.close`) and every message must carry the per-mount nonce, come from that frame, and name a row the host itself sent. Rows carry display strings only; endpoints and relays never cross.
  - **Host-confirmed ready:** 入 stays disabled until the host has resolved the world (`gate.peek {ready:true}`). This fixes the early-press finding from v0.2.933. A late resolve for a world the player has clicked away from is dropped.
  - **Engine adapter:** the torii, the 3D peek and arrival stay in the engine; the peek view crosses as a transferable `ImageBitmap` the napplet draws.
  - **Portability proof:** the engine-free reference world mounts the same files (`reference-world/doorway.html`).
  - **Restyling without authority:** the host may send colour variables (`--gw-*`, hex/rgb only), validated on both sides.
  - **Page CSP:** `frame-src 'self'` (previously unset, so `default-src` applied).
  - **Not yet:** the arrival card is still host-drawn.

## Open owner decisions (resolved above)

1. **Location path format:** `…/quest/w/<npub>/<world-id>` (proposed) or `…/quest/#/w/<npub>`.
2. **Milestone order:** whether the home-from-data move (Milestone 1) goes before the Gateway Experience extraction (Milestone 2). Proposed: 1 first, because the gate becomes a component of the world.
3. **Starter Pack contents for v1** (list in the roadmap).
4. **Component trust:** who can publish components that others may add (anyone signed, or an approved list first).
