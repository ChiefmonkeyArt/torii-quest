# ADR-0041 — Playtest UX: reliable Kami exit + visible hit feedback

Date: 2026-08-24
Status: Accepted (shipped v0.2.660-alpha)
Builds on: ADR-0027 (Kami ema capture), ADR-0029 (Kami Mode invincible-spirit state)

## Context

The first structured bot playtest (round 1, 2026-08-24 09:22 BST) exposed two
usability bugs — neither a hit-reg fault (the server damage chain is correct):

1. **Stuck in Kami Mode.** The owner entered Kami (K) to file an ema, committed
   the note (Enter), then could not return to normal play. ESC is the designed
   exit (`arenaRuntime.js` keydown → `kamiBusy()` → `kamiExit()`), but while
   pointer-locked the browser reserves the first ESC to release the lock and
   frequently does not surface a keydown for it — so the 2nd ESC never reached
   `exitKamiMode()` and `KAMI_STATE` stayed `active=true`. The owner was forced
   to reload the page to keep shooting.

2. **"Many hits and nothing."** The hit-detection chain is correct (ray →
   `sim.hitBot` applies damage → `BOT_HIT` broadcast → client `hitBot` + spark
   + `flashCross`). But `flashCross` was a 0.12s crosshair class toggle — too
   brief to read as confirmation — and the stronger screen-edge `flashHit(dmg)`
   was NOT wired to bot hits at all. So every confirmed body hit looked like
   "nothing happened."

Separately, the ema store failed with `ENOENT mkdir /var/lib/torii-quest/kami/shots`
because the VPS data dir did not exist. The store's `ensure()` already calls
`mkdir(dir, { recursive: true })`, so the code self-heals once the dir exists —
the fix was creating the dir on the VPS (ops), not a code change.

## Decision

1. **Reliable exit button.** `ensureOverlay()` now appends a `✕` button
   (top-right of the rack box) that calls `exitKamiMode()` on click. This is
   pointer-lock-independent: the rack has `pointer-events:auto` + the button is
   a real DOM control, so it works regardless of the browser's ESC reservation.
   ESC remains the documented keyboard exit; the button is the guaranteed
   fallback for the pointer-locked case.

2. **Visible hit feedback.** The `BOT_HIT_BY_PLAYER` handler now also calls
   `flashHit(dmg >= 9 ? 50 : 25)` — body shots flash the screen at ~0.55 opacity,
   headshots at 0.8 (`flashHit` scales `dmg/50`). `flashCross` duration rose
   0.12s → 0.25s. Every confirmed hit now produces an unmistakable screen + reticle
   flash, so the owner can see hits register without reading the server log.

## Consequences

- The owner can enter Kami to file ema notes + exit reliably via the `✕` button
  (or ESC when not pointer-locked), unblocking the ema-based playtest workflow.
- Hit feedback is now obvious enough to validate hit-reg by feel, not just by
  the `[SHOT-RESOLVE]` journal. If a hit still looks like "nothing," it is a
  genuine miss / no-hit, not a silent success.
- No change to damage values, hit detection, or the authoritative server path.
  BOT_HP / BODY / HEADSHOT unchanged.
- The ema store code already self-heals (recursive mkdir); no code change there.
  The VPS dir is now provisioned under `/var/lib/torii-quest/kami/`.
