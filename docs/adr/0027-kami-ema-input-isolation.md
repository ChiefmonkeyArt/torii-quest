# ADR-0027 — Kami ema input isolation: the note owns its keystrokes while open

**Status:** Accepted (shipped v0.2.637-alpha)
**Version:** v0.2.637-alpha
**Date:** 2026-08-23
**Type:** Bug fix (input boundary; no gameplay/physics/collider/damage change)
**Follows:** ADR-0025 (Kami Mode)
**Related:** ADR-0021 (NAP zone / pause input boundary, `tests/pause-input.test.js`)

## Context

Live-testing the v0.2.636 auction panel inside Kami Mode surfaced two input bugs
the owner hit immediately after pressing `Ctrl+E` to hang an ema:

1. **Space jumped the player while typing in the ema note.** The ema note is a
   `<textarea>`. Pressing Space (to separate words) also made the player's avatar
   jump.
2. **Escape could not close the ema modal.** Pressing Escape — the documented
   discard gesture (`onKey` → `finish(false)` → close) — did nothing visible to the
   ema; the owner was trapped on the screen.

## Root cause (found by reading the code, not guessing)

The input boundary ADR-0021 established for the pause menu did not extend to the
Kami ema note, even though both are modal overlays that must own their keystrokes.

### Bug 1 — Space leaks to the jump handler

`src/player.js:89` jumps on `Space` (and bare `KeyE`) via a callback registered
through `input.js`'s `onKeyDown`:

```js
onKeyDown(c => { if (c === 'Space' || (c === 'KeyE' && !keys['ShiftLeft'])) jump(); });
```

`src/input.js`'s document `keydown` handler set `keys[e.code] = true` and fired
every registered `downCb` **without checking whether a text field had focus**:

```js
document.addEventListener('keydown', e => {
  if (e.code === 'Escape') return;   // owned by pause-menu capture, not here
  keys[e.code] = true;
  _downCbs.forEach(fn => fn(e.code));
  // ...
});
```

So a Space typed into the ema `<textarea>` reached the jump callback. (The
`Escape` early-return here was the ADR-0021 pause carve-out, which is exactly why
bug 2 existed — see below.)

### Bug 2 — capture-phase Escape steals the keystroke before the textarea

`src/arenaRuntime.js:1248` registers a **capture-phase** document Escape
listener (third arg `true`):

```js
document.addEventListener('keydown', ev => {
  if (ev.code !== 'Escape' || _escapeHandledOnKeyDown) return;
  if (!isPlaying()) return;
  _openPause();
  ev.stopImmediatePropagation();
  _escapeHandledOnKeyDown = true;
}, true);
```

Capture-phase listeners fire **before** the target's bubble-phase listeners. The
ema note's own `onKey` (attached to the `<textarea>`) is a bubble-phase listener.
So on Escape:

1. The capture listener fires first.
2. `isPlaying()` returns `true` — because `openNote()` does **not** pause the game
   (it is a lightweight overlay, unlike the pause menu).
3. `_openPause()` runs + `stopImmediatePropagation()` — so the textarea's `onKey`
   never receives Escape.
4. The ema's `finish(false)` → close path never runs. The owner is trapped.

The capture listener was correct for the pause-menu case (ADR-0021) but it was
blind to the ema note, which is a second modal that also needs to own Escape.

## Decision

Three surgical changes plus a suppression flag. The ema note now owns its
keystrokes for as long as it is open, regardless of where DOM focus happens to be.

### 1. `input.js` — form-field guard + game-input suppression flag

```js
let _inputSuppressed = false;
export function setGameInputSuppressed(suppressed) {
  _inputSuppressed = suppressed;
  if (suppressed) clearKeys();   // no held movement key carries into the modal
}

document.addEventListener('keydown', e => {
  if (e.ctrlKey || e.metaKey) return;
  if (_inputSuppressed) return;                 // ← ema open: no keys, no callbacks
  const _t = e.target;
  if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA'
          || _t.tagName === 'SELECT' || _t.isContentEditable)) return;  // ← any text field
  // ... latch keys, fire downCbs ...
});
```

