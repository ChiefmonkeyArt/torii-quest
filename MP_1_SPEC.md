# MP-1 — WebSocket multiplayer (advisory hit detection)

**Version target:** v0.2.363-alpha
**Branch:** `mp-1-websocket-multiplayer-v0.2.363-alpha`
**Baseline:** v0.2.362-alpha @ `c36aa0d`
**Status:** SPEC — awaiting user sign-off, no code yet
**Owner track:** moves Multiplayer out of `torii-quest-strategy.md` "Later" onto the active shipped set.

---

## 1. Goal

Two use cases in one build:

1. **Share the live URL, friends join, we see each other and shoot.** The host operator runs Torii Quest on their own VPS at their own single domain. Everyone who visits that URL and logs in with Nostr enters the same WebSocket-backed shared arena.
2. **Cross-instance travel via a Torii Gateway.** From one operator's world you can portal into another operator's world by clicking a gateway that carries a `wss://` endpoint tag.

MP-1 is scoped to the first use case's happy path, plus the gateway plumbing to make the second use case work. Ranked play, anti-cheat, and eCash are explicitly out.

## 2. What is (and isn't) in scope

**In scope**
- Node WebSocket server (`server/arena-ws.js`) that runs alongside the static site on the same VPS
- Same-origin transport: `wss://<their-domain>/mp` — reverse-proxied by Caddy on the same TLS cert as the static site; no separate subdomain
- Client modules under `src/engine/multiplayer/` — flag-gated OFF by default
- NIP-07 challenge/response on connect for identity
- Position + orientation sync at ~20 Hz, interpolated on the receive side
- Chat relay
- **Advisory hit detection**: shooter's client says "I hit them for N", server relays, hit target's client applies damage. No server-side physics.
- Admin toggle in the Instance Settings shell (ACC-1) + per-zone opt-in flag
- Gateway `kind:30078` event schema updated to carry a `["ws", "wss://..."]` endpoint tag; travel-picker disconnects current WS and connects to the destination's WS
- `VPS_INSTALL.md` addendum with Caddy `/mp` block + `systemd` unit
- ~25 tests, gate-first pattern (same as UPD-1 / SEC-1 / ACC-1)

**Not in scope (deferred)**
- Server-authoritative hit detection → **MP-2**, alongside NIP-60 eCash stakes
- WebRTC P2P transport (option 3b) → **MP-3** or later
- Prize leaderboards / ranked matchmaking → post-MP-2
- Binary wire protocol → optimisation pass after MP-1 works
- Multi-arena / room switching on the same server → MP-1.5
- Voice chat, spectator mode, replays → not scheduled

## 3. Hit-detection model — advisory

Recap for the file (user decision on 2026-07-09):

- The shooter's browser runs its existing Rapier raycast and locally decides whether a shot hit and for how much damage.
- The client sends `SHOT` (aim ray, timestamp) AND `HIT` (target pubkey, damage, hit zone) to the server.
- The server relays both messages to all other clients. The server does NOT recompute the hit.
- The hit target's client applies damage locally on receipt of `HIT`.
- Chosen because MP-1 has no money on the line. Trades cheat-resistance for build speed and snappier feel.

MP-2 will replace this by moving the raycast to `server/arena-ws.js` (uses `raycastService` façade — see §6) and treating client `HIT` messages as advisory input only. The wire protocol is designed so that swap does not need a protocol version bump: MP-2 servers just ignore the client's damage claim and compute their own.

## 4. Architecture

```
Browser (client)                          Operator's VPS
+-----------------------------+           +-------------------------------+
| Torii Quest static bundle   |           | Caddy (:443)                  |
|  - src/engine/multiplayer/  | <-------> |   /            -> static site |
|    wsClient.js              |   WSS     |   /mp          -> arena-ws.js |
|    wireProtocol.js          |   over    |                (127.0.0.1:8787)|
|    positionSync.js          |   TLS     |                               |
|    remoteAvatars.js         |           | systemd: torii-arena-ws.service|
+-----------------------------+           |   node server/arena-ws.js     |
                                          +-------------------------------+
```

Single origin. One TLS cert. One domain. No client-side URL to configure — the client always dials `wss://${location.host}/mp`.

## 5. Wire protocol (JSON for MP-1)

Every message is `{ t: <type>, ... }`. Types are short strings to keep bytes low; a binary pass is an MP-1.5 optimisation.

### Handshake

