// engine/gateway/portalTrigger.js — the in-world PROXIMITY → CONFIRM trigger that
// drives the v0.2.180 portal-activation boundary (GATEWAY / NAP-zone handoff,
// v0.2.181, LEAN-2 continuation). This is the seam a host ticks every frame with
// the player position: when the player walks INTO range of a gateway portal it
// ARMS the (inert) boundary and raises a prompt; when the player walks OUT it
// disarms and clears the prompt; an explicit `interact()` (a key press / click)
// is the ONLY thing that confirms and navigates.
//
// Constrained by construction:
//   - PROXIMITY NEVER NAVIGATES. `tick(playerPos)` only arms/cancels the injected
//     boundary (both inert) and fires the prompt callback on range transitions.
//     A real same-origin hop happens ONLY when `interact()` is called while armed,
//     which delegates to `boundary.confirm()` (the v0.2.180 explicit step → the
//     v0.2.178 confirmed === true gate). No auto-navigation on proximity alone.
//   - PURE + node-safe: no THREE/Rapier/DOM/window/fs/network. The boundary (which
//     holds the injected browser window) is INJECTED by the host; this module never
//     reaches for a global `window`/`document`/`location` and exposes no bare
//     navigate/open/reload/goto/assign/href/pushState method of its own.
//   - Range is a scalar squared-distance compare via `withinPortalRange` (NO
//     Vector3/Matrix4 allocation — safe for the per-frame hot path).
//   - All same-origin / allowlist / consent / confirmation guarantees are inherited
//     unchanged from the injected boundary; this module adds NO new capability.

import { withinPortalRange } from './gatewayPortalActivation.js';

// PORTAL_TRIGGER_VERSION — bumped when the trigger report/contract shape changes.
export const PORTAL_TRIGGER_VERSION = 1;

// Default prompt text raised when the player is in range of an armed portal. A
// dedicated interact key (KeyF) is used by the host so it never collides with
// movement/jump. Display-only — this module performs no input handling itself.
export const PORTAL_PROMPT_TEXT = 'Press F to travel';

// Default proximity radius (world units) — mirrors gatewayPortalActivation's
// DEFAULT_PORTAL_RANGE. A host may override per portal.
const DEFAULT_TRIGGER_RANGE = 3;

// createPortalTrigger(opts) → an injectable, stateful proximity→confirm controller.
// The portal-activation BOUNDARY (which captured the injected browser window once at
// its own construction) is injected here — this module never touches a window.
//
//   opts {
//     boundary:    createGatewayPortalBoundary(...) instance  (REQUIRED — the acting seam)
//     component:   the in-world gateway component to travel through (REQUIRED)
//     context:     { title, zoneType, from, origin }  — forwarded to arm/confirm
//     portalPos:   { x, y, z }  — world position of the portal (REQUIRED for range)
//     range:       number       — proximity radius (default 3)
//     onPrompt:    fn(show:boolean, text:string)  — best-effort prompt sink (HUD)
//     promptText:  string       — overrides PORTAL_PROMPT_TEXT
//   }
//
// Returns:
//   tick(playerPos)   → { inRange, armed, changed } — call per frame; arms on enter,
//                        cancels on leave, fires onPrompt ONLY on transitions. INERT.
//   interact(grant?)  → portal-activation report | null — the explicit acting step;
//                        confirms ONLY when armed, else returns null (no-op).
//   isArmed()         → boolean
//   inRange()         → boolean
//   promptShown()     → boolean
//   reset()           → clears range/prompt state and cancels the boundary (INERT)
//   portalPos()/range() → injected geometry (copies)
export function createPortalTrigger(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const boundary = o.boundary || null;
  const component = o.component || null;
  const context = (o.context && typeof o.context === 'object' && !Array.isArray(o.context)) ? o.context : {};
  const portalPos = (o.portalPos && typeof o.portalPos === 'object') ? o.portalPos : null;
  const r = Number(o.range);
  const range = r > 0 ? r : DEFAULT_TRIGGER_RANGE;
  const onPrompt = typeof o.onPrompt === 'function' ? o.onPrompt : null;
  const promptText = typeof o.promptText === 'string' && o.promptText ? o.promptText : PORTAL_PROMPT_TEXT;

  let inRange = false;
  let promptShown = false;

  function _emitPrompt(show) {
    promptShown = show;
    if (onPrompt) {
      try { onPrompt(show, show ? promptText : ''); } catch { /* prompt sink is best-effort */ }
    }
  }

  // tick(playerPos) — call per frame. Pure of navigation: it only arms/cancels the
  // injected boundary (both inert) and toggles the prompt on RANGE TRANSITIONS, so
  // re-entering an already-in-range state does not re-arm or re-fire the prompt.
  function tick(playerPos) {
    if (!boundary || !component || !portalPos) {
      return { inRange: false, armed: false, changed: false };
    }
    const nowIn = withinPortalRange(playerPos, portalPos, range);
    let changed = false;
    if (nowIn && !inRange) {
      // Entered range: ARM (inert — never navigates) + raise the prompt.
      boundary.arm(component, context);
      inRange = true;
      changed = true;
      _emitPrompt(true);
    } else if (!nowIn && inRange) {
      // Left range: cancel the staged portal (inert) + clear the prompt.
      boundary.cancel();
      inRange = false;
      changed = true;
      _emitPrompt(false);
    }
    return { inRange, armed: boundary.armed(), changed };
  }

  // interact(grant) — the EXPLICIT confirm step (host calls on a key press / click).
  // Acts ONLY when the boundary is armed; otherwise a safe no-op returning null. On a
  // real confirm it clears the prompt (the staged portal is consumed) and returns the
  // portal-activation report.
  function interact(grant = true) {
    if (!boundary || !boundary.armed()) return null;
    const rep = boundary.confirm(grant);
    _emitPrompt(false);
    inRange = false;
    return rep;
  }

  // reset() — clears local range/prompt state and cancels any staged portal (inert).
  // For pause / leave-playing transitions so a stale prompt never lingers.
  function reset() {
    if (boundary && boundary.armed()) boundary.cancel();
    inRange = false;
    if (promptShown) _emitPrompt(false);
  }

  return {
    tick,
    interact,
    isArmed: () => !!boundary && boundary.armed(),
    inRange: () => inRange,
    promptShown: () => promptShown,
    reset,
    portalPos: () => (portalPos ? { x: portalPos.x, y: portalPos.y, z: portalPos.z } : null),
    range: () => range,
  };
}
