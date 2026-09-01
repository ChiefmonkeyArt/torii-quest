// engine/character/stickerLibrary.js — content-addressed sticker library
// (ADR-0090 slice 1). Pure, node-safe (no THREE/DOM/nostr signing).
//
// Stickers stop being a single hardcoded PNG and become content-addressed
// images: an image uploaded to Blossom (sha256) and described by a
// `torii.asset`-shaped Nostr metadata event carrying a sticker `type`. This
// module owns the pure seams of that library: (1) turn a sticker hash into a
// fetchable Blossom URL, (2) parse a sticker metadata manifest into a library
// entry, and (3) merge UGC entries into the seed library. The seed `ftff`
// entry in stickerPlacement.js stays first and unchanged, so the default fire
// behaviour is preserved.
//
// Deliberately NOT here: the upload round-trip, the metadata-event fetch, and
// event signing/publishing — those are runtime/host concerns (nostr.js +
// main.js). The 3D raycast/attach lives in stickerRaycast.js / stickerNpc.js.
// See ADR-0090 + the Digital Assets section of torii-quest-strategy.md.

import { isSha256 } from './characterManifest.js';
import { isKnownZone } from './stickerPlacement.js';

export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

// The `torii.asset` "type" value that marks a sticker image. ADR-0090 chose to
// extend `torii.asset` (rather than invent a new asset kind); this string fixes
// the sticker type at implementation time.
export const STICKER_ASSET_TYPE = 'image/sticker';

// stickerImageUrl(hash, server) → `https://<server>/<hash>`, or null when the
// hash is not a valid sha256 or the server is not https. Mirrors
// characterMesh.js's blossomMeshUrl — the same content-addressing contract,
// applied to sticker images instead of meshes.
export function stickerImageUrl(hash, server = DEFAULT_BLOSSOM_SERVER) {
  if (!isSha256(hash)) return null;
  const base = typeof server === 'string' ? server.trim().replace(/\/+$/, '') : '';
  if (!/^https:\/\//i.test(base)) return null;
  return `${base}/${hash}`;
}

// isStickerAsset(manifest) → boolean. A `torii.asset` manifest describes a
// sticker when it carries the sticker type.
export function isStickerAsset(manifest) {
  const m = (manifest && typeof manifest === 'object') ? manifest : {};
  return m.type === STICKER_ASSET_TYPE;
}

// parseStickerAssetManifest(manifest) → a library entry
// `{ id, label, hash, recommendedZone }`, or null when the manifest is not a
// valid sticker asset. `id` is the content hash (content-addressed identity, so
// two uploads of the same image collapse to one entry). Never throws.
export function parseStickerAssetManifest(manifest) {
  const m = (manifest && typeof manifest === 'object') ? manifest : {};
  if (!isStickerAsset(m)) return null;
  if (!isSha256(m.hash)) return null;
  const label = (typeof m.name === 'string' && m.name.trim()) ? m.name.trim() : null;
  if (!label) return null;
  const recommendedZone = isKnownZone(m.recommendedZone) ? m.recommendedZone : 'torso';
  return Object.freeze({
    id: m.hash,
    label,
    hash: m.hash,
    recommendedZone,
  });
}

// mergeStickerLibrary(library, entry) → a NEW frozen array with `entry`
// appended, or the original `library` array untouched when `entry` is invalid
// or a duplicate (same content hash). Seed entries stay first and unchanged.
export function mergeStickerLibrary(library, entry) {
  const lib = Array.isArray(library) ? library : [];
  if (!entry || !isSha256(entry.hash) || !entry.label) return lib;
  if (lib.some((s) => s && s.hash === entry.hash)) return lib; // dedupe by hash
  return Object.freeze([...lib, Object.freeze({
    id: entry.hash,
    label: entry.label,
    hash: entry.hash,
    recommendedZone: isKnownZone(entry.recommendedZone) ? entry.recommendedZone : 'torso',
  })]);
}