| # | Direction | Type | Payload | Notes |
|---|---|---|---|---|
| 1 | S → C | `HELLO` | `{ challenge, serverVersion, protocolVersion:1 }` | 32 random bytes, base64 |
| 2 | C → S | `AUTH` | `{ npub, sig, event }` | NIP-07-signed kind-22242 auth event over the challenge |
| 3 | S → C | `WELCOME` | `{ selfId, roster:[{id,npub,pos,rot,character}] }` or `AUTH_FAIL` | `id` is a short session id, not the pubkey |

### Presence

| Direction | Type | Payload | Rate |
|---|---|---|---|
| S → all | `JOIN` | `{ id, npub, pos, rot, character }` | once per new peer |
| S → all | `LEFT` | `{ id, reason }` | once |
| C → S → all | `MOVE` | `{ pos:[x,y,z], rot:[yaw,pitch], vel:[x,y,z] }` | 20 Hz, dead-reckoned |

### Combat (advisory)

| Direction | Type | Payload | Notes |
|---|---|---|---|
| C → S → all | `SHOT` | `{ origin:[x,y,z], dir:[x,y,z], t }` | tracer/muzzle-flash cue for everyone |
| C → S → all | `HIT` | `{ targetId, dmg, zone: "head"\|"body"\|"limb", shotT }` | shooter's client decides. Server relays untouched in MP-1. |
| S → all | `KILL` | `{ shooterId, victimId, weapon }` | victim's client emits after `HIT` reduces HP≤0 |

### Chat

| Direction | Type | Payload |
|---|---|---|
| C → S → all | `CHAT` | `{ msg }` (≤280 chars, server rate-limits 1/sec/pubkey) |

### Housekeeping

| Direction | Type | Payload |
|---|---|---|
| C ↔ S | `PING`/`PONG` | `{ t }` |

## 6. Client-side modules

All under `src/engine/multiplayer/`. All node-pure except `remoteAvatars.js` (touches THREE) and `wsClient.js` (touches WebSocket).

| Module | Responsibility | ~Lines |
|---|---|---|
| `wireProtocol.js` | Pure. Encode/decode every message type. Validators. Tests import this directly. | ~120 |
| `wsClient.js` | Connection state machine (`idle`→`connecting`→`authenticating`→`connected`→`closed`). Exponential backoff on reconnect, capped at 30s. Fires events on `roster` / `peerJoin` / `peerLeft` / `move` / `shot` / `hit` / `kill` / `chat`. | ~180 |
| `positionSync.js` | Pure. Ring buffer of remote peer positions; interpolates at render time from the last two snapshots. 100 ms interpolation delay, extrapolation for up to 200 ms then hold. | ~90 |
| `remoteAvatars.js` | Scene bookkeeping. On `peerJoin`, load their `.glb` character (already in-repo) and add to scene. On `move`, update the transform (from `positionSync`). On `left`, dispose. | ~140 |

Flag: `MP_ENABLED` in `src/config.js`, default `false`. When false, none of these modules are imported. When true, `main.js` wires them behind the same event-bus pattern already used for `EV.PHASE_CHANGE`.

Combat integration: `weapons.js` on a local `EV.BOT_HIT_BY_PLAYER`-shaped event for a remote peer also emits `HIT` through `wsClient.send()`. Reuses the `raycastService` façade — no new hot-path allocations.

## 7. Server (`server/arena-ws.js`)

Single file, ~500 lines, Node `ws` package (already common enough to add).

Responsibilities:
- Bind `127.0.0.1:8787` (Caddy handles TLS termination and `/mp` upstream)
- Track `Map<sessionId, {ws, npub, pos, rot, lastMove}>`
- HELLO challenge, verify AUTH with `nostr-tools` `verifyEvent`
- Rate-limit `MOVE` to 25 msg/sec/session (drop excess); `CHAT` to 1/sec; `HIT` to 20/sec
- Broadcast (fanout) to all other sessions; never echo to sender
- Sanitize before rebroadcast: strip unknown fields, clamp numeric ranges (pos within ±5000, rot within ±π)
- 60s idle → disconnect
- No persistence, no DB, no config file. All tuning via env vars: `PORT`, `MAX_PEERS`, `RATE_LIMIT_MOVE`
- Prints a startup banner with peer count every 60s (systemd journal)

Not doing yet: multi-room, replay recording, admin console, metrics endpoint.

## 8. Cross-instance travel

Gateway `kind:30078` event currently carries `["url", "https://..."]`. Extend it (backwards-compatible) with:

