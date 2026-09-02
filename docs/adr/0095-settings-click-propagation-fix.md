# ADR-0095: Settings Panel Action Buttons Were Dead (Click-Propagation Fix)

- **Status:** Accepted
- **Date:** 2026-09-01
- **Deciders:** chiefmonkey (+ Perplexity Computer agent)
- **Related:** ADR-0078 (settings panel + Access tab), `src/engine/settings/settingsPanel.js`, `src/main.js` (`_wireSettingsContentDelegation`), `tests/settings-panel-click.test.js`

## Context

Every action control inside the settings panel — **Save Profile**, **Remove**
(on the Relay tab), **Publish / Heartbeat toggle**, **Choose Blank / Use
Template**, the **Character Forge** buttons, and the **Access** radios/form —
is routed through a single *delegated* click listener registered on
`document` in `main.js`. That listener scopes itself to
`#torii-settings-content` and dispatches on `data-action` (plus delegated
`change`/`submit` for the Access tab).

In production, none of these buttons did anything. The panel's nav tabs and
the ✕ close button worked, but every `data-action` control appeared inert.

## Root cause

`settingsPanel.js` attached `e.stopPropagation()` to the **panel card**
(`#torii-settings-panel`) — originally intended to stop a click inside the
dialog from reaching the backdrop's click-to-close handler. But the backdrop
handler already guards with `e.target === backdrop`, so it never closes the
panel for clicks that land *inside* the card anyway. The `stopPropagation()`
was therefore redundant for its purpose and, as a side effect, stopped **all**
clicks inside the panel from ever bubbling up to `document` — so the delegated
`data-action` router never fired. This was confirmed live: a capture-phase
`document` listener received the click, a bubble-phase one did not, and the
tab content's `innerHTML` was never updated after any button press.

## Decision

1. Remove the `card.addEventListener('click', e => e.stopPropagation())`
   line from `settingsPanel.js`. Keep the backdrop's click-to-close, which
   remains correct via its `e.target === backdrop` guard.
2. Add a jsdom regression test (`tests/settings-panel-click.test.js`) that
   opens the panel, renders a `data-action` button, clicks it, and asserts a
   `document`-level bubble listener observes the click — plus a second
   assertion that clicking inside the card does **not** close the panel.

No other wiring changes: the delegated router, the tab renderers, and the
owner/login gating already exist and are unchanged. This is a one-line,
cause-of-record fix, not new functionality.

## Consequences

- **Positive:** every settings action button now routes correctly: relay
  remove/save, heartbeat publish, profile save, world choice, character
  actions, and the access form all fire. The "all settings buttons do nothing"
  failure mode is removed and locked against regression.
- **Negative / risk:** none material. Removing `stopPropagation()` does not
  change close-on-backdrop (still guarded), close-on-✕ (its own listener), or
  ESC-to-close (separate keydown handler). Clicks on the card's empty padding
  hit `e.target` = the card, not the backdrop, so they still do not close the
  panel.
- **Follow-on (tracked separately):** the Heartbeat tab's copy and state still
  describe the *client* heartbeat ("auto-starts on owner login / signer
  approval") whereas ADR-0094 made presence **server-side** (auto-on from the
  configured admin npub, no login/wallet). Its wording and state source are
  corrected as part of the settings redesign, not this fix.