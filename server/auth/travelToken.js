// server/auth/travelToken.js — server side of the signed travel token.
//
// Adds the pieces a pure structural verifier must NOT own: single-use consumption
// (a captured token can only seat one session) and the canonical audience URL
// (never trust a forwarded Host header). The cryptographic + structural check is
// shared with the client via verifyTravelEvent (src/engine/gateway/travelToken.js).

import {
  verifyTravelEvent,
  TRAVEL_PATH,
  TRAVEL_TTL_S,
} from '../../src/engine/gateway/travelToken.js';

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Resolve the canonical travel audience URL — the value a signer must place in
 * the token's `u` tag. Prefer the explicit TRAVEL_AUDIENCE_URL; otherwise derive
 * from QUEST_PUBLIC_URL's ORIGIN + '/mp/travel'. Returns '' when unconfigured
 * (the caller skips the audience check — sandbox / dynamic origins, exactly like
 * defaultLoginAudienceUrl in sessionTokens.js).
 */
export function defaultTravelAudienceUrl(env = process.env) {
  const explicit = (env && env.TRAVEL_AUDIENCE_URL ? String(env.TRAVEL_AUDIENCE_URL).trim() : '');
  if (explicit) return explicit;
  const base = (env && env.QUEST_PUBLIC_URL ? String(env.QUEST_PUBLIC_URL).trim() : '');
  if (!base) return '';
  let origin;
  try { origin = new URL(base).origin; } catch { return ''; }
  return `${origin}${TRAVEL_PATH}`;
}

/**
 * Create a travel-token authority: verifies a signed travel event (shared pure
 * check) and enforces single-use per event.id.
 *
 * @param {object} [deps]
 * @param {() => number} [deps.now]                 ms clock (default Date.now)
 * @param {string} [deps.audienceUrl]               canonical audience URL (defaults
 *        to defaultTravelAudienceUrl()); '' disables the audience check.
 * @param {Map} [deps.consumedStore]                event.id -> { expiresAt }
 * @param {number} [deps.maxConsumed]               outstanding consumed-entry cap (F08)
 * @param {number} [deps.ttlMs]                     how long a consumed id is retained
 */
export function createTravelTokens(deps = {}) {
  const {
    now = () => Date.now(),
    audienceUrl = defaultTravelAudienceUrl(),
    consumedStore = new Map(),
    maxConsumed = 10000,
    ttlMs = (TRAVEL_TTL_S + 60) * 1000,
  } = deps;

  /**
   * Verify a signed travel event and atomically consume it (single-use). Returns
   * the signer's hex pubkey on success, or null on any failure (fail-closed).
   * @param {object} event
   */
  function verifyAndConsume(event) {
    const v = verifyTravelEvent({ event, audienceUrl, nowMs: now() });
    if (!v.ok || !HEX64.test(v.pubkey)) return null;
    const id = event && typeof event.id === 'string' ? event.id : '';
    if (!id) return null;
    if (consumedStore.has(id)) return null; // replay → reject
    if (consumedStore.size >= maxConsumed) {
      // Bound: evict expired first; if still full, reject (do-not-grow).
      cleanup();
      if (consumedStore.size >= maxConsumed) return null;
    }
    consumedStore.set(id, { expiresAt: now() + ttlMs });
    return v.pubkey;
  }

  /** Purge expired consumed ids. Cheap; call on a timer + on cap-hit. */
  function cleanup() {
    const t = now();
    for (const [k, rec] of consumedStore) if (rec.expiresAt <= t) consumedStore.delete(k);
  }

  return {
    verifyAndConsume,
    cleanup,
    // Exposed for observability/tests only — contains only event ids, no secrets.
    _consumedStore: consumedStore,
  };
}