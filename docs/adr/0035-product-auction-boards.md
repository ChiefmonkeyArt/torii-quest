# ADR-0035: Product/Auction boards — three separate NAP-zone boards, owner-scoped, Nostr NIP-99/NIP-15-family sourced

- Status: Proposed
- Date: 2026-08-23
- Deciders: chiefmonkey

## Context

The current `#auction-panel` (`auctionPanel.js` + `marketStall.js`,
ADR-0026) is a single read-only panel showing one hardcoded auction id
(`PLEBEIAN_AUCTION_ID`) from one relay. The owner wants this reimagined,
both functionally and aesthetically, into a real product/auction display
sourced from their actual Plebeian Market listings (dev instance:
`https://auctionsdev.plebeian.market/`, going live at
`https://plebeian.market` on plain Nostr/NIP-99 later).

Confirmed seller identity for the dev site: displayed as "Chiefmonkey",
pubkey hex `ec79b568bdea63ca6091f5b84b0c639c10a0919e175fa09a4de3154f82906f25`
(same as the already-recorded VPS admin pubkey) — verified by opening a
live product page on `auctionsdev.plebeian.market` and reading the
"Sold by" profile link.

Plebeian Market is fully migrated to NIP-99 (`kind:30402` classified
listings, `kind:30403` drafts) for products, and already used kind
`30408` (auction) / `1023` (bid) for the existing auction panel — pure
Nostr-relay driven, no separate REST API. This matches the pattern
already implemented in `plebeianRelay.js`; it needs generalizing from "one
hardcoded auction id" to "query by npub, get a list."

Owner's explicit direction on structure (2026-08-23):
- Start with the owner's own npub only. Multi-seller/multi-board-type
  support (a single product board, art-on-a-wall board, collection board,
  for other people's shops) is real future scope, not built now — just
  keep the current build from architecturally blocking it later.
- Three separate boards as three separate components: Live Products, Live
  Auctions, Past Auctions. Not one tabbed panel.
- These are explicitly a precursor to a future "napplet" architecture
  ([[concepts/torii-napplet-architecture]]) — that generalized
  trusted-shell contract comes after this and ADR-0034 ship. Do not build
  the napplet contract now; just don't paint into a corner.
- Interaction split by mode: in normal play, sticker-fire selects/opens a
  board's buttons (existing NAP-zone sticker-select mechanics). In Kami
  Mode, stickers cannot be fired, but the crosshair stays visible and
  click/select still works against the same buttons.
- Visible to any guest, not gated to Kami Mode or the owner — this is a
  guest-facing display of the owner's shop, always-on in the NAP zone
  (subject to ADR-0034's `!kamiActive()` gate only in the sense that it
  must not be suppressed by Kami's own UI, not that Kami hides it from
  guests — clarify exact interaction with the owner if ambiguous once
  ADR-0034 lands).

## Decision

1. Three new components, each its own module (mirroring
   `marketStall.js`'s lazy-subscribe pattern) and each its own DOM root,
   NOT a shared tabbed panel:
   - `productBoard.js` — live products (`kind:30402`, active/in-stock),
     filtered to the configured owner npub.
   - `liveAuctionBoard.js` — auctions (`kind:30408`) whose end time is in
     the future, filtered to the owner npub.
   - `pastAuctionBoard.js` — auctions (`kind:30408`) whose end time has
     passed, filtered to the owner npub, read-only (no bidding UI needed,
     shows final price/winner if resolvable from bid events).
2. `plebeianRelay.js` gains a generalized subscribe-by-npub-and-kind
   function alongside the existing single-auction-id subscribe (kept for
   back-compat / incremental migration), rather than replacing it outright
   — minimizes blast radius on the current working auction panel while
   the new boards are built and verified.
3. Config: add `PLEBEIAN_OWNER_NPUB` (or reuse `ADMIN_PUBKEY_HEX` if
   confirmed identical to the seller pubkey above — verify before wiring,
   don't assume) to `config.js`, replacing the single hardcoded
   `PLEBEIAN_AUCTION_ID` as the new boards' default filter. Relay list
   stays `PLEBEIAN_RELAYS` (staging), pointed at prod when the owner cuts
   over to `plebeian.market`.
4. THIS SLICE ships DOM-overlay boards, same component family as the
   existing `#auction-panel`/`#emagake` — flat 2D smoked-glass panels
   fixed to the screen, the 3D world visible through/behind them, NOT
   objects placed in the 3D world. Each board is its own floating panel
   (ADR-0028 convention — body-scoped, survives `#screen-title`
   display:none during PLAYING), positioned so all three + the emagake
   rack (when Kami is active) don't overlap.
5. Interaction (both DOM, no raycasting):
   - Play mode: normal DOM click handlers on each board's buttons —
     reuses the sticker-fire trigger only insofar as sticker-fire already
     unlocks/points the cursor at a DOM target; no new 3D hit-testing.
   - Kami Mode: shooting is suppressed, but the boards are ordinary DOM
     elements, so a normal click resolves directly — no new raycast
     concept needed.
6. Board layout/content design (card style, typography, image
   thumbnails, pagination for >1 item) to be proposed as a mockup before
   implementation, per the design-review norm already used for prior
   HUD/panel work in this project.

## Deferred: 3D in-world boards (future slice)

Owner's longer-term preference is for these boards to exist as physical
3D objects in the NAP zone (canvas-textured meshes the player walks up to
and looks at), not screen-space panels. Explicitly deferred to a later
slice per owner decision (2026-08-23: "DOM now with 3D as a later slice").
When picked up, follow the existing in-world-object pattern used by
`portalMesh.js` — a pure plan module (geometry/position/content) consumed
by a THREE.js adapter that builds mesh(es) once and ticks only scalars —
plus new raycast-based select input for both play and Kami mode, since
neither exists today (confirmed by inspecting `arenaRuntime.js` and
`kamiMode.js`: sticker-fire raycast only ever resolves against
bots/terrain, and Kami Mode only ever suppresses shooting). Anchor
placement against live NAP terrain (`tomoeShapeData.js`) to be proposed,
not guessed, when that slice starts.

## Consequences

- `marketStall.js` / `auctionPanel.js` / current `#auction-panel` become
  superseded once the three boards ship; decide at implementation time
  whether to delete or fold into `liveAuctionBoard.js` (likely: the
  current single-auction display becomes the seed for
  `liveAuctionBoard.js`, `productBoard.js` and `pastAuctionBoard.js` are
  net-new).
- New non-projectile "select" input path in Kami Mode is a real feature
  addition beyond a pure refactor — needs its own tests
  (`kami-state-machine.test.js` likely gains cases).
- Nostr relay query shape (filtering `kind:30402`/`30408` by `#p`/author
  npub, live-vs-past split by tag timestamps) needs verifying against
  actual event shapes pulled from `wss://relay.staging.plebeian.market`
  before coding the reducer — do not guess the tag layout; inspect real
  events first (mirrors the project's "never guess, check the code"
  standing rule, extended to external protocol data).

## Non-goals (this ADR)

- Multi-seller / other-people's-shops board support (future work, kept
  architecturally possible only).
- The generalized napplet trusted-shell contract.
- Bidding/purchase actions from inside Torii Quest (panels remain
  read-only displays; buying happens on Plebeian Market itself, same as
  today's auction panel).
