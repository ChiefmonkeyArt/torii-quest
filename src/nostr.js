// nostr.js — NIP-07 login, kind:0 profile fetch
import { state } from './state.js';
import { emit, EV } from './events.js';
import { resolveMpHttpBase, loginForSessionToken } from './engine/multiplayer/sessionAuth.js';
import { verifyNostrEventSig } from './engine/crypto/nostrSig.js';
import { readProfiles } from './engine/nostr/profileRead.js';
import { readCharacters, buildCharacterFilter } from './engine/character/characterRelayRead.js';
import { buildCharacterEvent, parseCharacterEvent } from './engine/character/characterEvent.js';
import {
  WRITE_POLICY_OWNER_ONLY,
  WRITE_POLICY_DELEGATES,
  WRITE_POLICY_FOLLOWS_WRITE,
  normaliseWritePolicy,
} from './engine/gateway/writeAuthority.js';
import { readEffectiveNodeRelays } from './engine/presence/nodeRelays.js';

// v0.2.715-alpha (ADR-0081): ONE relay list for the whole game. The separate
// hardcoded `RELAYS` (nos.lol + vertexlab.io) that profile/login/leaderboard
// reads used is gone — every relay-consuming path now reads the SAME single
// list the operator edits in the Relay settings tab (localStorage
// `torii.node.relays` + <meta name="torii-relays">), falling back to the
// curated 5-relay DEFAULT_NODE_RELAYS. Public relays are fine here; what is
// gated is the ACTION (each publish keeps its own opt-in), not the relay.
function _effectiveRelays() {
  let metaGetter = null;
  try {
    if (typeof document !== 'undefined' && document.querySelector) {
      metaGetter = (name) => {
        const el = document.querySelector(`meta[name="${name}"]`);
        return el && el.content ? el.content : '';
      };
    }
  } catch { /* no document — meta source unavailable */ }
  return readEffectiveNodeRelays({ metaGetter });
}

const PROFILE_TIMEOUT_MS = 5000;
const PROFILE_SETTLE_MS = 1800;
export { PROFILE_SETTLE_MS };

// A nostrich profile's `picture` is attacker-controlled (anyone can sign a
// kind:0 with any string). Only accept a well-formed https URL before it ever
// reaches an <img src>, so a hostile value can't smuggle in javascript:/data:
// or other surprising schemes. Returns the URL string, or null if unsafe.
function _safeImageUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; } // absolute URLs only — no relative resolution
  return u.protocol === 'https:' ? u.href : null;
}

// A nostrich profile's `name` is also attacker-controlled. Cap to a reasonable
// display length and strip control characters so a hostile kind:0 can't blow
// out the title bar / HUD with megabytes of text or NUL/newline tricks. v0.2.260
// audit S5: pre-cap mitigates DOM bloat and avoids surprising layout overflows.
const MAX_NOSTR_NAME_LEN = 64;
function _safeName(raw) {
  if (typeof raw !== 'string') return null;
  // Strip C0/C1 control chars (incl. NUL, CR, LF, BEL) and trim whitespace.
  const cleaned = raw.replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.length > MAX_NOSTR_NAME_LEN
    ? cleaned.slice(0, MAX_NOSTR_NAME_LEN)
    : cleaned;
}

export async function nostrLogin() {
  if (!window.nostr) return 'NIP-07 extension not found';
  try {
    // v0.2.375-alpha — "1 sign at login, 0 signs in-game": sign ONE NIP-98
    // (kind:27235) event and exchange it for a server-issued session token the
    // arena WS reuses (no per-entry NIP-42 signature). The returned npub is the
    // signer's hex pubkey. Fall back to a plain getPublicKey() (no token → the
    // arena uses the NIP-42 challenge path) if token issuance is unavailable.
    let pk = null;
    const httpBase = resolveMpHttpBase();
    if (httpBase && typeof window.nostr.signEvent === 'function') {
      const res = await loginForSessionToken({
        httpBase,
        signEvent: (unsigned) => window.nostr.signEvent(unsigned),
      });
      if (res && /^[0-9a-f]{64}$/.test(res.npub || '')) pk = res.npub;
    }
    if (!pk) pk = await window.nostr.getPublicKey();
    state.nostrPubkey = pk;
    state.nostrName   = pk.slice(0,8).toUpperCase();
    emit(EV.NOSTR_LOGIN, { pubkey: pk });
    _fetchProfile(pk);
    // v0.2.714: on success return an empty string so the title-screen status
    // line hides — we no longer surface the raw pubkey fragment ("⚡ EC79B568")
    // under the Enter button. The pubkey is still stored in state for the
    // in-game display-name fallback; it just isn't shown on the homescreen.
    return '';
  } catch(e) {
    // Provider exists but the getPublicKey() request was rejected/failed — give an actionable
    // message (the usual cause is the extension prompt being dismissed), not a dead-end "failed".
    return 'Login failed — approve the request in your Nostr extension and try again';
  }
}

// v0.2.394-alpha: profile cards now fill progressively. Keep the profile-only
// kind:0 read scoped here so fanoutReq()/relayReq() stay byte-identical for the
// other callers that intentionally wait for all-relay EOSE (leaderboard union,
// arena presence). We open every relay concurrently, apply the FIRST valid
// profile immediately, then keep the remaining sockets alive for a short settle
// window so a fresher replaceable event can overwrite a stale early hit.
function _extractProfileMeta(event) {
  if (!event || event.kind !== 0) return null;
  let meta;
  try { meta = JSON.parse(event.content); } catch { return null; }
  if (!meta || typeof meta !== 'object') return null;
  return {
    createdAt: Number.isFinite(event.created_at) ? event.created_at : 0,
    name: _safeName(meta.name),
    avatar: _safeImageUrl(meta.picture),
  };
}

