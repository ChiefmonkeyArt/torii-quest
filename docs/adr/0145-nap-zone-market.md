# ADR-0145: NAP Zone market: automatically show people's shops, products and auctions (Accepted)

- **Status:** Accepted 2026-10-22. All four recommendations approved by the owner ("Accept all four market recommendations and continue"). Slice 1 shipped in v0.2.915-alpha.
- **Date:** 2026-10-21
- **Deciders:** chiefmonkey ("Soon we want to automatically pull in peoples shop and their products and auctions to the NAP Zone")
- **Builds on:** ADR-0026 (watch-only Plebeian client), ADR-0035 (owner-scoped product/auction boards), ADR-0140 (Applesauce relay layer), ADR-0144 (Gate v1 extensions)

## Today

Quest reads Plebeian listings watch-only:
- products: NIP-99 kind 30402;
- auctions: kind 30408 (`auction_v1`);
- bids: kind 1023.

It shows them on three owner-scoped NAP boards (ADR-0035) and hands every payment or custody action back to Plebeian.

Two gaps:
- **No owner key in the browser.** The board owner is `ADMIN_PUBKEY_HEX`, which comes from the server environment and is `''` in the browser.
- **One seller only.** Nobody else's shop can appear.

## Proposal (to confirm before building)

1. **Owner from the world, not the build.** Board owner = this world's resolved owner, from the instance capability endpoint or the heartbeat owner (`p` tag), so every operator's NAP Zone shows their own shop automatically.
2. **More sellers, by the owner's choice.** The owner curates a NIP-51 list of seller npubs (or opts in "people I follow" / "visitors who opt in"). Each seller gets a stall in the NAP Zone with their products, live auctions and past auctions, read from their relays.
3. **Shop metadata.** Stall name, banner and picture come from the seller's Plebeian shop record. The exact event kind is to be confirmed read-only against `PlebeianApp/market`, with no edits there without approval. Profile (kind 0) is the fallback.
4. **Gate extension, additive (ADR-0144 §8):**
   - a heartbeat MAY carry `["market", "plebeian"]` and `["market-relay", <wss>]`;
   - doorways can then show "this world has a market" before you travel;
   - v1 readers ignore it, so no protocol version change.
5. **Same trust boundary as now.**
   - Watch-only: no keys, payments or bids in Quest; "Buy" and "Bid" open Plebeian.
   - Listings are signature-checked and sanitised like heartbeats (https images only, text stripped, sizes capped).
   - Bids shown are labelled unconfirmed unless Plebeian's settlement evidence agrees (Plebeian #1112 / PR #1170).
6. **Transport.** Built on the Applesauce relay layer once the ADR-0140 trial lands. Its EventStore and live subscriptions fit "many sellers, live updates". Until then, one batched subscription per relay.
7. **Performance budget:**
   - lazy-loaded when the NAP Zone is active;
   - images through the existing compressed texture path;
   - at most N stalls visible at once (N set by the quality tier);
   - nothing in the arena or entry chunks.

## Open questions for the owner

- Who appears by default: only the owner, the owner's curated list, people they follow, or visitors who opt in?
- Do visiting players' shops show while they're present?
- Physical layout: one stall per seller, a market street, or a wall of boards?
- Which Plebeian relay set is authoritative now that the dev and production instances have split?

## Preparation findings (v0.2.913-alpha, 2026-10-22)

**Read-only look at `PlebeianApp/market`** (main branch, d4757b4, 2026-10-17; nothing changed there):
- **There's no dedicated shop or stall event.** A shop is the seller's profile (kind 0) plus their NIP-99 products (kind 30402) and collections (kind 30405).
- **Plebeian already has curated lists** (`src/lib/schemas/featured.ts`):
  - `featured_products`: kind 30405;
  - `featured_collections`: kind 30003;
  - `featured_users`: kind 30000 (NIP-51, with `p` tags).

  Quest can reuse the NIP-51 kind-30000 + `p` format for the owner's seller list, with no new schema.
- **Relays:** `relay.plebeian.market` (production) and `relay.staging.plebeian.market` (staging).
- **Auctions** (kind 30408, bids 1023) live on Plebeian's `auctions` branches, not main. Quest reads them from staging today.

**Quest bug confirmed.** `ownerBoards.start()` returns early when `ADMIN_PUBKEY_HEX` is empty, which it always is in the browser, so the NAP boards never load. The live page already carries the owner key in `<meta name="torii-host-pubkey">`, which `_hostIdentity()` reads.

## Implementation plan (each slice ships as its own release)

