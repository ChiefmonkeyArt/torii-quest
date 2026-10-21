# ADR-0140: Trial Applesauce as the gateway's relay layer

- **Status:** Accepted, stage 1 (v0.2.910): the directory read path and owner profiles use Applesauce by default. Stage 2 (a live subscription) is still open; see Results.
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

## Results (v0.2.910-alpha, 2026-10-21)

The operator asked for Applesauce "ASAP", so stage 1 ships with Applesauce on by default and an automatic fallback.

**Shape:**
- `applesauce-relay` 7.0.0, pinned exactly; it brings applesauce-core 7.0.3, RxJS 7.8.2 and nostr-tools 2.24.3.
- `reqCollector.js` (pure) and `applesauceTransport.js` sit behind the same `fanoutReq` contract.
- `gatewayTransport.js` resolves the flag and holds the lazy getter.
- `GATEWAY_TRANSPORT = 'applesauce'`. Override with `?gateway-transport=fanout|applesauce` or localStorage `torii.gatewayTransport`.
- The trust layer is unchanged: `readGateways({verify:true})` checks every event.

**Bench, Node 20 against Quest's 7 default relays plus one dead relay.** Same filter, timeout 5 s, grace 250 ms, 1 retry, 6 alternating runs:

| | fanout | applesauce |
|---|---|---|
| Cold scan | 806 ms | 973 ms (includes building the pool) |
| Warm scan, median | 806 ms | **382 ms** |
| Events / relays used | 11 / 7 | 11 / 7 (identical) |
| Dead relay | fails fast | skipped while in backoff |
| Sockets per 10 s rescan | ~7 new | 0 new (kept alive for 60 s) |

- **First adapter bug, found and fixed in the bench.** Applesauce makes a REQ to a relay in reconnect backoff hang until it reconnects; warm scans took 3–10 s. Fixes:
  - `partitionReady` skips relays the pool reports `ready === false`;
  - a straggler cap (1.5 s after the first EOSE, the same idea as the library's own `completeAfterIdle` grace).
- **Cold load is untouched.** The first scan always uses fanout. Applesauce loads through `requestIdleCallback` (8 s timeout), so time to the first world on a cold start is today's.
- **Size:**
  - entry chunk +0.34 KB;
  - a new lazy chunk of 156.9 KB raw / 51.4 KB gzip, cached by the service worker after first use;
  - nothing added to the arena chunk.

  The lazy chunk carries its own copy of `@noble/curves` 2.0.1, which nostr-tools pins. An npm override to share Quest's 2.2.0 upgraded Quest's own copy and grew the entry by 6 KB, so it was reverted. Revisit when nostr-tools moves up.
- **Browser (headless Chromium, built preview):**
  - the chunk loads, `ToriiDebug.gateway().transport === 'applesauce'`;
  - no CSP violations, no page errors;
  - freeze meter identical to fanout (24 long frames and the same max on the software GPU, which isn't a real-GPU timing);
  - under that heavily loaded main thread, applesauce scans still found the live world while fanout's per-socket timeouts found none.
- **Not met yet:**
  - live arrival via a held subscription (stage 2). For now new worlds still arrive on the 10 s rescan, which is now cheap.
  - The size budget wasn't agreed in advance. Proposed budget: lazy ≤ 55 KB gzip, entry ≤ +1 KB.
- **Revert:** `GATEWAY_TRANSPORT = 'fanout'`, one line, or the URL/localStorage override per browser.
- **`npm audit`:** no new advisories. The one high advisory, in `sharp`, a build-time image tool, already existed and is unrelated.
