# ADR-0060 — Restore real smoked-glass blur on the homepage panel with a true edge fade

- **Status:** Accepted
- **Date:** 2026-08-25
- **Deciders:** chiefmonkey
- **Related:** ADR-0054 (gateway screen smoked-glass card), v0.2.669-alpha / v0.2.673-alpha / v0.2.676-alpha / v0.2.677-alpha (homepage panel translucency history), v0.2.684-alpha (settings panel + homepage fade — this ADR's direct predecessor), `index.html` `#title-centre.glass-panel`

## Context

v0.2.684-alpha rounded the homepage centre panel's corners and made its background
fade to true 100% transparency at the edges, closing out a "hard edge" complaint
against the torii-gate background image. That fix worked by removing
`backdrop-filter: blur()` entirely and replacing it with a flat, non-blurred
`rgba(...)` tint whose opacity fades via a radial `mask-image`. It solved the hard
edge, but it also quietly deleted the panel's actual smoked-glass look — the
tint fades, but nothing behind the text is blurred anymore.

The owner asked for the smoked glass back, with the edge fade kept: "i want smoked
glass behind the main central content panel behind the text and i want it to fade
out at the edges to 100% transparency."

Root cause of why the naive fix (`backdrop-filter: blur(Npx)` + a single radial
`mask-image` on the same element) does not work: Chromium/WebKit rasterize the
blurred backdrop over the element's **full box** before the mask is composited on
top. Against a low-detail or synthetic test background this hard sampling boundary
is invisible; against the real torii-gate image (high-contrast linework) it shows
up as a visible rectangular cutoff at the panel's blur radius — no amount of mask
alpha feathering fixes it, because the mask clips the *tint*, not the *blur
sampling edge* itself. This was proven with isolated Chromium test pages
(`mask-image` correctly clips `blur()` against simple backgrounds, but not against
detailed ones) before deciding on the fix below.

## Decision

Replace the single blur+mask layer with a 4-ring concentric-blur technique: stack
several `backdrop-filter: blur()` layers of *decreasing* radius, each masked to a
*wider* radial band than the last, so the blur radius itself tapers off gradually
across the transition zone instead of cutting off at one edge. A final flat-tint
layer (no blur) carries the fade the rest of the way to true 0% opacity.

### What changes

`#title-centre.glass-panel` becomes `position:relative; background:transparent;
border:none; isolation:isolate;` with five new sibling layers inserted before the
existing content, each `position:absolute; inset:0; pointer-events:none;
z-index:0`:

1. `.gp-ring1` — `blur(16px) saturate(120%)`, mask solid 0–42%, fades to
   transparent by 58%.
2. `.gp-ring2` — `blur(10px) saturate(120%)`, mask band 32–72%.
3. `.gp-ring3` — `blur(5px) saturate(120%)`, mask band 50–85%.
4. `.gp-ring4` — `blur(2px)`, mask band 64–96%.
5. `.gp-tint` — flat `rgba(30,18,12,0.42)`, no blur, mask fading 0%→92% — carries
   the last stretch to true 0% opacity.

All pre-existing panel content (character select, login/enter buttons, controls
legend, version box) is wrapped in a new `.gp-content` div
(`position:relative; z-index:1`) so it renders above the ring/tint stack and stays
fully clickable.

### Out of scope (not this ADR)

- No changes to the gateway screen's smoked-glass card (ADR-0054) — different
  component, not touched.
- No changes to panel *content* (buttons, copy, layout) — visual/backdrop only.

## Consequences

- **Enables:** the panel reads as genuine smoked glass again (torii-gate lines
  visibly softened behind the text) while keeping the true-transparent edge fade
  from v0.2.684-alpha — both requirements satisfied simultaneously.
- **Forecloses:** a single blur+mask layer is no longer an acceptable pattern for
  any future translucent panel over a detailed background in this codebase; use
  the ring technique (or an equivalent multi-layer taper) instead.
- **Trade-offs:** five extra DOM nodes and five composited layers per panel
  instance instead of one — a small paint/compositing cost, accepted because the
  panel is a single always-on-screen homepage element, not a per-frame or
  per-entity cost.
- **Enforcement:** verified by direct screenshot comparison against the live
  homepage background (not synthetic test patterns); no automated visual-regression
  gate exists yet for this panel, so future edits to `.gp-ring*`/`.gp-tint` should
  be re-verified the same way rather than assumed correct from CSS alone.

## Alternatives considered

- **Feathering the mask harder on a single blur layer** — tried first; rejected
  because the hard edge is a property of blur *sampling*, not the mask's alpha
  curve, so no mask adjustment alone removes it.
- **`backdrop-filter` on a pseudo-element with `filter: blur()` on the background
  image itself** — would require duplicating/positioning a copy of the background
  per panel instance; rejected as more fragile and harder to keep in sync with the
  real background than a backdrop-filter-based approach.
- **Dropping blur entirely (the v0.2.684-alpha state)** — rejected per explicit
  owner request; loses the "smoked glass" look entirely.

## Notes

- Verified against the real homepage background, not synthetic test patterns —
  earlier isolated Chromium/Playwright tests (`mask-image` clipping behavior) were
  used only to diagnose the root cause, not as the final acceptance check.
- Confirmed via `elementFromPoint` that buttons/links inside `.gp-content` remain
  the top hit-tested element (the ring/tint layers are `pointer-events:none`).
- Zero gameplay-file overlap: `bots.js`, `botModel.js`, `bot-tactics.js`,
  `botNetState.js`, `botSim.js`, `physics.js`, `player.js`, `weapons.js`,
  `scene.js`, `hud.js`, `input.js`, `lod.js`, `multiplayerHost.js`,
  `wireProtocol.js`, `arenaRuntime.js`, `server/arena-ws.js`,
  `server/bots/botStateGate.js` all untouched.
- Rebased cleanly on top of a concurrent session's v0.2.685-alpha (ADR-0059,
  auction panel header hardening) and its follow-up debug-logging commit in
  `productNappletHost.js` — no file overlap, no merge conflicts.
- 3363/3368 full suite green (5 skipped), 21/21 regression gates green.
- Shipped as v0.2.686-alpha.
