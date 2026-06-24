# Torii Quest — v0.2.159-alpha: Read-Only Nostr Relay Adapter Foundation

## Goal
Define the SHAPE and pure safety boundary for READING events from Nostr relays
later (leaderboard scores, profiles, listings) — WITHOUT signing, publishing, key
handling, payments, NIP-07 actions, or auto-connecting from the game loop. Foundation
slice only: pure, node-testable helpers + a read-only adapter with an INJECTED
transport; the actual socket wire-up stays a deferred, audited host step.

## What landed

### 1. `src/engine/nostr/relayRead.js` (NEW — pure, node-safe)
No Nostr client, no WebSocket, no relay I/O, no signing, no key handling, no DOM, no
network. Every helper is a pure function over plain data and NEVER throws on
malformed input.
- `RELAY_READ_VERBS` = `['REQ', 'CLOSE']` (read-subscription frames only — `EVENT`
  / publish is deliberately absent) and `EVENT_FIELDS` (the NIP-01 event fields).
- `validateRelayUrl(raw)` → `{ valid, errors, url }` — absolute `ws://`/`wss://`
  only, must have a host, rejects embedded `user:pass@` credentials; returns the
  normalised href.
- `normalizeRelayEvent(raw)` → canonical NIP-01 event (`id/pubkey/created_at/kind/
  tags/content/sig`); `tags` coerced to an array of string arrays (non-array tags
  dropped, values stringified); `null` for non-objects.
- `validateRelayEvent(event)` → `{ valid, errors }` — structural checks (id/pubkey
  64-hex, kind/created_at non-negative ints, tags array-of-string-arrays, content
  string, sig 128-hex only when present). NO cryptographic verification — that is a
  host step with an injected verifier.
- `eventMatchesFilter(event, filter)` → boolean — pure NIP-01 filter semantics:
  conditions ANDed, values within `ids`/`authors`/`kinds` ORed, `since`/`until`
  bounds, `#<letter>` tag filters. `{}` matches all; `null` matches nothing; `limit`
  is a transport hint and is ignored per-event.
- `buildReqMessage(subId, filters)` → `['REQ', subId, ...filters]` and
  `buildCloseMessage(subId)` → `['CLOSE', subId]` — pure READ-frame builders (throw
  only on a structurally invalid subId/filters; there is NO EVENT/publish builder).
- `createReadOnlyRelayAdapter({ request })` → `{ read, readOnly: true }` — the
  read-only boundary. `request(filters, opts)` is an INJECTED host-only transport
  (e.g. a one-shot REQ→EOSE collector over the host's own socket). `read()`
  normalises → validates → filters whatever the transport returns into
  `{ ok, events, skipped, count, errors }`, degrades safely (no transport / thrown
  request / non-event-list shape) and NEVER throws, signs, publishes, opens a
  socket, or mutates. The returned object is `Object.freeze`d and exposes NO
  publish/sign/send/connect/close method.

### 2. SDK exposure (read-only)
`src/sdk/index.js` re-exports `relayRead` and registers it in `SDK_SURFACE` at the
**experimental** tier. Safe to expose: the pure helpers do no I/O and the adapter is
inert unless a host injects a `request` transport.

### 3. `tests/relay-read.test.js` (NEW — 17 cases)
Covers `validateRelayUrl` (ws/wss accept + normalised href; reject non-ws/relative/
empty/credentialled); `normalizeRelayEvent` (canonical coercion, tag stringify/drop,
null for non-objects, optional defaults); `validateRelayEvent` (valid w/ + w/o sig,
bad hex/ints/sig shape, no-throw); `eventMatchesFilter` (empty-matches-all,
null-matches-none, AND/OR across ids/authors/kinds, since/until, `#tag`);
`buildReqMessage`/`buildCloseMessage` (frame shape, single-filter wrap, throws,
read-verbs-only — no EVENT); and `createReadOnlyRelayAdapter` (normalise/validate/
filter, `{events}` envelope + bare array, safe degradation on no-transport/thrown/
bad-shape, frozen + no publish/sign/send/connect/close method) + SDK exposure.

## Verification
- `npm test` → **561 passed / 47 files** (was 544/46; +17 cases).
- `npm run check` → **ALL GREEN**, 14/14; check `[14]` references v0.2.159-alpha (5 docs).
- `npm run bundle:report` → advisory baseline unchanged (rapier chunk tracked, not gated).
- `npm run build` → clean (known large-chunk advisory only).
- `npm run handoff:status` → VERSION v0.2.159-alpha, package in sync; exits 0.

## Safety
godMode=false. No WebSocket/fetch/XHR in the module — it is pure data shaping +
predicates. No new `setTimeout`. No Vector3/Matrix4. No signing, publishing,
payments, relay writes, NIP-07 actions, private-key handling, auto-connect from the
game loop, or navigation. The pure helpers never touch the wire; the adapter only
reads through an explicitly injected transport and exposes no write/connect surface.

## Version markers bumped → v0.2.159-alpha
`src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs`
(header, `EXPECTED_VERSION`, stale-guard now flags `v0.2.158-alpha`).

## Docs updated
`todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`.
(`NOSTR_GAME_NIPS.md` does not exist in this repo; the relay-read contract is
documented in CODE_INDEX.md + SDK_DEBUG_INDEX.md instead — no new doc created.)

## Not done (left to parent agent)
Not pushed/published. The audited host wire-up — the actual WS REQ→EOSE collector
that implements the injected `request` transport, CSP `connect-src` relay entries,
and rate-limiting — remains deferred, as does the write path (NIP-07 signer + relay
publish, SEC-1) and the in-world rank-board MESH/HUD. Parent agent verifies,
security-reviews, deploys, publishes, pushes, and syncs docs.
