// engine/character/stickerPlacement.js — the sticker-placement model for the
// Character Forge. Pure, node-safe (no THREE/Rapier/DOM).
//
// A sticker is a placed decal on a character's body: the Blossom content hash
// of the sticker image, the body ZONE it sits on, and the u/v/rot of the
// placement on that zone's surface. This module owns (1) the body-zone registry
// + bone→zone resolution — so a raycast hit against the player's own SkinnedMesh
// can be turned into a zone — and (2) the immutable manifest operations that
// add/remove/update stickers. It is the pure core of the sticker-placement UI
// slice: the runtime raycasts the mesh, calls resolveZoneFromBoneNames() for the
// zone, and addSticker() to persist the placement (the host then sign+publishes
// the kind-35100 event as usual).
//
// Deliberately NOT here: the 3D raycast itself, texture upload, and event
// signing/publishing — those are runtime/host concerns (see main.js + nostr.js).
// See nap-torii-avatar-v0.md + ADR-0084.

import { isSha256 } from './characterManifest.js';
import { mapBonesToRoles } from './skeleton.js';

export const STICKER_PLACEMENT_VERSION = 1;

// Max stickers per character — a hard cap to bound signed-event size (a
// kind-35100 event is signed + published; keep it compact).
export const MAX_STICKERS = 24;

// ── body-zone registry ──────────────────────────────────────────────────────
// A zone is a body region. Each maps a set of canonical skeleton roles (see
// skeleton.js) so a raycast hit resolving to any of those roles lands a sticker
// on that zone. Coarse on purpose: the exact u/v within the zone is captured
// separately, so the registry only needs to bucket body regions.
export const STICKER_ZONES = Object.freeze(
  [
    { id: 'head',       label: 'Head',       roles: ['Head'] },
    { id: 'neck',       label: 'Neck',       roles: ['Neck'] },
    { id: 'torso',      label: 'Torso',      roles: ['Spine', 'Spine1', 'Spine2'] },
    { id: 'pelvis',     label: 'Pelvis',     roles: ['Hips'] },
    { id: 'left-arm',   label: 'Left arm',   roles: ['LeftShoulder', 'LeftUpperArm', 'LeftLowerArm'] },
    { id: 'right-arm',  label: 'Right arm',  roles: ['RightShoulder', 'RightUpperArm', 'RightLowerArm'] },
    { id: 'left-hand',  label: 'Left hand',  roles: ['LeftHand'] },
    { id: 'right-hand', label: 'Right hand', roles: ['RightHand'] },
    { id: 'left-leg',   label: 'Left leg',   roles: ['LeftUpperLeg', 'LeftLowerLeg'] },
    { id: 'right-leg',  label: 'Right leg',  roles: ['RightUpperLeg', 'RightLowerLeg'] },
    { id: 'left-foot',  label: 'Left foot',  roles: ['LeftFoot', 'LeftToe'] },
    { id: 'right-foot', label: 'Right foot', roles: ['RightFoot', 'RightToe'] },
  ].map((z) => Object.freeze({ ...z, roles: Object.freeze(z.roles) })),
);

// Curated sticker library — the v1 zero-AI set. Each entry references a sticker
// IMAGE by Blossom sha256 (content-addressed). `recommendedZone` is the default
// body zone when a sticker is dropped without an explicit raycast hit.
export const STICKER_LIBRARY = Object.freeze([
  Object.freeze({
    id: 'ftff',
    label: 'Torii sticker',
    hash: 'cb321d5d47e5ba0ea4739123406e3bf060aac4ed3351d5ceecf1a63a1c309ae7',
    recommendedZone: 'torso',
  }),
]);

// role → zone lookup (built once; frozen inputs so this is stable).
const _roleToZone = {};
for (const z of STICKER_ZONES) {
  for (const r of z.roles) _roleToZone[r] = z.id;
}

// isKnownZone(zoneId) → boolean. Never throws.
export function isKnownZone(zoneId) {
  return typeof zoneId === 'string' && STICKER_ZONES.some((z) => z.id === zoneId);
}

// getStickerZone(zoneId) → the zone object, or null. Never throws.
export function getStickerZone(zoneId) {
  return (typeof zoneId === 'string' && STICKER_ZONES.find((z) => z.id === zoneId)) || null;
}

// resolveRoleZone(role) → the zone id for a canonical role, or null.
export function resolveRoleZone(role) {
  return (typeof role === 'string' && _roleToZone[role]) || null;
}

// resolveZoneFromRoles(roles) → the zone id for the first mappable role, or null.
export function resolveZoneFromRoles(roles) {
  if (!Array.isArray(roles)) return null;
  for (const r of roles) {
    const z = resolveRoleZone(r);
    if (z) return z;
  }
  return null;
}

