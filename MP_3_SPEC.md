# MP-3 · Nostr score / leaderboard shipping (v0.2.366-alpha)

**Status:** shipped in v0.2.366-alpha
**Baseline:** v0.2.365-alpha (MP-1.5 sandbox-hosted arena)
**Ideology:** *"we shouldn't be reliant on nostr relays for gameplay, only sharing of scores and leaderboards"* — MP-3 is the first Torii Quest feature that lives on Nostr.

---

## Design (Option A — client-signed)

Server accumulates authoritative kill/death tallies per session and broadcasts them to all peers at match-end / disconnect. Each peer signs **their own** score with their nostr key (nip07 preferred, in-page seed fallback) and publishes to their configured relays. Aggregation for the leaderboard happens client-side by querying `kind:30078` with `#d=torii-quest`.

### Trust model

- Server is the **source of truth** during a match (already authoritative for hits via MP-2).
- Each peer sees the same tally table (server broadcasts to all).
- Peer signs and publishes their **own** row only — cannot forge others' pubkeys.
- Outliers get down-ranked client-side by cross-checking with independent witnesses (peer-published events from the same session id form a witness quorum).

### Why not server-signed

- No server key management (no env-var private key on the sandbox).
- No single relay dependency.
- Aligned with the user's cypherpunk sovereignty preference.

### Trade-off accepted

A dishonest peer could **not publish** their loss, or publish only wins. But they cannot forge a **win** because the same server broadcast reaches every other peer, and those peers' witness events contradict the false claim. See MP-3.1 follow-up (co-occurrence WoT seed).

---

## Wire protocol (PROTOCOL_VERSION=1, additive)

New message: **SCORE** (server → all peers in the session)

```jsonc
{
  "t": "SCORE",
  "sessionId": "<16-hex-char server-generated session id>",
  "endedAt": 1730000000000,   // ms epoch, server clock
  "tallies": [
    { "id": "<peer id>", "npub": "<64-hex pubkey>", "kills": 7, "deaths": 3, "damage": 231 },
    // …
  ]
}
```

Trigger conditions (server-side):

1. **Peer disconnect** — send SCORE to the departing peer (best-effort) + all remaining peers, containing the disconnecting peer's final tally + all others' current tallies.
2. **Match-end** — reserved. In MP-3 we only ship the disconnect trigger; explicit match rounds land in a later milestone.

MP-1/1.5 clients drop unknown types via `decode()`'s UNKNOWN_TYPE guard — SCORE is safe on the shipped wire.

`ALLOWED_FIELDS[MSG.SCORE] = ['sessionId', 'endedAt', 'tallies']`.

### Sanity clamps

- `sessionId`: 16 hex chars exactly.
- `tallies`: array, 1..32 entries.
- Per-entry: `id` string 1..32 chars, `npub` 64 hex, `kills`/`deaths`/`damage` non-negative integers ≤ 1e6.

---

## Nostr event schema (client → relays)

- **Kind:** `30078` (application-specific data, addressable / parameterized replaceable)
- **`d` tag:** `torii-quest` (namespace; a peer's latest score replaces prior)
- **Additional tags:**
  - `["session", "<sessionId>"]` — links to the arena session
  - `["k", "<kills>"]`, `["dth", "<deaths>"]`, `["dmg", "<damage>"]`
  - `["ended", "<endedAt>"]`
  - `["client", "torii-quest/v0.2.366-alpha"]`
- **Content:** JSON of the peer's own tally row, e.g.
  ```json
  {"kills":7,"deaths":3,"damage":231,"sessionId":"a1b2…","endedAt":1730000000000}
  ```

Because MP-3 uses **kind 30078 (parameterized replaceable)** with `d=torii-quest`, each pubkey has **one canonical current score** on the network. Leaderboard queries are cheap and consistent.

**Historical scores (for lifetime aggregation):** peer additionally publishes a `kind:1` (regular note) that mirrors the same content + tags, but is *not* replaceable. Relay retention determines depth of history. Leaderboard prefers `30078` for "current standing" and aggregates `kind:1`-tagged events for lifetime totals.

---

## Publishing (client)

1. Prefer `window.nostr.signEvent()` (NIP-07 browser extension).
2. Fallback: locally-persisted seed (existing `src/engine/crypto/nostrSig.js`) — reuses the same key the arena AUTH already uses.
3. Publish to the same relays configured in Instance Settings (existing setup).
4. Deduplicate: a peer's own `30078#d=torii-quest` event is published at most once per `sessionId + endedAt` pair (memoised in localStorage).

---

## Leaderboard aggregation (client)

Query: `{ kinds: [30078], '#d': ['torii-quest'], limit: 500 }` (deduped by pubkey via replaceable semantics).

Aggregation rules:
- `currentKills`, `currentDeaths`, `currentDamage`, `lastSeen` from `30078`.
- For lifetime totals, sum `kind:1` history: `{ kinds:[1], '#t':['torii-quest-score'], limit: 5000 }`.
- Sort by `lifetimeKills DESC`, then `lifetimeK/D DESC`, then `lastSeen DESC`.
- Top 20 shown in the leaderboard panel; Top 5 in the dashboard tile.

---

## Regression checks (added)

- **[19] MP-3 SCORE additive-only on PROTOCOL_VERSION=1** — grep for any PROTOCOL_VERSION bump; enforce SCORE is in MSG enum with ALLOWED_FIELDS entry.
- **[20] Leaderboard reads only `kind:30078` with `#d=torii-quest`** — grep client subscribes; block use of any other kind for ranking.

---

## Rollback

- Server: unset `SCORE_ENABLED` env var (defaults to `true` in v0.2.366-alpha) → server stops broadcasting SCORE frames.
- Client: `MP_SCORE_ENABLED = false` in `src/config.js` → client stops signing + publishing.
- Existing kind:30078 events on relays are harmless; unwind is silent.

---

## Follow-up (queued as MP-3.1)

Track per-installation **score-event co-occurrence** — which pubkeys my node repeatedly sees ranked alongside mine — as a data seed for a Nostr web-of-trust. Spec after MP-3 has produced ≥ 100 real matches to observe patterns from.
