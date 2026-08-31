// engine/character/stickerPlacementMode.js — the pure state machine for the
// in-world sticker placement flow (enter mode → raycast aim → confirm/cancel).
// Pure, node-safe: the runtime feeds it hits + intents; it emits the next state
// and a draft placement the host turns into addSticker() + a kind-35100
// republish. No THREE, no DOM, no network — the raycast itself is injected.
//
// Design matches the gateway controllers (travelConfirm.cpp / portalTrigger):
// every transition returns a NEW immutable state, and nothing here performs an
// action — the highest-effort effect is a draft the host may or may not publish.

import { placementFromRaycastHit } from './stickerRaycast.js';
import { addSticker } from './stickerPlacement.js';
import { isSha256 } from './characterManifest.js';

export const STICKER_PLACEMENT_MODE_VERSION = 1;

// Placement-mode phases.
export const PLACEMENT_PHASE = Object.freeze({
  INACTIVE: 'inactive',
  AIMING: 'aiming',      // mode entered; no valid hit under the cursor yet
  PLACING: 'placing',    // a live hit resolved to a draft placement (ready to confirm)
  CONFIRMED: 'confirmed',// the host accepted the draft and published
  CANCELLED: 'cancelled',
});

// initialPlacementModeState() → a fresh state.
export function initialPlacementModeState() {
  return Object.freeze({ phase: PLACEMENT_PHASE.INACTIVE, draft: null, error: null });
}

// enterPlacementMode(state) → AIMING (clears any prior draft).
export function enterPlacementMode(state = initialPlacementModeState()) {
  return Object.freeze({ phase: PLACEMENT_PHASE.AIMING, draft: null, error: null });
}

// aimPlacement(state, hit, stickerHash) → PLACING (with a draft placement) when
// the hit resolves to a zone AND `stickerHash` is a valid sha256 (the selected
// sticker image from STICKER_LIBRARY). Otherwise stays AIMING with no draft.
// The raycast supplies position; the selected sticker supplies identity.
export function aimPlacement(state = initialPlacementModeState(), hit, stickerHash) {
  const base = Object.freeze({ phase: PLACEMENT_PHASE.AIMING, draft: null, error: null });
  const placement = placementFromRaycastHit(hit);
  if (!placement || !isSha256(stickerHash)) return base;
  const draft = Object.freeze({ hash: String(stickerHash).toLowerCase(), ...placement });
  return Object.freeze({ phase: PLACEMENT_PHASE.PLACING, draft, error: null });
}

// confirmPlacement(state) → CONFIRMED, carrying the current draft. A no-op
// (returns the state unchanged) when there is no draft to confirm.
export function confirmPlacement(state = initialPlacementModeState()) {
  const st = (state && typeof state === 'object') ? state : initialPlacementModeState();
  if (st.phase !== PLACEMENT_PHASE.PLACING || !st.draft) return Object.freeze({ ...st });
  return Object.freeze({
    phase: PLACEMENT_PHASE.CONFIRMED,
    draft: Object.freeze(st.draft),
    error: null,
  });
}

// cancelPlacement(state) → CANCELLED, dropping any draft.
export function cancelPlacement(state = initialPlacementModeState()) {
  return Object.freeze({ phase: PLACEMENT_PHASE.CANCELLED, draft: null, error: null });
}

// resetPlacementMode() → back to INACTIVE.
export function resetPlacementMode() {
  return initialPlacementModeState();
}

// placementBindsToManifest(state, manifest, addStickerFn) → the next manifest
// with the confirmed draft applied, or the input when there is no confirmed
// draft. `addStickerFn` defaults to the shared addSticker (injected for tests).
export function placementToManifest(state, manifest, addStickerFn = addSticker) {
  const st = (state && typeof state === 'object') ? state : {};
  if (st.phase !== PLACEMENT_PHASE.CONFIRMED || !st.draft) return manifest;
  const fn = typeof addStickerFn === 'function' ? addStickerFn : addSticker;
  return fn(manifest, st.draft);
}