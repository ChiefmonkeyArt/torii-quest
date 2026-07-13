// sessionAuth.js — client side of the "1 sign at login, 0 signs in-game" flow
// (v0.2.375-alpha).
//
// The player signs ONE NIP-98 (kind:27235) event at login in exchange for an
// opaque bearer token from the arena server. The token lives in sessionStorage
// and is replayed by the WS client on every arena entry / reconnect, so the
// NIP-07 signer is never prompted again for the arena.
//
// Impure at the edges (fetch, sessionStorage, the signer) but every edge is
// INJECTABLE, so the login/token logic is unit-testable with fakes. No THREE,
// no DOM beyond sessionStorage.
//
// The HTTP endpoints hang off the SAME origin + path as the WS mount: the WS
// dials wss://host<wsPath> (e.g. /mp), so the HTTP base is https://host<wsPath>
// and the endpoints are <base>/auth-challenge and <base>/session. We NEVER
// hard-code /mp here — the mount prefix (sandbox /port/5000, or a /quest
// subpath) is derived from the same MP_WS_PATH the WS client uses.

import { MP_WS_PATH } from '../../config.js';

export const SESSION_TOKEN_KEY = 'tq.mp.sessionToken';
export const LOGIN_EVENT_KIND  = 27235; // NIP-98 HTTP Auth

// PORT_SENTINEL: deploy_website rewrites __PORT_5000__ → 'port/5000' at upload
// time (pplx sandbox). Mirrors multiplayerHost.resolveUrl so the HTTP base and
// the WS URL always share the same mount prefix.
const PORT_SENTINEL = '__PORT_5000__';

/** Compute the WS path including any sandbox port-forward prefix. */
function resolveWsPath() {
  const rewritten = !PORT_SENTINEL.startsWith('__');
  return rewritten ? `/${PORT_SENTINEL}${MP_WS_PATH}` : MP_WS_PATH;
}

/**
 * Derive the HTTP base for the session endpoints from the current origin.
 * Returns e.g. "https://host/mp" or null if no location is available.
 * @param {object} [opts]
 * @param {Location|{host:string,protocol:string}} [opts.location]
 */
export function resolveMpHttpBase(opts = {}) {
  const loc = opts.location
    || (typeof globalThis !== 'undefined' && globalThis.location) || null;
  if (!loc || !loc.host) return null;
  const wsPath = resolveWsPath();
  // Same-origin: reuse the page protocol (https in prod → wss for the socket).
  const scheme = loc.protocol === 'http:' ? 'http:' : 'https:';
  return `${scheme}//${loc.host}${wsPath}`;
}

/** Convert a resolved ws(s):// URL into its http(s):// base (test helper). */
export function httpBaseFromWsUrl(wsUrl) {
  if (typeof wsUrl !== 'string') return null;
  return wsUrl.replace(/^wss:\/\//, 'https://').replace(/^ws:\/\//, 'http://');
}

// ---------- token storage (sessionStorage) ----------

function _storage(injected) {
  if (injected) return injected;
  try {
    if (typeof globalThis !== 'undefined' && globalThis.sessionStorage) return globalThis.sessionStorage;
  } catch { /* SecurityError under strict cookie policy */ }
  return null;
}

export function getStoredToken(storage) {
  const s = _storage(storage);
  if (!s) return null;
  try { return s.getItem(SESSION_TOKEN_KEY) || null; } catch { return null; }
}

export function setStoredToken(token, storage) {
  const s = _storage(storage);
  if (!s || typeof token !== 'string' || !token) return false;
  try { s.setItem(SESSION_TOKEN_KEY, token); return true; } catch { return false; }
}

export function clearStoredToken(storage) {
  const s = _storage(storage);
  if (!s) return;
  try { s.removeItem(SESSION_TOKEN_KEY); } catch { /* noop */ }
}

// ---------- login → token ----------

/**
 * Sign ONE NIP-98 login event over a fresh server challenge and exchange it for
 * a session token. Returns { token, npub } on success or null on any failure
 * (so the caller can fall back to window.nostr.getPublicKey()).
 *
 * @param {object} deps
 * @param {string} deps.httpBase                 e.g. "https://host/mp"
 * @param {(unsigned:object)=>Promise<object>} deps.signEvent  window.nostr.signEvent
 * @param {typeof fetch} [deps.fetchImpl]        default globalThis.fetch
 * @param {()=>number} [deps.now]                unix-ms clock
 * @param {(k:string,v:string)=>void} [deps.setToken]  store hook (default sessionStorage)
 */
export async function loginForSessionToken(deps) {
  const {
    httpBase,
    signEvent,
    fetchImpl = (typeof globalThis !== 'undefined' ? globalThis.fetch : undefined),
    now = () => Date.now(),
    setToken = (t) => setStoredToken(t),
  } = deps || {};

  if (typeof httpBase !== 'string' || !httpBase) return null;
  if (typeof signEvent !== 'function') return null;
  if (typeof fetchImpl !== 'function') return null;

  const sessionUrl = `${httpBase}/session`;
  try {
    // 1. Fetch a one-time challenge.
    const chalRes = await fetchImpl(`${httpBase}/auth-challenge`, { method: 'GET' });
    if (!chalRes || !chalRes.ok) return null;
    const chalBody = await chalRes.json();
    const challenge = chalBody && chalBody.challenge;
    if (typeof challenge !== 'string' || !challenge) return null;

    // 2. Sign the NIP-98 event scoped to the session endpoint (single prompt).
    const unsigned = {
      kind: LOGIN_EVENT_KIND,
      created_at: Math.floor(now() / 1000),
      content: '',
      tags: [
        ['u', sessionUrl],
        ['method', 'POST'],
        ['challenge', challenge],
      ],
    };
    const event = await signEvent(unsigned);
    if (!event || typeof event.sig !== 'string' || typeof event.pubkey !== 'string') return null;

    // 3. Exchange the signed event for a token.
    const sesRes = await fetchImpl(sessionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, challenge }),
    });
    if (!sesRes || !sesRes.ok) return null;
    const sesBody = await sesRes.json();
    const token = sesBody && sesBody.token;
    const npub = sesBody && sesBody.npub;
    if (typeof token !== 'string' || !token) return null;
    setToken(token);
    return { token, npub: typeof npub === 'string' ? npub : null };
  } catch {
    return null;
  }
}