1. **Owner fix.** The boards' author comes from `_hostIdentity()`, falling back to `ADMIN_PUBKEY_HEX`. Tests cover meta present, absent and malformed. Every operator then sees their own products and auctions.
2. **Market data layer** (lazy chunk, on the shared Applesauce pool):
   - one subscription while the NAP Zone is active, for `authors = sellers` and kinds 0, 30402, 30405, 30408, plus 1023 by `#a` for live auctions only;
   - every event signature-verified (with the cached verifier) and parsed through the existing `boardModel` / `auctionModel` sanitisers;
   - its own size budget, enforced like `budget:applesauce`, with no entry growth beyond 1 KB.
3. **Seller list:**
   - owner + an owner-curated NIP-51 kind-30000 list (`d: torii-nap-sellers`, `p` tags, the same format as Plebeian's `featured_users`);
   - capped at 12 sellers;
   - edited first through a console or settings helper that signs with the owner's NIP-07 key, which needs owner approval per publish.
4. **Stalls in the world:**
   - one stall per seller, showing name and avatar from their profile, products, live auction and past auction;
   - at most N stalls rendered, set by quality tier;
   - images only through the compressed texture path, https only.
   - "Buy" and "Bid" open Plebeian (watch-only).
5. **Gate extension.** The heartbeat MAY carry `["market","plebeian"]` and `["market-relay", wss]`. Doorways show a market badge. v1 readers ignore it, and new fixtures cover it.
6. **Real-GPU and phone check.** Frame time in the NAP Zone with the maximum number of stalls, using the freeze meter.

## Owner decisions (2026-10-22): all four recommendations accepted

| Question | Recommendation |
|---|---|
| Who appears by default? | **Refined by the owner, 2026-10-22:** the instance owner's npub by default. The owner can instead select someone else's npub, or build a custom store by adding individual products and auctions. Shipped v0.2.916. |
| Do visiting players' shops show? | Not in v1. **Owner's direction:** later, every shop owner can see their shop in the virtual world, and possibly a mapped-out virtual marketplace where many people browse many shops. |
| Layout | A market street: stalls along the NAP edge, the nearest N rendered. |
| Relays | Products and profiles from `relay.plebeian.market` plus each seller's NIP-65 relays. Auctions from staging until Plebeian ships auctions to production. |

## Slice 1 shipped (v0.2.915-alpha)

- New `src/engine/plebeian/boardOwner.js`:
  - `resolveBoardOwner()` checks `window.__toriiHostPubkey`, then `<meta name="torii-host-pubkey">`, then `ADMIN_PUBKEY_HEX`.
  - `mergeOwnerEvents()` keeps only events signed by the owner with a valid signature, newest per listing, across relays. A relay can't slip a forged or foreign listing into the owner's stall.
- `ownerBoards.js`:
  - one subscription per relay: products from `PLEBEIAN_PRODUCT_RELAYS` (production + staging), auctions from `PLEBEIAN_AUCTION_RELAYS` (staging);
  - sockets close when the boards hide, so an unreachable relay no longer retries every 3 s all session.
- **Checked 2026-10-22:**
  - `relay.plebeian.market` answered HTTP 502;
  - staging holds the live host's 1 product, 1 auction and a profile, and both listings pass the new signature filter.

## Next

- **Slice 2:** the market data layer on the shared Applesauce pool (lazy chunk with its own size budget).
- **Slice 3: replaced by the store source (v0.2.916).**

## Store source shipped (v0.2.916-alpha)

The owner refined decision 1 on 2026-10-22: the store shows the instance owner's npub by default, with the option to pick another npub or build a custom store. It's stored in one owner-signed NIP-51 set, with no new kind:

- kind `30003`, `d: torii-nap-store`;
- `["p", <hex>]`: show that seller's shop;
- `["a", "30402|30408:<pk>:<d>"]`: a custom store of exactly those products and auctions, max 24. `a` wins over `p`;
- no tags, or no event: the owner's own shop.

How it works:
- The boards start straight away with the owner's shop. They also subscribe to the owner's store set and switch when one arrives.
- Only a set signed by this world's owner counts, and every listing is signature-checked.
- Custom stores accept only the chosen coordinates.
- The console helper is `ToriiDebug.napStore.preview({...})` / `.publish({...})` / `.state()`, lazy-loaded.
  - `publish` signs through NIP-07 and refuses unless the signer is this world's owner.
  - It publishes to `PLEBEIAN_PRODUCT_RELAYS`.
  - `naddr1…` links (as Plebeian shares them) and raw coordinates are both accepted.
- Live check: the real module against staging loaded the owner's 1 product and 1 auction, and closed all 5 sockets on hide.

## Later (owner direction)

- Every shop owner can see their own shop in the virtual world.
- A mapped-out virtual marketplace with many shops to browse.
- Builds on the Gate `market` extension (slice 5) and opt-in presence.
