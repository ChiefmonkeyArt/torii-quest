# ADR-0115: Single-instance npub session (one live character per identity)

- **Status:** Accepted
- **Date:** 2026-09-15
- **Version:** v0.2.846-alpha
- **Deciders:** chiefmonkey
- **Related:** ADR-0114 (seamless metaverse travel, recorded-only), `server/arena-ws.js`, `src/engine/multiplayer/wireProtocol.js`, `src/engine/multiplayer/wsClient.js`, `src/arenaRuntime.js`

## Context

The requirement is **"your character can never be duplicated — there can only be
one of you that builds your genuine WoT"**. The server previously keyed every
socket as a distinct session by a random id (`newSessionId()` = 12 random bytes),
and `finishAuth` set `sess.npub`/`sess.pubkey`/`sess.character` with **no check for
an existing session already authenticated with the same pubkey**. As a result, one
npub logged in on two machines produced **two live sessions and two avatars**
— a direct violation of the single-instance rule.

The 15-minute `IDLE_DISCONNECT_MS` backstop only reaps *crashed* tabs; it is not a
dedup mechanism. The client's `onclose` handler also re-schedules a reconnect for
almost every close reason, so a naive "server closes the duplicate" approach would
ping-pong: the kicked client re-dials, re-authenticates, and kicks the *other*
session back.

## Decision

Enforce **one live session per npub** on the server, with a dedicated terminal
client signal:

1. **Server** (`finishAuth`): when an npub authenticates and another *authed*
   session already holds the same lowercased 64-hex pubkey, that older session is
   superseded — sent `MSG.REPLACED { reason }` and then `closeSession(...,'replaced')`
   (its `LEFT` broadcast removes its duplicate avatar from every peer). The new
   session is then admitted as the single live instance. Anonymous / non-hex pubkeys
   skip dedup.
2. **Wire** (`wireProtocol.js`): add `MSG.REPLACED` (server→client) with a
   validator (optional `reason` ≤ 120 chars) and an `ALLOWED_FIELDS` entry. It is
   additive on `PROTOCOL_VERSION=1`, so older clients drop it via the existing
   `UNKNOWN_TYPE` guard.
3. **Client** (`wsClient.js`): on `MSG.REPLACED`, emit `'replaced'` then
   `disconnect('replaced')` — a **permanent** stop. `disconnect` sets
   `_disconnected`, so the subsequent `onclose` does **not** schedule a reconnect
   backoff; the superseded client can never ping-pong the single-session slot.
4. **Host** (`arenaRuntime.js`): on `mp_replaced`, surface
   "You logged in on another device — this session ended." and return to the title
   screen, so the superseded player understands why their world disconnected rather
   than seeing a silent freeze.

Supersede-older (rather than reject-newer) is chosen because it matches the travel
model in ADR-0114: the *newest* login is the live "you", and an older machine that
was left open is retired — the same handoff a gate-crossing would imply.

## Consequences

- Two machines sharing one npub now resolve to a single live character; the older
  session's avatar is removed for all peers and its local client stops cleanly.
- A reconnect after a network blip on the *same* machine supersedes the lingering
  dead socket, which is the desired behaviour (the re-dial is the live instance).
- Anonymous (guest) sessions are unaffected and may still coexist.
- No change to the identity/payment boundary: this is a session-cardinality rule,
  not an authentication or privilege change.