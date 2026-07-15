// src/engine/update/adminUpdateClient.js — client side of the admin "Update Now"
// server-reinstall flow (UPD-2, v0.2.387-alpha).
//
// The version box's "Update Now" button is shown ONLY when the arena reports
// autoUpdate=true AND the logged-in operator's pubkey === the admin pubkey the
// (public) capability endpoint sends down. On click the client signs ONE fresh
// intent event, POSTs it (with the existing session bearer token) to
// /mp/admin/update, and polls /mp/admin/update-status until the root runner
// finishes. The client NEVER installs anything and NEVER sends a target ref — the
// server-side runner resolves the latest tag itself.
//
// PURE + node-safe: no DOM, no THREE. Every edge (fetch, signer, RNG, clock) is
// INJECTED, so the whole flow is unit-testable with fakes. Never throws — network
// failures resolve to a structured error result the caller renders inertly.

export const INTENT_KIND = 1;

// v0.2.393-alpha: hard wall-clock ceiling for the DEPLOYING stage. The deploy
// restarts arena-ws (~9s); if the poller has seen no terminal state after this
// long it assumes the restart finished and auto-reloads rather than sticking.
export const DEPLOY_STALL_MS = 30000;

// The exact human deploy command, with the latest tag inlined, for the copy-command
// fallback shown when auto-update is not installed on the instance.
export function deployCommand(latestTag) {
  const tag = typeof latestTag === 'string' && /^v?\d/.test(latestTag) ? latestTag : '<tag>';
  const ref = tag.startsWith('v') ? tag : `v${tag}`;
  return [
    'cd ~/torii-src',
    'git fetch --tags origin',
    `git checkout ${ref}`,
    'npm ci',
    'npm run build',
    'npm run check',
  ].join(' && ');
}

// A ≥16-char lowercase-hex nonce. `randomFn(n)` returns >= n bytes (default
// crypto.getRandomValues via a Uint8Array; caller injects a deterministic source
// in tests).
export function newNonce(randomFn) {
  const n = 12; // 12 bytes → 24 hex chars (≥16)
  let bytes;
  if (typeof randomFn === 'function') {
    bytes = randomFn(n);
  } else if (typeof globalThis !== 'undefined' && globalThis.crypto
      && typeof globalThis.crypto.getRandomValues === 'function') {
    bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
  } else {
    bytes = new Uint8Array(n); // last-resort: zeros (tests always inject)
  }
  let hex = '';
  for (let i = 0; i < n; i += 1) hex += (bytes[i] & 0xff).toString(16).padStart(2, '0');
  return hex;
}

// buildIntentEvent({ nonce, now }) → the UNSIGNED intent event to hand to the
// NIP-07 signer. content is `torii-quest:update-now:<nonce>`; created_at is unix
// SECONDS (NIP-01). The server checks kind===1, content shape, freshness (≤120s),
// pubkey===admin, and the schnorr signature.
export function buildIntentEvent({ nonce, now = () => Date.now() } = {}) {
  return {
    kind: INTENT_KIND,
    created_at: Math.floor(now() / 1000),
    content: `torii-quest:update-now:${nonce}`,
    tags: [],
  };
}

// isAdminOperator(operatorPubkey, adminPubkey) → true iff both are the same hex64.
export function isAdminOperator(operatorPubkey, adminPubkey) {
  const HEX64 = /^[0-9a-f]{64}$/;
  const op = typeof operatorPubkey === 'string' ? operatorPubkey.toLowerCase() : '';
  const admin = typeof adminPubkey === 'string' ? adminPubkey.toLowerCase() : '';
  return HEX64.test(op) && HEX64.test(admin) && op === admin;
}

// fetchCapability({ httpBase, fetchImpl }) → { autoUpdate, adminPubkey }. Public,
// no auth. Any failure degrades to { autoUpdate:false, adminPubkey:null }.
export async function fetchCapability({ httpBase, fetchImpl } = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof httpBase !== 'string' || !httpBase || typeof f !== 'function') {
    return { autoUpdate: false, adminPubkey: null };
  }
  try {
    const res = await f(`${httpBase}/admin/update-capability`, { method: 'GET' });
    if (!res || !res.ok) return { autoUpdate: false, adminPubkey: null };
    const body = await res.json();
    return {
      autoUpdate: !!(body && body.autoUpdate === true),
      adminPubkey: body && typeof body.adminPubkey === 'string' ? body.adminPubkey : null,
    };
  } catch {
    return { autoUpdate: false, adminPubkey: null };
  }
}

// requestUpdate({ httpBase, token, signEvent, nonce, now, fetchImpl }) →
//   { ok, state } | { ok:false, code, error }. Signs the intent and POSTs it with
//   the session bearer token. Never throws.
export async function requestUpdate({
  httpBase, token, signEvent, nonce, now = () => Date.now(), fetchImpl,
} = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof httpBase !== 'string' || !httpBase) return { ok: false, error: 'no http base' };
  if (typeof token !== 'string' || !token) return { ok: false, error: 'no session token' };
  if (typeof signEvent !== 'function') return { ok: false, error: 'no signer' };
  if (typeof f !== 'function') return { ok: false, error: 'no fetch' };

  const n = typeof nonce === 'string' && nonce ? nonce : newNonce();
  const unsigned = buildIntentEvent({ nonce: n, now });
  let event;
  try {
    event = await signEvent(unsigned);
  } catch {
    return { ok: false, error: 'sign rejected' };
  }
  if (!event || typeof event.sig !== 'string' || typeof event.pubkey !== 'string') {
    return { ok: false, error: 'bad signature' };
  }
  try {
    const res = await f(`${httpBase}/admin/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ event }),
    });
    let body = {};
    try { body = await res.json(); } catch { /* tolerate empty body */ }
    if (res && res.ok && body && body.ok) return { ok: true, state: body.state || 'requested' };
    return { ok: false, code: res ? res.status : 0, error: (body && body.error) || 'request failed' };
  } catch {
    return { ok: false, error: 'network error' };
  }
}

// fetchStatus({ httpBase, token, fetchImpl }) → the status JSON, or
//   { state:'unavailable', code } on any failure. Never throws.
//
// v0.2.393-alpha: the status read is now PUBLIC, so `token` is OPTIONAL (sent as a
// bearer only when present). On failure the HTTP status is surfaced as `code` so
// the poller can tell a post-restart 403 (deploy almost certainly done) apart from
// a genuine network error. `code` is 0 for non-HTTP failures.
export async function fetchStatus({ httpBase, token, fetchImpl } = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof httpBase !== 'string' || !httpBase || typeof f !== 'function') {
    return { state: 'unavailable', code: 0 };
  }
  try {
    const headers = {};
    if (typeof token === 'string' && token) headers.Authorization = `Bearer ${token}`;
    const res = await f(`${httpBase}/admin/update-status`, { method: 'GET', headers });
    if (!res || !res.ok) return { state: 'unavailable', code: res ? res.status : 0 };
    const body = await res.json();
    if (!body || typeof body !== 'object' || typeof body.state !== 'string') {
      return { state: 'unavailable', code: res.status };
    }
    return body;
  } catch {
    return { state: 'unavailable', code: 0 };
  }
}
