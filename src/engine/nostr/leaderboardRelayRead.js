// engine/nostr/leaderboardRelayRead.js — READ-ONLY leaderboard relay-read PROOF
// (LB-1 / NOSTR-READ continuation, v0.2.160). Proves the READ path for the Nostr
// leaderboard: given relay events that a host's read-only transport WOULD return,
// it builds the score-event filter, extracts/validates score objects from those
// events, deduplicates per addressable run, ranks them with the existing
// leaderboardView helpers, and returns a read-only preview/report.
//
// Pure + node-safe: NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// publishing, NO key handling, NO NIP-07, NO DOM, NO network, NO auto-connect.
// This module NEVER opens a socket and exposes NO publish/sign/send/connect
// surface — it only consumes events that were handed to it (from a v0.2.159
// relayRead `read()` result, a bare event array, or deterministic local sample
// data) and shapes them into a ranked, display-only view. Every helper degrades
// safely on malformed input and never throws on event data.

import { LEADERBOARD_KIND, SCORE_FIELDS, validateScore } from './leaderboard.js';
import { rankScores } from './leaderboardView.js';
import { normalizeRelayEvent, validateRelayEvent } from './relayRead.js';

// The discovery topic tag the leaderboard score events carry (mirrors
// leaderboard.buildScoreEventTemplate's `['t','torii-quest']`).
export const LEADERBOARD_TOPIC = 'torii-quest';

function _isInt(v) { return Number.isInteger(v); }
function _isNonNegInt(v) { return _isInt(v) && v >= 0; }

// buildScoreFilter({ authors, since, until, limit }) → a NIP-01 filter object that
// selects leaderboard score events (kind 30000 + the torii-quest topic tag). Pure:
// optional `authors` (hex pubkeys), `since`/`until` (unix seconds), and `limit`
// (transport hint) are only included when well-formed, so a bad option is dropped
// rather than producing a malformed filter. Never throws.
export function buildScoreFilter({ authors = null, since = null, until = null, limit = null } = {}) {
  const filter = {
    kinds: [LEADERBOARD_KIND],
    '#t': [LEADERBOARD_TOPIC],
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

// extractScoreFromEvent(event) → { ok, score?, errors? }. Pure, never throws.
// Takes a NORMALISED leaderboard event and reconstructs a local score object. The
// authoritative numbers come from the JSON `content` (what the player signed); the
// indexable tags are a fallback for any field missing from content. The score's
// `runId` is anchored to the event's addressable `d` tag when present so it lines
// up with how the event was published. Rejects non-leaderboard kinds and events
// whose reconstructed score fails leaderboard validation.
export function extractScoreFromEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: ['event must be an object'] };
  }
  if (event.kind !== LEADERBOARD_KIND) {
    return { ok: false, errors: [`event kind must be ${LEADERBOARD_KIND}`] };
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

  const _num = (field) => {
    if (_isInt(content[field])) return content[field];
    const tagVal = _tagValue(tags, field);
    if (typeof tagVal === 'string' && tagVal !== '') {
      const n = Number(tagVal);
      if (Number.isFinite(n)) return n;
    }
    return undefined;
  };

  const accuracyRaw = Number.isFinite(content.accuracy)
    ? content.accuracy
    : (() => {
        const tagVal = _tagValue(tags, 'accuracy');
        const n = typeof tagVal === 'string' ? Number(tagVal) : NaN;
        return Number.isFinite(n) ? n : undefined;
      })();

  const score = {
    runId: content.runId != null && content.runId !== '' ? String(content.runId) : (dTag != null ? String(dTag) : null),
    score: _num('score'),
    kills: _num('kills'),
    headshots: _num('headshots'),
    accuracy: accuracyRaw,
    version: typeof content.version === 'string' && content.version !== ''
      ? content.version
      : (() => { const v = _tagValue(tags, 'version'); return typeof v === 'string' ? v : undefined; })(),
    pubkey: event.pubkey,
    created_at: event.created_at,
  };

  const { valid, errors } = validateScore(score);
  if (!valid) return { ok: false, errors };
  return { ok: true, score };
}

// _addressKey(score) → the dedup key for an addressable (kind-30000) score: the
// signing pubkey + the run's `d`/runId. Latest created_at wins per key (NIP-01
// parameterised-replaceable semantics). Pure.
function _addressKey(score) {
  return `${score.pubkey || ''}:${score.runId == null ? '' : score.runId}`;
}

// dedupeScores(scores) → { scores, dropped }. Pure, never throws. Keeps the newest
// event (highest created_at; ties broken by keeping the first seen) per address key
// so a player's replaced run does not appear twice. Returns the survivors and the
// count of superseded duplicates dropped.
export function dedupeScores(scores = []) {
  const list = Array.isArray(scores) ? scores : [];
  const byKey = new Map();
  let dropped = 0;
  for (const s of list) {
    const key = _addressKey(s);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, s);
      continue;
    }
    dropped += 1;
    const prevAt = _isInt(prev.created_at) ? prev.created_at : -1;
    const curAt = _isInt(s.created_at) ? s.created_at : -1;
    if (curAt > prevAt) byKey.set(key, s); // newer replaces older
  }
  return { scores: [...byKey.values()], dropped };
}

// _toEventArray(input) → an array of raw events drawn from any accepted shape, or
// null if the shape is unusable. Accepts a relayRead read() result ({ events }),
// a bare array of events, or null/garbage. Pure.
function _toEventArray(input) {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && Array.isArray(input.events)) return input.events;
  return null;
}

// readLeaderboardEvents(input) → a read-only ranked leaderboard report:
//
//   {
//     ok:         boolean,            // false only on an unusable input shape
//     filter:     { kinds, '#t', … }, // the score filter these events answer
//     count:      number,             // ranked rows returned
//     rows:       [{ rank, runId, score, kills, headshots, accuracyLabel, version }],
//     scores:     [score],            // deduped, validated score objects (pre-rank)
//     skipped:    [{ event, errors }],// events that failed normalise/validate/extract
//     duplicates: number,            // superseded addressable duplicates dropped
//     signed:     false,             // ALWAYS — this module never signs
//     published:  false,             // ALWAYS — this module never publishes
//     readOnly:   true,
//     errors:     [string],          // input-shape problems (never event data)
//   }
//
// `input` is whatever an injected read-only transport produced: a v0.2.159
// relayRead `read()` result, a bare array of relay events, or local sample data.
// Each event is normalised (relayRead.normalizeRelayEvent) → structurally validated
// (relayRead.validateRelayEvent) → score-extracted; failures land in `skipped`.
// Survivors are deduped per addressable run then ranked via leaderboardView's
// rankScores. NEVER signs, publishes, fetches, opens a socket, or throws on event
// data — an unusable top-level shape degrades to ok:false with an empty board.
export function readLeaderboardEvents(input, options = {}) {
  const filter = buildScoreFilter(options);
  const result = {
    ok: true,
    filter,
    count: 0,
    rows: [],
    scores: [],
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
    const ex = extractScoreFromEvent(event);
    if (!ex.ok) {
      result.skipped.push({ event, errors: ex.errors });
      continue;
    }
    extracted.push(ex.score);
  }

  const { scores, dropped } = dedupeScores(extracted);
  result.duplicates = dropped;
  result.scores = scores;

  const { rows } = rankScores(scores);
  result.rows = rows;
  result.count = rows.length;
  return result;
}

// SCORE_FIELDS is re-exported so SDK consumers reading this surface see the score
// schema alongside the reader without reaching into leaderboard.js.
export { SCORE_FIELDS };
