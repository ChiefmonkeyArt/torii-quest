// engine/nostr/relayRead.js — READ-ONLY Nostr relay adapter foundation (LB-1 /
// NOSTR-READ, v0.2.159). Defines the SHAPE and pure safety boundary for reading
// events from Nostr relays later (leaderboard scores, profiles, listings) WITHOUT
// signing, publishing, key handling, or auto-connecting from the game loop.
//
// Pure + node-safe: NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// key handling, NO DOM, NO network. Every helper is a pure function over plain
// data and NEVER throws on malformed input — bad events/filters degrade to safe
// error/empty states. The adapter's transport is an INJECTED `request` function
// (sync or async); this module never opens a socket itself, so importing it can
// never touch the wire. The adapter exposes a single `read()` path and NO
// publish/sign/send/connect/close method — read-only by construction.
//
//   request: (filters[], opts) => events[] | { events } | Promise<...>
//            (host-only injected reader; e.g. a one-shot REQ→EOSE collector)

// NIP-01 read-subscription frame verbs this module will build. EVENT (publish) is
// DELIBERATELY ABSENT — this adapter never constructs a write frame.
export const RELAY_READ_VERBS = Object.freeze(['REQ', 'CLOSE']);

// The canonical Nostr event fields (NIP-01). `sig` may be absent on an
// already-trusted/normalised event, but a wire event carries all seven.
export const EVENT_FIELDS = Object.freeze([
  'id', 'pubkey', 'created_at', 'kind', 'tags', 'content', 'sig',
]);

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;

function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
function _isHex128(v) { return typeof v === 'string' && HEX128.test(v); }
function _isInt(v) { return Number.isInteger(v); }
function _isNonNegInt(v) { return _isInt(v) && v >= 0; }

// validateRelayUrl(url) → { valid, errors, url }. Pure, never throws. A relay URL
// must be an absolute ws:// or wss:// URL with a host and NO embedded credentials
// (a `user:pass@` URL is a credential-leak smell and is rejected). Returns the
// normalised href on success, null otherwise.
export function validateRelayUrl(raw) {
  const errors = [];
  if (typeof raw !== 'string' || raw.trim() === '') {
    return { valid: false, errors: ['relay url must be a non-empty string'], url: null };
  }
  if (raw.length > 2048) {
    return { valid: false, errors: ['relay url too long'], url: null };
  }
  let u;
  try {
    u = new URL(raw); // absolute only — no relative resolution
  } catch {
    return { valid: false, errors: ['relay url is not a valid absolute URL'], url: null };
  }
  if (u.protocol !== 'ws:' && u.protocol !== 'wss:') {
    errors.push('relay url must use the ws:// or wss:// scheme');
  }
  if (!u.hostname) errors.push('relay url must have a host');
  if (u.username || u.password) errors.push('relay url must not contain credentials');
  return { valid: errors.length === 0, errors, url: errors.length === 0 ? u.href : null };
}

// normalizeRelayEvent(raw) → a canonical event object or null. Pure, never throws.
// Coerces a relay/wire event into the NIP-01 shape with strict types: `tags`
// becomes an array of string arrays (non-conforming tags dropped), missing/invalid
// optional fields are normalised (sig defaults to null). Returns null for a
// non-object input so callers can filter cleanly.
export function normalizeRelayEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const tags = Array.isArray(raw.tags)
    ? raw.tags
        .filter((t) => Array.isArray(t))
        .map((t) => t.map((x) => (x == null ? '' : String(x))))
    : [];
  return {
    id: typeof raw.id === 'string' ? raw.id : null,
    pubkey: typeof raw.pubkey === 'string' ? raw.pubkey : null,
    created_at: _isInt(raw.created_at) ? raw.created_at : null,
    kind: _isInt(raw.kind) ? raw.kind : null,
    tags,
    content: typeof raw.content === 'string' ? raw.content : '',
    sig: typeof raw.sig === 'string' ? raw.sig : null,
  };
}

// validateRelayEvent(event) → { valid, errors }. Pure, never throws. Checks the
// NIP-01 structural shape on a NORMALISED event (id/pubkey 64-hex, kind +
// created_at non-negative ints, tags array-of-string-arrays, content string). The
// signature is checked for SHAPE only when present (128-hex) — this module does NO
// cryptographic verification (that is a host step with a verifier dependency).
export function validateRelayEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { valid: false, errors: ['event must be an object'] };
  }
  const errors = [];
  if (!_isHex64(event.id)) errors.push('id must be 64-char lowercase hex');
  if (!_isHex64(event.pubkey)) errors.push('pubkey must be 64-char lowercase hex');
  if (!_isNonNegInt(event.kind)) errors.push('kind must be a non-negative integer');
  if (!_isNonNegInt(event.created_at)) errors.push('created_at must be a non-negative integer (unix seconds)');
  if (typeof event.content !== 'string') errors.push('content must be a string');
  if (!Array.isArray(event.tags) || !event.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'))) {
    errors.push('tags must be an array of string arrays');
  }
  if (event.sig != null && !_isHex128(event.sig)) errors.push('sig, when present, must be 128-char lowercase hex');
  return { valid: errors.length === 0, errors };
}

