// src/engine/presence/beaconClient.js — client side of the ADR-0094 server-side
// always-on presence beacon.
//
// The owner's browser is only responsible for ACTUATING the server beacon (turn
// it on once on first admin login, allow an off switch): it reads the server's
// public state and POSTs an on/off action carrying the existing session bearer
// token. It never holds the beacon key and never publishes presence itself while
// the server beacon is enabled — the server is the single source of truth.
//
// PURE + node-safe: fetch is injected; no DOM, no THREE, no timers. Never throws.

// fetchBeaconState({ httpBase, fetchImpl }) → the public server beacon state,
// degrading to { enabled:false } on any failure (so an unreachable server never
// blocks the shell). Shape mirrors /mp/admin/beacon's capability().
export async function fetchBeaconState({ httpBase, fetchImpl } = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof httpBase !== 'string' || !httpBase || typeof f !== 'function') {
    return { enabled: false };
  }
  try {
    const res = await f(`${httpBase}/admin/beacon`, { method: 'GET' });
    if (!res || !res.ok) return { enabled: false };
    const body = await res.json();
    return {
      enabled: !!(body && body.enabled === true),
      activatedAt: body && typeof body.activatedAt === 'number' ? body.activatedAt : null,
      pubkey: body && typeof body.pubkey === 'string' ? body.pubkey : null,
      adminPubkey: body && typeof body.adminPubkey === 'string' ? body.adminPubkey : null,
      lastPublishedAt: body && typeof body.lastPublishedAt === 'number' ? body.lastPublishedAt : null,
      lastError: body && typeof body.lastError === 'string' ? body.lastError : null,
    };
  } catch {
    return { enabled: false };
  }
}

// setBeacon({ httpBase, token, action, fetchImpl }) → POST the on/off action with
// the session bearer token. Never throws; returns { ok, error?, ...state }.
export async function setBeacon({ httpBase, token, action, fetchImpl } = {}) {
  const f = fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
  if (typeof httpBase !== 'string' || !httpBase || typeof f !== 'function') {
    return { ok: false, error: 'no http base' };
  }
  if (typeof token !== 'string' || !token) return { ok: false, error: 'no session token' };
  if (action !== 'on' && action !== 'off') return { ok: false, error: 'bad action' };
  try {
    const res = await f(`${httpBase}/admin/beacon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action }),
    });
    let body = {};
    try { body = await res.json(); } catch { /* tolerate empty body */ }
    if (res && res.ok && body && body.ok) return { ok: true, ...body };
    return { ok: false, code: res ? res.status : 0, error: (body && body.error) || 'request failed' };
  } catch {
    return { ok: false, error: 'network error' };
  }
}