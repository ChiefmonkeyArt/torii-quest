// engine/gamestr/gamestrLeaderboard.js — PURE gamestr.io kind 30762 leaderboard
// reader (Phase 0h, v0.2.601-alpha). The read-side companion to gamestrScore.js
// (Phase 0f publish): turns a raw batch of kind 30762 score events fetched from
// the gamestr relays into a sorted, deduped leaderboard of [{pubkey, score,
// duration?, createdAt}]. This is what the in-app "gamestr.io" sub-section
// renders alongside the existing NIP-78 leaderboard preview.
//
// Pure + node-safe: NO Nostr client, NO relay I/O, NO DOM, NO sockets,
// NO timers (src/engine is NOT on the regression-check timer allowlist). The
// fetch + render live in main.js (which reuses fanoutReq over GAMESTR_RELAYS,
// mirroring _refreshPersistentScores). Keeping this pure means it is
// node-testable and the relay layer can change without touching the schema.
//
// Kind 30762 is addressable replaceable (d = `<game-id>:<pubkey>`), so multiple
// events for the same player may arrive from different relays / at different
// times. Dedupe keeps the LATEST event per pubkey (highest created_at); on a
// created_at tie the highest score wins. The result is sorted by score desc.
//
// Constrained by construction (fail-closed, never throws): a malformed input —
// non-array, null, missing tags, unparseable score, bad pubkey — is dropped
// silently rather than propagating a bad row to the UI. The function NEVER
// throws: every failure path returns [] or skips the offending event.

const HEX64 = /^[0-9a-f]{64}$/;

// _firstTag(tags, name) → the string value of the first [name, value, ...] tag,
// or '' when absent. Pure; tolerates non-array tags.
function _firstTag(tags, name) {
  if (!Array.isArray(tags)) return '';
  for (const tag of tags) {
    if (Array.isArray(tag) && tag[0] === name && typeof tag[1] === 'string') return tag[1];
  }
  return '';
}

// _nonNegInt(v) → a non-negative integer parsed from a string/number, else null.
// Rejects negatives, NaN, Infinity, and non-numeric strings. Pure.
function _nonNegInt(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v >= 0 ? v : null;
  if (typeof v !== 'string' || !v.trim()) return null;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? n : null;
}

// _eventPubkey(event) → the player pubkey from the `p` tag, falling back to
// event.pubkey when the p tag is missing OR not a valid hex64. Lowercased +
// validated hex64; returns '' when both are invalid/missing. Pure.
function _eventPubkey(event) {
  if (!event || typeof event !== 'object') return '';
  const candidates = [_firstTag(event.tags, 'p'), typeof event.pubkey === 'string' ? event.pubkey : ''];
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue;
    const pk = raw.trim().toLowerCase();
    if (HEX64.test(pk)) return pk;
  }
  return '';
}

// _eventCreatedAt(event) → a finite epoch-seconds integer, else 0. Pure.
function _eventCreatedAt(event) {
  const ca = event && event.created_at;
  return Number.isFinite(ca) ? Math.floor(ca) : 0;
}

// buildGamestrLeaderboard(events) → [{pubkey, score, duration?, createdAt}]
// sorted by score desc. Pure; NEVER throws — non-array / null input → [].
//
//   - Dedupe by pubkey: keep the LATEST created_at per pubkey; on a created_at
//     tie, keep the highest score. (Kind 30762 is addressable replaceable, so a
//     relay may return stale + fresh events for the same d tag.)
//   - Parse the `score` tag as a non-negative integer; drop events with a
//     missing / unparseable score.
//   - Parse the optional `duration` tag as an integer when present; omit it
//     from the row when absent or unparseable.
//   - Validate the pubkey is hex64 (from the `p` tag, falling back to
//     event.pubkey); drop events with a bad pubkey.
export function buildGamestrLeaderboard(events) {
  if (!Array.isArray(events)) return [];
  const best = new Map(); // pubkey → {pubkey, score, duration?, createdAt}
  for (const event of events) {
    // Never let one bad event poison the batch — wrap each in its own try.
    let row;
    try {
      const pubkey = _eventPubkey(event);
      if (!pubkey) continue;
      const score = _nonNegInt(_firstTag(event.tags, 'score'));
      if (score === null) continue; // missing/unparseable score → drop
      const createdAt = _eventCreatedAt(event);
      const durRaw = _firstTag(event.tags, 'duration');
      const duration = _nonNegInt(durRaw);
      row = { pubkey, score };
      if (duration !== null) row.duration = duration;
      row.createdAt = createdAt;
    } catch {
      continue; // never throw into the caller for a malformed event
    }
    const prev = best.get(row.pubkey);
    if (!prev) {
      best.set(row.pubkey, row);
      continue;
    }
    // Keep the latest created_at; on a tie, the highest score.
    const isNewer = row.createdAt > prev.createdAt
      || (row.createdAt === prev.createdAt && row.score > prev.score);
    if (isNewer) best.set(row.pubkey, row);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}
