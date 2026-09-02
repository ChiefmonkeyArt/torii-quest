// engine/world/productPanelTrigger.js — PROXIMITY → INTERACT trigger for the
// in-world PRODUCT sign (ADR-0036). Mirrors gateway/portalTrigger.js's
// tick(playerPos)/interact() shape, minus the navigation-specific boundary —
// this trigger opens/closes the market panels, it never navigates anywhere.
//
// PURE + node-safe: no THREE/Rapier/DOM/window. Range check reuses the
// existing `withinPortalRange` scalar squared-distance helper (no
// Vector3/Matrix4 allocation — safe for the per-frame hot path).
//
// ADR-0036: the PRODUCT sign has stood in the NAP zone for weeks
// (`product-stall-panel` in proofSurfaceSpecs.js) as a display-only mesh with
// no interaction. This is the FIRST interaction wired to it: walk into range,
// a prompt appears, pressing the interact key opens the auction-panel + the
// three ADR-0035 boards together. Closing them is a separate explicit action
// (a close control on each panel) — this trigger's interact() only OPENS.

import { withinPortalRange } from '../gateway/gatewayPortalActivation.js';

export const PRODUCT_PANEL_PROMPT_TEXT = 'Press Q to view products';
const DEFAULT_TRIGGER_RANGE = 3;

// createProductPanelTrigger(opts) → an injectable, stateful proximity
// controller.
//
//   opts {
//     panelPos:   { x, y, z }   — world position of the PRODUCT sign (REQUIRED)
//     range:      number        — proximity radius (default 3)
//     onPrompt:   fn(show, text) — best-effort prompt sink (HUD)
//     onOpen:     fn()          — called once when the player interacts while in range
//     promptText: string        — overrides PRODUCT_PANEL_PROMPT_TEXT
//   }
//
// Returns:
//   tick(playerPos) → { inRange, changed } — call per frame; raises/clears the
//                      prompt ONLY on range transitions. Never opens anything.
//   interact()       → boolean — true if it opened (was in range), else false (no-op).
//   inRange()        → boolean
//   reset()          → clears range/prompt state without opening anything.
export function createProductPanelTrigger(opts = {}) {
  const o = (opts && typeof opts === 'object' && !Array.isArray(opts)) ? opts : {};
  const panelPos = (o.panelPos && typeof o.panelPos === 'object') ? o.panelPos : null;
  const r = Number(o.range);
  const range = r > 0 ? r : DEFAULT_TRIGGER_RANGE;
  const onPrompt = typeof o.onPrompt === 'function' ? o.onPrompt : null;
  const onOpen = typeof o.onOpen === 'function' ? o.onOpen : null;
  const promptText = typeof o.promptText === 'string' && o.promptText ? o.promptText : PRODUCT_PANEL_PROMPT_TEXT;

  let _inRange = false;

  function _emitPrompt(show) {
    if (onPrompt) {
      try { onPrompt(show, show ? promptText : ''); } catch { /* prompt sink is best-effort */ }
    }
  }

  function tick(playerPos) {
    if (!panelPos) return { inRange: false, changed: false };
    const nowIn = withinPortalRange(playerPos, panelPos, range);
    let changed = false;
    if (nowIn && !_inRange) {
      _inRange = true;
      changed = true;
      _emitPrompt(true);
    } else if (!nowIn && _inRange) {
      _inRange = false;
      changed = true;
      _emitPrompt(false);
    }
    return { inRange: _inRange, changed };
  }

  function interact() {
    if (!_inRange) return false;
    if (onOpen) { try { onOpen(); } catch { /* open sink is best-effort */ } }
    return true;
  }

  function inRange() { return _inRange; }

  function reset() {
    if (_inRange) _emitPrompt(false);
    _inRange = false;
  }

  return { tick, interact, inRange, reset, panelPos: () => panelPos, range: () => range };
}
