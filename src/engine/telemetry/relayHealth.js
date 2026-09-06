// engine/telemetry/relayHealth.js — pure, node-testable per-relay counters
// (v0.2.774). Records connection lifecycle events for every wss:// relay the
// game contacts so the Settings→Relays tab can show who is a good performer
// and who to replace over time. LS-persisted, no network I/O, no DOM at import.
//
// SHAPE (LS key `torii.relayHealth.v1`):
//   {
//     v: 1,
//     relays: {
//       "wss://nos.lol": {
//         opens: number,          // successful WS handshakes
//         opensFailed: number,    // failed open attempts (error/close before open)
//         closes: number,         // clean closes after open
//         messages: number,       // NIP-01 frames received
//         latencyMsSum: number,   // sum of connect times (ms) for opens
//         latencySamples: number, // number of latency samples in the sum
//         lastSeen: number,       // epoch ms of last successful message
//         lastFail: number,       // epoch ms of last failed open
//         failStreak: number,     // current consecutive fails since last success
//         sessions: number[],     // rolling window of session success counts
//                                 // (position N = successful opens in session N,
//                                 //  window kept to MAX_SESSIONS entries)
//       },
//       …
//     },
//     currentSession: {           // scratch counter, rotated on rotateSession()
//       [relayUrl]: number,       // successful opens this session
//     },
//   }
//
// PUBLIC API:
//   recordOpen(url, connectMs, opts?)  — a successful handshake with measured latency
//   recordOpenFail(url, opts?)         — an open attempt that errored/closed pre-open
//   recordClose(url, opts?)            — a clean close after a prior open
//   recordMessage(url, opts?)          — one NIP-01 frame received
//   rotateSession(opts?)               — snapshot currentSession into sessions[]
//   readHealth(opts?)                  — the whole record (deep-cloned; caller-safe)
//   readRelayHealth(url, opts?)        — one relay's record (deep-cloned) or null
//   resetHealth(opts?)                 — clears all counters (test/debug hook)
//
// EVERY function is pure w.r.t. the passed storage (defaults to
// globalThis.localStorage). No throws — LS failure → silent no-op.
// URL validation: only wss:// or ws:// URLs are accepted; others are ignored
// (so an accidental bad string can't corrupt the store).

const LS_KEY = 'torii.relayHealth.v1';
const MAX_SESSIONS = 30; // rolling window for the sparkline
const SCHEMA_VERSION = 1;

// _defaultStorage() — resolve localStorage lazily so SSR / node tests without a
// polyfill get an in-memory no-op instead of a ReferenceError.
function _defaultStorage() {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage;
    }
  } catch { /* fall through */ }
  return null;
}

// _blankRelay() — a fresh per-relay counter record.
function _blankRelay() {
  return {
    opens: 0,
    opensFailed: 0,
    closes: 0,
    messages: 0,
    latencyMsSum: 0,
    latencySamples: 0,
    lastSeen: 0,
    lastFail: 0,
    failStreak: 0,
    sessions: [],
  };
}

// _blankRoot() — a fresh top-level record.
function _blankRoot() {
  return { v: SCHEMA_VERSION, relays: {}, currentSession: {} };
}

// _isValidRelayUrl(url) — accept only wss:// / ws:// URLs. Rejects everything
// else so a caller mistake can't seed garbage into the store.
function _isValidRelayUrl(url) {
  if (typeof url !== 'string') return false;
  return /^wss?:\/\/[^\s]+$/i.test(url);
}

// _load(storage) — parse the LS blob into a well-formed root. Any parse error,
// missing/mismatched schema, or non-object payload → fresh root. Never throws.
function _load(storage) {
  if (!storage) return _blankRoot();
  let raw = null;
  try { raw = storage.getItem(LS_KEY); }
  catch { return _blankRoot(); }
  if (!raw) return _blankRoot();
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return _blankRoot(); }
  if (!parsed || typeof parsed !== 'object' || parsed.v !== SCHEMA_VERSION) {
    return _blankRoot();
  }
  const root = _blankRoot();
  if (parsed.relays && typeof parsed.relays === 'object') {
    for (const [url, rec] of Object.entries(parsed.relays)) {
      if (!_isValidRelayUrl(url) || !rec || typeof rec !== 'object') continue;
      const blank = _blankRelay();
      root.relays[url] = {
        opens: Number.isFinite(rec.opens) ? rec.opens : blank.opens,
        opensFailed: Number.isFinite(rec.opensFailed) ? rec.opensFailed : blank.opensFailed,
        closes: Number.isFinite(rec.closes) ? rec.closes : blank.closes,
        messages: Number.isFinite(rec.messages) ? rec.messages : blank.messages,
        latencyMsSum: Number.isFinite(rec.latencyMsSum) ? rec.latencyMsSum : blank.latencyMsSum,
        latencySamples: Number.isFinite(rec.latencySamples) ? rec.latencySamples : blank.latencySamples,
        lastSeen: Number.isFinite(rec.lastSeen) ? rec.lastSeen : blank.lastSeen,
        lastFail: Number.isFinite(rec.lastFail) ? rec.lastFail : blank.lastFail,
        failStreak: Number.isFinite(rec.failStreak) ? rec.failStreak : blank.failStreak,
        sessions: Array.isArray(rec.sessions)
          ? rec.sessions.filter((n) => Number.isFinite(n)).slice(-MAX_SESSIONS)
          : [],
      };
    }
  }
  if (parsed.currentSession && typeof parsed.currentSession === 'object') {
    for (const [url, n] of Object.entries(parsed.currentSession)) {
      if (_isValidRelayUrl(url) && Number.isFinite(n)) root.currentSession[url] = n;
    }
  }
  return root;
}

