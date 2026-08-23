# ADR-0028 — Floating overlays must not nest inside phase-hidden screens

**Status:** Accepted (shipped v0.2.643-alpha)
**Version:** v0.2.643-alpha
**Date:** 2026-08-23
**Type:** Bug fix (DOM structure; no gameplay/physics/protocol/collider change)
**Follows:** ADR-0025 (Kami Mode / emakake rack), ADR-0026 (Plebeian auction panel)
**Related:** ADR-0027 (ema input isolation — same live-test session)

## Context

After the ADR-0027 Esc/Enter fix shipped (v0.2.642-alpha), the owner reported that
**hung emas were nowhere to be seen** — the emakake rack did not appear on the
right-hand side of the arena, even after arming Kami Mode (`Ctrl+E`) and hanging
emas with Enter. The same symptom affected the **Plebeian auction panel**, which
should surface in the NAP market zone.

Both panels are `position: fixed` smoked-glass overlays meant to float over the
in-game world: `#emakake` (the ema rack, shown by `kamiMode.showEmakake()` when
armed) and `#auction-panel` (the watch-only Plebeian auction, shown by
`arenaRuntime` `setMarketActive()` on NAP-zone entry).

## Root cause (found by live browser inspection, not guessing)

Both panels were **nested inside `#screen-title` > `#title-columns`** in
`index.html`.

`src/engine/ui/phaseScreens.js` `applyPhaseScreens(phase, …)` is the single
declarative source for top-level screen visibility. It derives visibility from the
phase the FSM transitioned INTO:

```js
export function phaseVisibility(phase) {
  return {
    title: phase === PHASE.TITLE,
    hud:   phase !== PHASE.TITLE,
    pause: phase === PHASE.PAUSED,
  };
}
// applyPhaseScreens toggles elTitle.classList 'hidden' when !vis.title
```

The moment the phase leaves TITLE (→ PLAYING / PAUSED / DEAD / GAMEOVER),
`#screen-title` gets the `.hidden` class → `#screen-title.hidden { display: none; }`.

**`display: none` removes the ENTIRE subtree from the render tree — including
`position: fixed` descendants.** A `position: fixed` element is only taken out of
normal flow when it (or an ancestor) is rendered; if an ancestor is
`display: none`, the fixed descendant is not rendered at all. This is the key fact
that made the panels vanish: no amount of `.floating` (`position: fixed;
right: 14px; z-index: 40`) on the panel itself could rescue it, because its
ancestor `#screen-title` was removed from the render tree.

### Proof (live browser, reproduced against the deployed v0.2.642 site)

1. `#emakake` unhid + `.floating` added while `#screen-title` was **visible**
   (title screen): rect `300×123` at `x:1606` — pinned right, visible.
2. `#screen-title.classList.add('hidden')` (simulate the PLAYING transition) with
   `#emakake` still nested inside it: rect `w:0, h:0` — **not rendered**, even
   though the panel's own computed style was `display: flex; position: static`.
3. `document.body.appendChild(#emakake)` (move it out of `#screen-title`) with
   `#screen-title` still hidden + `.floating` added: rect `300×123` at `x:1606`,
   `position: fixed; right: 14px; top: 500.5px; z-index: 40` — **visible again**.

So the blocking constraint was the `display: none` ancestor, not the panel's own
CSS. The fix is structural: the panels must not live under `#screen-title`.

## Decision

Move `#emakake` and `#auction-panel` out of `#screen-title` / `#title-columns` to
**top-level body scope** (direct children of `<body>`, siblings of `#hud` and
`#pause-overlay`, placed immediately after `#screen-title` closes and before the
HUD block). They are hidden by default (`hidden` attribute) and shown on demand
by their respective controllers.

Top-level direct-body children are the lowest-risk placement: they are never
hidden by phase state, and they carry no `transform` / `filter` / `display: none`
ancestor that could establish a containing block or remove them from the render
tree. (A shared container would also have worked, but only if it were itself
top-level and never phase-hidden — direct body children avoid that foot-gun
entirely.)

The HTML comments at both the old (now-removed) nesting site and the new
top-level site now state the constraint explicitly: **these panels MUST live at
body scope, NOT inside `#screen-title`**, because `#screen-title` is
`display: none` during PLAYING and that removes even `position: fixed`
descendants.

## Consequences

- The ema rack is now visible on the right-hand side of the arena once Kami Mode
  is armed (`showEmakake({ floating: isPlaying() })` removes `hidden` and adds
  `.floating`). Hung emas appear in the rack after Enter commits
  (`finish(true)` → `addToTray` → `renderRack()`).
- The Plebeian auction panel is now visible in the NAP market zone when
  `setMarketActive()` shows it, instead of being silently hidden by
  `#screen-title`.
- On the title screen, the rack (if ever shown there) floats on the right rather
  than sitting as a column inside `#title-columns`; this is acceptable because the
  rack is `hidden` by default and only armed in the arena.
- No JS controller changes were needed: `showEmakake` / `renderEmakake` /
  `setMarketActive` all look up the panel by id (`getElementById`), which is
  location-independent. The move is purely structural (HTML).

## Tests

`tests/floating-panels-nesting.test.js` — 5 source-contract tests that parse
`index.html` and assert:

- `#screen-title` is present and balanced (its closing `</div>` is findable via a
  nested-`<div>` depth scan from its opening tag).
- `#emakake` and `#auction-panel` exist as elements.
- `#emakake` and `#auction-panel` are **NOT** nested inside `#screen-title`
  (their opening-tag byte offset is greater than `#screen-title`'s closing
  `</div>` byte offset).
- Both panels sit in the top-level overlay band (after `#screen-title` closes,
  before `#hud`).

These guard the exact regression: if either panel is ever re-nested under
`#screen-title` (or any phase-hidden screen), the byte-offset assertion fails.

Full suite: **3084 passing / 236 files** (was 3079 / 235 before this ADR; +5
nesting tests, +1 file).

## Spelling correction (ADR-0033, 2026-08-23)

This document's original text spells the ema rack "emakake." Confirmed against
Japanese-language sources: the correct romanization is **emagake** (絵馬掛け,
rendaku k→g). Left as-written above for the historical record; see ADR-0033
for the rename applied across code, DOM IDs, and docs.
