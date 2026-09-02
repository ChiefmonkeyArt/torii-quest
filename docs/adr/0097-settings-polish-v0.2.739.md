# ADR-0097 — Settings polish v0.2.739 (opacity + font + Character preview + toast + micro-interactions)

**Status:** Accepted (implemented in v0.2.739-alpha)
**Date:** 2026-09-02

## Context

The v0.2.738-alpha settings redesign shipped the dark charcoal + teal theme
and fixed the underlying dead-buttons regression, but a live playtest surfaced
three visible-quality bugs and one interaction-quality gap:

1. **Backdrop bleed-through** — the modal backdrop was set to
   `background: 'transparent'`, so the amber home-screen showed through the
   gaps around the settings panel and destroyed the "settings page" reading.
2. **Character tab empty when logged-out** — the entire panel body was
   wrapped in `if (isLoggedIn)`, so pre-login users saw a bare "Log in with
   Nostr" line and nothing else. No way to see the roster or what the tab
   even offered.
3. **Monospace font inherited from the game** — `#torii-settings-backdrop`
   inherited `font-family: var(--font)` (Courier New) from the global game
   token, giving the settings panel a wall-of-code feel instead of a
   conventional settings UI.
4. **No animated confirmations** — clicks worked but there was no visible
   feedback that a save/remove/select actually happened. The status was only
   written to `#entry-status`, which is hidden while the settings panel is
   open.

## Decision

Ship **v0.2.739-alpha** as a targeted quality-of-experience pass, scoped
strictly to `#torii-settings-backdrop`, `#torii-settings-panel`, and a new
`#torii-toast-layer`. The game's amber HUD is unchanged.

### 1. Backdrop dim + blur

`src/engine/settings/settingsPanel.js` — the backdrop element now uses
`background: 'rgba(6, 8, 10, 0.72)'` plus
`backdrop-filter: blur(8px)` (with the `-webkit-` prefix). Standard modal
behaviour, no amber bleed.

### 2. Font override

`index.html` — `#torii-settings-backdrop` now sets
`font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', system-ui, sans-serif;`.
System stack so the bundle size stays unchanged; scoped to the backdrop so it
cannot leak into the game.

### 3. Character tab preview pre-login

`src/engine/settings/characterForgePanel.js` — the login gate is now a
`.settings-gate` banner ABOVE the create view, not a wrapping condition. The
create view renders the same preset grid + Upload + Create-with-AI cards
whether the user is logged in or not, with every action `disabled` when
logged out. Nothing writes until login.

Contract updates (`renderCharacterForgePanel`):

- `_createView(presets, opts)` now takes `{ disabled: boolean }`.
- `_presetGrid(presets, opts)` now takes `{ disabled: boolean }` and adds
  `disabled` to every preset button.
- Logged-out banner text: `"Sign in with Nostr to save your character.
  You can browse the roster below."`
- Test lock updated (`tests/character-forge-panel.test.js`): logged-out
  rendering asserts the presence of `Sign in with Nostr`, `cf-preset-card`,
  and disabled `select-preset` / `upload-mesh` / `create-with-ai` buttons.

### 4. Toast system

New pure module `src/engine/ui/toast.js` — `showToast(message, opts)`
returning `{ el, dismiss }`. Convenience helpers `toastSuccess`,
`toastError`, `toastInfo`. Lazily creates `#torii-toast-layer` (z-index 300,
above the settings panel's z-index 200), stacks toasts, auto-dismisses at
2400ms with a leave animation. No framework, no state library, no
import-time DOM.

CSS in `index.html` — `.ts-toast` variants for `success` (teal-green),
`error` (rust-red), `info` (teal), slide-up entrance and exit animations
gated behind `@media (prefers-reduced-motion: no-preference)`.

Wired in `src/main.js`'s settings action router:

- `save-profile` → `toastSuccess('Profile saved.')` on resolve /
  `toastError('Profile save failed.')` on reject
- `save-relays` → `toastSuccess('Relays saved.')`
- `remove-relay` → `toastInfo('Relay removed.')`
- `publish-node` → `toastSuccess('Heartbeat updated.')`

Existing `showEntryStatus(...)` calls remain untouched — they still update
the title-screen entry-status line for backwards compatibility.

### 5. Button micro-interactions

CSS in `index.html`, scoped to `#torii-settings-panel`. On every
`.settings-btn`, `.cf-preset-card`, `.ts-nav-item`, `.ts-close-x`:

- Hover: `translateY(-1px)` (respects reduced-motion)
- Active: `translateY(0) scale(0.98)` press
- Focus-visible: 3px teal wash ring + accent border
- Disabled: 0.5 opacity, `cursor: not-allowed`
- Primary/danger variants: colored wash background on hover
- Entrance: 200ms panel rise + 160ms backdrop fade (`prefers-reduced-motion` respected)

`setTimeout` allowlist in `tools/regression-check.mjs` extended to include
`src/engine/ui/toast.js`.

## Consequences

- **Positive:** Settings now reads as a proper professional modal — proper
  scrim, proper font, animated action confirmations, real hover/focus/press
  feedback. Character tab is no longer a blank gate for logged-out users.
- **Positive:** Bundle size unchanged (system fonts, no new external assets,
  ~2.7 KB of pure JS for the toast module).
- **Neutral:** The AI-create card is still `disabled` in both states —
  wiring Meshy/routstr integration is out of scope, tracked under ADR-0091.
- **Test count:** 300 → 301 files, 3679 → 3684 tests. Curated captures in
  `toriiQuestDashboardData.js`, `mvpReadiness.js`, `NEXT_ACTION_STATE.json`
  bumped in the same commit as this ADR.

## Notes

- Scoped rigidly to `#torii-settings-backdrop` / `#torii-settings-panel` /
  `#torii-toast-layer` — the game's amber HUD, title screen, gateway, and
  world UI are all unchanged.
- Consent principle preserved — no toast fires without a real user action
  landing in the settings action router.
- Preserves the "professional, well-thought-out app" bar set by the user in
  the v0.2.739 request without redesigning any other surface.

## Follow-up

- v0.2.740+ — wire Meshy/routstr into `create-with-ai` (still ADR-0091).
- v0.2.740+ — extend toast wiring to `save-access`, `check-character`, and
  the sticker editor's `add-sticker` / `remove-sticker` actions.