function _applyProfileMeta(pubkey, meta) {
  if (!meta) return false;
  if (meta.name) { state.nostrName = meta.name; }
  if (meta.avatar) { state.nostrAvatar = meta.avatar; }
  emit(EV.NOSTR_LOGIN, { pubkey, name: meta.name, avatar: meta.avatar });
  _updateTitleUI();
  return true;
}

export function fetchProfileProgressive(pubkey, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const relays = Array.isArray(o.relays) ? o.relays : _effectiveRelays();
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.floor(o.timeoutMs) : PROFILE_TIMEOUT_MS;
  const settleMs = Number.isFinite(o.settleMs) && o.settleMs >= 0 ? Math.floor(o.settleMs) : PROFILE_SETTLE_MS;
  const WebSocketCtor = o.WebSocketCtor || (typeof WebSocket !== 'undefined' ? WebSocket : null);
  return new Promise((resolve) => {
    if (!WebSocketCtor) {
      resolve({ ok: false, applied: false, error: 'no-websocket' });
      return;
    }
    const sockets = [];
    const filters = [{ kinds: [0], authors: [pubkey], limit: 1 }];
    let pending = 0;
    let finished = false;
    let settled = false;
    let bestCreatedAt = -Infinity;
    let noEventTimer = null;
    let settleTimer = null;

    const cleanup = () => {
      if (noEventTimer) clearTimeout(noEventTimer);
      if (settleTimer) clearTimeout(settleTimer);
      for (const entry of sockets) {
        const ws = entry.ws;
        if (!ws) continue;
        try {
          if (ws.readyState === 1) ws.send(JSON.stringify(['CLOSE', entry.subId]));
        } catch { /* best-effort close */ }
        try {
          if (ws.readyState === 0 || ws.readyState === 1) ws.close();
        } catch { /* best-effort close */ }
      }
    };

    const finish = (ok, error) => {
      if (finished) return;
      finished = true;
      cleanup();
      resolve({ ok, applied: settled, error: ok ? null : (error || 'failed') });
    };

    const maybeFinish = () => {
      if (!pending) finish(settled, settled ? null : 'timeout');
    };

    const markDone = (entry) => {
      if (!entry || entry.done) return;
      entry.done = true;
      pending--;
      if (settled && !pending) finish(true, null);
      else if (!settled) maybeFinish();
    };

    const scheduleSettle = () => {
      if (settleTimer || settleMs <= 0) {
        if (settleMs <= 0) finish(true, null);
        return;
      }
      settleTimer = setTimeout(() => finish(true, null), settleMs);
    };

    const handleEvent = (event) => {
      const meta = _extractProfileMeta(event);
      if (!meta) return;
      if (!settled) {
        settled = _applyProfileMeta(pubkey, meta);
        if (!settled) return;
        bestCreatedAt = meta.createdAt;
        if (noEventTimer) clearTimeout(noEventTimer);
        scheduleSettle();
        return;
      }
      if (meta.createdAt > bestCreatedAt && _applyProfileMeta(pubkey, meta)) {
        bestCreatedAt = meta.createdAt;
      }
    };

    for (const relay of relays) {
      let ws;
      try { ws = new WebSocketCtor(relay); }
      catch { continue; }
      const entry = { relay, ws, subId: 'rq' + Math.random().toString(36).slice(2, 9), done: false };
      sockets.push(entry);
      pending++;
      ws.onopen = () => {
        try { ws.send(JSON.stringify(['REQ', entry.subId, ...filters])); }
        catch { markDone(entry); maybeFinish(); }
      };
      ws.onmessage = (ev) => {
        try {
          const frame = JSON.parse(ev.data);
          if (!Array.isArray(frame)) return;
          const [verb, sid, payload] = frame;
          if (sid !== entry.subId) return;
          if (verb === 'EVENT' && payload) handleEvent(payload);
          else if (verb === 'EOSE' || verb === 'NOTICE') markDone(entry);
        } catch { /* ignore a malformed frame */ }
      };
      ws.onerror = () => { markDone(entry); maybeFinish(); };
      ws.onclose = () => { markDone(entry); maybeFinish(); };
    }

    if (!pending) {
      finish(false, 'bad-url');
      return;
    }
    noEventTimer = setTimeout(() => finish(false, 'timeout'), timeoutMs);
  });
}

async function _fetchProfile(pubkey) {
  await fetchProfileProgressive(pubkey);
}

// v0.2.706-alpha — read-only lookup of ANY pubkey's published displayName,
// for the homepage owner caption ("This torii belongs to: <name>"). Deliberately
// separate from fetchProfileProgressive()/_fetchProfile() above: those apply the
// result onto the LOGGED-IN VIEWER's own state.nostrName/nostrAvatar (via
// _applyProfileMeta → EV.NOSTR_LOGIN), which would be wrong here — a visitor
// looking up the INSTANCE OWNER's name must never overwrite their own displayed
// identity. This reuses the same read-only kind:0 transport (fanoutReq) and the
// pure, well-tested extraction in engine/nostr/profileRead.js, and touches no
// global state at all — it just resolves a name string.
//
// Small in-memory TTL cache: the homepage calls this on every capability probe
// and NOSTR_LOGIN, but the owner's profile rarely changes, so repeat lookups in
// the same session reuse the cached name instead of re-querying relays.
const OWNER_PROFILE_NAME_CACHE = new Map(); // pubkey -> { name, expiresAt }
const OWNER_PROFILE_NAME_CACHE_TTL_MS = 5 * 60 * 1000;

