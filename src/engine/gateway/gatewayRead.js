// engine/gateway/gatewayRead.js — READ-ONLY gateway destination relay-read PROOF
// (GATEWAY / NAP-zone handoff, v0.2.164). Proves the READ path for a future
// world-registry / gateway destination record: given relay events a host's
// read-only transport WOULD return, it builds the gateway-destination filter,
// extracts + sanitises each record into a safe travel-preview model, selects the
// newest valid record per addressable zone, and returns a read-only report a host
// could SHOW before a player chooses to travel. It NEVER navigates.
//
// Pure + node-safe: NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// publishing, NO key handling, NO NIP-07, NO DOM, NO network, NO auto-connect, NO
// navigation. This module NEVER opens a socket and exposes NO publish/sign/send/
// connect/navigate surface — it only consumes events handed to it (a v0.2.159
// relayRead `read()` result, a bare event array, { events }, or deterministic local
// sample data) and shapes them into a sanitised destination preview. Any website /
// banner URL is validated https-only and kept as an INERT data string; any relay
// url is validated ws/wss-only — there is NO DOM assignment and NO navigation here.
// Every helper degrades safely on malformed input and never throws on event data.

import { normalizeRelayEvent, validateRelayEvent, validateRelayUrl } from '../nostr/relayRead.js';
import { safeProfileUrl, shortPubkey } from '../nostr/profileRead.js';
import { looksLikeNpub } from './travelIntent.js';

// NIP-78 application-data kind. The Torii world-registry / gateway descriptor is an
// addressable (parameterised-replaceable) event — its `d` tag is the zone id, so the
// newest event per (author + zone) is the current destination record. GATEWAY_PROTOCOL
// §2 leaves the registry kind TBD; 30078 (NIP-78 app data) is the read-proof choice.
export const GATEWAY_KIND = 30078;

// The discovery topic tag a gateway destination record carries so readers can find
// it across shared relays (mirrors the leaderboard's `['t','torii-quest']` pattern).
export const GATEWAY_TOPIC = 'torii-gateway';

// The destination-record fields this module surfaces into the travel-preview model.
export const GATEWAY_FIELDS = Object.freeze([
  'zoneId', 'title', 'description', 'zoneType', 'npub', 'pubkey', 'website',
  'banner', 'relays', 'topics', 'wsEndpoint', 'created_at', 'trust',
]);

// _safeWssRead(raw) → a wss URL string or null. Read-side counterpart to the
// worldPresence _safeWss builder. Kept local to avoid a cross-module dependency
// (the read graph stays leaf-pure by convention).
function _safeWssRead(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'wss:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

// The zoneType vocabulary mirrors travelIntent §4 (nap/arena/shop/gallery). An
// unknown/absent type degrades to null rather than being trusted.
const ZONE_TYPES = Object.freeze(['nap', 'arena', 'shop', 'gallery']);

const HEX64 = /^[0-9a-f]{64}$/;
function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
function _isInt(v) { return Number.isInteger(v); }
function _isNonNegInt(v) { return _isInt(v) && v >= 0; }

// Control chars (C0 + DEL) and HTML angle brackets are stripped from every text
// field — a relay record is attacker-controlled, so no control byte or markup
// fragment is ever carried into the preview model. Escapes (not raw bytes) keep the
// source safe to edit. Defined once and reused.
const UNSAFE_TEXT = /[\x00-\x1f\x7f<>]/g;

// _safeText(raw, maxLen) → a trimmed, control/markup-stripped, length-capped string,
// or null when absent/blank/non-string. Pure, never throws. Spaces and digits are
// preserved; only control chars and angle brackets are removed.
function _safeText(raw, maxLen = 256) {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(UNSAFE_TEXT, '').trim();
  if (clean === '') return null;
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

// _safeZoneType(raw) → a known zone type, or null. Pure.
function _safeZoneType(raw) {
  return typeof raw === 'string' && ZONE_TYPES.includes(raw) ? raw : null;
}

// _safeRelays(raw) → a deduped array of validated ws/wss relay urls (capped), or [].
// Pure, never throws. Each candidate is run through relayRead.validateRelayUrl so a
// hostile relay string (credentials, non-ws scheme, relative) can never enter the
// preview. Accepts an array or a single string.
function _safeRelays(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  const out = [];
  for (const r of list) {
    const { valid, url } = validateRelayUrl(r);
    if (valid && url && !out.includes(url)) out.push(url);
    if (out.length >= 16) break;
  }
  return out;
}

// _safeTopics(raw) → a deduped array of clean topic labels (capped), or []. Pure.
function _safeTopics(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const t of list) {
    const clean = _safeText(t, 64);
    if (clean && !out.includes(clean)) out.push(clean);
    if (out.length >= 16) break;
  }
  return out;
}

// buildGatewayFilter({ authors, since, until, limit }) → a NIP-01 filter that selects
// gateway destination records (kind 30078 + the torii-gateway topic tag). Pure:
// optional `authors` (hex pubkeys), `since`/`until` (unix seconds) and `limit`
// (transport hint) are only included when well-formed, so a bad option is dropped
// rather than producing a malformed filter. Never throws.
export function buildGatewayFilter({ authors = null, since = null, until = null, limit = null } = {}) {
  const filter = {
    kinds: [GATEWAY_KIND],
    '#t': [GATEWAY_TOPIC],
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

// _tagValue(tags, name) → the value of the first matching tag, or undefined. Pure.
function _tagValue(tags, name) {
  if (!Array.isArray(tags)) return undefined;
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === name) return t[1];
  }
  return undefined;
}

// _tagValues(tags, name) → all values for a repeated tag (e.g. relay/topic). Pure.
function _tagValues(tags, name) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const t of tags) {
    if (Array.isArray(t) && t[0] === name && t[1] != null) out.push(t[1]);
  }
  return out;
}

