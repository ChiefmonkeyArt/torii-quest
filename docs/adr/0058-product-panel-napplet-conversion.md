# ADR-0058 — Convert the product panel into the first live `nap-torii-world` napplet

**Status:** Accepted (proposed 2026-08-25)
**Version target:** v0.2.683-alpha
**Supersedes:** none (builds on ADR-0057)
**Related:** ADR-0026 (spatial marketplace), ADR-0036 (product-panel proximity+Q trigger), ADR-0057 (napplet world-surface shell scaffold)

## Context

ADR-0057 shipped the trusted-shell scaffold: a sandboxed `<iframe>` (sandbox="allow-scripts",
no allow-same-origin) whose `contentWindow` is the unforgeable napplet identity, with every
inbound `postMessage` validated by `MessageEvent.source` (not `event.origin`), routed through
pure world handlers. That scaffold is dormant — every surface is `enabled: false`, nothing is
mounted in the live arena.

The NAP implementation order's step 2 is: **convert the product panel** — the smallest existing
surface — to validate the whole stack against real DOM + the 3D trigger boundary.

The product panel today (`src/engine/plebeian/marketStall.js`, ADR-0026) is a DOM overlay
`#auction-panel` fed by a Plebeian relay WebSocket subscription. `setMarketActive(active)`
shows/hides it; `renderAuctionPanel(snapshot)` writes the auction view into the panel from a
`buildAuctionViewModel()` (pure). It is read-only (no bidding). It opens via the ADR-0036
proximity+Q trigger on the in-world PRODUCT sign.

## The core constraint (data must be brokered)

A napplet runs inside `sandbox="allow-scripts"` at an **opaque origin**. This blocks same-origin
access to the parent, but it does **not** by itself block network access — scripts inside the
iframe can still attempt `fetch()` / `WebSocket` / image loads. The security model of
`nap-torii-world` v0 is "the shell is the data authority; the napplet never touches the relay
directly." nap-relay (a real relay-broker capability) is deferred to a later ADR.

So "converting the product panel to a napplet" means: **the shell keeps the relay subscription
(network stays in the trusted shell) and brokers JSON snapshots INTO the napplet; the napplet
becomes the renderer** (runs inside the sandbox, renders structured data into its own DOM).

## Decision

Build ADR-0058 as: the `#auction-panel-body` becomes a live napplet iframe; the shell keeps relay
+ data authority. Minimal blast radius — the panel wrapper, close control, CSS, and the Q-trigger
are untouched. Only the bid-list body is owned by the napplet; the header/stats (title, summary,
chips, high bid, next-min) stay on the shell's legacy path. The legacy `renderAuctionPanel()`
remains as a fallback when the napplet is disabled or its mount fails.

### Message design (two directions)

- **Napplet → shell requests** (unchanged from ADR-0057): `world.attach.get`, `world.zone.list`,
  `world.emit` — dispatched by `worldNappletHandlers` (that dispatcher is napplet→shell ONLY).
- **Shell → napplet events** (NEW): a `post(type, data)` method on `NappletSurface` posts an
  envelope `{ type, channelId, data }` to the iframe's `contentWindow`. The iframe bridge gains
  `window.napplet.world.on(type, handler)` / `.off(type, handler)`; the product renderer registers
  `world.on('world.surface.update', ...)` and renders `data.snapshot` when `data.channel ===
  'plebeian.auction'`.

### Nonce / channel id (hardening item 2 — lands now)

- Parent generates a `channelId` with `crypto.getRandomValues` and injects it into the srcdoc.
- The shell validates every inbound message with BOTH `event.source === iframe.contentWindow` AND
  `ev.data.channelId === channelId`.
- Every response / push carries the `channelId`.
- The iframe ignores messages not from `parent` (hardening item 1) and with a wrong/missing nonce.

`postMessage(..., '*')` stays acceptable ONLY because the iframe has an opaque origin (no concrete
origin to target), paired with source + nonce validation.

### Renderer (structured data, no untrusted innerHTML)

The shell reuses `auctionModel.js` / `buildAuctionViewModel()` (pure) to compute the view model,
then a serializer (`productNappletSnapshot.js`) turns it into plain JSON for iframe transfer:
- no `Map`s, no functions, no class instances;
- bid rows capped (e.g. 64);
- only the fields the bid-list renderer needs;
- **no remote profile images in v1** — bidder identity is `{ name, initial, hue }` only
  (fallback colored-circle + initial). Image loading is deferred; if it ever lands, it allows only
  `https:` URLs, sets `referrerPolicy='no-referrer'`, and the CSP below is set deliberately.

The iframe renderer builds DOM nodes with `textContent` — never `innerHTML` of untrusted data.
It does NOT import the parent's ES modules (the sandbox is at an opaque origin with no same-origin
access). A small duplicated DOM renderer in the product srcdoc is the deliberate cost of the
sandbox boundary.

### CSP

