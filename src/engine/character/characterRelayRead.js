// engine/character/characterRelayRead.js — READ-ONLY kind-35100 character relay
// read (the "smooth experience" seam, live). Proves the READ path for a player's
// existing character: given relay events a host's read-only transport WOULD
// return, it builds the character filter, parses each event via
// characterEvent.parseCharacterEvent, selects the newest character per author, and
// returns a read-only report.
//
// Pure + node-safe: NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// publishing, NO key handling, NO NIP-07, NO DOM, NO network, NO auto-connect.
// This module NEVER opens a socket and exposes NO publish/sign/send/connect
// surface — it only consumes events handed to it (a relayRead `read()` result, a
// bare event array, or deterministic local sample data). Every helper degrades
// safely on malformed input and never throws on event data.

import { normalizeRelayEvent, validateRelayEvent } from '../nostr/relayRead.js';
import { parseCharacterEvent, CHARACTER_EVENT_KIND, CHARACTER_D_TAG } from './characterEvent.js';

function _isInt(v) { return Number.isInteger(v); }
function _isNonNegInt(v) { return _isInt(v) && v >= 0; }

// buildCharacterFilter({ authors, since, until, limit }) → a NIP-01 filter that
// selects kind-35100 character events carrying the `torii-character` d tag. Pure:
// optional `authors` (hex pubkeys), `since`/`until` (unix seconds), and `limit`
// (transport hint) are only included when well-formed, so a bad option is dropped
// rather than producing a malformed filter. Never throws.
export function buildCharacterFilter({ authors = null, since = null, until = null, limit = null } = {}) {
  const filter = {
    kinds: [CHARACTER_EVENT_KIND],
    '#d': [CHARACTER_D_TAG],
  };
  if (Array.isArray(authors)) {
    const clean = authors.filter((a) => typeof a === 'string' && a !== '');
    if (clean.length > 0) filter.authors = clean;
  }
  if (_isInt(since)) filter.since = since;
  if (_isInt(until)) filter.until = until;
  if (_isNonNegInt(limit)) filter.limit = limit;
  return filter;
}

function _toEventArray(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && Array.isArray(input.events)) return input.events;
  return null;
}

// readCharacters(input, options) → a read-only character report:
//
//   {
//     ok:          boolean,     // false only on an unusable input shape
//     filter:      { kinds:[35100], '#d':['torii-character'], … },
//     count:       number,      // newest characters returned
//     characters:  [entry],     // { pubkey, created_at, manifest, valid, errors }
//     skipped:     [{ event, errors }],
//     duplicates:  number,      // superseded replaceable characters dropped
//     signed:      false,       // ALWAYS — this module never signs
//     published:   false,       // ALWAYS — this module never publishes
//     readOnly:    true,
//     errors:      [string],
//   }
//
// `input` is whatever an injected read-only transport produced. Each event is
// normalised (relayRead.normalizeRelayEvent) → structurally validated
// (relayRead.validateRelayEvent) → character-parsed (characterEvent.parseCharacterEvent);
// failures land in `skipped`. Survivors are reduced to the newest character per
// author (kind 35100 is parameterized-replaceable). A parsed-but-invalid character
// (e.g. a character event with no mesh) is KEPT with `valid:false` so the caller
// can distinguish "has a character" from "has a broken character". NEVER signs,
// publishes, fetches, opens a socket, or throws on event data.
export function readCharacters(input, options = {}) {
  const filter = buildCharacterFilter(options);
  const result = {
    ok: true,
    filter,
    count: 0,
    characters: [],
    skipped: [],
    duplicates: 0,
    signed: false,
    published: false,
    readOnly: true,
    errors: [],
  };

  const rawEvents = _toEventArray(input);
  if (rawEvents == null) {
    result.ok = false;
    result.errors.push('input must be a relayRead result, an events array, or { events }');
    return result;
  }

  const extracted = [];
  for (const item of rawEvents) {
    const event = normalizeRelayEvent(item);
    if (event == null) {
      result.skipped.push({ event: item, errors: ['not an event object'] });
      continue;
    }
    const struct = validateRelayEvent(event);
    if (!struct.valid) {
      result.skipped.push({ event, errors: struct.errors });
      continue;
    }
    const parsed = parseCharacterEvent(event);
    if (parsed == null) {
      result.skipped.push({ event, errors: ['not a torii-character event'] });
      continue;
    }
    extracted.push({
      pubkey: event.pubkey,
      created_at: _isInt(event.created_at) ? event.created_at : null,
      manifest: parsed.manifest,
      valid: parsed.valid,
      errors: parsed.errors,
    });
  }

  // Newest per author (parameterized-replaceable: one current character per npub).
  const byKey = new Map();
  let dropped = 0;
  for (const c of extracted) {
    const key = c.pubkey || '';
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, c); continue; }
    dropped += 1;
    const prevAt = _isInt(prev.created_at) ? prev.created_at : -1;
    const curAt = _isInt(c.created_at) ? c.created_at : -1;
    if (curAt > prevAt) byKey.set(key, c);
  }

  result.duplicates = dropped;
  result.characters = [...byKey.values()];
  result.count = result.characters.length;
  return result;
}

// findCharacterFor(readResult, pubkey) → the character entry for a pubkey, or null.
// Convenience over a readCharacters() report. Pure, never throws.
export function findCharacterFor(readResult, pubkey) {
  if (!readResult || !Array.isArray(readResult.characters)) return null;
  const pk = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : '';
  if (!pk) return null;
  return readResult.characters.find((c) => c && c.pubkey === pk) || null;
}