export async function fetchOwnerProfileName(pubkey, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const pk = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(pk)) return '';

  const nowMs = Number.isFinite(o.nowMs) ? o.nowMs : Date.now();
  const cached = OWNER_PROFILE_NAME_CACHE.get(pk);
  if (cached && cached.expiresAt > nowMs) return cached.name;

  const relays = Array.isArray(o.relays) ? o.relays : _effectiveRelays();
  const request = typeof o.request === 'function' ? o.request : fanoutReq;
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : PROFILE_TIMEOUT_MS;

  let raw;
  try {
    raw = await request(relays, [{ kinds: [0], authors: [pk], limit: 1 }], { timeoutMs });
  } catch {
    return cached ? cached.name : '';
  }
  const events = raw && Array.isArray(raw.events) ? raw.events : [];
  const { profiles } = readProfiles(events);
  const profile = profiles.find((p) => p.pubkey === pk);
  const name = (profile && profile.displayName && profile.displayName !== profile.shortPubkey)
    ? profile.displayName
    : '';

  OWNER_PROFILE_NAME_CACHE.set(pk, { name, expiresAt: nowMs + OWNER_PROFILE_NAME_CACHE_TTL_MS });
  return name;
}

export function __resetOwnerProfileNameCache() {
  OWNER_PROFILE_NAME_CACHE.clear();
}

// fetchOwnProfile(pubkey, opts) → the sanitised kind:0 profile view-model for
// the given pubkey, or null. Read-only: reuses fanoutReq + readProfiles (the
// same pure extraction fetchOwnerProfileName uses), but returns the FULL
// profile (name/displayName/about/picture/website/nip05/lud16) instead of just
// the display name — used to pre-fill the Profile settings tab from the user's
// published Nostr profile. Never throws; a failed/empty lookup returns null.
export async function fetchOwnProfile(pubkey, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const pk = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const relays = Array.isArray(o.relays) ? o.relays : _effectiveRelays();
  const request = typeof o.request === 'function' ? o.request : fanoutReq;
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : PROFILE_TIMEOUT_MS;

  let raw;
  try {
    raw = await request(relays, [{ kinds: [0], authors: [pk], limit: 1 }], { timeoutMs });
  } catch {
    return null;
  }
  const events = raw && Array.isArray(raw.events) ? raw.events : [];
  const { profiles } = readProfiles(events);
  return profiles.find((p) => p.pubkey === pk) || null;
}

// fetchOwnCharacter(pubkey, opts) → the parsed `torii.character` manifest for the
// given pubkey, or null. Read-only: reuses fanoutReq + readCharacters (the pure
// kind-35100 extraction). Returns the manifest only when the event parses AND
// carries a mesh hash — a broken/empty character degrades to null so the caller
// falls through to the create flow. Never throws; a failed/empty lookup returns null.
export async function fetchOwnCharacter(pubkey, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const pk = typeof pubkey === 'string' ? pubkey.trim().toLowerCase() : '';
  if (!/^[0-9a-f]{64}$/.test(pk)) return null;
  const relays = Array.isArray(o.relays) ? o.relays : _effectiveRelays();
  const request = typeof o.request === 'function' ? o.request : fanoutReq;
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : PROFILE_TIMEOUT_MS;

  let raw;
  try {
    raw = await request(relays, [buildCharacterFilter({ authors: [pk], limit: 1 })], { timeoutMs });
  } catch {
    return null;
  }
  const events = raw && Array.isArray(raw.events) ? raw.events : [];
  const { characters } = readCharacters(events);
  const entry = characters.find((c) => c.pubkey === pk);
  if (!entry || !entry.valid) return null;
  const manifest = entry.manifest;
  return (manifest && manifest.mesh && manifest.mesh.hash) ? manifest : null;
}

function _updateTitleUI() {
  const nameEl   = document.getElementById('nostr-display-name');
  const avatarEl = document.getElementById('nostr-avatar-img');
  const phEl     = document.getElementById('nostr-avatar-ph');
  const statusEl = document.getElementById('stats-status');
  if (nameEl)   nameEl.textContent  = state.nostrName || 'ANON';
  if (statusEl) statusEl.textContent = '● CONNECTED';
  if (avatarEl && state.nostrAvatar) {
    avatarEl.src = state.nostrAvatar;
    avatarEl.style.display = 'block';
    if (phEl) phEl.style.display = 'none';
  }
}


// ── Live relay transport (v0.2.251 — n2n gateway presence) ────────────────
// A read-only REQ→EOSE collector + an EVENT publish path + a NIP-07 signEvent
// wrapper. These are the only live WebSocket sites besides the kind:0 profile
// fetch above; all setTimeout usage stays in this allowlisted file so the
// regression check's setTimeout allowlist (nostr.js + hud.js) still holds.
//
// Constrained by construction:
//   - READ: relayReq opens a WebSocket, sends a REQ with the caller's filters,
//     collects EVENT frames, resolves on EOSE (or timeout / error), then closes.
//     Never signs, never publishes, never navigates.
//   - PUBLISH: publishEvent sends a signed EVENT frame and resolves on the relay's
//     OK(true)/OK(false)/NOTICE. The event MUST already be signed (use signEvent).
//     No key handling here — signing is delegated to NIP-07.
//   - SIGN: signEvent wraps window.nostr.signEvent (NIP-07). The extension computes
//     the id + sig; this module never sees a private key.
//   - Every function degrades safely: a missing window.nostr / closed socket / bad
//     relay yields a structured error result, never a throw into the game loop.

