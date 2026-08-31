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

// buildCharacterEvent(manifest, opts) → the UNSIGNED kind-35100 event for a
// manifest (the reverse of parseCharacterEvent). Tags are emitted in the same
// shape the parser reads back, so build→parse round-trips losslessly for every
// field the manifest carries. `opts.pubkey` (hex64) and `opts.createdAt` (unix
// seconds) are optional — the NIP-07 signer fills pubkey/sig/id, and created_at
// defaults to now. Pure; never throws on malformed input.
export function buildCharacterEvent(manifest, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const m = (manifest && typeof manifest === 'object') ? manifest : {};
  const tags = [['d', CHARACTER_D_TAG]];

  if (m.mesh && typeof m.mesh === 'object' && m.mesh.hash) {
    tags.push(['mesh', m.mesh.hash, m.mesh.name || '']);
  }
  for (const c of (Array.isArray(m.clips) ? m.clips : [])) {
    if (c && c.hash) tags.push(['clip', c.hash, c.name || '']);
  }
  for (const s of (Array.isArray(m.stickers) ? m.stickers : [])) {
    if (!s || !s.hash) continue;
    tags.push(['sticker', s.hash, s.zoneId || '', String(s.u ?? 0), String(s.v ?? 0), String(s.rot ?? 0)]);
  }
  if (typeof m.name === 'string' && m.name) tags.push(['name', m.name]);
  for (const c of (Array.isArray(m.colors) ? m.colors : [])) {
    if (c && c.slot) tags.push(['color', c.slot, c.hex || '']);
  }
  for (const c of (Array.isArray(m.contrib) ? m.contrib : [])) {
    if (!c || !c.nappletDTag) continue;
    tags.push(['contrib', c.nappletDTag, c.aggregateHash || '', ...(Array.isArray(c.tags) ? c.tags : [])]);
  }

  return {
    kind: CHARACTER_EVENT_KIND,
    created_at: Number.isFinite(o.createdAt) ? Math.floor(o.createdAt) : Math.floor(Date.now() / 1000),
    tags,
    content: '',
    pubkey: typeof o.pubkey === 'string' ? o.pubkey : '',
  };
}