// extractGatewayFromEvent(event) → { ok, gateway?|errors? }. Pure, never throws.
// Takes a NORMALISED gateway event and reconstructs a sanitised travel-preview model.
// The authoritative descriptor comes from the JSON `content`; indexable tags are a
// fallback for any field missing from content. The zone id is anchored to the
// addressable `d` tag (falls back to content.zoneId). Rejects non-gateway kinds and
// records with no usable zone id. ALL text is control/markup-stripped, the website is
// https-only, relays are ws/wss-only — a hostile record degrades, never escapes.
export function extractGatewayFromEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: ['event must be an object'] };
  }
  if (event.kind !== GATEWAY_KIND) {
    return { ok: false, errors: [`event kind must be ${GATEWAY_KIND}`] };
  }

  let content = {};
  if (typeof event.content === 'string' && event.content !== '') {
    try {
      const parsed = JSON.parse(event.content);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) content = parsed;
    } catch {
      // Malformed JSON content → fall back to tags only.
    }
  }

  const tags = Array.isArray(event.tags) ? event.tags : [];
  const dTag = _tagValue(tags, 'd');

  const zoneId = _safeText(
    content.zoneId != null && content.zoneId !== '' ? String(content.zoneId)
      : (dTag != null ? String(dTag) : null),
    128,
  );
  if (zoneId == null) {
    return { ok: false, errors: ['gateway record must have a zone id (d tag or content.zoneId)'] };
  }

  // npub is advisory display data; pubkey is the authoritative signer identity.
  const npubRaw = typeof content.npub === 'string' ? content.npub : _tagValue(tags, 'npub');
  const npub = looksLikeNpub(npubRaw) ? npubRaw : null;
  const pubkey = _isHex64(event.pubkey) ? event.pubkey : null;

  const relays = _safeRelays(
    Array.isArray(content.relays) ? content.relays : _tagValues(tags, 'relay'),
  );
  const topics = _safeTopics(
    Array.isArray(content.topics) && content.topics.length > 0 ? content.topics : _tagValues(tags, 't'),
  );

  const gateway = {
    zoneId,
    title: _safeText(content.title != null ? content.title : (content.name != null ? content.name : _tagValue(tags, 'title')), 128),
    description: _safeText(content.description != null ? content.description : content.about, 512),
    zoneType: _safeZoneType(content.zoneType != null ? content.zoneType : _tagValue(tags, 'zoneType')),
    npub,
    pubkey,
    shortPubkey: pubkey ? shortPubkey(pubkey) : '',
    website: safeProfileUrl(content.website),
    banner: safeProfileUrl(content.banner != null ? content.banner : content.picture),
    relays,
    topics,
    // MP-1: optional multiplayer WebSocket endpoint. Reader picks from tag first,
    // then content — content is attacker-controlled JSON so tag takes precedence.
    wsEndpoint: _safeWssRead(_tagValue(tags, 'ws')) || _safeWssRead(content.wsEndpoint),
    created_at: _isInt(event.created_at) ? event.created_at : null,
    // A read record is never crypto-verified here, so it is surfaced as unverified.
    trust: 'unverified',
  };
  return { ok: true, gateway };
}

// _addressKey(gateway) → the dedup key for an addressable gateway record: the signing
// pubkey + zone id. Newest created_at wins per key (NIP-01 parameterised-replaceable
// semantics). Pure.
function _addressKey(gateway) {
  return `${gateway.pubkey || ''}:${gateway.zoneId == null ? '' : gateway.zoneId}`;
}