// relayReq(url, filters, opts?) → Promise<{ ok, events, relay, error }>
// One relay, one REQ, collect until EOSE. `filters` is a NIP-01 filter array
// (a single filter object is also accepted). `opts.timeoutMs` caps the wait
// (default 4000). `opts.graceMs` (default 0) adds a late-event grace window:
// on EOSE the socket stays open for graceMs to catch stragglers that some
// relays emit after EOSE (observed flakiness during the n2n interop proof)
// before closing. Pure of side effects beyond the socket; resolves rather
// than rejecting on failure so callers can fan out.
export function relayReq(url, filters, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 4000;
  const graceMs = Number.isFinite(o.graceMs) && o.graceMs > 0 ? Math.floor(o.graceMs) : 0;
  const subsId = 'rq' + Math.random().toString(36).slice(2, 9);
  const flt = Array.isArray(filters) ? filters : (filters && typeof filters === 'object' ? [filters] : []);
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      resolve({ ok: false, events: [], relay: url, error: 'no-websocket' });
      return;
    }
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { resolve({ ok: false, events: [], relay: url, error: 'bad-url' }); return; }
    const events = [];
    let done = false;
    let inGrace = false;
    let mainTimer = null;
    let graceTimer = null;
    const finish = (ok, error) => {
      if (done) return; done = true;
      if (mainTimer) clearTimeout(mainTimer);
      if (graceTimer) clearTimeout(graceTimer);
      try { if (ws.readyState === 1) ws.close(); } catch { /* best-effort close */ }
      resolve({ ok, events, relay: url, error: ok ? null : (error || 'failed') });
    };
    mainTimer = setTimeout(() => finish(events.length ? true : false, 'timeout'), timeoutMs);
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['REQ', subsId, ...flt])); }
      catch (e) { finish(false, 'send-failed'); }
    };
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data);
        if (!Array.isArray(frame)) return;
        const [verb, sid, payload] = frame;
        if (verb === 'EVENT' && sid === subsId && payload) events.push(payload);
        else if (verb === 'EOSE' && sid === subsId) {
          // Late-event grace: some relays emit EOSE before flushing older stored
          // events. Hold the socket open for graceMs to catch stragglers, then
          // close. A second EOSE during grace closes immediately.
          if (graceMs > 0 && !inGrace) {
            inGrace = true;
            if (mainTimer) clearTimeout(mainTimer);
            graceTimer = setTimeout(() => finish(true, null), graceMs);
          } else {
            finish(true, null);
          }
        }
        else if (verb === 'NOTICE') { finish(false, 'notice'); }
      } catch { /* ignore a malformed frame */ }
    };
    ws.onerror = () => { finish(false, 'error'); };
    ws.onclose = () => { finish(events.length ? true : false, 'closed'); };
  });
}

// fanoutReq(relays, filters, opts) → Promise<{ events, used, failed }>. Queries
// every relay in parallel, merges collected events (deduped by id), and returns
// the union. Never rejects; failed relays are listed but don't fail the call.
// opts.retries (default 0) re-queries relays that failed on a prior pass — a
// single retry recovers transient TLS-reset / 503 flakiness (observed on
// relay.nostr.band and relay.damus.io under concurrent load during the n2n
// interop proof). opts.graceMs is passed through to relayReq. Both default to
// off, so callers opt in deliberately.
export async function fanoutReq(relays, filters, opts = {}) {
  const list = Array.isArray(relays) ? relays : (relays ? [relays] : []);
  const retries = Number.isFinite(opts.retries) && opts.retries > 0 ? Math.floor(opts.retries) : 0;
  let results = await Promise.all(list.map((r) => relayReq(r, filters, opts)));
  for (let attempt = 0; attempt < retries; attempt++) {
    const failed = results.filter((r) => !r.ok);
    if (!failed.length) break; // nothing left to retry
    const retryResults = await Promise.all(failed.map((r) => relayReq(r.relay, filters, opts)));
    // merge retry results back into `results` in place (replace each failed slot)
    let ri = 0;
    for (let i = 0; i < results.length; i++) {
      if (!results[i].ok) { results[i] = retryResults[ri++]; }
    }
  }
  const seen = new Set();
  const events = [];
  const used = [];
  const failed = [];
  for (const r of results) {
    if (r.ok && r.events.length) {
      used.push(r.relay);
      for (const e of r.events) {
        if (e && typeof e.id === 'string' && !seen.has(e.id)) { seen.add(e.id); events.push(e); }
      }
    } else if (!r.ok) {
      failed.push(r.relay);
    }
  }
  return { events, used, failed };
}

// signEvent(unsignedEvent) → Promise<{ ok, event, error }>. Wraps NIP-07
// window.nostr.signEvent; the extension returns a fully-signed event (id + sig).
export async function signEvent(unsigned) {
  if (typeof window === 'undefined' || !window.nostr || typeof window.nostr.signEvent !== 'function') {
    return { ok: false, event: null, error: 'nip-07-unavailable' };
  }
  try {
    const signed = await window.nostr.signEvent(unsigned);
    if (!signed || typeof signed.id !== 'string' || typeof signed.sig !== 'string') {
      return { ok: false, event: null, error: 'nip-07-bad-signature' };
    }
    return { ok: true, event: signed, error: null };
  } catch (e) {
    return { ok: false, event: null, error: 'nip-07-rejected' };
  }
}

