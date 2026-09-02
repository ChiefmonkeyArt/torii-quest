# ADR-0026 — Spatial Marketplace: Quest as a watch-only Plebeian client

**Status:** Accepted (slices 1-2 shipped v0.2.635-alpha; slice 3 shipped v0.2.636-alpha)
**Version:** v0.2.636-alpha
**Date:** 2026-08-23
**Type:** Feature direction (new subsystem; no gameplay behaviour change)
**Follows:** ADR-0025 (Kami Mode)
**Related:** ADR-0021 (NAP zone layout), the Napplet Architecture (draft), the Gateway Protocol

## Context

The Torii vision is a world a person builds and inhabits, where commerce is
native: sell products, sell time, hold auctions, hold LIVE auctions, and create a
world of your choosing. The pieces already exist, independently:

- **Torii Quest** is the 3D world + the napplet host shell. Its NAP zone already
  contains a read-only "product panel" (`productPanel.js`) whose note reads
  "Plebeian/Nostr market stall; previews one listing read-only. No checkout/pay/
  zap." and whose view-model "carries a link OUT to the marketplace and NO
  checkout/pay/zap/publish."
- **Plebeian Market** (`PlebeianApp/market`) is a complete Nostr-native marketplace:
  NIP-99-based product listings, auctions (bid/confirm/settlement events), NIP-60
  Cashu wallets, NIP-53 live auction chat, listing-scoped NIP-17 buyer-seller
  DMs, Lightning/Nutzap settlement. **The Torii maintainer is the founder and
  owner of Plebeian** (`github.com/PlebeianApp`), so Quest is a first-party
  client of its own marketplace protocol — not a third-party integration. The
  Plebeian repo remains a separate codebase; this ADR's client lives in
  `torii-quest` and consumes Plebeian's published Nostr events read-only.
- **Freedom tech stack** — Nostr identity (NIP-07), Cashu ecash, Lightning,
  Routstr pay-per-request inference.

The gap: nothing in the 3D world is wired to a real Plebeian listing. The product
panel renders a static view-model, not live marketplace data.

## Decision

**Quest becomes a spatial client of Plebeian — a "watch-only client" rendered as
places.** Plebeian remains the commerce protocol and engine. Quest renders
listings/auctions/wallets in-world as stalls, shops, auction rooms, service booths,
galleries, and live-event spaces, and links OUT to Plebeian for any action that
touches custody or payment.

This is explicitly spec-sanctioned. The gamma_spec (`gamma_spec.md`, PlebeianApp/
market) defines a **watch-only client**: "applications that allow users to display
products without implementing full e-commerce capabilities... product rendering
alone can be sufficient." Quest's first marketplace slice is a watch-only client
that renders real kind-30402 listing events inside the NAP zone.

### Boundary — Quest never becomes custody or payment authority

- Quest **renders and proposes**. It reads public Nostr/Plebeian events and
  displays them. It never holds private keys, never locks or releases Cashu
  proofs, never settles, never signs payment authorisation autonomously.
- Any bid / buy / checkout is a **shell-mediated hand-off**: the napplet proposes,
  the shell asks the user for explicit NIP-07 consent, and (for v0) hands off to
  the canonical Plebeian listing URL rather than recreating checkout in-world.
- Plebeian's settlement requires complete custody evidence (kind-1025 path
  release + NUT-7 spent-proof + kind-1024 seller settlement must agree). A spatial
  watch-only client does not participate in that custody chain — it shows settled
  state read from events; it does not assert settlement.

### Listing read contract (verified against gamma_spec)

A Plebeian product listing is **NIP-99 kind 30402**. Required tags: `d` (id),
`title`, `price` (`[amount, currency, optional frequency]`). Optional: `type`
(`[simple|variable|variation, digital|physical]`), `visibility`, `stock`,
`summary`, `image` (`[url, dimensions, sorting-order]`, multiple), `spec`, `t`
(categories), `location`, `g` (geohash), `shipping_option`. Content is the product
description in markdown. Collections are kind 30405; shipping options 30406; reviews
31555.

The reader subscribes to kind-30402 events filtered by **seller pubkey** (and
optionally by collection `a`-tag) and maps each to the existing in-world product
view-model:

| Plebeian 30402 tag | Quest product view-model field |
|---|---|
| `title` | `title` |
| first `image` url | `image` |
| `price` `[amount, currency]` | `priceLabel` (rendered as listed, e.g. "10.99 USD" — NOT converted to sats) |
| event `pubkey` | `sellerNpub` |
| canonical listing URL (derived from `d` + pubkey) | `url` (the "View on Plebeian.Market" link) |
| `summary` / content | `reward` / description (display only) |

