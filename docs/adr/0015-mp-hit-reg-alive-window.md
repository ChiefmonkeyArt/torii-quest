# ADR-0015 — Fix MP hit-reg alive-window (accept rewound-alive shots)

**Status:** Accepted (2026-08-22)
**Ships in:** v0.2.625-alpha
**Author:** Torii Agent (proposal); Chiefmonkey (approval pending)
**Related:** ADR-0013 (bot identity + [SHOT]/[KILL]/[RESPAWN] logs),
ADR-0014 ([FIRE] per-trigger logs). This ADR is the targeted fix these two
diagnostic layers were built to enable.

## Context

v0.2.624 diagnostics captured a clean fingerprint of the "shot bots many times
to no effect" bug in an MP session. Sample from the log:

```
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net    (×8 in a row)
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.6 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.7 resolved=mp reason=net
[FIRE] hit=bot zone=body toi=15.7 resolved=mp reason=net
[RESPAWN] botId=1 name=Grumpy
[RESPAWN] botId=3 name=Sleepy
```

Client aim ray hit a bot on every shot. Server issued **zero** `BOT_HIT` for
these. Then the bot(s) respawned mid-barrage. Similar pattern earlier: 12
client-confirmed hits on Augustink resolved into only 3 server damage events.

Reading `server/bots/arenaBotSim.js::resolvePlayerShot` (v0.2.385-alpha)
reveals the exact split:

```js
// Position is rewound to what the client rendered, but damage eligibility
// follows the current authoritative life state.
const live = getBot(r.id);
if (!live?.alive) continue;
```

The rewind uses two different views of the same bot for the same ray:

- **Position** — from the snapshot ring at `rewindTs` (~viewLag ago).
- **Alive bit** — from the CURRENT state (now).

The comment justifies this by noting that using the old snapshot's alive bit
made a freshly respawned bot visible-but-unhittable for the whole rewind
window. That is a real concern.

But it also creates the **symmetric** bug on the death side. Consider the
100ms after the server kills bot B:

- Server marks `live.alive = false` immediately.
- Client hasn't received `BOT_KILL` yet (network one-way + jitter).
- Client's render still shows B alive and moving at its interpolated pose.
- Player fires; aim ray hits B's client collider → `[FIRE] hit=bot`.
- Server receives SHOT with `viewLag ~ 100ms`, rewinds B's position to
  ~100ms ago (when B was in fact still alive), casts ray → hit.
- Server checks `live.alive` = false → skips → **silent drop, no BOT_HIT
  sent**.

Player sees 8 straight aim-ray hits with zero effect, then B disappears
(when BOT_KILL finally propagates to the client). The console log we
captured matches this exactly.

## Decision

Store the `alive` bit in each snapshot ring row, alongside `x, z, footY,
radius`. On resolve, a hit is accepted when **either** the rewound-time
alive bit **or** the current alive bit is true.

```js
const wasAlive = !!r.alive;      // rewound-to-shot-ts
const isAlive  = !!live?.alive;  // current authoritative
if (!wasAlive && !isAlive) continue;
```

Truth table:

| ts alive | now alive | before | after | notes                        |
|:--------:|:---------:|:------:|:-----:|:-----------------------------|
|  false   |   false   |  skip  | skip  | dead throughout — correct    |
|  true    |   true    |  hit   | hit   | alive throughout — correct   |
|  false   |   true    |  hit ✓ | hit   | freshly respawned — preserves v0.2.383 |
|  true    |   false   |  skip ✗ | **hit** | **THE FIX** — was alive when shot, died before packet arrived |

This is the minimum semantic change that closes the death-side window
without reopening the respawn-side one.

## Non-goals

- **No change to peer-vs-peer resolveShot** — no evidence of the same bug
  there. Peer positions and alive-bits are both snapshotted together in a
  different ring; ADR-0015 is scoped to bots only.
- **No change to damage numbers, headshot classifier, damage table, or
  collider shapes.** Only the alive-eligibility check moves.
- **No change to the rewind clock, viewLag clamp, or `LAG_COMP_MS`.**
- **No client change.** Client-side raycast, hit prediction, and death FSM
  are unchanged. The fix is server-only.
- **No refactor of the shared client/server sim.** The bot snapshot ring
  lives in `server/bots/botSnapshotRing.js` (server-only), so adding an
  `alive` column is a local change.

## Consequences

**Positive:**

- Fixes the "many client-side hits, no server damage" pattern captured in
  the v0.2.624 log. Every `[FIRE] hit=bot resolved=mp reason=net` for a bot
  that was alive at shot-ts will now produce a matching `[SHOT]`.
- Preserves the v0.2.383 fix (freshly respawned bot hittable immediately).
- Symmetric with the peer resolver's contract: "if the shooter saw a live
  target, the shot counts".
- No behavioural change for cases the current code already handled
  correctly (positions match up; both alive-bits agree).

**Negative:**

- One extra byte-worth per snapshot row (bool `alive`). Ring size = O(bots ×
  frames_in_window), unchanged in shape.
- A shooter can still land a hit on a bot in the ~100ms window after the
  bot died server-side, provided that at the rewound instant it was alive.
  This is CORRECT — it matches what the shooter saw. If the same bot was
  simultaneously killed by two players in the same viewLag window, both
  kills may register damage against a now-dead bot; the ledger's
  `applyDamage` already returns zero-damage after hp≤0 (`outcome.applied=0`),
  so no double-kill or negative HP. To be safe we add a unit test.

**Edge case — kill-credit for a "posthumous" hit:** if bot dies at T=0 on
the server (from bot AI or another shooter), and a client shot resolves
against a rewound-alive collider at T=+80ms, the ledger records dmg but
`outcome.killed` stays false (hp already ≤0 → applyDamage returns 0). No
extra KILL event, no double-credit. Only shooters who land the actual
lethal hp≤0 transition earn the kill. This is the same rule the current
code enforces.

## Implementation notes

- `server/bots/botSnapshotRing.js::pushBotSnap`: extend the row schema to
  `{ id, x, z, footY, radius, alive }`. Backwards-incompatible for callers
  that construct rows manually, but the only caller is inside
  `arenaBotSim.js`.
- `server/bots/arenaBotSim.js::resolvePlayerShot`: replace the
  `!live?.alive` skip with the `wasAlive || isAlive` gate above. Update
  the code comment to explain why.
- `sampleBotsAt` returns rows verbatim — no change beyond passthrough.
- No public API change on the wire; MP protocol unchanged.

## Test plan

Add `server/bots/arenaBotSim.alive-window.test.js` with a controlled
snapshot ring:

1. Bot alive at ts, alive now → hit resolves.
2. Bot dead at ts, dead now → skipped.
3. Bot dead at ts, alive now (respawn window) → hit resolves (regression
   guard for v0.2.383).
4. Bot alive at ts, dead now (THE FIX) → hit resolves.
5. Kill-credit posthumous: apply dmg to a bot at hp=0 → outcome.applied=0,
   outcome.killed=false, no negative hp.

Then extend `damage-table-parity.test.js` if it references ring shape.

Regression: gate 21/21, full vitest (+5 new tests).

## Rollback

Revert to v0.2.624-alpha. The snapshot ring's extra `alive` column is
additive; older clients don't care. Server code reverts cleanly.

## Post-ship verification

Play v0.2.625 in MP. Expect the `[FIRE] hit=bot resolved=mp` → `[SHOT]`
ratio to move from ~30% (today's log) toward ~100% for bots that were on
screen when the shot fired. Streams of 8+ consecutive `hit=bot` with no
`[SHOT]` followed by a `[RESPAWN]` should disappear.
