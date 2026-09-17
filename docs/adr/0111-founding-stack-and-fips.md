# ADR-0111: Founding Stack and FIPS as founding-layer transport

- **Status:** Accepted
- **Date:** 2026-09-17
- **Deciders:** chiefmonkey
- **Related:** ADR-0106 (never force an update), `GATEWAY_PROTOCOL.md`, `COMPONENTS.md`, `torii-quest-strategy.md` (Core Principles → "Cooperation, not governance"; new "Founding Stack" section; renamed "Founding-Layer Transports" subsection)

## Context

Torii's stated mission is a self-sovereign, federated, decentralised metaverse built on Nostr, Bitcoin, open protocols, free markets, and FOSS. In practice, Torii today is decentralised at the **application** layer — identity is Nostr, money is Bitcoin/Cashu, discovery is relays, software distribution is signed component listings — but still relies on the **incumbent** internet for transport: rented VPS, public DNS name, Caddy reverse proxy, Let's Encrypt certificate. Every seller / operator / world node depends on a landlord (registrar, hosting company, CA) for its address to work.

That is a material contradiction with the Core Principles. A Plebeian node that pays a rent to be reachable is not sovereign in the same way that a Nostr identity is sovereign. It works today because Torii has one operator, but it does not generalise: a network of 1,000 or 100,000 Plebeian nodes cannot be composed of DNS-and-VPS operators. That population does not exist; making it exist by requiring each node to become a DevOps operator contradicts the FOSS-developer-growth principle.

Two clarifications during the 2026-09-13 discussion shaped the response:

1. **Torii's target user is not a Shopify/Woo/BTCPay seller** but a self-hosted Plebeian node — a peer, not a customer of an existing storefront. This rules out an integration-adapter strategy and rules in a self-federated-node strategy.
2. **Coordination between nodes is cooperation, not governance.** No central rulemaker is acceptable; peers agree, attest, and cooperate via signed events. This is now a Core Principle and is expanded in the project wiki's `concepts/torii-cooperation` page.

The transport question therefore stops being an optimisation ("when a NAT operator shows up, revisit FIPS") and becomes a founding-layer question: **what removes the DNS/hosting landlord for a Plebeian node the same way Nostr removed the account-system landlord and Bitcoin removed the payment-processor landlord?**

## Decision

**Decision 1 — Founding Stack.** Torii formalises a Founding Stack in `torii-quest-strategy.md`: a per-layer table naming the landlord each layer removes, the primitive Torii uses, and current status. The stack is the machine-readable expression of the Core Principles and the reference every contributor uses to see which of today's pragmatic choices (VPS, DNS, HTTPS) are load-bearing and which are marked for eventual replacement. The stack layers are: identity (Nostr npub), discovery (Nostr relays), money (Bitcoin / Lightning / Cashu / Nutzap), reputation (NIP-58 badges + web-of-trust + NIP-51 lists), software distribution (signed component listings), content addressing (Blossom / NIP-94), cooperation (per-node policy + federated lists + attestations + chosen arbiters), transport (FIPS + Tor / Nym / BLE), local resilience (multi-transport mesh), compute / AI (local Ollama / Hermes / routstr).

