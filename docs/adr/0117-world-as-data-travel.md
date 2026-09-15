# ADR-0117: World-as-data travel (portal client, FIPS-addressed, local-first)

- **Status:** Accepted
- **Date:** 2026-09-15
- **Deciders:** chiefmonkey
- **Related:** ADR-0114 (adopted — this AMENDS its Option B choice to Option A), ADR-0115 (single-instance), ADR-0116 (signed travel token), ADR-0111-DRAFT (founding-stack / FIPS), Blossom/NIP-94, `src/engine/world/worldSchema.js` + `worldLoader.js` + `worldRenderer.js`

## Context

ADR-0114 committed to **Option B (fullscreen iframe)** as the bridge for seamless
travel and named **Option A (world-as-data)** as the future target. On review the
iframe was rejected: pointer-lock/keyboard across a cross-origin iframe is a
perpetual cost for a 3D arena, and it re-downloads the destination's whole site
while contributing nothing the portal client does not do more cleanly. The
decision is now **reversed**: **world-as-data is the architecture**, not object B.

The address bar never changing is a **hard requirement** — "our world is our
asset, our data, local first." A world is already a **data manifest**, not a
self-contained site: `worlds/*/world.json` (terrain, spawns, lights, objects,
combat, foliage, portals) is validated by `worldSchema.validateWorld` and rendered
by `worldRenderer`. The remaining gap for a true portal client is not "define what a
world is" but "stop bundling it locally and start addressing + fetching it by npub."

This also **leans into the Founding Stack** (ADR-0111): a world addressed by its
owner's **npub** (transport collapses into identity) and its content by **hash**
is exactly the FIPS + Blossom/NIP-94 pairing the founding stack commits to.

## Decision

1. **World-as-data is the travel architecture.** Entering a destination world =
   resolve the owner's npub → fetch that world's manifest (content-addressed) →
   render it with the local engine → join the destination's `arena-ws` relay.
   No top-level navigation, no iframe, no address-bar change, no re-login (the
   signed travel token from ADR-0116 carries identity), no duplicate character
   (single-instance from ADR-0115 holds — close socket A before joining B).
2. **A world is a content-addressed bundle.** `world.json` + its referenced assets
   (GLBs, terrain heightfields, textures) are addressed by **sha256 hash** via
   Blossom/NIP-94, and the owner publishes a small **world-reference event** (npub,
   world hash, world version, relay endpoint) so peers can resolve the world by
   npub alone. The `{npub, relay, target}` handoff collapses `relay` into the npub
   (ADR-0111 Decision 2).
3. **Local-first.** The manifest + assets are cached by hash on the client; a world
   already fetched renders offline/local, "our data, our asset," with no landlord.
4. **Staged, browser-first.** Browser players reach remote worlds over the existing
   HTTPS/WebSocket fallback + a Blossom fetch-by-hash, because a WebGL page cannot
   speak FIPS directly yet (ADR-0111 Decision 5). FIPS npub-addressing becomes the
   transport as its node-layer spike matures; nothing here blocks that, and nothing
   in the spike depends on the browser.

## First slice (adoption)

Narrowest end-to-end proof of the seam, over HTTPS first:

1. Publish side — persist the live world's `world.json` + assets, content-hash them,
   and mint a world-reference Nostr event from the owner's npub (version + hashes).
2. Resolve side — `resolveWorldByNpub(npub)` reads the reference event from relays,
   fetches the manifest by hash (Blossom), validates via `worldSchema`, and hands it
   to the existing `worldRenderer`.
3. `_gwOpenVisit` switches from `window.location.href` to the portal-client path:
   stop socket A, resolve + render world B in the same shell, join relay B (auto-auth
   via the token), spawn at the destination gate.

Deferred (not in the first slice): native FIPS transport (ADR-0111 spike), cross-world
authoring/editor, and any change to how softare components are distributed.

## Consequences

- The address bar stays the player's own — the hard requirement is met by
  construction, not by embedding.
- A "world" is finally a sovereign, content-addressed asset: owned by its npub,
  retrievable by hash, cacheable locally, independent of any URL or host.
- The renderer already exists (`worldRenderer`); the work is the resolve path, not a
  new engine.
- Blossom/NIP-94 becomes load-bearing for worlds (it already is for Character Forge
  + Continuum), and FIPS npub-addressing slots in later without refactoring.
- Trade-off: cross-origin manifest/asset fetches introduce a CORS + caching surface
  that did not exist in the iframe (which delegated those to the embedded site).