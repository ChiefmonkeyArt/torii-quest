# ADR-0069: Pause Modal Recolored to Torii Sunset Theme

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** chiefmonkey
- **Related:** ADR-0068 (boot overlay recolor), `index.html` (pause-overlay CSS block, lines ~1040–1048), `src/arenaRuntime.js` (`_openPause` / `_resume`, ESC handler)

## Context

During play, pressing ESC releases pointer lock and transitions the game to the
`PAUSED` phase (see `src/arenaRuntime.js` `_openPause` → `state.transition(PAUSE)`).
On `PHASE_CHANGE` the title/HUD/pause screens are toggled (`applyPhaseScreens` in
`src/engine/ui/phaseScreens.js`), which adds `.show` to `#pause-overlay`. The modal
contains the **PAUSED** title plus RESUME / HANG AN EMA / EXIT THE GAME buttons.
(The "ESC twice" wording from the owner reflects the common browser path: the first
ESC exits pointer lock, the second opens the pause modal — or, in browsers that
suppress the pointer-locked keydown, the `keyup` handler opens pause on the same
press once the lock is released.)

The modal panel was still on the legacy **dark-neon-purple** palette:
`#pause-box` background `rgba(20,20,35,0.97)` with a `rgba(139,92,246,0.4)` purple
border, and a neutral `rgba(0,0,0,0.6)` backdrop. Since `v0.3` the rest of the
product is on the canonical **torii-gate sunset** palette (`:root` tokens). The
pause modal was another remaining unmigrated purple surface (the boot overlay was
the other, fixed in ADR-0068).

## Decision

Recolor the pause modal to the torii-gate sunset theme. **Layout, sizing,
padding, border-radius, button DOM/IDs, the `.show` toggle, focus/pointer-lock
behavior, and the resume flow are all unchanged** — color-only migration. The
buttons already use the shared, already-themed `.btn` / `.btn-secondary`
classes, so they needed no change.

Color mapping:

| Element | Before (purple) | After (torii sunset) |
| --- | --- | --- |
| Backdrop | `rgba(0,0,0,0.6)` | `rgba(20,13,9,0.7)` (warm dark, `--bg` family) |
| Panel background | `rgba(20,20,35,0.97)` (purple-dark) | `rgba(30,18,12,0.97)` (warm twin, same opacity) |
| Panel border | `rgba(139,92,246,0.4)` (purple) | `var(--panel-glass-border)` (`rgba(232,178,120,0.35)`) |
| Panel depth | (none) | `box-shadow: 0 0 40px rgba(0,0,0,0.5)` (subtle lift) |
| Title "PAUSED" | (inherited) | `var(--accent)` (`#e8842c`) + warm glow `text-shadow rgba(232,132,44,0.35)` |

The panel opacity is deliberately kept at `0.97` (matching the original) rather
than dropping to the `--panel-glass` token's `0.62` — the pause modal is meant to
block out the paused scene behind it, and reducing opacity would change that feel.

## Consequences

- **Enables:** Every player-facing modal surface (boot overlay, pause modal) is
  now on the one canonical theme; no purple flashes anywhere in the live UX.
  Using `:root` tokens for the border keeps it in sync with future palette tweaks.
- **Forecloses:** The legacy purple pause panel is gone; reintroducing it would
  require off-palette hex.
- **Trade-offs:** Pure CSS color swap — no behavior, no DOM, no JS, no asset
  change. Zero runtime cost. The panel background is a derived warm value
  (`rgba(30,18,12,0.97)`) rather than a raw token, chosen to preserve the
  original near-opaque feel; documented here so a future tokenization pass can
  reconcile it.
- **Enforcement:** No new regression-check rule. Verified by visual inspection
  (Playwright screenshot) of the styled modal with the `.show` class forced.

## Alternatives considered

- **Switch the panel to `--panel-glass` (0.62 opacity).** Rejected: the pause
  modal should block the paused game from view; 0.62 would let the scene show
  through and change the feel the owner is happy with.
- **Restyle the buttons too.** Rejected: the `.btn` / `.btn-secondary` classes are
  shared and already themed; touching them would be out of scope and risk other
  surfaces.
- **Leave the purple.** Rejected: owner explicitly asked for the theme to be
  applied.

## Notes

- Buttons: `.btn` (RESUME) uses `--accent` `#e8842c` fill; `.btn-secondary`
  (HANG AN EMA, EXIT THE GAME) uses a warm bronze border `rgba(232,178,120,0.5)`
  + warm text — already on-theme, unchanged.
- Title contrast: `var(--accent)` `#e8842c` against the `rgba(30,18,12,0.97)`
  panel passes WCAG AA large-text (3:1). The title is 1.8rem / letter-spaced,
  i.e. large text. Backdrop text contrast is not a concern (the modal panel is
  near-opaque and carries the only text).
