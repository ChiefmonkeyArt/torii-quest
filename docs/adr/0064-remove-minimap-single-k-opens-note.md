# ADR-0064: Remove the in-game minimap, and make a single K press open the ema note input

- **Status**: Accepted
- **Date**: 2026-08-26
- **Deciders**: chiefmonkey (maintainer), Perplexity Computer (agent)
- **Related**: Supersedes the two-step K entry documented in [ADR-0029](./0029-kami-mode-state-machine.md); extends the instant-post behaviour of [ADR-0042](./0042-ema-instant-post-on-enter.md). Builds on the in-game HUD work of [ADR-0031](./0031-kami-mode-hotkey-bare-key.md) and [ADR-0034](./0034-second-kami-press-highlights-note.md).

## Context

Two independent in-arena UX issues surfaced in v0.2.693-alpha playtesting:

1. **A stray black square in the top-left of the in-game screen.** The CSS placed the minimap wrapper `#minimap-wrap` at `bottom: 70px; right: 16px`, but the `#minimap` canvas was a *sibling* of that wrapper, not a child of it. With no positioning of its own, the canvas fell back to normal flow at the top-left of the `#hud` container — so the black square with its orange bot-dots and purple player-dot rendered in the top-left, opposite the intended corner. The maintainer does not want a minimap at all ("not needed").

2. **Kami Mode's two-step entry felt slow.** Per ADR-0029, the first bare K only *entered* Kami Mode (rack visible, invincible spirit, shooting off, movement/look live); a *second* K was required to open the ema note textarea and start typing. The maintainer wants a single K to drop the player straight into typing, and after they submit (Enter) or cancel (Esc) the pointer should be *released* — not re-locked — so they can click on the emagake rack.

## Decision

### (a) Remove the minimap entirely

Delete the minimap across all three files that reference it:

- `index.html` — remove the `#minimap` canvas element and the (already-empty) `#minimap-wrap` div, plus the `#minimap-wrap` CSS rule.
- `src/hud.js` — remove the `drawMinimap(playerPos, bots)` export and its `_mm` 2D-context lookup.
- `src/arenaRuntime.js` — remove the `drawMinimap` import, the `_minimapTick` frame-counter, and the every-4th-frame `drawMinimap(...)` call from the game loop.

Full removal (not `display:none`) is chosen because the minimap is unwanted, and removal also stops the wasted per-frame canvas clear + bot/player plot work.

### (b) Single K opens the note; Enter/Esc release the pointer

In `src/engine/kami/kamiMode.js`, change the bare-K keydown handler so that, after the existing `isPlaying()` / text-field / modifier guards, it always calls `openNote()` directly — no `else if (!_kamiActive) enterKamiMode();` branch. `openNote()` already enters Kami Mode itself if it is not yet active (via `await enterKamiMode()`), so a single K now enters Kami Mode **and** opens the note input in one press, focusing `#kami-note-input` so the player can type immediately.

Keep Shift+K unchanged (it still retries unsent/failed ema only), and keep ADR-0034's behaviour: a repeat K while a note is already open highlights the input rather than silently no-op'ing.

In `openNote()`'s `finish(commit)`:

- Add `ta.blur()` when hiding the note overlay, so the hidden textarea releases keyboard focus.
- Remove the `if (wasLocked) _deps.requestPointerLock();` restore line, so submitting (Enter) or cancelling (Esc) the note leaves the pointer **free** rather than re-locking it. This lets the player mouse-click the emagake rack (hang a fresh ema, retry a failed one) without first re-locking. Shooting remains suppressed while Kami Mode is active; the player can press K again any time to open a new note.

## Consequences

- **Positive:** the unwanted top-left black square is gone, and the saved per-frame minimap work is dropped.
- **Positive:** Kami Mode is now one keystroke to typing — the flow the maintainer asked for — and the post-submit pointer release makes the emagake rack immediately mouse-interactive.
- **Negative / trade-off:** this supersedes ADR-0029's explicit two-step entry model. ADR-0029's *state machine* (NORMAL ⇄ KAMI ⇄ EMA_OPEN) is unchanged; only the *trigger* for EMA_OPEN collapses from "2nd K" to "1st K". The pause-modal `kamiCapture` button still calls `openNote` directly, so it is unaffected.
- **Risk:** if the maintainer later wants a minimap back, it must be re-added (canvas + wrapper correctly nested + draw + tick). This is straightforward and well-documented by the git history of this change.

## Tests

- `tests/adr-0064-regressions.test.js` (new) — 5 source-contract guards:
  - `index.html` no longer defines `#minimap` / `#minimap-wrap`;
  - `hud.js` no longer exports `drawMinimap`;
  - `arenaRuntime.js` no longer imports `drawMinimap` or runs `_minimapTick`;
  - the bare-K handler routes to `openNote()` with no `else if (!_kamiActive) enterKamiMode()` branch;
  - `finish()` does not call `requestPointerLock()` and does call `ta.blur()`.
- `tests/kami-state-machine.test.js` — updated: "1st K enters KAMI and immediately opens the note" (was "1st K enters KAMI, 2nd K opens the note"); the repeat-press highlight test is now the 2nd press, not 3rd.
- `tests/kami/kami-ema-instant-post.test.js` — `openNoteAndType` helper updated to a single K (was two K presses); the three ADR-0042 invariants (Enter posts once, failed POST stays retryable, Shift+K retries) are unchanged.

Full suite + regression check run green before tag.
