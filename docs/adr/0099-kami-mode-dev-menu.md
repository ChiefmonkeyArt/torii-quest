# ADR-0099: Kami-mode dev menu (owner-only runtime toggles surface)

- **Status:** Accepted
- **Version:** v0.2.743-alpha
- **Supersedes / relates to:** ADR-0025 (Kami Mode), ADR-0084 (napplet wiring),
  ADR-0090 (UGC sticker system slice 2 — introduced the sticker A/B toggle
  currently only reachable via `ToriiDebug.stickers.forcePlaneMode`).

## Context

Since ADR-0090 slice 2 landed in v0.2.741-alpha, runtime A/B toggles (starting
with the sticker RENDER-MODE plane vs baked path) have been reachable **only**
via `ToriiDebug.*` console incantations. That's a working developer surface
during the prototype phase, but:

- It is undiscoverable by anyone who doesn't already know the property path.
- It becomes progressively worse as toggles accumulate (v0.2.744 will add
  a recording-ring on/off in PR-C, and more are queued behind that).
- It provides no visible READ-BACK — the operator has to `state()` and then
  `forcePlaneMode(...)` every time.

Meanwhile the perpetual-world constraint (see Torii Quest strategy) means we
can never afford to leak dev/owner UI to the public view — the world stays
live, so other players are in it while the owner tinkers.

## Decision

Introduce a **left-edge, Kami-mode-only, owner-only** dev menu that surfaces
runtime toggles as one-click buttons with live state read-back. The menu is
gated in **CODE**, not just in UI (project rule: "Handlers gate is enforced in
code, not just UI").

Concretely:

1. `src/engine/dev/devMenuModel.js` — pure state machine. Owns a registry of
   toggle entries `{ id, label, hint?, get, set }`. Injected `isVisible()`
   predicate is checked BEFORE any entry's `set()` is invoked, so a
   synthesized DOM click while the gate is closed still no-ops. `renderModel()`
   returns a frozen snapshot the DOM driver can't mutate back into the model.
2. `src/engine/dev/devMenu.js` — DOM driver. Mounts `#torii-dev-menu`,
   1Hz-throttled pump, wipes DOM contents when the gate closes so a re-open
   starts clean.
3. `index.html` — `<div id="torii-dev-menu" hidden>` + smoked-glass CSS
   matching the emagake rack and owner-boards language. Fixed to the LEFT
   edge, docked below the owner-boards stack (`top: calc(8vh + 3 * (27vh
   + 10px))`) so it never collides.
4. `src/arenaRuntime.js` — one-time wiring:
   - `installDevMenu({ isVisible: () => kamiActive() && kamiIsOwner() })`
   - `registerDevToggle({ id: 'sticker-plane-mode', ..., get:
     getStickerRenderState().forcePlaneMode, set: setStickerForcePlaneMode })`
   - `pumpDevMenu(performance.now())` in the per-frame `update()`.
5. `src/main.js` — the existing `ToriiDebug.stickers.forcePlaneMode` console
   surface stays as-is. Both flip the same underlying flag in
   `stickerRenderMode.js`, which is the single source of truth. The menu row
   reflects a console flip on the next pump.

## Consequences

**Positive:**

- Discoverable A/B — the owner sees the toggle by entering Kami Mode instead
  of reading the source.
- Additive: PR-C's recording-ring toggle can register itself with one call.
- Public perpetual-world view is unaffected — the panel is hidden AND its
  intent-handlers refuse when the gate is closed.
- Model is pure, so it stays trivially test-covered as more toggles are added.

**Negative / open edges:**

- The 1Hz pump means a console flip via `ToriiDebug.*` takes up to one second
  to reflect in the row. Acceptable — the menu row is the discoverable path;
  the console remains the fast path for anyone who prefers it.
- Fixed left-edge positioning assumes the owner-boards stack sits at its usual
  height. On very short viewports the panel can fall below the fold — the
  smoked-glass panel is scroll-page anchored (not viewport-clipped) so it is
  still reachable by scroll, and no A/B is game-critical.
- The menu doesn't yet support non-boolean toggles (numeric sliders, enum
  selectors). That comes when a real use case demands it, not before.

## Test coverage

`tests/adr-0099-kami-dev-menu.test.js` — 18 tests covering:

- Pure-model semantics (frozen snapshots, gate refusal in code, thrown
  setters caught, invalid/duplicate IDs rejected).
- DOM driver rendering (hidden vs visible, one row per entry, live get()
  read-back, clean wipe on hide).
- Owner + Kami gate flow (public view → non-owner-in-Kami → owner-in-Kami).
- Synthesized DOM click while gate is closed → set() never called
  (defense-in-depth against a stale button reference).

## Not in this ADR

- The Kami left-hand dev menu shell has no positioning override,
  drag-to-reposition, or dockability. It sits where CSS puts it.
- The sticker A/B remains a boolean render-mode flip only. No introduction
  of new sticker rendering modes here.
- Recording-ring toggle is queued as ADR-0100 in PR-C (v0.2.744-alpha) and
  will register itself against this same shell.

## References

- `src/engine/dev/devMenuModel.js` — model
- `src/engine/dev/devMenu.js` — DOM driver
- `src/engine/character/stickerRenderMode.js` — sticker A/B source of truth
- `src/engine/kami/kamiMode.js` — `kamiActive()`, `kamiIsOwner()` predicates
- `tests/adr-0099-kami-dev-menu.test.js`
