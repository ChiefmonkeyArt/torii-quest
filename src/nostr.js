// nostr.js — NIP-07 login, kind:0 profile fetch
import { state } from './state.js';
import { emit, EV } from './events.js';
import { resolveMpHttpBase, loginForSessionToken } from './engine/multiplayer/sessionAuth.js';

const RELAYS = ['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band','wss://relay.primal.net'];
const PROFILE_TIMEOUT_MS = 5000;
const PROFILE_SETTLE_MS = 1800;
export { RELAYS, PROFILE_SETTLE_MS };

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
    return `⚡ ${state.nostrName}`;
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
  const relays = Array.isArray(o.relays) ? o.relays : RELAYS;
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
