// nostr.js — NIP-07 login, kind:0 profile fetch
import { state } from './state.js';
import { emit, EV } from './events.js';
import { resolveMpHttpBase, loginForSessionToken } from './engine/multiplayer/sessionAuth.js';

const RELAYS = ['wss://relay.damus.io','wss://nos.lol','wss://relay.nostr.band','wss://relay.primal.net'];
export { RELAYS };

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

// v0.2.260 audit S5: fan out the kind:0 profile lookup across every relay in
// parallel via fanoutReq() and pick the freshest event (highest created_at).
// The previous implementation only contacted RELAYS[0] (break after the first
// successful WebSocket construction), so a single offline lead relay left the
// player as "PUBKEY12" forever even though their profile was happily on the
// other three. Sanitises name + picture through the existing safe-* helpers.
async function _fetchProfile(pubkey) {
  const { events } = await fanoutReq(
    RELAYS,
    [{ kinds: [0], authors: [pubkey], limit: 1 }],
    { timeoutMs: 5000 },
  );
  if (!events.length) return;
  // Pick the latest signed kind:0 across relays — replaceable events follow
  // "latest created_at wins" semantics (NIP-01).
  let latest = events[0];
  for (const e of events) {
    if (e && Number.isFinite(e.created_at) && e.created_at > (latest.created_at | 0)) {
      latest = e;
    }
  }
  let meta;
  try { meta = JSON.parse(latest.content); } catch { return; }
  if (!meta || typeof meta !== 'object') return;
  const safeName = _safeName(meta.name);
  const safePic  = _safeImageUrl(meta.picture);
  if (safeName) { state.nostrName = safeName; }
  if (safePic)  { state.nostrAvatar = safePic; }
  emit(EV.NOSTR_LOGIN, { pubkey, name: safeName, avatar: safePic });
  _updateTitleUI();
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
