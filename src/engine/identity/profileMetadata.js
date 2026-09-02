// engine/identity/profileMetadata.js — Phase 0g kind:0 (NIP-01 user metadata)
// UNSIGNED event builder for the Profile settings tab. PURE + node-safe: NO
// DOM, NO WebSocket, NO fetch, NO NIP-07 reach — mirrors
// engine/gateway/worldPresence.js's buildPresenceEvent shape exactly (same
// validate-then-build contract, same "BUILD produces unsigned, host signs"
// division of responsibility).
//
// Constrained by construction:
//   - BUILD ONLY: buildProfileMetadataEvent produces an UNSIGNED kind:0
//     event template. The host's NIP-07 signEvent (nostr.js) adds id+sig.
//     This module never signs or publishes anything itself.
//   - Standard NIP-01 kind:0 fields only: name, about, picture, nip05,
//     website, lud16 (Lightning address) — the common profile fields most
//     Nostr clients read, matching what the "standard nostr profile" fields
//     request called for (display name + bio, plus the other conventional
//     kind:0 keys so a Torii-published profile renders sanely elsewhere).
//   - Every field is optional; an all-blank input still produces a valid
//     (empty-content-object) event rather than erroring, so a user can
//     clear their profile by saving blank fields.

const HEX64 = /^[0-9a-f]{64}$/;
function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// _safeHttps(raw) → an https URL string or null. Pure, never throws. Mirrors
// worldPresence._safeHttps / nostr.js's _safeImageUrl (https-only avatars —
// no javascript:/data: smuggling into an eventual <img src>).
function _safeHttps(raw) {
  if (typeof raw !== 'string' || raw.trim() === '' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw.trim()); } catch { return null; }
  return u.protocol === 'https:' ? u.href : null;
}

// _cleanText(raw, maxLen) → trimmed, control-char-stripped text capped at
// maxLen, or '' for blank/invalid input. Mirrors nostr.js's _safeName
// control-char stripping so a hostile/pasted value can't smuggle NUL/CR/LF
// into stored profile content.
function _cleanText(raw, maxLen) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

// _cleanNip05(raw) → a loosely-validated NIP-05 identifier (local@domain
// shape) or ''. Not a full RFC-5322 validator — just enough shape-checking
// to reject obvious garbage before it's stored/published. Pure.
function _cleanNip05(raw) {
  const v = _cleanText(raw, 256);
  if (!v) return '';
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : '';
}

// _cleanLud16(raw) → a loosely-validated Lightning address (same local@domain
// shape as NIP-05/email) or ''. Pure.
function _cleanLud16(raw) {
  return _cleanNip05(raw);
}

// buildProfileMetadataEvent(input) → an UNSIGNED kind:0 event template ready
// for NIP-07 signEvent. `input.pubkey` (hex64) is required so the caller can
// verify identity before signing; everything else is optional and degrades
// to '' / omitted. Returns { ok, event, errors }. Pure; never throws.
export function buildProfileMetadataEvent(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const errors = [];
  const pubkey = typeof i.pubkey === 'string' ? i.pubkey.trim() : '';
  if (!_isHex64(pubkey)) errors.push('pubkey must be a 64-char hex string');
  if (errors.length) return { ok: false, event: null, errors };

  const name = _cleanText(i.name, 64);
  const displayName = _cleanText(i.displayName, 64);
  const about = _cleanText(i.about, 512);
  const picture = _safeHttps(i.picture);
  const website = _safeHttps(i.website);
  const nip05 = _cleanNip05(i.nip05);
  const lud16 = _cleanLud16(i.lud16);

  const content = {};
  if (name) content.name = name;
  if (displayName) content.display_name = displayName;
  if (about) content.about = about;
  if (picture) content.picture = picture;
  if (website) content.website = website;
  if (nip05) content.nip05 = nip05;
  if (lud16) content.lud16 = lud16;

  return {
    ok: true,
    event: {
      kind: 0,
      pubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [],
      content: JSON.stringify(content),
    },
    errors: [],
  };
}
