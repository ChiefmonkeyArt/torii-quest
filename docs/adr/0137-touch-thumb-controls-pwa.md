# ADR-0137: Touch thumb controls + installable PWA

- **Status:** Accepted
- **Date:** 2026-10-20
- **Deciders:** chiefmonkey ("make a PWA that I can enter Torii Quest with as a guest and walk around… thumb slide controls on the screen to emulate the wasd keys and mouse control").
- **Builds on:** ADR-0027/0029 (input suppression), ADR-0051 (yaw wrap). Points and combat unchanged.

## Context

On a phone Quest loaded, but there was no keyboard and no pointer lock: the
player could not walk or look. The page had a service worker but no web app
manifest, so it could not be installed to the home screen.

## Decision

1. **`src/engine/input/touchControls.js`**: an overlay shown only while PLAYING, on coarse-pointer devices (`?touch=1` / `?touch=0` force it on/off).
   - **Left 45 %**: a floating joystick. The stick centres where the thumb lands. Sliding emits synthetic `keydown`/`keyup` for W/A/S/D in 8 sectors, with a 22 % dead zone. Every existing key consumer works unchanged.
   - **Right 55 %**: a look pad. Thumb travel goes through `input.applyLookDelta` (0.0058 rad/px), using the same yaw/pitch accumulator and clamp as mouse-look.
   - **Buttons**: FIRE (`input.triggerShoot`), JUMP (Space) and II (Escape, which opens the normal pause overlay).
   - The overlay uses z-index 30: above the HUD, below panels (40+), pause (60) and menus.
   - Pointer Events use `touch-action:none` and `preventDefault`, so there is no compatibility mousedown and no stray shots.
   - The overlay polls visibility every 150 ms; it does no per-frame work. Held keys are released when the overlay hides.
2. **`src/input.js`**: adds `applyLookDelta()` and `triggerShoot()`.
   - `applyLookDelta()` is gated on PLAYING and on full input suppression; it does not need pointer lock.
   - `triggerShoot()` keeps the same ADR-0027/0029 gates as left-click; mousedown now calls it.
3. **PWA**: `public/manifest.webmanifest` declares a fullscreen, landscape app.
   - `start_url` and `scope` are relative, so the app works under `/quest/` or at the root.
   - Icons: 192, 512 and maskable 512 PNGs rendered from `favicon.svg`.
   - `index.html` links the manifest and adds theme-color, Apple standalone meta tags and `viewport-fit=cover`.

## Consequences

- Phones can install Quest, enter as a guest from the title screen, then walk, look, jump and fire.
- Desktop behaviour is unchanged.
- Not yet verified on real devices: look sensitivity, and how iOS Safari handles fullscreen.

## Addendum (v0.2.920-alpha): contextual USE button

- A fourth button, **USE**, sends `KeyQ`, so every Q consumer works unchanged on touch.
- It appears only while `useLabel()` returns a label. At the NAP market boards that is **VIEW** when the player is within range of the PRODUCT or AUCTION board, and **CLOSE** while their panels are open.
- It sits above FIRE and is orange, so it reads as an action, not a weapon.
- The label is polled on the overlay's existing 150 ms visibility timer: no per-frame work and no new timers.
- On touch devices, the board prompts say "Tap VIEW …" instead of "Press Q …".
