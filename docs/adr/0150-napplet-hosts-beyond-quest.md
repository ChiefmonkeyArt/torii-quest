# ADR-0150: Napplet hosts beyond Quest: one host-agnostic boundary, Quest's runtime as the reference, FIPS node-side

- **Status:** Proposed (2026-10-29). Pairs with the Torii Continuum team-collaboration decision record, amendment "FIPS private mode and the Teams napplet" (also Proposed). Accept both together or neither.
- **Date:** 2026-10-29
- **Deciders:** chiefmonkey
  - "Ok so what do we need to get coding it into a FIPS napplet?"
  - "Update the Torii Quest napplet decision records to match"
- **Related:**
  - ADR-0057 (world-surface shell), ADR-0058 (product panel), ADR-0082 (game host), ADR-0083 (avatar shell), ADR-0094 (release-time napplet identity);
  - ADR-0111 (founding stack and FIPS, Decision 5: browsers cannot speak FIPS, node-side first);
  - ADR-0147 (Gateway Experience boundary table: "FIPS (node-side)" in the trusted host);
  - ADR-0148 (one node, every home);
  - Torii Continuum `docs/adr-team-collaboration.md`, `docs/trials/teams-fips/README.md`.

## Context

The napplet architecture was drafted with Quest as the only host. The three v0
contracts (`nap-torii-world`, `nap-torii-game`, `nap-torii-avatar`) and every
host so far (`NappletSurface`, `NappletGameHost`, `productNappletHost`, the
M2 Gateway napplet in `src/engine/gateway/gateNapplet.js`) live in this
repository. The napplet architecture notes treat Quest as the only v0 host;
other Torii apps were not expected to drive the v0 contracts.

Two things have changed:

- **A second host is proposed.** Torii Continuum's team-collaboration amendment
  ships team chat, roster, PRs and clanker status as a sandboxed napplet,
  `nap-torii-team@1`, hosted by the Continuum shell. Torii Hibiki is already a
  standalone napplet with its own trusted shell.
- **FIPS is getting a concrete use.** The same amendment reaches the team
  services (Cordn coordinator, private ngit-grasp, relay) over FIPS, as
  `<node-npub>.fips`, with HTTPS kept as the fallback.

Without a decision, each new host would reinvent the sandbox rules, or a
napplet would end up with network or key access because "this host is
different". Quest's code is the only proven implementation of the boundary.

## Decision

**Any Torii app may host napplets, provided it keeps the same boundary Quest
keeps. Quest's runtime is the reference, other hosts port it, and FIPS stays
on the trusted, node side for every host.**

1. **The boundary is host-agnostic and binding on every host.** These rules,
   from ADR-0057, ADR-0082 and ADR-0147, are the contract, not Quest
   implementation details:
   - mount in an `srcdoc` iframe with `sandbox="allow-scripts"` only (opaque origin, never `allow-same-origin`);
   - the napplet document carries its own CSP denying the network (`default-src 'none'; connect-src 'none'`);
   - accept a message only when `event.source` is that napplet's iframe and the per-mount nonce matches;
   - the napplet asks, the host checks and acts; keys, signing, relays, sockets, storage and wallets stay with the host;
   - the host page's CSP frames only what it means to (`frame-src 'self'` or tighter).
2. **Quest's runtime is the reference implementation.** Another host ports
   `nappletEnvelope.js`, `nappletSrcdoc.js` and the `NappletSurface` mount
   pattern into its own repository instead of depending on this one at
   runtime. A shared package is extracted only once two hosts have shipped
   and the copies are seen to drift (the strategy's "extract after three
   uses" rule, relaxed to two because the code is security-critical).
3. **Each host owns its contracts.** Quest keeps the three v0 contracts plus
   the gate surface. A contract defined by another app (first:
   `nap-torii-team@1`) is owned and versioned there, using the same
   `nap-torii-<name>@<major>` naming. Quest does not host it and needs no code
   change.
4. **FIPS is node-side for every host.** A napplet never sees FIPS, a socket
   or a mesh address. Hosts may reach their own services over FIPS (ADR-0111
   Decision 5, ADR-0147's boundary table), and must keep a non-FIPS fallback
   while FIPS is pre-1.0.
5. **One conformance list for every host.** Before a new host ships a
   napplet, its tests cover the same checks Quest's do: wrong `source`
   rejected, wrong or missing nonce rejected, no `allow-same-origin`, the
   napplet CSP denies the network, and a napplet request cannot trigger a
   signature or network call without the host's own check.

## Consequences

- **Enables:** Continuum Teams (and later Torii DE) can ship napplets without
  re-deciding the trust boundary; Quest's Gateway napplet and a Teams napplet
  can be reviewed against one rule set; FIPS-reachable services fit without
  changing any napplet.
- **Forecloses:** a host-specific exception that gives a napplet network,
  same-origin or key access; a runtime dependency from another app on Quest's
  source tree.
- **Trade-offs:** two copies of the runtime exist until a shared package is
  extracted; drift is controlled by the conformance list, not by shared code.
- **Enforcement:** no Quest code changes. The conformance list in Decision 5
  is the acceptance gate for any host's first napplet. Quest's existing
  tests are the reference: `tests/napplets/napplet-surface.test.js`,
  `napplet-srcdoc.test.js`, `game-napplet-host.test.js`,
  `product-napplet-host.test.js` and `tests/gateway/gate-napplet-host.test.js`,
  `gate-napplet-ui.test.js`.

## Alternatives considered

- **Keep napplets Quest-only.** Rejected: Teams and Hibiki already need
  sandboxed UIs outside Quest, and duplicating the rules ad hoc is riskier
  than stating them once.
- **Shared npm package now.** Deferred: only one host has shipped; extracting
  first would freeze an API before the second host has tested it.
- **Napplets that speak FIPS through a host bridge.** Rejected for now: it
  would give the napplet a network surface, and ADR-0111 already places FIPS
  on the node.

## Notes

- ADR-0057, ADR-0082, ADR-0083 and ADR-0147 are unchanged; this ADR extends
  them and supersedes nothing.
- FIPS status at the time of writing: v0.5.3, MIT; the project describes the
  protocol and APIs as not yet stable and lists a cryptographic audit as a
  priority (https://github.com/jmcorgan/fips).
