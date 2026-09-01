# ADR-0034: Kami Mode visual unification — no darkened modal, world stays fully visible

- Status: Accepted
- Date: 2026-08-23
- Deciders: chiefmonkey

## Context

Kami Mode today (ADR-0025/0029/0031/0032) has two visible surfaces with
different aesthetics:

1. The emagake rack (`emagakePanel.js`) — a floating, translucent panel
   pinned to the right, world fully visible behind it. This is the
   aesthetic the owner wants everywhere in Kami Mode.
2. The ema note editor (`#kami-overlay` in `kamiMode.js`) — a full-screen
   `position:fixed; inset:0` layer at `rgba(8,6,14,0.72)` with a centered
   wooden-plaque-styled box. This darkens and blocks the rest of the
   screen while writing a note.

The owner's instruction (2026-08-23): entering Kami Mode should keep the
world fully visible exactly as it is on the initial single-K press, for
every component — the emagake rack, the ema editor, and anything added
later. Writing a new ema (2nd K) should not pop out or darken the screen;
instead the ema editor should sit at the bottom of the screen, and
pressing K again should highlight it rather than opening a separate modal.

Additionally: the market/auction panel currently auto-shows on NAP-zone
entry regardless of Kami Mode (`arenaRuntime.js` calls
`setMarketActive(_inNapNow)` unconditionally). The owner does not want any
panel auto-popping-up while in Kami Mode — Kami Mode should show only its
own components (emagake list right, ema editor bottom) until superseded by
ADR-0035's board work.

## Decision

1. Replace the full-screen darkened `#kami-overlay` with an inline,
   non-blocking bottom bar, styled with the same panel aesthetic as the
   emagake rack (same translucent background, border, font treatment).
   The world remains fully visible and unobstructed behind it at all
   times — no backdrop dimming.
2. Second K press (already in Kami Mode) opens the ema editor inline at
   the bottom rather than centering a modal. Third-state clarification:
   if the owner presses K while the editor is already open, it should
   highlight/focus the existing editor rather than opening a second one.
3. Kami Mode's own hotkey/state machine (ADR-0029) is unchanged: 1st K
   enters Kami Mode, 2nd K opens/focuses the ema editor, Esc semantics
   unchanged (1st Esc closes an open editor without discarding-via-modal-
   dismiss confusion, 2nd Esc exits Kami Mode).
4. `setMarketActive` (and any future NAP-zone panel) must not activate
   while `kamiActive()` is true. Gate: `setMarketActive(_inNapNow &&
   !kamiActive())`. This is a minimal, scoped fix — the panel's full
   redesign is ADR-0035.
5. No change to the owner-gate, sealing, or server wire protocol. This is
   presentation-only.

## Consequences

- The ema editor's textarea, hint text, and validation logic
  (`emaModel.js`) are unchanged — only the DOM container and its CSS
  change from a centered dimmed modal to a bottom-anchored translucent
  bar matching the emagake rack.
- Existing tests asserting `#kami-overlay` display toggling need updating
  to assert the new bottom-bar container instead; behavior (open on 2nd K,
  close on Esc/Enter) is unchanged so state-machine tests should not need
  logic changes, only DOM-shape assertions.
- `setMarketActive` gating on `kamiActive()` is one added condition in
  `arenaRuntime.js`; `marketStall.js` itself needs no change.

## Non-goals (deferred to ADR-0035)

- Redesigning the market/auction panel's content or making it
  guest-visible independent of NAP-zone presence.
- Any new napplet architecture — noted by the owner as coming after this
  and ADR-0035 are done.
