# ADR-0029 — Kami Mode state machine: NORMAL ⇄ KAMI ⇄ EMA_OPEN

**Status:** Accepted (shipped v0.2.644-alpha)
**Version:** v0.2.644-alpha
**Date:** 2026-08-23
**Type:** Behavior / architecture (gameplay input + state machine; no physics/protocol/collider change)
**Follows:** ADR-0025 (Kami Mode / sealed ema), ADR-0027 (ema input isolation), ADR-0028 (floating overlays body-scope)
**Related:** ADR-0026 (Plebeian auction panel — separate, deferred to its own slice)

## Context

After ADR-0028 shipped (v0.2.643-alpha), the owner live-tested the emakake +
auction panels in the arena. Two bugs surfaced, plus the owner specified the
intended Kami Mode workflow:

**Bugs**
1. **The emakake rack never hides.** `hideEmakake()` existed but was never
   called. Once armed, the rack stayed visible forever — through Esc, through
   exiting the arena, through re-entering. The only reset was a hard page
   refresh.
2. **The auction panel auto-shows for guests.** `setMarketActive(true)` fired on
   every NAP-zone entry regardless of login, so a guest entering the market zone
   saw the admin's auction panel.

**Owner's intended workflow (verbatim)**
> 1st ctrl+e enters into kami mode… it pauses play for the admin, it makes them
> invincible (can't be hit), it doesn't pause the game for the bots… but any
> previously created ema are listed on the right as we've already done.
> The 2nd ctrl+e opens a new ema… on hitting enter they are added to the emakake.
> Pressing esc is like pressing a 'back' button… if inside an ema, esc will
> discard and back out to the kami main screen… Pressing esc for a 2nd time will
> back out of kami mode and back to normal play.
> … they can move around any game or in their nap zone invincibly like a kami
> spirit or deity and they can create ema.

So Kami Mode is an **invincible-spirit roaming state**, not a frozen one:
movement + look stay live, shooting is disabled, the owner can't be hit, the
rack is visible, and ema can be created. Bots keep running.

## Decision

Split the single `_armed` flag into a proper three-state machine with a
dedicated exit path. The state machine is:

```
NORMAL --Ctrl+E--> KAMI --Ctrl+E--> EMA_OPEN
EMA_OPEN --Enter(commit)/Esc(discard)--> KAMI
KAMI --Esc--> NORMAL
```

### State variables (`src/engine/kami/kamiMode.js`)
- `_armed` — owner verified + crypto ready. A **capability**, not a mode.
- `_kamiActive` — the admin is IN Kami Mode (rack visible, shooting suppressed,
  movement/look live, invincible flag on).
- `_noteOpen` — the ema textarea editor is open (full input suppressed for typing).
- `_invincible` — recorded so `player.takeDamage` can no-op the owner's HP.
- `_entering` / `_enterToken` — async-first-enter race guard (see "Race + cancel"
  below).
- `_noteCleanup` — removes the textarea keydown listener on forced exit.

### Transitions
- `enterKamiMode()` — arm, `showEmakake`, set `_kamiActive`/`_invincible`,
  `setShootingSuppressed(true)`. Does NOT open a note.
- `exitKamiMode()` — `hideEmakake`, clear flags, restore shooting. Centralised;
  called from Esc-in-KAMI, phase→TITLE, and `kamiExit()`.
- Ctrl+E handler: `if (!_kamiActive) enterKamiMode(); else openNote();`
  Shift+Ctrl+E (seal + send tray) unchanged.
- `openNote()` enters KAMI first (no-op if already active), then opens the note.
- `finish()` returns to KAMI (not NORMAL): clears the full input-suppress used
  for typing, re-applies the shooting-only suppress. The rack stays visible.

### Tray preservation
The tray is NOT cleared on exit. Prior ema reappear on the next arm — the owner
can enter/leave Kami Mode without losing pending notes.

## Input split (ADR-0029)

`src/input.js` gains a **finer** suppression than the ema-note full-suppress:

- `setShootingSuppressed(bool)` + `_shootingSuppressed` flag.
- The mousedown shoot path gates on `if (_inputSuppressed || _shootingSuppressed)
  return;`.
- The movement-keys keydown path is gated by `_inputSuppressed` **alone** — so in
  KAMI the spirit roams + aims but does not fire. The full
  `setGameInputSuppressed(true)` is reserved for the ema textarea (typing needs
  every input off).

## Esc handling (`src/arenaRuntime.js`)

The capture-phase Escape listener already yielded when `kamiNoteOpen()`. It now
also yields when `kamiBusy()` (active OR a first-enter pending): Esc in KAMI
calls `kamiExit()` instead of opening the pause menu. The `kamiNoteOpen()` check
stays first, so Esc inside an open ema still discards the note → back to KAMI.

## Invincibility (`src/player.js`)

`takeDamage(dmg)` is guarded by `if (kamiInvincible()) return;`. In single-player
today nothing damages the local player (bots are targets, not return-fire), so
this is a **no-op until bot return-fire / MP peer-fire exists** — but it is wired
so that path is one guard away. It is NOT client-trusted for MP; the server must
also admin-gate damage for the owner pubkey.

## Owner-check memoization (v0.2.645 fix)

`checkOwner()` is memoised **by pubkey**, and only a confirmed-owner result is
cached. An empty pubkey (login not yet resolved) or a non-match is NOT cached.

The arena becomes PLAYING before the async NIP-07 login (`nostrLogin()` in
`src/nostr.js`) resolves `state.nostrPubkey`. If the owner pressed Ctrl+E in
that window, the original memo cached `false` from an empty pubkey and every
later Ctrl+E silently returned "KAMI: OWNER ONLY" — the rack never appeared
while shooting kept working, because `enterKamiMode()`'s body never ran. The
symptom looked like "logged in, no kami."

The fix: re-check on the next Ctrl+E whenever the pubkey is empty or the result
is false. A confirmed owner is still cached (instant re-arm). A `[kami]
owner-check` log line is emitted on each fetch so the branch can be diagnosed
without guessing.

The first Ctrl+E awaits an owner-capability fetch (`checkOwner` →
`fetchCapability`). While that is in flight:
- Esc must NOT fall through to the pause menu → the Esc guard yields on
  `kamiBusy()` (active OR entering).
- A late owner resolution must NOT show the rack after the user backed out →
  `enterKamiMode` captures `_enterToken`; `exitKamiMode` / a new enter bump it,
  so a stale resolution sees `token !== _enterToken` and aborts.

## Title re-entry guard

The global Ctrl+E listener is installed once. Without a guard, pressing Ctrl+E
on the title/home screen (after exit) would re-enter KAMI + re-show the rack. The
handler now early-returns `if (!isPlaying())`. KAMI is an in-arena surface; the
NAP zone is inside PLAYING so it still works there. The pause-modal button
(`kamiCapture`) calls `openNote` directly, so it still works from PAUSED.

## Auto-exit on leave-arena

`installKamiMode` subscribes to `EV.PHASE_CHANGE`. On transition to `PHASE.TITLE`
(the Home button / any exit-to-title), `exitKamiMode()` runs — so the rack cannot
persist across exit/re-enter in-session. Verified that **every** phase write goes
through `transition()` (the only `state.phase =` write is inside `transition`
itself, line 106), so the subscription catches all exit paths. `_tray` is
preserved (prior ema reappear on re-arm).

## Note cleanup on forced exit

`exitKamiMode()` force-closes an open note via `_closeNoteIfOpen()`: hides the
overlay + removes the textarea keydown listener (`_noteCleanup`). Without this,
a hidden note would keep a stale `onKey` bound, and a later re-open would stack a
second listener — the old closure's `finish()` could fire on the new note.
`finish()` also clears `_noteCleanup` on its own normal path.

## What is NOT in this ADR (deferred)

The **auction-panel button** (stop `setMarketActive` auto-show on NAP entry; add
a button to the existing product panel that opens `#auction-panel`; gate
logged-in only) is a separate slice with its own commit + ADR-0030. Full
admin-stall rework (display fixed-price products + auctions from the owner's
Plebeian stall) is deferred — noted in the handoff.

## Tests

- `tests/input-shooting-suppression.test.js` — `setShootingSuppressed` blocks the
  shoot path but NOT movement keys; `setGameInputSuppressed` blocks both (ema-note
  state).
- `tests/kami-state-machine.test.js` — 1st Ctrl+E enters KAMI (not a note): rack
  shown, shooting suppressed, invincible on; `kamiExit()` restores NORMAL; phase
  →TITLE auto-exits; 2nd Ctrl+E while in KAMI attempts a note but stays in KAMI.
- `tests/pause-input.test.js` (contract) — updated to assert the new input gate,
  the `kamiBusy` import, and the `_kamiActive`-conditional shooting-suppress in
  `finish()`.
- Full suite: 3091 passing / 238 files.

## Browser verification (manual, owner)

Still required post-deploy: 1st Ctrl+E enters KAMI (rack on right, can't shoot,
can move/look); 2nd Ctrl+E opens ema; Enter saves to rack; Esc in ema → back to
KAMI; Esc in KAMI → exit (rack hidden, shooting restored); leaving the arena
resets; hard refresh keeps the rack hidden until Ctrl+E.
