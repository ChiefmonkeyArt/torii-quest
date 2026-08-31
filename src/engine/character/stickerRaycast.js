// engine/character/stickerRaycast.js — turn a 3D raycast hit against the
// player's own character SkinnedMesh into a sticker placement (zone + u/v/rot).
// Pure, node-safe (no THREE: the runtime adapter — stickerStudio.js — extracts
// the hit fields it consumes here, so this conversion is fully unit-testable).
//
// This is the in-world half of ADR-0086: the sticky-skin system (stickerNpc.js)
// already raycasts an animated SkinnedMesh to an exact skin point; this module
// owns the step that turns that hit into a PERSISTENT placement the host feeds
// to addSticker() + the kind-35100 republish. The runtime still does the
// raycast + bone extraction (it needs THREE + the live skeleton); the durable,
// portable decision — which body ZONE, and the u/v/rot on it — lives here.

import { resolveZoneFromBoneNames, normalizeUv, normalizeRotation } from './stickerPlacement.js';

export const STICKER_RAYCAST_VERSION = 1;

// normalizeRaycastHit(hit) → a substrate-agnostic hit descriptor, or null.
// `boneNames` are the bones driving the skin at the hit face (the runtime reads
// skinIndex/skinWeight, as stickerNpc.js already does). `uv` is the geometry
// texture-UV at the hit (optional); `normal`/`point` are world-space vectors
// (optional). Rejects a hit with no bones (nothing to resolve a zone from).
export function normalizeRaycastHit(hit) {
  const h = (hit && typeof hit === 'object') ? hit : null;
  if (!h) return null;
  const boneNames = Array.isArray(h.boneNames) ? h.boneNames.map((n) => String(n)) : [];
  if (boneNames.length === 0) return null;
  const hasUv = h.uv && typeof h.uv === 'object'
    && Number.isFinite(h.uv.u) && Number.isFinite(h.uv.v);
  const hasNormal = h.normal && typeof h.normal === 'object' && Number.isFinite(h.normal.x);
  const hasPoint = h.point && typeof h.point === 'object' && Number.isFinite(h.point.x);
  return {
    boneNames,
    uv: hasUv ? { u: h.uv.u, v: h.uv.v } : null,
    normal: hasNormal ? { x: h.normal.x, y: h.normal.y, z: h.normal.z } : null,
    point: hasPoint ? { x: h.point.x, y: h.point.y, z: h.point.z } : null,
  };
}

// rotationFromNormal(normal, fallback) → the sticker's in-plane rotation
// (radians), the azimuth of the surface normal projected onto the XZ plane. This
// keeps a decal "upright" relative to the body so opposite sides of a limb do
// not read upside-down. A near-vertical (Y-axial) normal has no azimuth → the
// fallback (default 0). Always normalised to [0, 2π).
export function rotationFromNormal(normal, fallback = 0) {
  const n = (normal && typeof normal === 'object') ? normal : {};
  const x = Number(n.x) || 0;
  const z = Number(n.z) || 0;
  if (Math.abs(x) < 1e-6 && Math.abs(z) < 1e-6) return normalizeRotation(fallback);
  return normalizeRotation(Math.atan2(x, z));
}

// placementFromRaycastHit(hit) → { zoneId, u, v, rot } | null. The core
// raycast→placement conversion: zone from the hit's bones, u/v from the surface
// UV when present (zone centre 0.5 otherwise), rot from the surface normal.
// Returns null when the hit is empty or its bones map to no known zone.
export function placementFromRaycastHit(hit) {
  const h = normalizeRaycastHit(hit);
  if (!h) return null;
  const zoneId = resolveZoneFromBoneNames(h.boneNames);
  if (!zoneId) return null;
  return {
    zoneId,
    u: h.uv ? normalizeUv(h.uv.u) : 0.5,
    v: h.uv ? normalizeUv(h.uv.v) : 0.5,
    rot: rotationFromNormal(h.normal),
  };
}