// dedupeGateways(gateways) → { gateways, dropped }. Pure, never throws. Keeps the
// newest record (highest created_at; ties keep the first seen) per address key so a
// replaced destination does not appear twice. Returns the survivors and the count of
// superseded duplicates dropped.
export function dedupeGateways(gateways = []) {
  const list = Array.isArray(gateways) ? gateways : [];
  const byKey = new Map();
  let dropped = 0;
  for (const g of list) {
    const key = _addressKey(g);
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, g); continue; }
    dropped += 1;
    const prevAt = _isInt(prev.created_at) ? prev.created_at : -1;
    const curAt = _isInt(g.created_at) ? g.created_at : -1;
    if (curAt > prevAt) byKey.set(key, g); // newer replaces older
  }
  return { gateways: [...byKey.values()], dropped };
}

// _toEventArray(input) → an array of raw events from any accepted shape, or null.
// Accepts a relayRead read() result ({ events }), a bare array, or null/garbage. Pure.
function _toEventArray(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && Array.isArray(input.events)) return input.events;
  return null;
}

// readGateways(input, options) → a read-only gateway destination report:
//
//   {
//     ok:         boolean,            // false only on an unusable input shape
//     filter:     { kinds, '#t', … }, // the gateway filter these events answer
//     count:      number,             // destination records returned
//     gateways:   [preview-model],    // sanitised, newest-per-zone travel previews
//     skipped:    [{ event, errors }],// events that failed normalise/validate/extract
//     duplicates: number,            // superseded addressable duplicates dropped
//     navigated:  false,             // ALWAYS — this module never navigates
//     signed:     false,             // ALWAYS — this module never signs
//     published:  false,             // ALWAYS — this module never publishes
//     performed:  false,             // ALWAYS — this module never acts
//     readOnly:   true,
//     errors:     [string],          // input-shape problems (never event data)
//   }
//
// `input` is whatever an injected read-only transport produced: a v0.2.159 relayRead
// `read()` result, a bare array of relay events, { events }, or local sample data.
// Each event is normalised → structurally validated → gateway-extracted; failures
// land in `skipped`. Survivors are reduced to the newest record per addressable zone.
// NEVER navigates, signs, publishes, fetches, opens a socket, or throws on event data
// — an unusable top-level shape degrades to ok:false with an empty destination list.
export function readGateways(input, options = {}) {
  const filter = buildGatewayFilter(options);
  const result = {
    ok: true,
    filter,
    count: 0,
    gateways: [],
    skipped: [],
    duplicates: 0,
    navigated: false,
    signed: false,
    published: false,
    performed: false,
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
    const ex = extractGatewayFromEvent(event);
    if (!ex.ok) {
      result.skipped.push({ event, errors: ex.errors });
      continue;
    }
    extracted.push(ex.gateway);
  }

  const { gateways, dropped } = dedupeGateways(extracted);
  result.duplicates = dropped;
  result.gateways = gateways;
  result.count = gateways.length;
  return result;
}

// DEMO_GATEWAY_EVENTS — a frozen, deterministic sample the debug shell renders. Two
// records for the same zone from one author (older is superseded → 1 duplicate) plus
// a second zone, so the shell shows dedupe + the preview model on inert local data.
export const DEMO_GATEWAY_EVENTS = Object.freeze([
  {
    id: 'a'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: GATEWAY_KIND,
    created_at: 1_700_000_200,
    tags: [['d', 'nap-garden'], ['t', GATEWAY_TOPIC]],
    content: JSON.stringify({
      zoneId: 'nap-garden',
      title: 'The Nap Garden',
      description: 'A quiet NAP zone to rest between arenas.',
      zoneType: 'nap',
      npub: 'npub1chiefmonkeyexampledestinationrecord00000000000000',
      website: 'https://torii-quest.pplx.app/nap-garden',
      relays: ['wss://relay.example.com', 'wss://relay.example.com'],
      topics: [GATEWAY_TOPIC, 'nap'],
    }),
    sig: 'c'.repeat(128),
  },
  {
    id: 'd'.repeat(64),
    pubkey: 'b'.repeat(64),
    kind: GATEWAY_KIND,
    created_at: 1_700_000_100, // older → superseded by the record above
    tags: [['d', 'nap-garden'], ['t', GATEWAY_TOPIC]],
    content: JSON.stringify({ zoneId: 'nap-garden', title: 'Nap Garden (old)', zoneType: 'nap' }),
    sig: 'e'.repeat(128),
  },
  {
    id: 'f'.repeat(64),
    pubkey: '9'.repeat(64),
    kind: GATEWAY_KIND,
    created_at: 1_700_000_300,
    tags: [['d', 'arena-prime'], ['t', GATEWAY_TOPIC]],
    content: JSON.stringify({
      zoneId: 'arena-prime',
      title: 'Arena Prime',
      description: 'The main combat arena.',
      zoneType: 'arena',
      relays: ['wss://relay.example.org'],
    }),
    sig: '1'.repeat(128),
  },
]);
