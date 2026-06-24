# Torii Quest — v0.2.160-alpha: Leaderboard Relay-Read Proof

## Goal
Use the v0.2.159 read-only relay adapter boundary to PROVE how Nostr leaderboard
score events can be READ → normalised → validated → ranked from injected relay
events — WITHOUT live auto-connect, signing, publishing, key handling, payments,
NIP-07 actions, or any network/WebSocket. Read path only; the write path and the
audited host transport stay deferred.

## What landed

### 1. `src/engine/nostr/leaderboardRelayRead.js` (NEW — pure, node-safe)
No Nostr client, no WebSocket, no relay I/O, no signing, no key handling, no DOM,
no network, no auto-connect. Every helper is pure over plain data and never throws
on event data.
- `LEADERBOARD_TOPIC` = `'torii-quest'`.
- `buildScoreFilter({ authors, since, until, limit })` → a NIP-01 filter selecting
  kind-30000 leaderboard events with the `#t:torii-quest` topic tag. Only
  well-formed options are included (bad options dropped, never a malformed filter).
- `extractScoreFromEvent(event)` → `{ ok, score?|errors? }` — rebuilds a local
  score from a NORMALISED leaderboard event: authoritative numbers from JSON
  `content`, with indexable-tag fallback; `runId` anchored to the `d` tag; carries
  `pubkey` + `created_at` for dedupe. Rejects non-kind-30000 events and any score
  that fails `leaderboard.validateScore` (e.g. headshots > kills). Never throws.
- `dedupeScores(scores)` → `{ scores, dropped }` — addressable/parameterised-
  replaceable semantics: keeps the newest event (highest `created_at`) per
  `pubkey:runId` key, counting superseded duplicates.
- `readLeaderboardEvents(input, options)` → a read-only ranked report
  `{ ok, filter, count, rows, scores, skipped, duplicates, signed:false,
  published:false, readOnly:true, errors }`. Accepts a v0.2.159 relayRead `read()`
  result (`{events}`), a bare events array, or deterministic local sample data;
  runs each item through relayRead `normalizeRelayEvent` → `validateRelayEvent` →
  `extractScoreFromEvent` (failures collected in `skipped`), dedupes, then ranks via
  `leaderboardView.rankScores`. An unusable top-level shape degrades to `ok:false`
  with an empty board. NEVER signs, publishes, opens a socket, or throws; exposes
  NO publish/sign/send/connect surface.
- Re-exports `SCORE_FIELDS` for SDK consumers.

### 2. SDK exposure (read-only)
`src/sdk/index.js` re-exports `leaderboardRelayRead` and registers it in
`SDK_SURFACE` at the **experimental** tier. Safe: pure helpers, no I/O, inert
without injected/sample events.

### 3. ToriiDebug shell (deterministic local sample, display-only)
`src/engine/debug/shellReport.js` adds `DEMO_RELAY_SCORE_EVENTS` (a frozen LOCAL
sample of four kind-30000 events — two valid, one superseded duplicate, one
malformed) and `leaderboardRelayReadReport(events?, opts?)`. Wired into
`buildShellReport` and exposed read-only at `ToriiDebug.shells.leaderboardRelayRead()`.
The locked 4-surface `shellsSummary` proof-board list is UNCHANGED.

### 4. `tests/leaderboard-relay-read.test.js` (NEW — 12 cases)
Covers `buildScoreFilter` (kind+topic; well-formed vs malformed options);
`extractScoreFromEvent` (JSON content, tag fallback, reject wrong kind / invalid
score / null); `dedupeScores` (newest-per-address, dropped count); and
`readLeaderboardEvents` (rank + filter shape, `{events}` envelope + dedupe, skip
malformed/non-leaderboard, safe degradation on unusable shapes, no
publish/sign/send/connect surface) + SDK exposure.

## Verification
- `npm test` → **573 passed / 48 files** (was 561/47; +12 cases).
- `npm run check` → **ALL GREEN**, 14/14; check `[14]` references v0.2.160-alpha (5 docs);
  proof-surface gate `[12]` ok (4 bound).
- `npm run bundle:report` → advisory baseline unchanged (rapier chunk tracked, not gated).
- `npm run build` → clean (known large-chunk advisory only).
- `npm run handoff:status` → VERSION v0.2.160-alpha, package in sync; exits 0.

## Safety
godMode=false. No WebSocket/fetch/XHR in the module — pure data shaping +
predicates over injected/sample events. No new `setTimeout`. No Vector3/Matrix4.
No signing, publishing, payments, relay writes, NIP-07 actions, private-key
handling, auto-connect from the game loop, or navigation. The reader only consumes
events handed to it; it never touches the wire and exposes no write/connect surface.

## Version markers bumped → v0.2.160-alpha
`src/config.js`, `package.json`, `index.html` (×2), `tools/regression-check.mjs`
(header, `EXPECTED_VERSION`, stale-guard now flags `v0.2.159-alpha`).

## Docs updated
`todo.md`, `progress.md`, `HANDOFF.md`, `CODE_INDEX.md`, `SDK_DEBUG_INDEX.md`.

## Not done (left to parent agent)
Not pushed/published. The audited host wire-up — the actual WS REQ→EOSE collector
implementing the injected `request` transport, CSP `connect-src` relay entries, and
rate-limiting — remains deferred, as does the write path (NIP-07 signer + relay
publish, SEC-1) and the in-world rank-board MESH/HUD. Parent agent verifies,
security-reviews, deploys, publishes, pushes, and syncs docs.
