# Torii Gate Protocol v1 (frozen)

> **Status:** FROZEN v1 (ADR-0144, v0.2.909-alpha). The wire format below changes only by **additive extensions** (§8) or a new major version. CI enforces it with the conformance fixtures in `conformance/gateway-v1/`.
>
> **Audience:** anyone building a world in any engine or language. You need a Nostr library (or ~100 lines of WebSocket + schnorr code) and an https page where players can land. You don't need Torii code, Three.js, FIPS, napplets or a Torii node.
>
> **History:** the v0.1 draft (URL intent and signed-handshake sketch) is kept in `docs/gateway-protocol-v0.1-draft.md`.

The key words MUST, SHOULD and MAY are used as in RFC 2119.

## 0. What the Gate is

A world tells the network "I'm open, here's where to land" by publishing a **heartbeat** event (§2). A **reader** (any world's doorway UI) lists live heartbeats (§3). A player **travels** by visiting the destination's landing URL with their pubkey attached (§4). The destination **admits** them under its own policy (§5).

That's the whole protocol. Everything else (multiplayer endpoints, signed invitations, node transports such as FIPS) is an optional extension (§8).

## 1. Identity

- A world is identified by its **owner pubkey** (hex, 32 bytes). Hostnames, URLs and relays are hints that can change; the owner key is the durable name.
- A world MAY publish several zones. Each zone is the addressable pair (owner, `d` tag).

## 2. Heartbeat event (writer rules)

An addressable Nostr event (NIP-01, parameterised replaceable):

| Field | Value |
|---|---|
| `kind` | **30078** (NIP-78 application data) |
| `pubkey` | the owner's key, or a **beacon key** that names the owner in a `p` tag |
| `content` | JSON object (below), ≤ 4 KB |

**Tags.** A writer MUST include:

| Tag | Rule |
|---|---|
| `["d", <zoneId>]` | 1–128 chars, unique per owner |
| `["t", "torii-gateway"]` | the discovery topic |
| `["expiration", <unix seconds>]` | NIP-40. SHOULD be `created_at + 1200` (20 min); MUST be within `created_at + 60 … + 3600` |

A writer SHOULD also include:

| Tag | Rule |
|---|---|
| `["zoneType", "nap" \| "arena" \| "shop" \| "gallery"]` | the kind of zone |
| `["title", <text>]` | the world title |
| `["relay", <wss url>]` | zero or more relays where the world can be reached |
| `["p", <owner hex>]` | **required** when `pubkey` is a beacon key rather than the owner |

**Content.** A writer MUST include:
- `zoneId`: string, equal to the `d` tag;
- `website`: an **https** landing URL (public host, default port, no credentials);
- `version`: `1`.

A writer SHOULD include:
- `title` (≤128 chars) and `description` (≤512 chars);
- `zoneType` (as above);
- `relays`: array of ≤8 ws/wss URLs;
- `topics`: array of ≤8 strings of ≤64 chars;
- `displayName` (≤128 chars) and `avatar` (https): the owner's display name and picture.

**Cadence.** Republish at least every **10 minutes** while open. Stop publishing, and the record expires, when closed.

## 3. Reader rules

A reader querying relays with the filter `{"kinds":[30078], "#t":["torii-gateway"]}`:

1. **MUST verify** the NIP-01 event id and the BIP-340 signature, and drop any failure.
2. **MUST drop stale records.** A record is live when `expiration` ≥ now, or when `created_at` ≥ now − 3600.
   - The second clause tolerates a reader clock that runs ahead of the writer's; it also covers records with no `expiration`.
   - Drop any record carrying a `state` tag (a handshake, not presence).
3. **MUST sanitise before showing anything:**
   - strip control characters and markup from text, and enforce the length limits above;
   - `website`, `avatar` and `banner` must be https, or they are ignored;
   - relays must be ws/wss without credentials;
   - `ws` (§8) must be wss;
   - an unknown `zoneType` means none.
4. **MUST resolve the owner** as the first valid hex `p` tag if present, otherwise `pubkey`.
5. **The zone id** is `content.zoneId` when it is a non-empty string, otherwise the `d` tag. Writers MUST keep them equal. A record with neither is skipped. Malformed `content` JSON falls back to tags only.
6. **MUST keep only the newest** record per (`pubkey`, zone id).
7. A record without a valid https `website` MAY be listed but MUST NOT offer travel.
8. MUST ignore unknown fields and tags; they are how extensions (§8) stay compatible.
9. SHOULD hide its own world from its own list.

A record that fails a MUST is skipped, never shown half-trusted.

## 4. Travel (the hop)

To send a player to a world, the origin navigates to:

```
<website>?torii-traveller=<player pubkey hex>[#/zone/<slug>]
```

- `website` is the sanitised https URL from §3.
- The origin MUST refuse loopback, private-range or credentialed hosts and non-default ports, except in local development.
- `torii-traveller` is the traveller's 64-char lowercase hex pubkey. Anonymous travel omits it.
- `#/zone/<slug>` MAY select a zone. The slug matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and is ≤64 chars.
- Travel MUST only happen after an explicit player action (a click or a confirm). Parsing a heartbeat or a link never moves anyone.

## 5. Arrival (destination rules)

- The destination reads `torii-traveller` and MUST treat it as a **claim, not authentication**. Anyone can type a URL.
- To act on the identity (seating, follows-only access, inventory), the destination MUST verify it itself, for example with a NIP-07 login or NIP-98 HTTP auth that proves control of that key.
- Admission policy belongs to the destination. Quest offers `public`, `follows-only`, `whitelist` and `invite-only`.
- A refused traveller SHOULD be shown why and offered a way back. Origins SHOULD keep their own world one click away.

## 6. Security summary

| Threat | Rule |
|---|---|
| Forged world listing | §3.1 signature check |
| Ghost worlds | §2 expiration + §3.2 staleness |
| Script/markup injection | §3.3 sanitising |
| Phishing or LAN redirects | §4 https, public hosts only |
| Impersonated traveller | §5 claim vs proof |
| Drive-by teleports | §4 explicit player action |

## 7. Versioning

- `content.version` is `1`.
- Readers MUST accept `version` ≥ 1 and apply only the fields they know.
- A change that breaks a v1 reader requires `version: 2` and a new section in this file. Under ADR-0144 that needs an ADR and new conformance fixtures.

## 8. Extensions (optional, additive)

| Extension | Shape | Status |
|---|---|---|
| Multiplayer endpoint | `["ws", <wss url>]` tag (+ `content.wsEndpoint`); the tag wins | Live in Quest |
| Signed invitation / private travel | handshake records carrying a `state` tag (readers drop them from presence) | Reserved, not in use |
| Node transports (FIPS, …) | between operators' nodes, outside this protocol | Node-side |
| Market listings in a zone | see ADR-0145 (NAP Zone market) | Proposed |

## 9. Conformance

`conformance/gateway-v1/` is engine-free and has no dependencies beyond `@noble/curves`:

| Path | What it does |
|---|---|
| `fixtures/heartbeats.json` | signed valid and invalid heartbeats with expected reader results |
| `fixtures/travel.json` | travel-URL and arrival cases |
| `gate-v1.mjs` | a ~200-line reference reader and writer check: `checkHeartbeat`, `readWorlds`, `visitUrl`, `readTraveller` |
| `check.mjs` | CLI: `node conformance/gateway-v1/check.mjs event.json` checks your own heartbeat |
| `reference-world/` | a single-page world with no 3D engine that publishes, lists, travels and greets arrivals |

A world conforms when its heartbeats pass `check.mjs` and its reader agrees with every fixture. Quest's own reader and writer are tested against the same fixtures in CI.

## 10. Relationship to Quest's code

| Concern | Module |
|---|---|
| Writer | `src/engine/gateway/worldPresence.js` (`buildPresenceEvent`); cadence in `src/engine/presence/heartbeat.js` |
| Reader | `src/engine/gateway/gatewayRead.js` (`readGateways`, with `verify` per §3.1) |
| Travel | `src/engine/gateway/openVisit.js` (`buildVisitUrl`), `urlHarden.js`, `zoneRoute.js` |
| Arrival | `src/engine/gateway/handoffArrival.js` (`readArrivingTraveller`, arrival modes) |
