# ADR-0081: Single Unified Relay List (Connection, Not Consent)

- **Status:** Proposed
- **Date:** 2026-08-28
- **Deciders:** chiefmonkey (+ Perplexity Computer agent)
- **Supersedes (partially):** ADR-0076's rationale for splitting relay lists by
  "public vs. Torii-ecosystem" trust. ADR-0076's *default relay set* and its
  per-action opt-in gates (heartbeat, gamestr, access settings) are preserved
  unchanged — only the reasoning for having two separate relay lists is replaced.
- **Related:** `src/engine/presence/nodeRelays.js`, `src/nostr.js`,
  `src/engine/settings/relayPanel.js`, `src/main.js`, `src/arenaRuntime.js`,
  ADR-0077 (heartbeat auto-on), gamestr opt-in (`GAMESTR_ENABLED`/
  `getGamestrEnabled()`), `publishAccessSettings`.

## Context

Torii Quest currently has **two separate, hardcoded relay lists**:

1. **`DEFAULT_NODE_RELAYS`** (`nodeRelays.js`) — 3 relays (gamestr.io,
   plebeian.market, routstr.com). Drives the **Relay settings tab** (visible,
   editable) and is what the heartbeat/presence **publish** path uses.
2. **`RELAYS`** (`nostr.js`) — 2 relays (nos.lol, vertexlab.io). Used for
   **profile reads, login, leaderboard reads, and the presence-discovery read**
   (merged with list 1). Hardcoded, not shown anywhere in Settings, not
   editable by the operator.

ADR-0076 justified this split as a trust boundary: "presence events are
operator-identity-bearing, so silently publishing to big public relays
(damus/nos.lol/nostr.band/primal) was forbidden." That framing conflated two
different concerns:

- **Which relays we connect to** (a technical/reach question — public relays
  are fine, popular relays are *good*, more reach = better discovery).
- **Which actions are allowed to publish user data without confirmation**
  (a consent question — scores, achievements, presence should never appear in
  Primal/Damus/Amethyst unless the user clicked something to make that happen).

The user's clarification: public relays are not the problem. The problem would
be the game silently publishing identity-bearing data (presence, scores,
achievements) to *any* relay — public or private — without an explicit user
action. Relay identity and publish consent are orthogonal; conflating them
produced two lists where one was sufi cient.

## Decision

**Collapse to one relay list.** Delete the separate hardcoded `RELAYS` in
`nostr.js`. All relay-consuming code — profile reads, login, leaderboard reads,
presence-discovery reads, AND presence/heartbeat publish — reads from the
single list already exposed via `readEffectiveNodeRelays()` in `nodeRelays.js`.
That list stays owner-editable in the existing Relay settings tab
(`relayPanel.js`) — nothing about the tab's UI/UX changes, it now just
controls reads too, not only publish.

**Prepopulate the single default list with 5 relays** (the full set verified
live in ADR-0076/v0.2.711, union of both former lists):

```js
export const DEFAULT_NODE_RELAYS = Object.freeze([
  'wss://main.relay.gamestr.io',   // gaming notes + presence (Torii ecosystem)
  'wss://relay.plebeian.market',   // marketplace presence (Torii ecosystem)
  'wss://relay.routstr.com',       // routstr network relay (Torii ecosystem)
  'wss://nos.lol',                 // popular general relay — good for reach
  'wss://relay.vertexlab.io',      // NIP-45 profile aggregator
]);
```

**Consent stays exactly where it already lives — per action, not per relay:**
this ADR changes zero opt-in logic. Each publish action keeps its own explicit
gate, verified unchanged:

| Action | Gate (unchanged by this ADR) |
| --- | --- |
| Heartbeat/presence | Auto-fires once on owner login (ADR-0077), but every publish still requires a live NIP-07 signer approval prompt — nothing signs or sends without that click. |
| Gamestr score | `GAMESTR_ENABLED \|\| getGamestrEnabled()` — off by default, owner opts in via a Settings toggle. |
| Access settings | Only publishes on explicit "SAVE ACCESS SETTINGS" click + signer prompt. |
| Achievements | Not yet implemented — no gate exists to preserve. |

The single relay list only answers "where do we send/read from once an action
is already permitted to run" — it never grants permission by itself. A relay
being "public and popular" is now a *good* property (more reach, more
discovery), not a red flag.

**What changes in code:**
- `nostr.js`: remove the local `RELAYS` constant; import
  `readEffectiveNodeRelays` from `nodeRelays.js` and use it everywhere `RELAYS`
  was read (profile fetch, login, leaderboard, presence-discovery merge, access
  settings read/publish). The presence-discovery merge
  (`[..._nodeRelaysForPublish(), ...RELAYS]`) collapses to just the one list
  (de-duplicated already by `readEffectiveNodeRelays`).
- `main.js` / `arenaRuntime.js`: swap the `RELAYS` import for the effective-relays
  read (call at point of use, since the operator can change it at runtime).
- `nodeRelays.js`: `DEFAULT_NODE_RELAYS` grows from 3 to 5 entries (above).
- `relayPanel.js`: no UI/behavior change — same textarea, same starter banner,
  same badge. Subtitle copy updates from "Relays your node publishes presence
  to" to "Relays Torii Quest connects to (reads and presence publish)" so the
  scope is accurate.
- No change to CSP — all 5 relay hosts are already covered (2 already in
  `connect-src` per ADR-0076; nos.lol/vertexlab.io were already reachable from
  the read path so already permitted).

## Consequences

- **One source of truth.** An operator who edits the Relay tab now changes
  *everything* — reads and publishes — instead of unknowingly leaving reads on
  a separate, invisible, hardcoded list.
- **Simpler mental model.** "Which relays does Torii Quest use" has one answer.
  New contributors don't have to learn the publish/read split or the ADR-0076
  trust framing to understand the code.
- **Consent is now visibly independent of relay choice** in the code (no
  `RELAYS` name to imply "the public/dangerous ones"), matching the actual
  product rule: popular relays are good, silent publishing is not.
- **Test impact:** any test asserting `RELAYS` equals the old 2-entry constant,
  or asserting the *node-relay* list has exactly 3 entries, needs updating to
  the merged 5-entry `DEFAULT_NODE_RELAYS`. The "presence never publishes to
  public relays absent operator config" regression tests should be re-read
  against the new framing — the guard that matters is "no publish action fires
  without its own opt-in," not "public relays are excluded from the list,"
  and should be re-asserted that way if it currently asserts the latter.

## Non-goals

- Not adding a UI distinction between "read relays" and "write relays" — the
  user explicitly wants exactly one list, one textarea, one saved value.
- Not changing any opt-in/consent gate — this ADR only touches relay *plumbing*.
- Not adding achievements publish (doesn't exist yet).