// publishEvent(url, event, opts?) → Promise<{ ok, relay, accepted, error }>.
// Sends a signed EVENT frame, resolves on OK(true)/OK(false)/NOTICE or timeout.
export function publishEvent(url, event, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 5000;
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') {
      resolve({ ok: false, relay: url, accepted: false, error: 'no-websocket' });
      return;
    }
    let ws;
    try { ws = new WebSocket(url); }
    catch (e) { resolve({ ok: false, relay: url, accepted: false, error: 'bad-url' }); return; }
    let done = false;
    const finish = (ok, accepted, error) => {
      if (done) return; done = true;
      try { if (ws.readyState === 1) ws.close(); } catch { /* best-effort close */ }
      resolve({ ok, relay: url, accepted, error });
    };
    const timer = setTimeout(() => finish(false, false, 'timeout'), timeoutMs);
    ws.onopen = () => {
      try { ws.send(JSON.stringify(['EVENT', event])); }
      catch (e) { clearTimeout(timer); finish(false, false, 'send-failed'); }
    };
    ws.onmessage = (ev) => {
      try {
        const frame = JSON.parse(ev.data);
        if (!Array.isArray(frame)) return;
        const verb = frame[0];
        if (verb === 'OK' && frame[1] === event.id) {
          clearTimeout(timer); finish(true, frame[2] === true, frame[2] === true ? null : 'rejected');
        } else if (verb === 'NOTICE') {
          clearTimeout(timer); finish(false, false, 'notice');
        }
      } catch { /* ignore a malformed frame */ }
    };
    ws.onerror = () => { clearTimeout(timer); finish(false, false, 'error'); };
    ws.onclose = () => { clearTimeout(timer); finish(false, false, 'closed'); };
  });
}

// fanoutPublish(relays, event, opts) → Promise<{ accepted, used, failed }>.
// Publishes to every relay in parallel; a relay is "used" only on OK(true).
export async function fanoutPublish(relays, event, opts = {}) {
  const list = Array.isArray(relays) ? relays : (relays ? [relays] : []);
  const results = await Promise.all(list.map((r) => publishEvent(r, event, opts)));
  const used = [];
  const failed = [];
  let accepted = 0;
  for (const r of results) {
    if (r.ok && r.accepted) { used.push(r.relay); accepted++; }
    else failed.push(r.relay);
  }
  return { accepted, used, failed };
}

// ── Character create round-trip (write half) ────────────────────────────────
// publishCharacter builds the unsigned kind-35100 event from a manifest, signs
// it via NIP-07, verifies it parses back to a valid character, then fans out to
// the unified relay list. Mirrors publishAccessSettings' shape. The read half is
// fetchOwnCharacter (above).

// publishCharacter(manifest, opts) → Promise<{ ok, event, accepted, used, failed, error }>.
// ok:true only when at least one relay accepted the signed event. Never throws.
export async function publishCharacter(manifest, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const sign = typeof o.sign === 'function' ? o.sign : signEvent;
  const publish = typeof o.publish === 'function' ? o.publish : fanoutPublish;
  const relays = Array.isArray(o.relays) ? o.relays : _effectiveRelays();
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.floor(o.timeoutMs) : 5000;
  const out = { ok: false, event: null, accepted: 0, used: [], failed: [], error: null };

  if (typeof sign !== 'function') { out.error = 'nip-07-unavailable'; return out; }
  if (typeof publish !== 'function') { out.error = 'publish-transport-required'; return out; }
  if (!relays.length) { out.error = 'at-least-one-relay-required'; return out; }

  const unsigned = buildCharacterEvent(manifest, { pubkey: o.pubkey, createdAt: o.createdAt });
  let signed;
  try { signed = await sign(unsigned); } catch { out.error = 'nip-07-threw'; return out; }
  if (!signed || !signed.ok || !signed.event) { out.error = (signed && signed.error) || 'nip-07-failed'; return out; }

  const parsed = parseCharacterEvent(signed.event);
  if (!parsed || !parsed.valid) { out.error = 'signed-character-invalid'; return out; }

  let res;
  try { res = await publish(relays, signed.event, { timeoutMs }); } catch { out.error = 'publish-threw'; return out; }
  out.accepted = (res && res.accepted) || 0;
  out.used = Array.isArray(res && res.used) ? res.used : [];
  out.failed = Array.isArray(res && res.failed) ? res.failed : [];
  out.event = signed.event;
  out.ok = out.accepted > 0;
  if (!out.ok) out.error = 'no-relay-accepted';
  return out;
}

// ── Blossom upload (NIP-96/NIP-98) ───────────────────────────────────────────
// The "make it so" path for a custom mesh: upload a GLB to a Blossom server and
// get back its content-addressed sha256, which then slots into the manifest's
// mesh.hash. NIP-98 HTTP auth signs a kind-27235 event over the upload URL; the
// file bytes go up in a PUT. Signing is delegated to NIP-07 (no key here).

export const BLOSSOM_AUTH_KIND = 27235;
export const DEFAULT_BLOSSOM_SERVER = 'https://blossom.primal.net';

// buildBlossomAuthEvent(server, method, opts) → the UNSIGNED NIP-98 auth event
// for a Blossom upload. Pure; the signer fills pubkey/sig/id.
export function buildBlossomAuthEvent(server, method = 'PUT', opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const base = typeof server === 'string' ? server.replace(/\/+$/, '') : '';
  return {
    kind: BLOSSOM_AUTH_KIND,
    created_at: Number.isFinite(o.createdAt) ? Math.floor(o.createdAt) : Math.floor(Date.now() / 1000),
    tags: [['u', `${base}/upload`], ['method', String(method || 'PUT').toUpperCase()]],
    content: '',
  };
}

function _b64(str) {
  if (typeof btoa === 'function') return btoa(str);
  if (typeof Buffer !== 'undefined') return Buffer.from(str, 'utf8').toString('base64');
  return '';
}

