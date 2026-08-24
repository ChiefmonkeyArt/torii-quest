# ADR-0056 — Recording indicator + dashboard surfacing

**Status:** Accepted · **Version:** v0.2.680-alpha · **Date:** 2026-08-25

## Context

ADR-0055 added a 1Hz auto-capture diagnostic ring that silently records sealed
frames + snapshots while the owner plays. The ring works, but it is invisible:
the owner has no in-game confirmation that capture is live, and the oversight
dashboard does not document the feature at all. A silent recorder is a trust
problem — the owner cannot tell whether it is recording, stalled, or erroring.

## Decision

1. **Live arena HUD indicator** — a new module `src/engine/render/recIndicator.js`
   renders an amber, glowing **`● RECORDING`** overlay (top-right, `pointer-events:none`,
   high z-index) in the arena HUD. It is **owner-gated, not debug-gated**: the owner
   sees it while playing so they know the 1Hz ring is live; non-owners never capture
   and never see it.

2. **Pure CSS glow, throttled rAF** — the pulse is a CSS `@keyframes` animation on
   `text-shadow`/`opacity`; the rAF loop only calls a throttled (`~250ms`) `update()`
   that changes text/state. Near-zero cost. `prefers-reduced-motion` disables the pulse.

3. **Honest states** —
   - `● RECORDING` (amber) when active + a recent upload or inflight.
   - `● REC ERROR` (red) when `lastError` is set and no upload has succeeded since,
     with the error string as a secondary line.
   - A secondary line shows `ring n/120 · last 1s` (the ring count comes from the
     autocap report's `ringCap`/`captured` — **not hardcoded** in the UI module).

4. **Zero cost when off** — no DOM is created until the owner is in the arena with the
   capability resolved true; the element is torn down the moment they leave.

5. **Static oversight dashboard card** — a new "Live diagnostics" section is generated
   into `dashboard.html` documenting the autocap feature: ring cap (120), ring path,
   separation from `ema.jsonl`/`shots/`, the owner gate, and the retrieval CLI. The
   dashboard stays static/read-only — **no network calls** are added; the live
   indicator itself lives in the arena HUD, not on the dashboard page.

## Consequences

- The owner gets visible confirmation the recorder is live while they play, and a
  clear red signal when uploads are failing.
- No performance regression: the glow is pure CSS and the text update is throttled.
- The oversight dashboard now documents the diagnostic surface so a fresh agent or
  human reader knows it exists and how to retrieve a ring.
