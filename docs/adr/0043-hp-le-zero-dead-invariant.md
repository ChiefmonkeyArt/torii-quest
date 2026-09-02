# ADR-0043: hp ≤ 0 ⇒ dead invariant (bots-wont-die fix)

- **Status:** Accepted
- **Date:** 2026-08-24
- **Version:** v0.2.663-alpha
- **Supersedes / relates to:** ADR-0042 (bot hit feedback), ADR-0016 (D-1..D-4 nameplate/death visibility)

## Context

In v0.2.662 the owner reported bots "not dying or disappearing" despite landing
many shots. A server-side diagnostic log (`[BOT-DMG]` in `applyBotDamage`,
v0.2.662) proved the **server is fully correct**: every shot registered, HP
depleted (e.g. boss Augustink 60→0 over 20 body shots), `killBot` fired, and
`alive=false` + `BOT_KILL` were produced. Decrypted client screenshots showed
the decisive symptom: **two bots with empty gray HP bars (HP=0) but both
standing upright with visible nameplates.**

The client's `_syncNetBot` death branch fires on `!pose.alive`, and inside it
hides the nameplate + runs the blowback arc. A visible nameplate on a 0-HP bot
means the **alive branch** was running — i.e. `b.alive` was `true` while
`b.hp === 0`.

Root cause: `botNetState.applyHit(id, hp)` only set `b.hp`; it never forced
`b.alive = false` when `hp <= 0`. A kill-shot `BOT_HIT` carries `hp=0`, so the
HP bar emptied but `b.alive` stayed `true` and the death branch never fired.
`BOT_KILL` may also be delayed, dropped, or followed by a stale pre-kill
`BOT_STATE` snapshot that carries the impossible wire state `alive=true,
hp=0` — and the old `ingest` blindly stored `b.alive = s.alive`, un-killing
the bot.

## Decision

Enforce a single invariant in `botNetState.js` (the client's pure
server-authoritative bot state buffer): **a bot with HP ≤ 0 is dead, regardless
of what `BOT_KILL` or any snapshot says.**

1. **`applyHit(id, hp)`** — when `hp <= 0`, set `b.hp = 0`, `b.alive = false`,
   `b.snap = true` (so the corpse hard-jumps, no slide). A kill-shot `BOT_HIT`
   now marks the bot dead immediately, with no `BOT_KILL` required.
2. **`ingest(states)`** — coerce the impossible wire state:
   `hp = max(0, s.hp)`, `alive = s.alive === true && hp > 0`. A stale snapshot
   can never un-kill a bot the server has drained.
3. **`bots.js applyBotHit`** — mirror the coercion in the wrapper state:
   `if (hp <= 0) bot.state.alive = false`, so the render path's branches that
   read `bot.state.alive` stay consistent with the net state.

This makes the death robust to `BOT_KILL` being delayed/dropped and to stale
pre-kill snapshots — the exact failure modes the v0.2.383 "event-authoritative"
comment claimed to handle but did not fully cover (it only protected the
~67ms window before the next ingest overwrote `b.alive`).

## Consequences

- Bots now visibly die the moment a kill-shot `BOT_HIT` (hp=0) arrives: the
  death branch fires → `playDeath` + blowback arc + nameplate hide + colliders
  parked below the floor (y=-100).
- The boss (Augustink, 60 HP) still requires ~20 body shots / 7 headshots —
  that is by design (tank boss), now communicated via the HP bar draining to 0
  before the death.
- The temporary `[BOT-DMG]` server diagnostic from v0.2.662 is retained for one
  more confirmation cycle (harmless `console.log`), to be removed once the
  death is confirmed live end-to-end.
- 4 new regression tests in `tests/multiplayer/bot-net-state.test.js` lock the
  invariant: kill-shot hit (hp=0), overkill (hp<0), stale-snapshot can't
  un-kill, and genuine respawn reanimates.
