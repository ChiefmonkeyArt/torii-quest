// engine/character/characterEvent.js — parse a Nostr kind-35100 character event
// into a `torii.character` manifest. Pure, node-safe.
//
// This is the "smooth experience" seam: a player may already have a .glb
// attached to their npub (a signed character event on a relay). The Character
// Forge reads that event, extracts the manifest, and — if valid — skips the
// creation flow entirely and just seats the existing character. The player never
// knows a mesh was fetched and validated behind the scenes.

import { validateCharacterManifest, emptyCharacterManifest } from './characterManifest.js';

export const CHARACTER_EVENT_KIND = 35100;
export const CHARACTER_D_TAG = 'torii-character';

function _num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// parseCharacterEvent(event) → { manifest, valid, errors, pubkey } | null.
// Returns null when the event is not a Torii character event (wrong kind or
// missing the "torii-character" d tag). Otherwise returns the parsed manifest
// plus a validation verdict. Never throws on malformed input.
export function parseCharacterEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.kind !== CHARACTER_EVENT_KIND) return null;

  const tags = Array.isArray(event.tags) ? event.tags : [];
  const hasDTag = tags.some(
    (t) => Array.isArray(t) && t[0] === 'd' && t[1] === CHARACTER_D_TAG,
  );
  if (!hasDTag) return null;

  const manifest = emptyCharacterManifest();
  for (const t of tags) {
    if (!Array.isArray(t) || t.length < 2) continue;
    const name = t[0];
    const rest = t.slice(1);
    if (name === 'mesh') {
      manifest.mesh = { hash: rest[0] || '', name: rest[1] || '' };
    } else if (name === 'clip') {
      manifest.clips.push({ hash: rest[0] || '', name: rest[1] || '' });
    } else if (name === 'sticker') {
      manifest.stickers.push({
        hash: rest[0] || '',
        zoneId: rest[1] || '',
        u: _num(rest[2]),
        v: _num(rest[3]),
        rot: _num(rest[4]),
      });
    } else if (name === 'name') {
      manifest.name = rest[0] || '';
    } else if (name === 'color') {
      manifest.colors.push({ slot: rest[0] || '', hex: rest[1] || '' });
    } else if (name === 'contrib') {
      manifest.contrib.push({
        nappletDTag: rest[0] || '',
        aggregateHash: rest[1] || '',
        tags: rest.slice(2),
      });
    }
  }

  const { valid, errors } = validateCharacterManifest(manifest);
  return { manifest, valid, errors, pubkey: event.pubkey || null };
}

// hasCharacter(event) → boolean. Quick "is there a usable character attached"
// check — true only when the event parses AND carries a mesh hash.
export function hasCharacter(event) {
  const parsed = parseCharacterEvent(event);
  return !!(parsed && parsed.manifest && parsed.manifest.mesh && parsed.manifest.mesh.hash);
}
