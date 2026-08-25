# ADR-0059 — Harden the auction panel renderer (no `innerHTML` of untrusted data)

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** chiefmonkey
- **Related:** ADR-0026 (spatial marketplace), ADR-0058 (product panel napplet), `src/engine/plebeian/auctionPanel.js`, `tests/plebeian/auction-panel.test.js`

## Context

ADR-0058 moved the auction panel's **bid-list body** into a sandboxed napplet that
renders with `textContent` only — no `innerHTML` of untrusted data. But the panel's
**header** (chips, high-bid) and the **legacy fallback body** (used when the napplet is
disabled or its mount fails) still render through `auctionPanel.js`, which writes
`innerHTML` from Plebeian relay data. This was explicitly deferred in ADR-0058:

> Hardening the header + the legacy fallback body to `textContent` / DOM nodes is a
> recommended follow-up ADR.

The relay data is untrusted: `auction_type`, `currency`, `title`, `summary`, and the
kind-0 profile fields (`name`, `picture`, `about`) are all attacker-influenced strings.
Writing them via `innerHTML` is an injection hazard — a malicious auction or profile
could inject markup/script into the trusted shell's DOM.

## Decision

Eliminate every `innerHTML` write in `auctionPanel.js`, replacing them with DOM-node
construction (`document.createElement`) + `textContent` assignment. The pure
formatting helpers change from returning HTML strings to returning plain data
descriptors, so they stay unit-testable without a DOM.

### What changes

1. `renderChips(vm)` → **`buildChips(vm)`** returns `[{ cls, text }]` (plain data).
   The renderer builds `<span class="...">` nodes and sets `textContent`.
2. `renderBidRow(r)` → **`buildBidRow(r)`** returns a plain descriptor
   `{ cls, time, who, amount, flag, avatar: { hue, initial, picture } }`. The renderer
   builds the row as DOM nodes. The avatar `<img>` gets `src`/`alt`/`loading`/
   `referrerpolicy` via `setAttribute` and an `onerror` handler (no inline-JS string).
3. `auction-panel-high` is built as a text node (`highBid.toLocaleString()`) + a
   `<span class="cur">` whose `textContent` is the currency.
4. The static "Waiting for relay…" empty state uses `createElement` + `textContent`
   instead of an `innerHTML` string (no untrusted data, but keeps the invariant clean).
5. `title` / `summary` / `next` already use `textContent` — unchanged.

### Out of scope (not this ADR)

- The **poster** uses `style.backgroundImage = url("…")`, not `innerHTML`. It is a
  CSS-value injection surface but cannot execute script (background-image does not run
  `javascript:`), and is display-only. Left as-is; a future ADR may validate the URL is
  `http(s)`.
- The napplet srcdoc renderer (`productPanelNappletSrcdoc.js`) is already `textContent`-only
  (ADR-0058) — untouched.

## Consequences

- Positive: no relay- or profile-derived string ever reaches `innerHTML` in the panel;
  the legacy fallback (the live path when the napplet is disabled) is now as hardened as
  the napplet body.
- Positive: the pure helpers return data, not markup, so the "no untrusted innerHTML"
  invariant is enforced by construction rather than by convention.
- Neutral: the renderer is slightly more verbose (explicit node construction) — the cost
  of removing the injection surface.
- Negative: none material. The DOM node builders are internal to `auctionPanel.js`.

## Tests

`tests/plebeian/auction-panel.test.js` is updated: the fake DOM gains `createElement` /
`createTextNode` / `appendChild` / `className` / `setAttribute`, and assertions move from
HTML-string matching to checking `children` + `textContent`. New cases assert that
malicious `auction_type` / `currency` / profile `name` values are rendered as inert text
(no element injection).