// _save(storage, root) — best-effort persist. Silently drops on any LS error.
function _save(storage, root) {
  if (!storage) return;
  try { storage.setItem(LS_KEY, JSON.stringify(root)); }
  catch { /* quota / disabled — silently continue */ }
}

// _ensureRelay(root, url) — get-or-create the per-relay record.
function _ensureRelay(root, url) {
  if (!root.relays[url]) root.relays[url] = _blankRelay();
  return root.relays[url];
}

// _now() — indirection so tests can stub globalThis.Date.
function _now() { return Date.now(); }

function recordOpen(url, connectMs, opts = {}) {
  if (!_isValidRelayUrl(url)) return;
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  const rec = _ensureRelay(root, url);
  rec.opens += 1;
  rec.failStreak = 0;
  rec.lastSeen = _now();
  if (Number.isFinite(connectMs) && connectMs >= 0) {
    rec.latencyMsSum += connectMs;
    rec.latencySamples += 1;
  }
  root.currentSession[url] = (root.currentSession[url] || 0) + 1;
  _save(storage, root);
}

function recordOpenFail(url, opts = {}) {
  if (!_isValidRelayUrl(url)) return;
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  const rec = _ensureRelay(root, url);
  rec.opensFailed += 1;
  rec.failStreak += 1;
  rec.lastFail = _now();
  _save(storage, root);
}

function recordClose(url, opts = {}) {
  if (!_isValidRelayUrl(url)) return;
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  const rec = _ensureRelay(root, url);
  rec.closes += 1;
  _save(storage, root);
}

function recordMessage(url, opts = {}) {
  if (!_isValidRelayUrl(url)) return;
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  const rec = _ensureRelay(root, url);
  rec.messages += 1;
  rec.lastSeen = _now();
  _save(storage, root);
}

// rotateSession() — snapshot currentSession counters into each relay's rolling
// session history, then clear currentSession. Call once at page load or when
// entering a new arena so the sparkline shows "opens this session" per bar.
// A relay with zero opens this session gets a 0 pushed (so the sparkline shows
// gaps where a relay was silent).
function rotateSession(opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  // Every known relay gets a bar for this session (0 if it was silent).
  const knownUrls = new Set([
    ...Object.keys(root.relays),
    ...Object.keys(root.currentSession),
  ]);
  for (const url of knownUrls) {
    const rec = _ensureRelay(root, url);
    const count = root.currentSession[url] || 0;
    rec.sessions.push(count);
    if (rec.sessions.length > MAX_SESSIONS) {
      rec.sessions = rec.sessions.slice(-MAX_SESSIONS);
    }
  }
  root.currentSession = {};
  _save(storage, root);
}

function readHealth(opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  // Deep-clone so callers can't mutate our on-disk shape.
  return JSON.parse(JSON.stringify(root));
}

function readRelayHealth(url, opts = {}) {
  if (!_isValidRelayUrl(url)) return null;
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  const root = _load(storage);
  const rec = root.relays[url];
  return rec ? JSON.parse(JSON.stringify(rec)) : null;
}

function resetHealth(opts = {}) {
  const storage = opts.storage !== undefined ? opts.storage : _defaultStorage();
  _save(storage, _blankRoot());
}

export {
  LS_KEY,
  MAX_SESSIONS,
  SCHEMA_VERSION,
  recordOpen,
  recordOpenFail,
  recordClose,
  recordMessage,
  rotateSession,
  readHealth,
  readRelayHealth,
  resetHealth,
};
