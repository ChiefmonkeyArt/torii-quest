// engine/gateway/travelToken.js — the SIGNED travel token (seamless gate-cross).
//
// The open-visit hop currently appends the traveller's hex pubkey as an UNSIGNED
// `?torii-traveller=` hint; the destination cannot trust it (it is spoofable), so
// the traveller must re-approve a NIP-07 sign-in in the NEW world. This module
// replaces that hinge with a short-lived, single-use NIP-98 (kind:27235) "travel"
// event signed ONCE in the ORIGIN world (where the signer is already active) and
// verified by the DESTINATION before it auto-seats the session — no re-sign.
//
//   event = { kind:27235, created_at, content:'', tags:[
//     ['u', <destination travel audience URL>],  // who this token is addressed to
//     ['t', 'travel'],                            // action verb
//     ['expiration', <unix-seconds>]            // NIP-40 TTL (bounds replay)
//   ] }   -- signed → adds id, pubkey, sig
//
// PURE + node-safe: no DOM, no window, no NIP-07 (signing is injected), no fetch.
// The structural/signature verifier is shared by the client (pre-check + tests)
// and the SERVER (authoritative — the server adds single-use consumption on top
// of verifyTravelEvent in server/auth/travelToken.js). Mirrors how nostrSig.js is
// imported by server/auth/sessionTokens.js.

import { verifyNostrEventSig } from '../crypto/nostrSig.js';

export const TRAVEL_EVENT_KIND = 27235; // NIP-98 HTTP Auth
export const TRAVEL_ACTION     = 'travel';
export const TRAVEL_PATH       = '/mp/travel';
export const TRAVEL_TTL_S      = 300; // 5-minute token lifetime
export const MAX_CLOCK_SKEW_S  = 300; // symmetric created_at tolerance

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Build the UNSIGNED travel event addressed to `audienceUrl`. Pure; never signs.
 * @param {{ audienceUrl:string, nowMs?:number }} args
 * @returns {object|null} the unsigned event, or null if audienceUrl is blank.
 */
export function buildTravelUnsigned({ audienceUrl, nowMs = Date.now() } = {}) {
  if (typeof audienceUrl !== 'string' || !audienceUrl) return null;
  const created = Math.floor(nowMs / 1000);
  const expiration = created + TRAVEL_TTL_S;
  return {
    kind: TRAVEL_EVENT_KIND,
    created_at: created,
    content: '',
    tags: [
      ['u', audienceUrl],
      ['t', TRAVEL_ACTION],
      ['expiration', String(expiration)],
    ],
  };
}

/**
 * Sign a travel event via the injected signer (window.nostr.signEvent in prod).
 * Returns the signed event, or null on any failure (fail-closed).
 * @param {{ unsigned:object, signEvent:(unsigned:object)=>Promise<object> }} args
 */
export async function signTravelToken({ unsigned, signEvent } = {}) {
  if (!unsigned || typeof signEvent !== 'function') return null;
  try {
    const signed = await signEvent(unsigned);
    if (!signed || typeof signed.sig !== 'string' || typeof signed.pubkey !== 'string') return null;
    return signed;
  } catch {
    return null;
  }
}

/**
 * Pure structural + cryptographic verification of a signed travel event. The
 * SERVER is authoritative — this is also usable client-side for an early reject
 * and is the unit under test. Does NOT track single-use (that is server state).
 * @param {{ event:object, audienceUrl?:string, nowMs?:number,
 *           verifySig?:(evt:object)=>boolean }} args
 * @returns {{ ok:boolean, pubkey:string|null, reason:string|null }}
 */
export function verifyTravelEvent({
  event,
  audienceUrl = '',
  nowMs = Date.now(),
  verifySig = verifyNostrEventSig,
} = {}) {
  const fail = (reason) => ({ ok: false, pubkey: null, reason });
  if (!event || typeof event !== 'object') return fail('bad-event');
  if (event.kind !== TRAVEL_EVENT_KIND) return fail('bad-kind');
  if (!HEX64.test(event.pubkey || '')) return fail('bad-pubkey');
  if (!Array.isArray(event.tags)) return fail('bad-tags');

  const get = (name) => event.tags.find((t) => Array.isArray(t) && t[0] === name);
  const u = get('u');
  const t = get('t');
  const exp = get('expiration');

  if (audienceUrl) {
    if (!u || u[1] !== audienceUrl) return fail('bad-audience');
  }
  if (!t || t[1] !== TRAVEL_ACTION) return fail('bad-action');
  if (!exp || typeof exp[1] !== 'string') return fail('bad-expiration');

  const expSec = Number(exp[1]);
  if (!Number.isInteger(expSec) || expSec <= Math.floor(nowMs / 1000)) return fail('expired');

  const created = event.created_at;
  if (typeof created !== 'number' || !Number.isFinite(created)) return fail('bad-created');
  if (Math.abs(Math.floor(nowMs / 1000) - created) > MAX_CLOCK_SKEW_S) return fail('stale');
  if (created >= expSec) return fail('expired');

  if (!verifySig(event)) return fail('bad-sig');
  return { ok: true, pubkey: event.pubkey, reason: null };
}

/**
 * Derive a destination's travel audience URL from its world `website` (https
 * origin + TRAVEL_PATH). Matches the server's canonical audience derivation.
 * Returns '' when the website cannot be parsed (caller skips the audience check
 * or aborts). Pure; never throws.
 * @param {string} website
 */
export function travelAudienceFromWebsite(website) {
  if (typeof website !== 'string' || !website) return '';
  let origin;
  try { origin = new URL(website).origin; } catch { return ''; }
  return `${origin}${TRAVEL_PATH}`;
}