**Decision 2 — FIPS as founding-layer transport.** Torii commits to FIPS (Free Internetworking Peering System, https://github.com/jmcorgan/fips) as the founding-layer transport for node-to-node traffic. A Torii node is reached by its npub, with no DNS, no VPS-with-public-hostname, and no reverse-proxy dependency. FIPS is promoted from "Future Transports — radar list" to "Founding-Layer Transports — committed direction" in the strategy doc. Adoption remains incremental: HTTPS/WebSocket is kept as fallback, and the actual work begins as a scoped spike, not a roadmap-wide refactor.

**Decision 3 — Torii is both adopter and reference integration for FIPS.** FIPS is alpha and needs a real, visual, motivated user population to prove itself. Torii — a metaverse of Plebeian nodes — is that population, and the arrangement is explicitly reciprocal: Torii gains the founding-layer transport it needs, FIPS gains a flagship integration and non-technical user base. This is captured as a co-marketing decision, not just a technology adoption.

**Decision 4 — Paired dependencies.** FIPS provides transport but not content addressing. The offline-worlds story and the NAP-zone shop-asset story (GLBs, images, product media) both require content-addressed storage. Blossom / NIP-94 is chosen as the paired primitive and is added to the same spike, not deferred.

**Decision 5 — Browser-side bridge, staged.** A WebGL page cannot own a TUN device or raw sockets, so browser players cannot speak FIPS directly today. The path is (1) node-to-node FIPS first — the biggest sovereignty unlock and what unblocks self-hosted Plebeian nodes; (2) a small always-online bridge that translates browser WebSocket/WebRTC ↔ FIPS mesh, ideally the seller's own node so no third-party landlord re-enters the picture; (3) native / PWA / Tauri clients speak FIPS directly, matching the `concepts/torii-mobile-progression` wiki page. This staging is explicit so the browser limitation is not treated as a blocker for the node-layer work.

**Decision 6 — Adjacent transports kept as fallback and defence-in-depth.** Tor onion services for censorship-resistant browser access without a bridge; Nym for metadata privacy at the packet level; BLE / LAN mesh for the local circular-economy resilience case (two market stalls clearing trades with the wider internet down). None of these replace FIPS; all coexist with it as fallback / specialised transports.

## Consequences

### Positive

- **Removes the last landlord.** A Plebeian node no longer requires a rented address to be reachable. Identity, money, discovery, and now transport are all sovereign primitives. This is the completion of the freedom-tech stack, not an addition to it.
- **10× the eligible operator pool.** Home boxes, laptops, mini-PCs, sovereign appliances, and NAT'd connections all become first-class nodes. This is the population the Plebeian vision actually depends on.
- **Cleaner Gateway Protocol.** The `{npub, relay, target}` handoff shape collapses `relay` into the npub itself. This simplifies `GATEWAY_PROTOCOL.md` and strengthens the case for proposing it upstream as a NIP.
- **Privacy by construction.** The seller's home IP is not leaked to a middlebox during discovery, presence, or handoff. Aligns with the privacy-first stance.
- **Local resilience.** Multi-transport (UDP / TCP / Tor / Nym / BLE) means a local circular economy can keep clearing trades even with the wider internet down. This is not decoration; it is the same freedom guarantee applied to network conditions.
- **Reciprocal legitimacy.** Torii's public reference-integration status with FIPS improves both projects' credibility and coverage.

### Negative / risks

- **FIPS is alpha.** Real integration will surface bugs and gaps upstream. Mitigation: keep HTTPS as fallback for the entire spike period; contribute fixes upstream rather than forking.
- **Browser gap.** Browser-only players cannot benefit until the bridge lands. Mitigation: node-to-node work has independent value (unblocks self-hosted nodes) and does not wait on browser support.
- **Two paired dependencies at once.** Adding Blossom / NIP-94 alongside FIPS raises the spike's surface area. Mitigation: Blossom is a smaller, more mature integration than FIPS, and doing them together is cheaper than sequencing them because they share the "sovereign node addresses sovereign content" architectural conversation.
- **Operational maturity gap.** DNS + Let's Encrypt is well-understood by operators; FIPS is not. Mitigation: keep HTTPS as fallback; document the FIPS path as opt-in; do not deprecate the VPS path until the FIPS path has been through real load.
- **Content-addressing coupling.** Committing to Blossom now excludes IPFS/Iroh from the same slot. Mitigation: Blossom is Nostr-native and already the default in the Character Forge + Continuum work; the coupling is with the rest of the stack, not against alternatives.

### Neutral

- Existing Torii nodes on VPSes keep working exactly as they do today. This ADR adds a path; it removes nothing.
- The scoped spike is time-bounded (one or two weekends). It does not become a roadmap-wide refactor; if it fails to prove itself, HTTPS remains the default and the strategy doc is updated to reflect that.

## Scope of first spike

Non-negotiable success criteria for closing the spike:

1. One Torii node runs as a FIPS peer alongside its existing HTTPS listener.
2. Its npub is a valid FIPS address — a second FIPS peer can reach it purely by npub, with no DNS lookup and no port-forwarding on the first node.
3. One Gateway Protocol handoff between two nodes uses npub-only routing (the `relay` field collapsed into the npub); the browser player experiences the hop as normal.
4. Blossom / NIP-94 hosts one shop-asset (a GLB or image) content-addressed by hash; the destination node fetches it by hash rather than URL.
5. HTTPS/WebSocket fallback is preserved and passes existing regression checks.
6. Public write-up (blog post or README section) attributes the FIPS integration and links jmcorgan's upstream repo.

Explicit non-goals of this spike:

- Browser client speaking FIPS directly (deferred to bridge / native).
- Deprecating VPS-based hosting (VPS remains a first-class option indefinitely).
- Any change to identity, money, or reputation layers (they are already sovereign).
- Any global "Torii network policy" — cooperation is federated per node.

## Alternatives considered

- **Do nothing.** Continue as VPS + DNS + HTTPS indefinitely. Rejected: contradicts Core Principles, caps operator population at "people who can run a VPS", leaves transport as the odd landlord out.
- **Tor onion services only.** Provides some of the same properties (no DNS needed, censorship resistance). Rejected as the primary transport because of latency, browser dependency, and single-transport fragility. Retained as fallback and as the browser-side path without a bridge.
- **Custom mesh protocol.** Considered and rejected: writing another p2p protocol when a values-aligned open project exists is exactly the not-invented-here trap the Core Principles rule out. FIPS's npub-as-address property is not reproducible by a generic mesh; it is what makes the choice.
- **IPFS / Iroh for content addressing.** Considered and rejected as the paired dependency: Blossom is Nostr-native, already the default in Character Forge and Continuum, and does not introduce a second identity/DHT model alongside Nostr's.
- **Wait for browser FIPS support.** Rejected: the node-layer work has independent value, and browser support depends on bridge/native progress that is faster once nodes exist to bridge to.
- **Full-stack refactor.** Rejected: violates the "Incremental structure, no big rewrites" principle. Scoped spike is the correct shape.

## Update-All checklist (this PR)

This is a docs-only ADR — no runtime code changes, so no VERSION / CACHE_VERSION / EXPECTED_VERSION bump applies, and no VPS deploy is triggered. Adoption of the ADR itself does not schedule the FIPS spike; the spike will be added to `torii-quest-todo.md` as a separate LEAN-N task only after the current 15-hour proof-of-concept loop (world-serialization + portal-live-mirror + gate-only travel) lands and stabilises.

Updated in this PR:

- [x] `docs/adr/0111-founding-stack-and-fips.md` — this file.

Skipped intentionally (with reason):

- `src/config.js` VERSION / `package.json` / `public/sw.js` CACHE_VERSION / `tools/regression-check.mjs` EXPECTED_VERSION — docs-only change; no runtime behaviour affected.
- `torii-quest-strategy.md` (in-repo copy, if any) — the source-of-truth strategy doc lives in the Space file repo and was updated there (commit `b5ee49c`); it names ADR-0111 already. If a mirror of the strategy is added to the app repo later, cross-links land in that PR.
- `torii-quest-todo.md` / `torii-quest-progress.md` — the FIPS spike is not being scheduled by this ADR; those docs stay untouched until the spike is queued.
- `MVP_APPROVAL_STATE.json` / `NEXT_ACTION_STATE.json` / dashboard data — unaffected.
- `torii-continuum-*` and `torii-de-*` docs — this ADR is Quest-scoped (the Gateway Protocol collapse is a Quest artefact); Continuum and DE will pick up the founding-layer commitment when their own spikes touch transport.
- Tag / VPS deploy — docs-only PR; no tag bump, no deploy.
