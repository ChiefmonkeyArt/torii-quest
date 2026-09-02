# ADR-0068: Boot Loading Overlay Recolored to Torii Sunset Theme

- **Status:** Accepted
- **Date:** 2026-08-26
- **Deciders:** chiefmonkey
- **Related:** ADR-0067, `index.html` (boot-overlay CSS block, lines ~1065–1101), `src/main.js` (`showBootOverlay` / `ensureArenaReady`)

## Context

After a visitor logs in with Nostr (or proceeds anonymously) and clicks
**ENTER TORII** (`#btn-enter-nap`), `main.js` calls `showBootOverlay()` to paint a
full-screen loading surface while the deferred `arenaRuntime.js` (three-vendor)
chunk + Rapier WASM + scene/physics bootstrap run. That overlay is CSS-only and
three-free so it can render on the very first paint before any heavy module
loads.

The overlay was originally built (`v0.2.529`) on a **dark-neon-purple** palette:
`#140a28` radial background, `#b794f4` title, `#8b5cf6 → #f7931a` progress bar.
Since `v0.3` the rest of the product (title screen, HUD, panels, buttons) was
recolored to the canonical **torii-gate sunset** palette defined in `:root`
(`--bg #140d09`, `--accent #e8842c`, `--accent-soft #c9793a`, `--orange #f7931a`,
`--panel-text #f5e6d8`, `--panel-text-dim #c9b19d`, `--muted`). The `:root`
comment itself states that palette "Replaces the dark-neon-purple theme" and
that the old purple is "kept ONLY for the few remaining player-facing surfaces
not yet migrated."

The boot overlay was the last such unmigrated player-facing surface. The owner
confirmed the overlay's layout/structure looks great and only asked for it to be
recolored to the project's theme.

## Decision

Recolor the boot loading overlay to the canonical torii-gate sunset palette,
expressed via the existing `:root` CSS custom properties. **Layout, element
sizing, spacing, typography scale, and the eased progress-bar animation are all
unchanged** — this is a color-only migration.

Color mapping:

| Element | Before (purple) | After (torii sunset) |
| --- | --- | --- |
| Background radial | `#140a28 → #0a0a0f → #050308` | `#2a1810 → #140d09 → #0a0604` |
| Base text color | `#e8e8f0` | `var(--panel-text)` (`#f5e6d8`) |
| Title "⛩ TORII QUEST" | `#b794f4`, glow `rgba(139,92,246,0.4)` | `var(--accent)` (`#e8842c`), glow `rgba(232,132,44,0.45)` |
| Status label | `rgba(255,255,255,0.55)` | `var(--panel-text-dim)` (`#c9b19d`) |
| Progress track | `rgba(255,255,255,0.08)` | `rgba(232,178,120,0.12)` |
| Progress bar fill | `linear-gradient(#8b5cf6, #f7931a)` | `linear-gradient(var(--accent-soft), var(--orange))` + warm glow `box-shadow rgba(247,147,26,0.5)` |
| Sub-label | `rgba(255,255,255,0.2)` | `var(--muted)` (`rgba(255,232,214,0.35)`) |

## Consequences

- **Enables:** Every player-facing surface is now on the one canonical theme.
  The overlay no longer flashes a purple screen that contradicts the warm
  sunset title screen shown immediately before and after it. Using `:root`
  tokens means a future palette tweak propagates to the overlay automatically.
- **Forecloses:** The legacy neon-purple boot styling is gone; if anyone wanted
  a distinct "techy" loading feel, it must now be derived from the sunset
  palette, not reintroduced as raw purple hex.
- **Trade-offs:** Pure CSS color swap — no behavior, no DOM, no JS, no asset
  change. Zero runtime cost. Risk is limited to contrast/legibility, verified
  below.
- **Enforcement:** No new regression-check rule. The boot overlay is verified by
  visual inspection (screenshot) of the built `dist/index.html`. The colors are
  sourced exclusively from `:root` tokens (no off-palette hex except the
  gradient stops, which mirror the documented sunset reference `#2a1810` /
  `#140d09` / `#0a0604` and the existing `--bg`).

## Alternatives considered

- **Reuse the `torii-gate-sunset.jpg` background image** (like the title
  screen) behind the overlay. Rejected: the overlay is deliberately CSS-only /
  three-free / image-free so it paints before any asset fetch; depending on a
  JPEG would reintroduce a network round-trip on the critical first-paint path
  the overlay exists to protect.
- **Add a spinner / animated torii gate SVG.** Rejected: owner said the current
  design already looks great and only wants the colors themed — adding new
  decoration would expand scope against the standing "don't change things out
  of scope" rule.
- **Leave the purple.** Rejected: it is the last off-theme player-facing surface
  and the owner explicitly asked for the recolor.

## Notes

- Contrast checked against the warm `#2a1810 → #0a0604` background:
  `--panel-text` (#f5e6d8) and `--accent` (#e8842c) both exceed WCAG AA 4.5:1
  for body / large text; `--panel-text-dim` (#c9b19d) and `--muted` are used
  only for secondary/caption text where the 3:1 large-text threshold applies.
  No reliance on color alone — every state still has a text label.
- The `#8b5cf6` purple that remains in `src/` (arena.js `C_PURPLE`,
  `proofSurfaceRenderPlan.js` SCORE, `bots.js` color set) is in-world 3D object
  coloring, intentionally out of scope for this loading-overlay recolor.