// uploadBlossom(file, opts) → Promise<{ ok, sha256, url, error }>. `file` is a
// Blob/File (browser). `opts.server` overrides the default Blossom server; the
// operator may point this at a self-hosted Blossom instance. Never throws.
export async function uploadBlossom(file, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const server = (typeof o.server === 'string' && o.server.trim() ? o.server.trim() : DEFAULT_BLOSSOM_SERVER).replace(/\/+$/, '');
  const sign = typeof o.sign === 'function' ? o.sign : signEvent;
  const out = { ok: false, sha256: null, url: null, error: null };

  if (!file || (typeof file.arrayBuffer !== 'function' && !(typeof Blob !== 'undefined' && file instanceof Blob))) {
    out.error = 'file-required'; return out;
  }
  if (typeof sign !== 'function') { out.error = 'nip-07-unavailable'; return out; }
  if (typeof fetch !== 'function') { out.error = 'fetch-unavailable'; return out; }

  let signed;
  try { signed = await sign(buildBlossomAuthEvent(server, 'PUT')); } catch { out.error = 'nip-07-threw'; return out; }
  if (!signed || !signed.ok || !signed.event) { out.error = (signed && signed.error) || 'nip-07-failed'; return out; }

  const authHeader = 'Nostr ' + _b64(JSON.stringify(signed.event));
  let res;
  try {
    res = await fetch(`${server}/upload`, { method: 'PUT', headers: { Authorization: authHeader }, body: file });
  } catch { out.error = 'upload-failed'; return out; }
  if (!res || !res.ok) { out.error = 'upload-http-' + (res ? res.status : 'err'); return out; }

  let data;
  try { data = await res.json(); } catch { out.error = 'upload-bad-response'; return out; }
  const sha = data && (data.sha256 || (data.url && String(data.url).split('/').pop()));
  if (!sha || !/^[0-9a-f]{64}$/.test(sha)) { out.error = 'upload-no-sha256'; return out; }
  out.sha256 = sha;
  out.url = data.url || `${server}/${sha}`;
  out.ok = true;
  return out;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ACCESS_SETTINGS_KIND = 30078;
const ACCESS_SETTINGS_SCHEMA_VERSION = 1;
const ACCESS_SETTINGS_CACHE_TTL_MS = 5000;
const ACCESS_SETTINGS_CACHE = new Map();
const ACCESS_SETTINGS_EVENT_LIMIT = 50;
const ACCESS_SUPPORTED_MODES = new Set(['public', 'follows-only', 'whitelist', 'invite-only']);
const ACCESS_EDITABLE_MODES = new Set(['public', 'follows-only']);
const ACCESS_SUPPORTED_POLICIES = new Set(['visitor-follows-owner', 'mutual', 'owner-follows-visitor']);
const ACCESS_EDITABLE_WRITE_POLICIES = new Set([WRITE_POLICY_OWNER_ONLY, WRITE_POLICY_DELEGATES, WRITE_POLICY_FOLLOWS_WRITE]);

export {
  ACCESS_SETTINGS_KIND,
  ACCESS_SETTINGS_SCHEMA_VERSION,
  ACCESS_SETTINGS_CACHE_TTL_MS,
};

function _accessPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function _normaliseAccessRelays(relays) {
  const list = Array.isArray(relays) ? relays : (typeof relays === 'string' ? [relays] : []);
  return [...new Set(list.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()))].sort();
}

function _normaliseAccessMode(raw) {
  const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ACCESS_SUPPORTED_MODES.has(mode) ? mode : '';
}

function _normaliseAccessPolicy(raw) {
  const policy = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return ACCESS_SUPPORTED_POLICIES.has(policy) ? policy : '';
}

function _normaliseInstanceId(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value || value.length > 200) return '';
  return value;
}

function _readDTag(tags) {
  const list = Array.isArray(tags) ? tags : [];
  for (const tag of list) {
    if (Array.isArray(tag) && tag[0] === 'd' && typeof tag[1] === 'string') return tag[1];
  }
  return '';
}

function _accessCacheKey({ instanceId, ownerPubkey, relays }) {
  return JSON.stringify([instanceId, ownerPubkey, _normaliseAccessRelays(relays)]);
}

function _normaliseDelegateSet(raw) {
  const list = Array.isArray(raw) ? raw : (raw instanceof Set ? [...raw] : []);
  return [...new Set(list
    .map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '')
    .filter((value) => HEX64.test(value)))].sort();
}

function _cloneAccessSettings(settings) {
  return settings ? { ...settings, delegateSet: _normaliseDelegateSet(settings.delegateSet) } : null;
}

export function buildAccessSettingsDTag(instanceId) {
  const normalised = _normaliseInstanceId(instanceId);
  return normalised ? `torii:quest:access:${normalised}` : '';
}

