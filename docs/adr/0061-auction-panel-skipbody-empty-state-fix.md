# ADR-0061 — Honor `skipBody` in the auction panel's "no auction yet" empty state

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** chiefmonkey
- **Related:** ADR-0058 (product panel napplet conversion), ADR-0059 (auction panel header hardening), `src/engine/plebeian/auctionPanel.js`, `src/engine/plebeian/marketStall.js`, `src/engine/napplets/productNappletHost.js`

## Context

ADR-0058 gave the product napplet ownership of the auction panel's bid-list
body. `marketStall.js`'s `render()` reflects this by calling
`renderAuctionPanel(snap, { skipBody: true })` whenever a napplet is mounted,
so the legacy renderer updates only the header/stats and leaves
`#auction-panel-body` alone (the napplet owns it).

`renderAuctionPanel()` only applied `skipBody` in its **later** code path —
the one reached once an auction view-model (`vm`) exists. Its **earlier**
"no auction data yet" branch (`if (!vm) { ... }`), used while waiting for the
first relay response, unconditionally wiped `body.textContent` and inserted a
static "Waiting for relay…" placeholder, with no `skipBody` check at all.

This produced a real, live symptom that took an extended diagnostic session
to isolate: `_tryMountNapplet()` genuinely mounted the napplet iframe into
`#auction-panel-body` and returned `true` — confirmed via targeted
`console.error` instrumentation added across a7c3dde4, `54a66684`, and
`7719eb26` (v0.2.687-alpha through v0.2.689-alpha) — but the very next
`render()` call in the same `setMarketActive(true)` invocation hit the `!vm`
branch (because the Nostr relays, `relay.damus.io` / `relay.nostr.band`, had
not yet responded) and immediately overwrote the freshly-mounted iframe with
the empty-state placeholder. The player-visible result was indistinguishable
from "napplet never mounted": the panel always showed the legacy empty state,
even though the mount had, in fact, succeeded moments earlier.

This is a genuine code defect, not a relay outage or config issue — a slow or
temporarily-unreachable relay on the very first render is a normal, expected
condition, not an edge case that should be allowed to destroy a live napplet
surface.

## Decision

Add the same `!opts.skipBody` guard to the `!vm` early-return branch that
already exists on the later, `vm`-truthy path:

```js
if (!vm) {
  if (body && !opts.skipBody) {
    body.textContent = '';
    body.appendChild(el(doc, 'div', 'auction-empty', 'Waiting for relay…'));
  }
  if (statusEl) statusEl.textContent = 'watch-only · connecting';
  return 0;
}
```

When a napplet owns the body, no code path in `renderAuctionPanel()` may
write to `#auction-panel-body`, regardless of whether an auction view-model
is available yet.

## Consequences

- **Enables:** the product napplet now survives the render cycle immediately
  after mount, including the common case where relay data has not arrived
  yet. The napplet's own "connecting" state (already implemented via
  `_relayStatus` passed to `_host.push(...)`) is now the only thing the
  player sees during that wait, instead of a flash of legacy markup
  overwriting a live iframe.
- **Forecloses:** no code path may reintroduce a body write inside
  `renderAuctionPanel()` without checking `opts.skipBody` first. Any future
  branch added to this function must follow the same guard.
- **Trade-offs:** none material — this is a pure bug fix restoring the
  originally-intended ADR-0058 invariant ("napplet owns the body, legacy
  renderer never touches it while mounted").
- **Enforcement:** new regression test asserts that calling
  `renderAuctionPanel(snapshot, { skipBody: true })` with no auction data
  (`vm` is null) leaves an existing body untouched, mirroring the existing
  coverage for the `vm`-truthy `skipBody` case.

## Alternatives considered

- **Guard in `marketStall.js` instead** (e.g. only call `render()` after the
  first relay response arrives): rejected — this would delay the header/stats
  update unnecessarily and still leaves the underlying defect in
  `renderAuctionPanel()` for any other future caller that passes
  `skipBody: true` before `vm` exists.
- **Make `_tryMountNapplet()` defer mounting until `vm` is truthy:** rejected
  — the napplet is designed to mount immediately and show its own
  "connecting" state; delaying mount would just move the race elsewhere and
  contradicts ADR-0058's design.

## Notes

- Diagnosed via three rounds of temporary `console.error` instrumentation in
  `marketStall.js` (`setMarketActive`, `_tryMountNapplet`) and
  `productNappletHost.js` (`mount()`), shipped as v0.2.687-alpha through
  v0.2.689-alpha specifically to narrow this down, per the "never guess,
  always check the code and narrow down with logging" project rule. All of
  that temporary logging is reverted in the commit that ships this fix.
- Confirmed live via manual console check:
  `document.querySelector('#auction-panel-body')?.innerHTML` showed the
  `auction-empty` placeholder markup immediately after a log-confirmed
  successful mount, which is what led directly to this branch.
