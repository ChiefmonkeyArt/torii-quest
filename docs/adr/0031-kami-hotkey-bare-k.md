# ADR-0031: Kami Mode Hotkey Moved to Bare K (from Ctrl/Cmd+E)

- **Status:** Accepted
- **Date:** 2026-08-23
- **Deciders:** chiefmonkey
- **Related:** ADR-0025 (Kami Mode), ADR-0029 (state machine), ADR-0030
  (visibility fix), `src/engine/kami/kamiMode.js`, `src/input.js`, `index.html`

## Context

After v0.2.648 shipped the rack/badge visibility fix, the owner reported
"still no kami" with a full console log pasted. The log showed a normal
arena session (movement, shooting, kills, respawns) but **zero `[kami]`
log lines** — not even the unconditional `hotkey pressed` diagnostic that
fires on every Ctrl/Cmd+E keydown before any owner-check or phase guard.

A code-level audit (per the standing "never guess" rule) ruled out:

- **Stale deploy.** Verified via deploy log, release symlink, on-disk
  built file, local repo at the deployed commit, and a cache-busted live
  `curl` — v0.2.648 was genuinely live and the deployed JS bundle
  contained the `hotkey pressed` / `kami-mode-badge` / `owner-check`
  strings the user's own console referenced.
- **A swallowing listener.** Every `document`/`window` `keydown` listener
  in the codebase was enumerated (`arenaRuntime.js` Escape/L/Tab handlers,
  `input.js`, `kamiMode.js` itself). None filter on `KeyE`, use capture
  phase against it, or call `stopPropagation`/`stopImmediatePropagation`
  in a way that could intercept it.
- **A broken install path.** `installKamiMode(...)` is called
  unconditionally during arena boot, not gated behind any async/conditional
  that could skip it.

The owner then confirmed the actual cause directly: **Ctrl+E (and Cmd+E)
is a Brave/Chromium browser shortcut that focuses the address/search
bar.** The keydown is consumed by browser chrome before it ever reaches
the page's `document`, so the listener installed by `installKamiMode`
never fires — fully explaining zero `[kami]` output of any kind.

Ctrl+K / Cmd+K, the first alternative considered, has the same class of
problem: it's a widely-reserved Chromium combo (search/address-bar focus
in many browsers and a near-universal "command palette" shortcut
elsewhere), so picking it would just relocate the same failure mode.

## Decision

Kami Mode's hotkey is now a **bare, unmodified `K` key press** — no
Ctrl/Cmd/Alt. Browsers do not intercept unmodified single-key presses on
a page that has focus, so this class of bug cannot recur for any
modifier-based combo. `E` was already taken as the (unmodified) jump
alias in `player.js`, so `K` was chosen as the first unused, unbound key.

- `ev.ctrlKey || ev.metaKey || ev.altKey` now **excludes** the press —
  Ctrl+K / Cmd+K / Alt+K pass through untouched to the browser.
- A focused text field (`INPUT`/`TEXTAREA`/`SELECT`/`contenteditable`)
  still owns bare `K`, mirroring the existing ADR-0027 typing guard in
  `input.js` — typing the letter "k" into the ema note or any other field
  does not trigger Kami Mode.
- Shift+K still seals + sends the tray (was Shift+Ctrl+E), unchanged
  behavior otherwise.
- All in-game copy (`#emagake-empty`, `#kami-mode-badge`) and console
  diagnostics updated from "CTRL/⌘+E" to "K".

## Consequences

- **Enables:** a hotkey that cannot be silently eaten by browser chrome,
  regardless of browser or OS. No more Mac/Brave/Chrome-specific modifier
  workarounds (ADR-0029's Ctrl-vs-Cmd fix is now moot for this key).
- **Forecloses:** `K` is no longer available for any other bare-key game
  binding (movement/action keys are already WASD/Space/C/F/L/R/Tab, so no
  collision existed).
- **Trade-offs:** a bare letter key is slightly more likely to be pressed
  incidentally during normal play than a modified combo. Mitigated by the
  existing `isPlaying()` guard (no-ops outside active play) and the
  focused-field guard above.
- **Enforcement:** two new regression tests in
  `tests/kami-state-machine.test.js` — (1) Ctrl+K / Cmd+K must NOT enter
  Kami Mode (proves the browser-reserved-combo class of bug can't
  recur), and (2) bare `K` typed into a focused text input must NOT
  enter Kami Mode. Existing state-machine tests were updated to dispatch
  bare `KeyK` instead of Ctrl+`KeyE`.

## Alternatives considered

- **Ctrl+K / Cmd+K.** Rejected — same failure class, just a different
  commonly browser-reserved combo.
- **Keep Ctrl/Cmd+E, document a workaround.** Rejected — puts the burden
  on every player to know and avoid a silent browser conflict; not
  discoverable, not fixable by us once shipped.
- **A different modifier (Alt+E, Shift+E).** Considered but bare `K`
  removes the entire class of browser-shortcut collision rather than
  gambling on one specific combo being unclaimed across all browsers/OSes
  (Alt combos are reserved in some browsers, e.g. Alt+E in Firefox opens
  Edit).

## Notes

- Diagnostic technique reused from prior ADRs: cross-check the deploy
  log, release symlink, on-disk bundle, local source at the deployed
  commit, and a cache-busted live fetch before trusting any single
  reading — this again caught nothing wrong on the deploy side, which is
  what correctly pointed the investigation at the browser layer instead.
- 3093/3093 tests passing (238 files), build clean, regression check
  shows only the 3 pre-existing (unrelated) `setTimeout` advisories
  present since before v0.2.642.