The form-field guard is the general fix: Space/E typed into **any** text field no
longer leaks to movement. The suppression flag is the belt-and-braces fix for the
case where focus slips off the textarea (a click on the modal backdrop, a tab,
or a pointer-lock edge): while the ema is open the arena sets the flag, so `keys`
is never latched, `downCbs` never fire, AND the mousedown shoot handler
early-returns — a click on the ema modal cannot fire a shot even if focus has
slipped off the textarea.

### 2. `arenaRuntime.js` — capture Escape yields to the ema

```js
document.addEventListener('keydown', ev => {
  if (ev.code !== 'Escape' || _escapeHandledOnKeyDown) return;
  if (kamiNoteOpen()) { _escapeHandledOnKeyDown = true; return; }  // ← ema owns Escape
  if (!isPlaying()) return;
  _openPause();
  ev.stopImmediatePropagation();
  _escapeHandledOnKeyDown = true;
}, true);
```

When the ema is open, the capture listener marks Escape handled and returns
**without** calling `stopImmediatePropagation`, so the textarea's bubble-phase
`onKey` receives Escape and runs `finish(false)` → close. Setting
`_escapeHandledOnKeyDown = true` also means the pointer-lock keyup Escape
fallback (line 1274) sees `handled === true` and does not open the pause menu on
the same gesture — so Escape closes the ema and nothing else.

### 3. `kamiMode.js` — toggle suppression + stop propagation

```js
export function kamiNoteOpen() { return _noteOpen; }

function openNote(...) {
  _noteOpen = true;
  _deps.setGameInputSuppressed(true);   // ← ema owns input
  // ...
}
function finish(committed) {
  _noteOpen = false;
  _deps.setGameInputSuppressed(false);  // ← hand input back
  // ...
}
function onKey(ev) {
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(false); }
  else if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); finish(true); }
}
```

`stopPropagation` on the ema's own Escape/Enter prevents any later bubble-phase
listener from seeing the commit/discard keystroke. (Shift+Enter still inserts a
newline — the ema is multi-line.)

## Why not just pause the game when the ema opens?

Considered and rejected. The ema note is deliberately a lightweight overlay that
captures a note pinned to the cursor's world position; pausing the simulation
would freeze the very scene the owner is annotating and would change the
sealing semantics (the same-tick screenshot would capture a frozen frame). The
suppression flag gives the input isolation of a pause without pausing.

## Why not widen the ADR-0021 pause Escape carve-out instead?

The capture listener's `isPlaying()` guard is the wrong signal for the ema: the
ema does not set `isPlaying()` false, and changing that would couple the ema to
the pause state machine. `kamiNoteOpen()` is a single-purpose, ema-local signal.

## Consequences

- Space/E typed into the ema note (or any text field) no longer leaks to movement
  or jump.
- Escape closes the ema note; it does not open the pause menu on the same gesture.
- A click on the ema modal cannot fire a shot, even if focus has slipped off the
  textarea.
- The pause menu's Escape behaviour is unchanged when the ema is not open.
- No gameplay, physics, collider, damage, wire, or protocol change. `godMode`
  stays false. No new `setTimeout`/`Vector3`/`Matrix4`.

## Tests

`tests/pause-input.test.js` gains an ADR-0027 block (9 input-boundary tests,
source-contract): the form-field guard (INPUT/TEXTAREA/SELECT/contentEditable),
the suppression flag (export + `if (_inputSuppressed) return;` in keydown AND
mousedown + `clearKeys()` on enable), the arenaRuntime capture Escape yield
(`kamiNoteOpen()` import + guard + `setGameInputSuppressed` in the kami deps),
and the ema `onKey` `stopPropagation` on Escape + Enter. Full suite 3078/3078
green.

## Smoke test (owner, on desktop)

After deploy: `Ctrl+E` to open the ema. Type words with spaces — no jump. Press
bare `E` — no jump. Press Escape — the ema closes and the pause menu does NOT
open. Press `Ctrl+E` again, type a note, press Enter — the note commits (and
seals). Movement + shooting resume immediately on close.
