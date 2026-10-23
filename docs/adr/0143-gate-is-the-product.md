# ADR-0143: The Torii Gate is the product; Quest is the first world

- **Status:** Accepted
- **Date:** 2026-10-21
- **Deciders:** chiefmonkey
  - "I always saw quest as the open world BUT it was the Torii gate that is the true innovation … it's the Torii gate that is the unifying connector and handshake."
  - "people should be able to build their worlds with any gaming engine they chose and then they include the torii gateway … and they connect to mine and everyone elses."
  - On this framing: "do all the things."
- **Related:** `GATEWAY_PROTOCOL.md` (v0.1 draft), ADR-0111/0126 (FIPS is node-to-node), ADR-0140 (Applesauce relay trial), ADR-0130 (combat-quality directive).

## Context

Quest is a browser world: Three.js, Rapier and Nostr identity. Its gateway lets a player travel to another operator's world. Discovery comes from world heartbeats (kind 30078 with NIP-40 expiry, `#t:torii-gateway`), and travel is a URL handoff carrying the player's npub. Nothing in that agreement depends on Three.js, Rapier or Quest's code: any engine with a Nostr library can do it.

Two audiences see the project differently:
- **Players** visit worlds, so for them the product is Quest.
- **Developers**, especially in the Nostr community, rarely adopt someone else's game. They do adopt small open standards (NIPs) that connect their own work to others'.

The [Nostr Game Engine](https://ngengine.org/) (jMonkeyEngine, Java, OpenSats-funded) handles networking *inside* a game. Nothing yet links independently built worlds, so the Gate fills a gap.

## Decision

The north star is: **Torii is an open network of worlds. The Torii Gate is its open protocol. Torii Quest is the first world, and the proof that it works.**

1. **The Gate is three layers, and only the first is required.**

   | Layer | What it is | Who needs it |
   |---|---|---|
   | Protocol | Nostr events: world heartbeat/directory, destination by npub, handoff URL and arrival | Every world, any engine |
   | Doorway | The travel UI | Web worlds embed it as a napplet; native engines use a small SDK/adapter |
   | Node services | FIPS and other node-to-node transport, run by the operator's node | Optional; travel works over relays + HTTPS without them |

   Say "Gate protocol" or "doorway", never "FIPS napplet". FIPS stays node-side (ADR-0111/0126).
2. **Gate track order.** G1 and G2 come before the Applesauce trial (ADR-0140), which is a client-side relay optimisation:
   - **G1:** freeze spatial hop v1 in `GATEWAY_PROTOCOL.md`: open travel only (heartbeat discovery + URL handoff + arrival). The signed handoff (§6) becomes an optional extension.
   - **G2:** a conformance kit: JSON fixtures, an engine-free validator, and a minimal reference world with no Three.js, so another engine can prove it complies.
   - **G3:** a second world on a different stack. The first candidate is an NGE world (Java). Contacting its developers needs operator approval of the message and identity.
   - **G4:** a NIP draft, once G3 has worked both ways.
3. **Quest's combat-quality directive (ADR-0130) is unchanged.** It still governs Quest game-zone work. The Gate track runs alongside it and doesn't replace it. The points stay frozen.

## Consequences

- **Enables:**
  - a pitch the Nostr developer community can adopt ("add a short spec; your world joins the network") without taking on Quest's stack;
  - Quest becomes the reference world and the demo for that pitch.
- **Forecloses:** Torii-only protocol fields in the core (anything Quest-specific must be an optional extension), and requiring FIPS, napplets or a Torii node to join.
- **Trade-offs:**
  - Gate work competes with Quest polish for time;
  - a protocol with one implementation is only a draft until G3 succeeds;
  - freezing v1 early limits later changes to extensions.
- **Enforcement:**
  - G1's freeze adds protocol fixtures to the test suite, so any change to the v1 wire format fails CI;
  - the strategy north star and todo order reference this ADR.

## Alternatives considered

- **Quest as the product, the Gate as a feature:** this pitches one game to other game makers; low uptake, and it ties the network to our stack.
- **Ship the Applesauce trial first:** it only speeds up Quest's own client and does nothing for interoperability.
- **Go straight to a NIP:** NIPs without two working implementations rarely land; G2 and G3 come first.

## Follow-up proposed (ADR-0147, 2026-10-23)

ADR-0147 puts the doorway layer (the **Torii Gateway Experience** napplet) at the centre of the architecture. The napplet asks (`gate.peek`, `gate.enter`); trusted gate services check, sign and act; a small engine adapter places it. Extracting it from Quest is Milestone 2 of `docs/design/sovereign-metaverse-roadmap.md`.