**Price view-model change:** the existing `priceLabel(priceSats)` assumes sats.
Plebeian prices are `amount + ISO-4217 currency` (or BTC). The view-model gains a
`priceDisplay` field carrying the listing's price as-stated; `priceSats` is kept
only for the legacy sats path. This is a render-only change — no transaction logic.

### Auction read contract (verified against the live staging relay, 2026-08-22)

A Plebeian english auction is **kind 30408** (`schema: auction_v1`); bids are
**kind 1023**, each referencing the auction via an `#e` (event id) and `#a`
(`30408:<seller-pubkey>:<d>`) tag. These are **custom Plebeian kinds**, not in the
public `gamma_spec` event-kinds doc — verified by querying Plebeian's own relays.

- **Plebeian relays** (not public Nostr relays): `wss://relay.plebeian.market`
  (prod), `wss://relay.staging.plebeian.market` (dev/test). Quest connects to the
  staging relay by default (`PLEBEIAN_RELAYS` in `src/config.js`).
- **Auction tags (30408):** `d` (id), `title`, `summary`, `auction_type`
  (`english`), `start_at`, `end_at`, `currency` (`SAT`), `starting_bid`,
  `bid_increment`, `reserve`, `settlement_policy` (e.g.
  `cashu_p2pk_bidder_path_v1`), `key_scheme` (e.g. `hd_p2pk`), `image[]`, `t[]`,
  `spec[]`, `shipping_option`.
- **Bid tags (1023):** `e` (auction id), `a` (auction a-tag), `p` (seller pubkey),
  `amount`, `currency`, `mint`, `locktime`, `refund_pubkey`, `child_pubkey`,
  `key_scheme`, `status`, optional `prev_bid`.
- **Query method:** `REQ {"ids":[<auction-id>]}` for the auction +
  `REQ {"#e":[<auction-id>],"kinds":[1023],"limit":300}` for bids. Read-only; Quest
  never publishes (no `EVENT` frame).