// resolveZoneFromBoneNames(boneNames) → the zone for a bone list, or null.
// Maps bone names → canonical roles (skeleton.js) → zone. Returns null when no
// bone maps to a known zone (e.g. an unknown bone convention).
export function resolveZoneFromBoneNames(boneNames) {
  if (!Array.isArray(boneNames) || boneNames.length === 0) return null;
  const { mapped } = mapBonesToRoles(boneNames);
  return resolveZoneFromRoles(Object.keys(mapped));
}

// ── placement normalisation ─────────────────────────────────────────────────

// clamp to [0,1]; non-finite → the zone centre (0.5).
export function normalizeUv(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.min(1, Math.max(0, n));
}

const _TAU = Math.PI * 2;

// Normalise a rotation to [0, 2π). Non-finite → 0.
export function normalizeRotation(rot) {
  const n = Number(rot);
  if (!Number.isFinite(n)) return 0;
  return ((n % _TAU) + _TAU) % _TAU;
}

// normalizeStickerPlacement(placement) → a valid placement { hash, zoneId, u, v,
// rot } or null. Rejects a non-sha256 hash or an unknown zone; clamps u/v/rot.
export function normalizeStickerPlacement(placement) {
  const p = (placement && typeof placement === 'object') ? placement : {};
  if (!isSha256(p.hash)) return null;
  if (!isKnownZone(p.zoneId)) return null;
  return {
    hash: p.hash.toLowerCase(),
    zoneId: p.zoneId,
    u: normalizeUv(p.u),
    v: normalizeUv(p.v),
    rot: normalizeRotation(p.rot),
  };
}

// buildStickerPlacement(input) — alias for readability at the call site.
export function buildStickerPlacement(input) {
  return normalizeStickerPlacement(input);
}

// ── manifest operations (immutable) ────────────────────────────────────────

function _stickersOf(manifest) {
  return (manifest && Array.isArray(manifest.stickers)) ? manifest.stickers : [];
}

// addSticker(manifest, placement) → a NEW manifest with the sticker appended.
// The input manifest is never mutated. Returns the input unchanged when the
// placement is invalid, the manifest is not an object, or MAX_STICKERS was hit.
export function addSticker(manifest, placement) {
  const m = (manifest && typeof manifest === 'object') ? manifest : null;
  const norm = normalizeStickerPlacement(placement);
  if (!m || !norm) return m;
  const stickers = _stickersOf(m);
  if (stickers.length >= MAX_STICKERS) return m;
  return { ...m, stickers: [...stickers, norm] };
}

// removeSticker(manifest, index) → a NEW manifest without the sticker at
// `index`. Out-of-range index (or non-integer) returns the input unchanged.
export function removeSticker(manifest, index) {
  const m = (manifest && typeof manifest === 'object') ? manifest : null;
  if (!m) return null;
  const stickers = _stickersOf(m);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= stickers.length) return m;
  return { ...m, stickers: stickers.slice(0, i).concat(stickers.slice(i + 1)) };
}

// updateSticker(manifest, index, patch) → a NEW manifest with the sticker at
// `index` patched. Only the fields present in `patch` change (hash/zoneId are
// replaced verbatim and re-validated; u/v/rot are normalised). Invalid index or
// an invalid resulting placement returns the input unchanged.
export function updateSticker(manifest, index, patch) {
  const m = (manifest && typeof manifest === 'object') ? manifest : null;
  if (!m) return null;
  const stickers = _stickersOf(m);
  const i = Number(index);
  if (!Number.isInteger(i) || i < 0 || i >= stickers.length) return m;
  const p = (patch && typeof patch === 'object') ? patch : {};
  const existing = stickers[i];
  const merged = {
    hash: typeof p.hash === 'string' ? p.hash : existing.hash,
    zoneId: typeof p.zoneId === 'string' ? p.zoneId : existing.zoneId,
    u: (p.u !== undefined && p.u !== null) ? normalizeUv(p.u) : existing.u,
    v: (p.v !== undefined && p.v !== null) ? normalizeUv(p.v) : existing.v,
    rot: (p.rot !== undefined && p.rot !== null) ? normalizeRotation(p.rot) : existing.rot,
  };
  if (!isSha256(merged.hash) || !isKnownZone(merged.zoneId)) return m;
  const next = stickers.slice();
  next[i] = merged;
  return { ...m, stickers: next };
}

// countStickers(manifest) → the number of stickers (0 for a missing manifest).
export function countStickers(manifest) {
  return _stickersOf(manifest).length;
}