export function parseAccessSettingsContent(content) {
  if (typeof content !== 'string' || !content.trim()) {
    return { ok: false, settings: null, error: 'access-settings-content-required' };
  }
  let parsed;
  try { parsed = JSON.parse(content); }
  catch {
    return { ok: false, settings: null, error: 'access-settings-json-invalid' };
  }
  const obj = _accessPlainObject(parsed);
  const schemaVersion = Number.isInteger(obj.schemaVersion) ? obj.schemaVersion : NaN;
  const instanceId = _normaliseInstanceId(obj.instanceId);
  const ownerPubkey = typeof obj.ownerPubkey === 'string' ? obj.ownerPubkey.trim().toLowerCase() : '';
  const arrivalMode = _normaliseAccessMode(obj.arrivalMode);
  const followPolicy = _normaliseAccessPolicy(obj.followPolicy);
  const writePolicy = normaliseWritePolicy(obj.writePolicy).policy;
  const delegateSet = _normaliseDelegateSet(obj.delegateSet);
  const updatedAt = (typeof obj.updatedAt === 'string' && obj.updatedAt.trim())
    ? obj.updatedAt.trim()
    : (Number.isFinite(obj.updatedAt) ? String(obj.updatedAt) : '');
  if (schemaVersion !== ACCESS_SETTINGS_SCHEMA_VERSION) {
    return { ok: false, settings: null, error: 'access-settings-schema-invalid' };
  }
  if (!instanceId) return { ok: false, settings: null, error: 'access-settings-instance-invalid' };
  if (!HEX64.test(ownerPubkey)) return { ok: false, settings: null, error: 'access-settings-owner-invalid' };
  if (!arrivalMode) return { ok: false, settings: null, error: 'access-settings-mode-invalid' };
  if (!followPolicy) return { ok: false, settings: null, error: 'access-settings-policy-invalid' };
  if (!updatedAt) return { ok: false, settings: null, error: 'access-settings-updated-at-invalid' };
  return {
    ok: true,
    settings: { schemaVersion, instanceId, ownerPubkey, arrivalMode, followPolicy, writePolicy, delegateSet, updatedAt },
    error: null,
  };
}

export function verifyAccessSettingsEvent(event, opts = {}) {
  const o = _accessPlainObject(opts);
  const expectedOwnerPubkey = typeof o.ownerPubkey === 'string' ? o.ownerPubkey.trim().toLowerCase() : '';
  const expectedInstanceId = _normaliseInstanceId(o.instanceId);
  const expectedDTag = buildAccessSettingsDTag(expectedInstanceId);
  if (!event || event.kind !== ACCESS_SETTINGS_KIND) {
    return { ok: false, settings: null, error: 'access-settings-kind-invalid' };
  }
  if (!HEX64.test(expectedOwnerPubkey) || !expectedInstanceId || !expectedDTag) {
    return { ok: false, settings: null, error: 'access-settings-target-invalid' };
  }
  if (typeof event.pubkey !== 'string' || event.pubkey.toLowerCase() !== expectedOwnerPubkey) {
    return { ok: false, settings: null, error: 'access-settings-owner-mismatch' };
  }
  if (_readDTag(event.tags) !== expectedDTag) {
    return { ok: false, settings: null, error: 'access-settings-d-tag-invalid' };
  }
  if (!verifyNostrEventSig(event)) {
    return { ok: false, settings: null, error: 'access-settings-sig-invalid' };
  }
  const parsed = parseAccessSettingsContent(event.content);
  if (!parsed.ok) return parsed;
  if (parsed.settings.instanceId !== expectedInstanceId) {
    return { ok: false, settings: null, error: 'access-settings-instance-mismatch' };
  }
  if (parsed.settings.ownerPubkey !== expectedOwnerPubkey) {
    return { ok: false, settings: null, error: 'access-settings-owner-mismatch' };
  }
  return {
    ok: true,
    settings: {
      ...parsed.settings,
      createdAt: Number.isFinite(event.created_at) ? event.created_at : 0,
      eventId: typeof event.id === 'string' ? event.id : '',
      dTag: expectedDTag,
    },
    error: null,
  };
}

export async function readLatestAccessSettings(opts = {}) {
  const o = _accessPlainObject(opts);
  const request = typeof o.request === 'function' ? o.request : null;
  const instanceId = _normaliseInstanceId(o.instanceId);
  const ownerPubkey = typeof o.ownerPubkey === 'string' ? o.ownerPubkey.trim().toLowerCase() : '';
  const relays = _normaliseAccessRelays(o.relays);
  const nowMs = Number.isFinite(o.nowMs) ? Math.floor(o.nowMs) : Date.now();
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.floor(o.timeoutMs) : 5000;
  const graceMs = Number.isFinite(o.graceMs) && o.graceMs >= 0 ? Math.floor(o.graceMs) : 250;
  const retries = Number.isFinite(o.retries) && o.retries >= 0 ? Math.floor(o.retries) : 1;
  const cacheTtlMs = Number.isFinite(o.cacheTtlMs) && o.cacheTtlMs >= 0 ? Math.floor(o.cacheTtlMs) : ACCESS_SETTINGS_CACHE_TTL_MS;
  const key = _accessCacheKey({ instanceId, ownerPubkey, relays });
  const cached = ACCESS_SETTINGS_CACHE.get(key);
  const cachedOut = cached && cached.settings
    ? {
        ok: true,
        settings: _cloneAccessSettings(cached.settings),
        cached: true,
        stale: true,
        error: null,
        used: cached.used.slice(),
        failed: cached.failed.slice(),
      }
    : null;

  if (!instanceId || !HEX64.test(ownerPubkey)) {
    return { ok: false, settings: null, cached: false, stale: false, error: 'access-settings-target-invalid', used: [], failed: relays };
  }
  if (cached && cached.expiresAt > nowMs && cached.settings) {
    return {
      ok: true,
      settings: _cloneAccessSettings(cached.settings),
      cached: true,
      stale: false,
      error: null,
      used: cached.used.slice(),
      failed: cached.failed.slice(),
    };
  }
  if (!request || relays.length === 0) {
    return cachedOut || { ok: false, settings: null, cached: false, stale: false, error: 'access-settings-unavailable', used: [], failed: relays };
  }

  let raw;
  try {
    raw = await request(relays, [{ kinds: [ACCESS_SETTINGS_KIND], authors: [ownerPubkey], '#d': [buildAccessSettingsDTag(instanceId)], limit: ACCESS_SETTINGS_EVENT_LIMIT }], {
      timeoutMs,
      graceMs,
      retries,
    });
  } catch {
    return cachedOut || { ok: false, settings: null, cached: false, stale: false, error: 'access-settings-unavailable', used: [], failed: relays };
  }

  const events = raw && Array.isArray(raw.events) ? raw.events : [];
  const used = raw && Array.isArray(raw.used) ? raw.used.slice() : [];
  const failed = raw && Array.isArray(raw.failed) ? raw.failed.slice() : [];
  let latest = null;
  for (const event of events) {
    const verified = verifyAccessSettingsEvent(event, { instanceId, ownerPubkey });
    if (!verified.ok) continue;
    const createdAt = Number.isFinite(verified.settings.createdAt) ? verified.settings.createdAt : -Infinity;
    const latestCreatedAt = latest && Number.isFinite(latest.settings.createdAt) ? latest.settings.createdAt : -Infinity;
    const isNewer = !latest
      || createdAt > latestCreatedAt
      || (createdAt === latestCreatedAt && String(verified.settings.eventId) > String(latest.settings.eventId));
    if (isNewer) latest = verified;
  }
  if (!latest) {
    ACCESS_SETTINGS_CACHE.delete(key);
    return { ok: true, settings: null, cached: false, stale: false, error: null, used, failed };
  }
  ACCESS_SETTINGS_CACHE.set(key, {
    settings: _cloneAccessSettings(latest.settings),
    used,
    failed,
    expiresAt: nowMs + cacheTtlMs,
  });
  return { ok: true, settings: _cloneAccessSettings(latest.settings), cached: false, stale: false, error: null, used, failed };
}