The `auctionModel.js` view-model tracks the running high bid (the latest monotonic
maximum), flags non-monotonic bids as "below high" (a *display* signal only — it
does NOT assert bid validity; settlement is Plebeian's custody chain), and derives
status (`LIVE`/`ENDED`/`UPCOMING`) from `start_at`/`end_at`. The reference auction
shipped with this slice is the maintainer's first test auction
(`55d80b60…`, "Building from Strength to Strength") — its two non-monotonic
tail bids are **test behaviour, not a production bug**, and are preserved as
documented history.

### Slice 1-2 shipped: Market Stall Reader (auction board)

A smoked-glass DOM overlay panel (`#auction-panel`, mirroring the emagake
glass component style — no panel background, only chips/rows tinted with 6px
backdrop blur, world reads sharp through the gaps) renders inside the NAP
market zone. It is toggled by NAP-zone entry (`setMarketActive(isNapLand(...))`
in `arenaRuntime.js`, mirroring `setNapMode`). The relay subscription is lazy —
first NAP entry starts it, re-entry keeps it warm. Footer links out to the
canonical `auctions.plebeian.market` listing URL — **watch-only, no bidding in the
panel.** Modules: `src/engine/plebeian/{auctionModel,plebeianRelay,auctionPanel,marketStall}.js`.

## Slice 3 — Bidder identity + reverse-order bids (shipped v0.2.636-alpha)

Owner feedback on the slice-2 panel: (1) bids were oldest-first; (2) the second
(column) showed the raw 8-hex bidder pubkey; (3) no avatar. Slice 3 changes only
the panel's *rendering* + a read-only profile fetch — no wire, no bidding, no
server change.

- **Descending order.** `renderAuctionPanel` sorts the bid history by amount
  descending before rendering (`[...vm.bids].sort((a,b) => b.amount - a.amount)`),
  so the highest bid is row 1. The underlying `buildBidHistory` order (and its
  `isHighBid`/`isMonotonic` flags) is unchanged for callers that read the model
  directly.
- **Bidder identity.** `auctionModel.parseProfileEvent` parses a kind-0 Nostr
  profile → `{pubkey, name, picture}`; `resolveBidder(pubkey, profiles)` returns a
  display `{name, picture, initial, hue}` — the profile `name`/`picture` where a
  kind-0 exists, else a deterministic colored circle (`hashHue` from the pubkey)
  with the first alphanumeric of the pubkey as the initial. `buildBidHistory` now
  accepts an optional `profiles` Map and attaches `bidder` to each row.
- **Avatar rendering.** `renderBidRow` renders a 22px circular avatar: the profile
  picture `<img>` (object-fit cover) sits absolutely over a colored-circle fallback
  carrying the initial; on `<img>` load error the img hides and the fallback shows.
  The display name (or short pubkey fallback) replaces the raw 8-hex column.
- **Profile fetch.** `plebeianRelay.fetchProfiles(pubkeys, relays)` queries kind-0
  from all given relays in parallel (6s collection window per relay, 8s overall
  timeout, first name/picture wins). `marketStall.scheduleProfileFetch` debounces
  (400ms) a fetch of the current bidders' pubkeys from both
  `wss://relay.staging.plebeian.market` + `wss://relay.plebeian.market` once bids
  have arrived, then re-renders. Read-only; a missing or broken profile degrades
  gracefully to the colored-circle avatar — the panel never blocks on profiles.
- **Top-bid flag.** `isTopBid` (only the single highest bid) is now used for the
  gold "high bid" flag + `.high` class, replacing `isHighBid` (every ascending
  bid) so the flag reads cleanly in a highest-first list. The pre-existing grey
  "below high" flag (`!isMonotonic`) is unchanged — it marks bids placed under the
  running high at their time.
- **Tests.** 8 new (5 in `auction-model.test.js`: parseProfileEvent,
  resolveBidder, isTopBid single-flag, bidder+profile resolution; 3 in
  `auction-panel.test.js`: colored-circle fallback avatar, picture avatar when a
  profile is present, descending order). 35 plebeian tests + 3072 full suite
  green.

**Reality check on live data:** of the 5 unique bidders on the staging test
auction, only 2 carry a kind-0 profile on the Plebeian relays ("Gay Fox" — name
only, no picture; "sandwich" — name + picture). The other 3 fall back to the
deterministic colored-circle avatar + short pubkey, which is the intended
degradation — bidders who never set a Nostr profile get a stable, distinct avatar
anyway.

## Build order (slices, smallest first)

1. **ADR-0026** (this record) — the contract and the watch-only boundary. ✅
2. **Market Stall Reader** — the NAP auction panel becomes real: subscribe to
   kind-30408 + kind-1023 on Plebeian's relay, render the auction + bid history
   in-world, link out to Plebeian. No bidding, no payment. ✅ (shipped v0.2.635)
3. **Auction Board** — same stall, but auction events + countdown + current high
   bid. Still read-only. ✅ (folded into slice 2 — the shipped panel already shows
   the high bid, end-time countdown, and full bid history)
4. **Bid Proposal** — shell asks the user to sign/place a bid via NIP-07. If the
   settlement path is uncertain, hand off to the Plebeian listing URL rather than
   recreating checkout in-world.
5. **Live Auction Room** — the flagship. NIP-53 live chat / bid feed, seller/
   auctioneer presence, countdown, anti-snipe display, real-time bid updates.
6. **Sell Time** — a service/appointment listing variant (a 30402 with a service
   `type` and an availability/booking schema). Needs booking schema; not first.
7. **World Builder** — place/move stalls in a world config (the `nap-torii-world`
   contract). "Create a world of your choosing" comes after the stall proves
   useful; the NAP zone already exists as a place to prove commerce.

## Landmines

- **No wallet/custody surface in Quest.** Render + propose only; Plebeian/payment
  rails settle. The napplet architecture already enforces this — applets cannot
  directly own signing, relay, wallet, or travel authority; the shell mediates.
- **Verify event shapes against the live gamma_spec before coding each slice** —
  do not rely on memory for kind/tag/payment details. (This ADR's contract was
  verified against `gamma_spec.md` + `event-kinds.md` on 2026-08-22.)
- **Live auctions are the marquee, not the first technical step.** Build the
  read-only stall, then live updates, then bidding.
- **World-builder can wait.** The NAP zone is already a place to prove commerce;
  build the market object before the editor.
- **PlebeianApp/market is read-only for the assistant.** The spatial client is
  built entirely inside `torii-quest`, consuming Plebeian's published Nostr events
  and protocol. If an integration requires upstream Plebeian changes, surface it
  and ask the maintainer before touching that repo.

## Status of related drafts

The Napplet Architecture (world-surface / whole-game / avatar contracts) and the
Gateway Protocol are Quest-only v0 drafts, not filed NAPs. This ADR does not file
them; it specifies the first concrete world-surface commerce surface and defers
the napplet contract formalisation. The market stall is built as a Quest
component first and can be reframed as a `nap-torii-world` applet later without
changing the read contract.
