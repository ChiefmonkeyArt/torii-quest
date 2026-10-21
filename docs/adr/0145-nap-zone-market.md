# ADR-0145: NAP Zone market: automatically show people's shops, products and auctions (Proposed)

- **Status:** Proposed (plan only, nothing built)
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
