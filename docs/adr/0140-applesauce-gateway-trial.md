# ADR-0140: Trial Applesauce as the gateway's relay layer

- **Status:** Proposed (trial approved; adoption decided by its results)
- **Date:** 2026-10-21
- **Deciders:** chiefmonkey: "The Torii gateway experience is paramount to torii quest… Write the ADR and add the Applesauce gateway trial to the todo list".
- **Related:** the gateway protocol and directory (`src/engine/gateway/*`), live following, ADR-0057 (napplets), ADR-0111 (FIPS as the node transport), ADR-0126 (FIPS two-node heartbeat; it left Applesauce out of scope).

## Context

Every gateway lookup goes through `fanoutReq`/`relayReq` in `src/nostr.js`. That covers the world directory, friends' and follows' worlds, owner profiles, and kind 3 follow lists:
- each call opens a fresh WebSocket per relay, sends one REQ, then closes on EOSE or timeout;
- `Promise.all` waits for the slowest relay (4–5 s timeouts) before anything renders;
- nothing stays subscribed, so new worlds and presence changes only appear on the next lookup;
- only Quest's configured relays are asked, not the relays each world owner publishes to (NIP-65 outbox);
- relay health is tracked with a cool-down, but there's no shared event cache, so reopening the gateway starts from scratch.

[Applesauce](https://applesauce.build/) is hzrd149's modular Nostr SDK. It is OpenSats funded and powers noStrudel. v7 rebuilt its relay layer:
- persistent pooled connections;
- relay liveness and NIP-42 auth;
- streaming results with explicit "relays failed" vs "nothing found";
- batched loaders;
- NIP-65 outbox routing;
- an in-memory `EventStore`.

It depends on RxJS and has had major breaking releases (v5 to v7 within about a year).

## Decision

Run a time-boxed trial. Don't adopt yet.

1. **Scope:** the gateway directory read path only (world records and their owners' profiles). Not combat, not the arena chunk, not publishing.
2. **Boundary:** Applesauce only fetches events. Quest's trust layer stays exactly as it is and runs on every event, whatever the transport: `gatewayRead` validation and normalisation, `handoffVerify`, the travel handshake, and the consent gates.
3. **Not FIPS, not a napplet.** The trial is the browser's relay (WSS) read path inside the trusted shell. The gateway stays shell code; napplets can still only request travel through consent-gated handlers. FIPS stays node-to-node (Suite-managed, ADR-0126), and its same-origin heartbeat snapshot is unchanged.
4. **Isolation:**
   - behind a flag (`GATEWAY_TRANSPORT = 'fanout' | 'applesauce'`, default `'fanout'`);
   - loaded with a dynamic import from the gateway screen only, so it never touches the arena or `torii-entry` chunks;
   - published to no relay.
5. **Measured both ways** on the same relays and the same signed test worlds:
   - time to first world rendered (p50 and p95);
   - worlds found vs a known set;
   - behaviour with one relay dead or slow;
   - reopen time (cache);
   - added gzip bytes and parse time;
   - live arrival of a newly published world.
6. **Exit criteria:**
   - **Adopt** if it's clearly faster to first world and finds at least as many worlds, live updates work, and the added size stays within an agreed budget.
   - **Otherwise** take the in-house fix: stream results as each relay answers, keep a small cache keyed by world record, and optionally hold a short-lived subscription. Then close this ADR as Rejected.

## Consequences

- No behaviour change until the flag flips. Today's path stays the default and the fallback.
- If adopted, `fanoutReq` callers move gradually, gateway first. Profiles, presence and live following come later, each behind its own decision.
- Risks:
  - **RxJS size:** check with the bench and bundle report before any default change.
  - **Upstream churn:** pin exact versions and keep a thin adapter so a swap back costs one file.