```
["ws", "wss://otherdomain/mp"]
```

Travel-picker flow:
1. User clicks a gateway destination in `gatewayPortal.js` view.
2. `main.js` gateway subscriber calls `wsClient.disconnect()`.
3. Browser navigates to the destination `url` (same-origin cookies survive because everyone uses `/mp` under their own domain, not a shared one).
4. On the destination site, boot sequence dials `wss://${location.host}/mp` — same relative URL, different host.

No cross-site cookies. No shared identity server. Identity is the user's Nostr key, presented fresh at each destination via NIP-07.

## 9. Deployment (single-domain, SHC)

`VPS_INSTALL.md` gets a new section. Skeleton:

```caddyfile
your-domain.tld {
    encode gzip
    root * /var/www/torii-quest
    file_server

    handle /mp {
        reverse_proxy 127.0.0.1:8787
    }
}
```

```ini
# /etc/systemd/system/torii-arena-ws.service
[Unit]
Description=Torii Quest Arena WebSocket server
After=network.target

[Service]
Type=simple
User=torii
WorkingDirectory=/opt/torii-quest
ExecStart=/usr/bin/node /opt/torii-quest/server/arena-ws.js
Restart=on-failure
Environment=PORT=8787
Environment=MAX_PEERS=32

[Install]
WantedBy=multi-user.target
```

Non-technical operators run the installer (a follow-up workstream — **MP-1.5 · Installer**) which shells into their SHC VM via the SHC user-api's `/vm/{id}/ssh-keys/apply-live` flow, drops the static files, writes the Caddy + systemd config, reloads both, and prints "Your world is live at https://your-domain.tld".

MP-1 itself assumes the operator already has: VM + domain + Caddy + `node` installed. The installer packages that away in MP-1.5.

## 10. Tests (~25)

All under `tests/multiplayer/`. Same pattern as `tests/state.test.js` — pure, node-safe, fixture-driven.

| File | Cases | Focus |
|---|---|---|
| `wire-protocol.test.js` | 8 | Encode/decode every type; reject malformed; version tag round-trip |
| `ws-client-state.test.js` | 5 | State machine transitions; backoff; auth failure handling |
| `position-sync.test.js` | 6 | Interpolation math; extrapolation cap; late-packet handling |
| `hit-relay.test.js` | 3 | Advisory model contract: server never mutates HIT payload; MP-2 hook stub |
| `gateway-ws-tag.test.js` | 3 | `kind:30078` schema extended; old events without `ws` tag still parse |

Regression check gets one new item: forbid new `WebSocket(` / `new ws.WebSocket(` in any file outside `src/engine/multiplayer/` and `server/`.

## 11. Version markers (bump list — from handoff §4)

- `src/config.js` VERSION → `v0.2.363-alpha`, plus `MP_ENABLED = false`
- `index.html` `#version-label`, `#ver`
- `package.json` `"version": "0.2.363-alpha"`
- `tools/regression-check.mjs` header + `EXPECTED_VERSION` + stale-version regex flags v0.2.362
- `src/engine/dashboard/toriiQuestData.js` — `TORII_QUEST_VERSION`, "Source version" row, "Tests" row (target: 2092 + ~25 = ~2117 passing)
- `public/sw.js` `CACHE_VERSION = 'tq-v0.2.363-alpha'`
- `MVP_APPROVAL_STATE.json` (regenerated via `npm run approval:state -- --write`)
- `torii-quest-{strategy,todo,progress,handoff}.md` "Current version" lines

## 12. Definition of Done

- All ~25 new tests pass; full suite green
- `npm run check` clean (16/16 regression checks + new WS-scope check)
- `npm run release:status` READY verdict
- With `MP_ENABLED=false` (shipped default), zero behaviour change vs v0.2.362 — single-player identical
- With `MP_ENABLED=true` on a dev host running `arena-ws.js` locally, two browser tabs see each other's avatars, positions update smoothly, shooting one drops its HP, kill feed fires
- Docs updated: strategy moves "Mass player mode" out of Later; todo shows MP-1 shipped, MP-2 spec queued; progress adds MP-1 entry; handoff updates §1 to mention multiplayer
- PR squash-merged onto `main`
- Preview deploy validated (not yet published to live — user decides)

---

## Sign-off gate

Before ANY code is written, this spec is committed to the branch and shown to the user. The user acks:
- Scope (§2)
- Wire protocol (§5)
- Deploy shape (§9)
- Test coverage (§10)

Only then does implementation begin.
