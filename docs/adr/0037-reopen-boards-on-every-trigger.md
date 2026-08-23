# ADR-0037: Reopen All Boards on Every Trigger Press

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0036 (product-panel click trigger), `src/engine/plebeian/ownerBoards.js`

## Context

ADR-0036 wired the PRODUCT sign's proximity+Q trigger so that `onOpen` calls
`setMarketActive(true); setBoardsActive(true);`. Each panel closes via its own
explicit close button: the auction panel via `setMarketActive(false)`, each
owner board via `hideOwnerBoard(boardId)`.

Live testing (2026-08-23) found a reopen bug: after the first open→close cycle,
pressing Q again re-opened the auction panel but left all three boards hidden.
Step away, walk back, press Q — same result: only the auction panel appeared.

## Root cause (code-traced, not guessed)

`setBoardsActive(active)` short-circuited with `if (active === _active) return;`
before its `showHide(active)` call. `hideOwnerBoard(boardId)` — the close-button
path — deliberately does **not** touch the module-level `_active` flag (it only
sets the board's DOM `hidden` attribute). So after closing boards individually,
`_active` stayed `true`, and the next `setBoardsActive(true)` returned early
without re-showing the individually-hidden boards.

The auction panel did not have this bug because its close button calls
`setMarketActive(false)`, which resets its own `_active` — so the reopen's
`true !== false` transition ran `showHide` and re-showed it.

A pre-existing test even encoded the bug as a workaround: it called
`setBoardsActive(false); setBoardsActive(true)` to "simulate the real close→
reopen cycle," masking the fact that the real `onOpen` only ever calls
`setBoardsActive(true)`.

## Decision

`setBoardsActive(active)` now always calls `showHide(active)` — force-show (or
hide) all three boards unconditionally, so a fresh trigger press re-shows any
board that was individually hidden via `hideOwnerBoard()`. The relay
subscription `start()` + `render()` are still gated to the false→true edge, so
repeated trigger presses do not churn WebSocket connections.

## Consequences

- Positive: pressing Q at the PRODUCT sign now reliably reopens all three
  boards every time, regardless of which were individually closed before —
  matching the ADR-0036 contract ("opens the auction-panel + the three boards
  together") on every press, not just the first.
- Negative: `showHide(true)` now runs on every trigger press even when the
  boards are already visible. Cost is negligible — it loops three DOM elements
  setting attributes that are already set. No per-frame or allocation cost (it
  is only called on interact, not in the per-frame tick).
- The misleading workaround test is replaced with a regression that reproduces
  the real `onOpen` call sequence (open → close all individually → reopen with
  `setBoardsActive(true)` only).