The product srcdoc includes a Content-Security-Policy meta: `connect-src 'none'` (plus a baseline
`default-src 'none'; img-src 'none'; script-src 'self'`). This enforces the v0 security model at
the iframe level — even if a future napplet bug tried to `fetch()` or open a `WebSocket`, the
browser blocks it.

### First-update race (lands now)

The iframe script registers its `world.on('world.surface.update', …)` handler during boot (before
the iframe `load` event). A shell `push()` that lands before boot completes would be dropped and the
bid-list body would stay empty until the next relay event. `productNappletHost` therefore queues
the latest payload and replays it on the iframe `load` event (by which point the handler is
registered). Latest-wins: only the most recent pending payload is replayed.

## Built-in local napplet identity (not full NIP-5A)

This product napplet is a **built-in, local** napplet — its srcdoc is generated by the shell, and
its identity is a local `(dTag, aggregateHash)` pair, not loaded from an external NIP-5A manifest
(kind 35129) with a verified aggregate hash. External manifest loading + untrusted remote napplets
are deferred. Record this so nobody mistakes ADR-0058 for full NIP-5A manifest verification.

## Modules

1. `docs/adr/0058-product-panel-napplet-conversion.md` — this ADR.
2. `src/engine/napplets/nappletSrcdoc.js` (UPDATE) — add: parent source check, `channelId`
   support, `world.on/off` event channel + shell→napplet dispatch, CSP.
3. `src/engine/napplets/NappletSurface.js` (UPDATE) — generate/accept `channelId`, inject into the
   srcdoc builder, validate the inbound nonce, return a `post(type, data)` method.
4. `src/engine/napplets/productNappletSnapshot.js` (NEW, pure) — `serializeBidList(vm)` → plain
   JSON for iframe transfer (caps bids, strips unknowns, drops Maps/functions/images).
5. `src/engine/napplets/productPanelNappletSrcdoc.js` (NEW, pure) — self-contained product
   bid-list renderer (DOM nodes + textContent), with nonce + source check + CSP, reusing the world
   bootstrap via an `extraScript` hook.
6. `src/engine/napplets/productNappletHost.js` (NEW, browser-only DI) — mounts the surface into
   `#auction-panel-body`, pushes snapshot/status, destroys on close, falls back to legacy
   `renderAuctionPanel()` on failure.
7. `src/engine/plebeian/marketStall.js` (UPDATE) — keep the relay subscription; when the napplet is
   enabled, push serialized snapshots to the host; when disabled, use the legacy renderer.
8. `src/engine/napplets/worldNappletSurfaceConfig.js` (UPDATE) — `product-stall-panel.enabled = true`,
   `allowedEmitKinds: []` (read-only surface — no emits). `world.emit` returns `accepted:false`
   when there is no real handler for a live surface.

## Tests (DI stubs, no jsdom — follows codebase convention)

- `napplet-srcdoc.test.js` (UPDATE) — parent source check present; nonce check present; exposes
  `world.on/off`; no dynamic untrusted `innerHTML`; CSP includes `connect-src 'none'`.
- `napplet-surface.test.js` (UPDATE) — wrong source ignored; correct source + wrong nonce ignored;
  correct source + nonce dispatches; `post()` carries `channelId`; destroy tears down listener+iframe.
- `product-napplet-snapshot.test.js` (NEW) — serializes Maps/plain profiles; strips unknown fields;
  caps bids; no HTML strings; no image URLs.
- `product-napplet-host.test.js` (NEW) — mounts only when enabled; posts a snapshot on mount; pushes
  updates/status; destroys cleanly; falls back to the legacy renderer when disabled/fails.

## Deferred (NOT this ADR)

- bidding / checkout / zap (still read-only).
- wallet / signing / NIP-07 / Cashu.
- relay-broker / `nap-relay` capability.
- external NIP-5A manifest loading (kind 35129) + verified aggregate hash.
- `leaderboard-board` napplet conversion.
- sticker-studio avatar napplet.
- iframe-to-texture / true in-world embedded DOM (WebXR immersive renders only the WebGL canvas;
  embedding a live iframe in a 3D scene is unsolved — deferred per ADR-0057).
- remote untrusted napplets.
- remote profile images in the bid list (v1 uses initials only).
- **Header renderer innerHTML hardening** — `auctionPanel.js`'s legacy header path (chips /
  high-bid, fed auction metadata from the Plebeian relay) still writes via `innerHTML`. This is
  pre-existing ADR-0026 code, NOT introduced or changed by ADR-0058, and is out of this ADR's
  scope (body conversion only). ADR-0058's "no innerHTML of untrusted data" claim is scoped to
  the **napplet bid-list body** (bids from any pubkey — hardened to `textContent`). Hardening the
  header + the legacy fallback body to `textContent` / DOM nodes is a recommended follow-up ADR.

## Open questions (park for later ADRs)

- Does the snapshot need a `seq` + dedup window so a reconnecting relay doesn't re-render stale
  order? (v1 is idempotent full re-render — fine at this scale.)
- Should `world.surface.update` grow a `status` sub-channel for relay connect/error, or fold it
  into the snapshot? (v1 folds status into the snapshot push.)