export async function publishAccessSettings(opts = {}) {
  const o = _accessPlainObject(opts);
  const sign = typeof o.sign === 'function' ? o.sign : signEvent;
  const publish = typeof o.publish === 'function' ? o.publish : fanoutPublish;
  const instanceId = _normaliseInstanceId(o.instanceId);
  const ownerPubkey = typeof o.ownerPubkey === 'string' ? o.ownerPubkey.trim().toLowerCase() : '';
  const arrivalMode = _normaliseAccessMode(o.arrivalMode);
  const followPolicy = _normaliseAccessPolicy(o.followPolicy || 'visitor-follows-owner');
  const writePolicyMeta = normaliseWritePolicy(o.writePolicy);
  const writePolicy = writePolicyMeta.policy;
  const delegateSet = _normaliseDelegateSet(o.delegateSet);
  const relays = _normaliseAccessRelays(o.relays);
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.floor(o.timeoutMs) : 5000;
  const nowMs = Number.isFinite(o.nowMs) ? Math.floor(o.nowMs) : Date.now();
  const updatedAt = typeof o.updatedAt === 'string' && o.updatedAt.trim()
    ? o.updatedAt.trim()
    : new Date(nowMs).toISOString();
  const out = { ok: false, accepted: 0, used: [], failed: [], settings: null, error: null };
  if (!instanceId || !HEX64.test(ownerPubkey)) { out.error = 'access-settings-target-invalid'; return out; }
  if (!ACCESS_EDITABLE_MODES.has(arrivalMode)) { out.error = 'access-settings-mode-not-editable'; return out; }
  if (!followPolicy) { out.error = 'access-settings-policy-invalid'; return out; }
  if (o.writePolicy != null && !writePolicyMeta.editable) { out.error = 'access-settings-write-policy-not-editable'; return out; }
  if (!ACCESS_EDITABLE_WRITE_POLICIES.has(writePolicy)) { out.error = 'access-settings-write-policy-not-editable'; return out; }
  if (typeof sign !== 'function') { out.error = 'nip-07-unavailable'; return out; }
  if (typeof publish !== 'function') { out.error = 'publish-transport-required'; return out; }
  if (!relays.length) { out.error = 'at-least-one-relay-required'; return out; }

  const payload = {
    schemaVersion: ACCESS_SETTINGS_SCHEMA_VERSION,
    instanceId,
    ownerPubkey,
    arrivalMode,
    followPolicy,
    writePolicy,
    delegateSet,
    updatedAt,
  };
  const unsigned = {
    kind: ACCESS_SETTINGS_KIND,
    created_at: Math.floor(nowMs / 1000),
    tags: [['d', buildAccessSettingsDTag(instanceId)]],
    content: JSON.stringify(payload),
  };
  let signed;
  try { signed = await sign(unsigned); }
  catch {
    out.error = 'nip-07-threw';
    return out;
  }
  if (!signed || !signed.ok || !signed.event) {
    out.error = (signed && signed.error) || 'nip-07-failed';
    return out;
  }
  const verified = verifyAccessSettingsEvent(signed.event, { instanceId, ownerPubkey });
  if (!verified.ok) {
    out.error = verified.error || 'signed-event-invalid';
    return out;
  }
  let res;
  try { res = await publish(relays, signed.event, { timeoutMs }); }
  catch {
    out.error = 'publish-threw';
    return out;
  }
  out.accepted = (res && res.accepted) || 0;
  out.used = Array.isArray(res && res.used) ? res.used : [];
  out.failed = Array.isArray(res && res.failed) ? res.failed : [];
  out.settings = _cloneAccessSettings(verified.settings);
  out.ok = out.accepted > 0;
  if (!out.ok) {
    out.error = 'no-relay-accepted';
    return out;
  }
  ACCESS_SETTINGS_CACHE.set(_accessCacheKey({ instanceId, ownerPubkey, relays }), {
    settings: _cloneAccessSettings(verified.settings),
    used: out.used.slice(),
    failed: out.failed.slice(),
    expiresAt: nowMs + ACCESS_SETTINGS_CACHE_TTL_MS,
  });
  return out;
}

export function __resetAccessSettingsCache() {
  ACCESS_SETTINGS_CACHE.clear();
}