// eventMatchesFilter(event, filter) → boolean. Pure NIP-01 filter semantics over a
// NORMALISED event: a filter's conditions are ANDed together, and within a single
// condition the listed values are ORed. Supports `ids`, `authors`, `kinds`,
// `since`, `until`, and tag filters (`#e`, `#p`, `#t`, …). `limit` is a transport
// hint, not a per-event predicate, so it is ignored here. A null/non-object filter
// matches nothing; an empty filter `{}` matches every event. Never throws.
export function eventMatchesFilter(event, filter) {
  if (!event || typeof event !== 'object') return false;
  if (!filter || typeof filter !== 'object' || Array.isArray(filter)) return false;

  if (Array.isArray(filter.ids) && !filter.ids.includes(event.id)) return false;
  if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey)) return false;
  if (Array.isArray(filter.kinds) && !filter.kinds.includes(event.kind)) return false;
  if (_isInt(filter.since) && !(_isInt(event.created_at) && event.created_at >= filter.since)) return false;
  if (_isInt(filter.until) && !(_isInt(event.created_at) && event.created_at <= filter.until)) return false;

  for (const key of Object.keys(filter)) {
    if (key.length !== 2 || key[0] !== '#') continue; // `#<single-letter>` tag filters
    const wanted = filter[key];
    if (!Array.isArray(wanted)) continue;
    const tagName = key[1];
    const values = (event.tags || [])
      .filter((t) => t[0] === tagName)
      .map((t) => t[1]);
    if (!wanted.some((w) => values.includes(w))) return false;
  }
  return true;
}

// buildReqMessage(subId, filters) → ['REQ', subId, ...filters]. Pure builder for a
// NIP-01 read SUBSCRIPTION frame (the host serialises + sends it over its own
// socket). Throws ONLY on a structurally invalid subId/filters (programmer error),
// never on event data. This builds a READ frame; there is no EVENT/publish builder.
export function buildReqMessage(subId, filters = []) {
  if (typeof subId !== 'string' || subId === '') {
    throw new Error('buildReqMessage: subId must be a non-empty string');
  }
  const list = Array.isArray(filters) ? filters : [filters];
  if (!list.every((f) => f && typeof f === 'object' && !Array.isArray(f))) {
    throw new Error('buildReqMessage: every filter must be a plain object');
  }
  return ['REQ', subId, ...list];
}

// buildCloseMessage(subId) → ['CLOSE', subId]. Pure builder for the frame that ENDS
// a read subscription. Read-side only — it tears a subscription down, never writes.
export function buildCloseMessage(subId) {
  if (typeof subId !== 'string' || subId === '') {
    throw new Error('buildCloseMessage: subId must be a non-empty string');
  }
  return ['CLOSE', subId];
}

// createReadOnlyRelayAdapter({ request }) → { read }. The READ-ONLY boundary: the
// caller injects a `request(filters, opts)` transport (host-only; e.g. a one-shot
// REQ→EOSE collector over the host's own socket). The adapter normalises, validates
// and filters whatever `request` returns and hands back a structured result — it
// NEVER signs, publishes, opens a socket, or mutates anything, and exposes NO
// publish/sign/send/connect/close method. `read()` NEVER throws: a missing
// transport, a thrown request, or malformed events all degrade to a safe result.
export function createReadOnlyRelayAdapter({ request = null } = {}) {
  // read(filters, opts) → { ok, events, skipped, count, errors }.
  //   - events:  normalised + structurally-valid events matching ALL filters.
  //   - skipped: { event, errors } for events that normalised but failed validation.
  //   - errors:  transport/usage problems (no request, request threw, bad shape).
  async function read(filters = [], opts = {}) {
    const result = { ok: true, events: [], skipped: [], count: 0, errors: [] };

    if (typeof request !== 'function') {
      result.ok = false;
      result.errors.push('no transport: inject a read-only `request` function');
      return result;
    }

    const list = Array.isArray(filters) ? filters : [filters];

    let raw;
    try {
      raw = await request(list, opts);
    } catch (e) {
      result.ok = false;
      result.errors.push('request failed: ' + (e?.message || String(e)));
      return result;
    }

    // Accept either a bare array of events or a { events } envelope.
    const rawEvents = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.events) ? raw.events : null);
    if (rawEvents == null) {
      result.ok = false;
      result.errors.push('request returned a non-event-list result');
      return result;
    }

    for (const item of rawEvents) {
      const event = normalizeRelayEvent(item);
      if (event == null) {
        result.skipped.push({ event: item, errors: ['not an event object'] });
        continue;
      }
      const { valid, errors } = validateRelayEvent(event);
      if (!valid) {
        result.skipped.push({ event, errors });
        continue;
      }
      if (list.length === 0 || list.some((f) => eventMatchesFilter(event, f))) {
        result.events.push(event);
      }
    }
    result.count = result.events.length;
    return result;
  }

  // Frozen so a caller can't bolt a publish()/sign() onto the read-only adapter.
  return Object.freeze({ read, readOnly: true });
}
