# ADR-0061 — Fix the product napplet's body ownership: skip-body guard + clear static placeholder on mount

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** chiefmonkey
- **Related:** ADR-0058 (product panel napplet conversion), ADR-0059 (auction panel header hardening), `src/engine/plebeian/auctionPanel.js`, `src/engine/plebeian/marketStall.js`, `src/engine/napplets/productNappletHost.js`, `src/engine/napplets/NappletSurface.js`

## Context

ADR-0058 gave the product napplet ownership of the auction panel's bid-list
body. `marketStall.js`'s `render()` reflects this by calling
`renderAuctionPanel(snap, { skipBody: true })` whenever a napplet is mounted,
so the legacy renderer updates only the header/stats and leaves
`#auction-panel-body` alone (the napplet owns it).

Two separate defects combined to break this invariant, found in sequence via
live testing (each fix was retested live before moving to the next):

**Defect 1 — `skipBody` not honored in the "no auction yet" branch.**
`renderAuctionPanel()` only applied `skipBody` in its **later** code path —
the one reached once an auction view-model (`vm`) exists. Its **earlier**
"no auction data yet" branch (`if (!vm) { ... }`), used while waiting for the
first relay response, unconditionally wiped `body.textContent` and inserted a
static "Waiting for relay…" placeholder, with no `skipBody` check at all.
Confirmed via targeted `console.error` instrumentation added across
a7c3dde4, `54a66684`, and `7719eb26` (v0.2.687-alpha through v0.2.689-alpha):
`_tryMountNapplet()` genuinely mounted the napplet iframe and returned
`true`, but the very next `render()` call — hitting `!vm` because the Nostr
relays (`relay.damus.io` / `relay.nostr.band`) had not yet responded —
immediately overwrote the freshly-mounted iframe with the empty-state
placeholder. Player-visible result: indistinguishable from "napplet never
mounted."

**Defect 2 — the static placeholder is never cleared on mount.**
Fixing defect 1 alone produced a second, distinct symptom, caught by
retesting live: `#auction-panel-body` starts with a static
`<div class="auction-empty">Waiting for relay…</div>` baked directly into
`index.html` (its resting/default markup, present before any JS runs).
`NappletSurface.js`'s `container.appendChild(iframe)` only appends — it
never clears existing content. With defect 1 fixed but this one still
present, the live DOM at `document.querySelector('#auction-panel-body').innerHTML`
showed exactly:

```html
<div class="auction-empty">Waiting for relay…</div><iframe sandbox="allow-scripts" ...>
```

— both the static placeholder and the mounted iframe present at once,
instead of the iframe replacing it.

Neither defect is a relay outage or config issue — a slow or
temporarily-unreachable relay on the very first render is a normal, expected
condition, not an edge case that should be allowed to corrupt the napplet's
body ownership.

## Decision

**Fix 1 (`auctionPanel.js`):** add the same `!opts.skipBody` guard to the
`!vm` early-return branch that already exists on the later, `vm`-truthy
path:

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

**Fix 2 (`productNappletHost.js`, `mount()`):** clear the host container's
`textContent` once, immediately before `createNappletSurface(...)` is
called, but only on the path that is about to succeed (the disabled /
missing-container fallback paths must leave the static placeholder alone so
the legacy renderer can take over normally):

```js
const host = container || (document && document.getElementById(bodyId));
if (!host) return false;
if (typeof host.textContent !== 'undefined') host.textContent = '';
try {
  surface = createNappletSurface({ ... });
  ...
```

Together: the napplet's body is cleared exactly once, right at mount time,
and never touched again by the legacy renderer for as long as the napplet
stays mounted.

## Consequences

- **Enables:** the product napplet now survives the render cycle immediately
  after mount, including the common case where relay data has not arrived
  yet, and no longer coexists with the static placeholder it's meant to
  replace. The napplet's own "connecting" state (already implemented via
  `_relayStatus` passed to `_host.push(...)`) is now the only thing the
  player sees during that wait.
- **Forecloses:** no code path may reintroduce a body write inside
  `renderAuctionPanel()` without checking `opts.skipBody` first. Any future
  branch added to that function must follow the same guard. Any future
  napplet host built on `NappletSurface.js` must clear its own container's
  pre-existing static content before mounting — `NappletSurface.js` itself
  intentionally stays append-only since it's a shared primitive with no
  opinion on what, if anything, preceded it.
- **Trade-offs:** none material — both are pure bug fixes restoring the
  originally-intended ADR-0058 invariant ("napplet owns the body, legacy
  renderer never touches it while mounted, and nothing else does either").
- **Enforcement:**
  - `tests/plebeian/auction-panel.test.js` — new case asserts
    `renderAuctionPanel(snapshot, { skipBody: true })` with no `vm` leaves an
    existing (napplet-owned) body untouched.
  - `tests/napplets/product-napplet-host.test.js` — new case seeds the fake
    container with a static placeholder child before calling `mount()`, then
    asserts only the iframe remains afterward.
  - Both new tests were manually verified to fail when their respective fix
    is reverted, then pass again with the fix restored, before being
    committed.

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
- **Clear the container inside `NappletSurface.js` itself, for every napplet:**
  rejected — `NappletSurface.js` is a shared primitive with no knowledge of
  what a given host's container is used for beforehand; some future napplet
  host may want additive/overlay behavior. Clearing belongs in the
  napplet-specific host (`productNappletHost.js`), which knows its own
  container's contract.

## Notes

- Diagnosed via three rounds of temporary `console.error` instrumentation in
  `marketStall.js` (`setMarketActive`, `_tryMountNapplet`) and
  `productNappletHost.js` (`mount()`), shipped as v0.2.687-alpha through
  v0.2.689-alpha specifically to narrow this down, per the "never guess,
  always check the code and narrow down with logging" project rule. All of
  that temporary logging is reverted in the commit that ships fix 1.
- Fix 2 was found by retesting live immediately after fix 1 shipped —
  `document.querySelector('#auction-panel-body')?.innerHTML.slice(0,200)`
  showed the placeholder and iframe coexisting, which led directly to
  inspecting `NappletSurface.js`'s `appendChild` call.
