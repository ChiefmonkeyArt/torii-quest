# ADR-0030 — Kami Mode visibility: smoked-glass rack body + KAMI MODE badge

**Status:** Accepted (shipped v0.2.647-alpha)
**Version:** v0.2.647-alpha
**Date:** 2026-08-23
**Type:** UI / UX (CSS + DOM overlay; no physics/protocol/collider/state-machine change)
**Follows:** ADR-0025 (Kami Mode / sealed ema), ADR-0028 (floating overlays body-scope), ADR-0029 (Kami state machine)
**Related:** ADR-0026 (Plebeian auction panel — separate, deferred to its own slice)

## Context

After ADR-0029 shipped (v0.2.644) + the owner-check + Mac ⌘E hotkey fixes
(v0.2.645 / v0.2.646), the owner live-tested Ctrl+E in the arena. The console
showed the full KAMI path succeeding:

```
[kami] owner-check owner=ec79b568 admin=ec79b568 isOwner=true
[kami] Kami Mode armed — Ctrl+E to enter Kami Mode
[kami] entered Kami Mode — Ctrl+E for an ema, Esc to leave
```

…yet the owner reported **"no kami"** — nothing visible had changed on screen.
Shooting was suppressed (KAMI was genuinely active), but the rack was invisible
to the eye.

### Root cause (diagnosed, not guessed)

The rack **was** rendering. Verified in a cloud browser against the live arena:
`document.elementFromPoint()` at the rack's center returned the rack's own child
(`emakake-empty`), `isRackOnTop: true`, computed style `display:flex;
position:fixed; right:14px; z-index:40`, rect 300×123 at the right edge. The 3D
canvas is `z-index:auto` (appended to `document.body` by `scene.js`), so the
z-index:40 rack stacks above it correctly.

The rack was **camouflaged**, not absent:

1. **It overlapped the first-person weapon.** The rack sits at `right:14px;
   width:300px` — the same screen region as the gun view-model. The rack's text
   painted *over* the weapon, reading like weapon HUD text, not a distinct panel.
2. **It was empty.** No prior ema hung yet, so the only content was
   `RACK IS EMPTY` + the `CTRL+E TO HANG AN EMA` hint.
3. **The body had no backing.** Per the original smoked-glass design, only the
   header chip + rows carry smoked glass; `#emakake-body` (where the empty-state
   text lives) was `background:transparent`. So the text floated bare over the
   gun with nothing behind it.

Net effect: the owner's eye had no unmistakable signal that KAMI was active.

This also aligned with the owner's earlier explicit design asks — "Increase the
smokiness to the glass effect and the height of the emakami on the right" +
"put the panel beside the chat area and make it highly translucent" — which had
only been partially honored.

## Decision

Make Kami Mode entry **unmistakable** without repositioning the rack (the right
edge / "beside chat" placement is the owner's stated intent):

1. **Tall rack even when empty.** `#emakake.floating` gains `min-height: 46vh`.
   An empty rack is now a visible tall smoked-glass panel, not ~120px of
   floating text.

2. **Smoked-glass body.** `#emakake-body` gains `background:
   rgba(8,10,20,0.38)` + `backdrop-filter: blur(6px)` + a faint border, so the
   whole rack reads as a readable smoked panel the world shows through — not
   bare text over the gun. Honors "increase the smokiness."

3. **Larger, centered empty state.** `#emakake-empty` is centered (`margin:auto`)
   + tinted, so `RACK IS EMPTY` + the hint are clearly part of the panel.

4. **Persistent KAMI MODE badge.** A new `#kami-mode-badge` — a small
   `pointer-events:none` pill pinned top-center (`z-index:45`, above the HUD at
   10, below pause/death overlays at 60/50). Shown on `enterKamiMode()`, hidden on
   every `exitKamiMode()` path (including the not-yet-active Esc-during-check
   path). Copy: `⛩ KAMI MODE · CTRL/⌘+E EMA · ESC EXIT`. This is the
   unmistakable "you are in KAMI" signal the owner was missing. It never blocks
   movement/look — KAMI is still a roaming spirit mode.

5. **Mac-aware copy.** The empty-state hint + badge say `CTRL/⌘+E`, reflecting
   the v0.2.646 fix that made ⌘E enter KAMI on macOS.

### Why not reposition the rack away from the weapon?

Moving the rack off the right edge is a larger design change that conflicts with
the owner's "on the right / beside chat" intent. The smokier/taller rack + the
top-center badge make KAMI unmistakable *in place*. Repositioning stays on the
table only if a future screenshot still shows the rack fighting the weapon.

## Consequences

- **Positive:** The owner can now see at a glance that KAMI is active (badge) +
  that the rack is live (tall smoked panel), even before any ema exists. Matches
  the requested smokier/taller glass.
- **Neutral:** The badge is non-interactive (`pointer-events:none`) + hidden
  outside KAMI, so it adds no input surface + no clutter in normal play.
- **Risk:** `min-height:46vh` on the floating rack could look large on short
  viewports; `max-height:80vh` still caps it + the body scrolls.

## Test evidence

- `npm run build` — clean (2.18s).
- `npm test` — 3091 passing / 238 files (unchanged; this is CSS + a DOM toggle,
  no state-machine logic change).
- `npm run check` — the 3 pre-existing `setTimeout` findings in
  `kamiMode.js` / `marketStall.js` / `plebeianRelay.js` remain (present at
  v0.2.642 HEAD, unrelated).
- Cloud-browser verification: `elementFromPoint` at the rack center returns the
  rack's own child (`isRackOnTop: true`), confirming the rack renders above the
  3D canvas. Post-fix screenshots should show the tall smoked rack + the badge.

## Deferred

The NAP-zone auction auto-show (`setMarketActive(true)` on market entry, which
covers the emakake) is **not** addressed here. It remains a separate, deferred
auction-button slice: stop the auto-show, add a product-panel
button → `#auction-panel`, gate logged-in only. This ADR-0030 is the kami
visibility fix; that slice keeps its own commit/ADR.
