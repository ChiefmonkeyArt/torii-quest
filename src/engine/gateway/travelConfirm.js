// engine/gateway/travelConfirm.js — gateway TRAVEL CONFIRMATION / INTENT behind the
// consent gate (GATEWAY / NAP-zone handoff, v0.2.165). Proves the SHAPE of a future
// NAP-zone-to-NAP-zone travel action: it takes a SANITISED gateway destination (the
// v0.2.164 `gatewayRead` preview model, or a plain destination descriptor), builds a
// deterministic, sanitised travel intent, then routes that intent through the v0.2.162
// consent gate (`gateway:travel`). The result is an INERT report — it says where a
// host COULD travel and whether consent WOULD allow it, but it never navigates,
// unloads/reloads the world, writes, signs, publishes, sends, or connects.
//
// Pure + node-safe: NO browser navigation (`location.href`/`window.open`/router), NO
// world unload/reload, NO Nostr client, NO WebSocket, NO relay I/O, NO signing, NO
// publishing, NO NIP-07, NO key handling, NO payments, NO auto-update, NO DOM, NO
// network, NO auto-connect. This module NEVER performs the travel and exposes NO
// navigate/goto/travel/sign/publish/send/connect/apply/write surface — it only
// prepares a sanitised destination wrapped in a consent decision. A decision of
// `allowed:true` is permission for the HOST to act later behind its own audited,
// consented transport (the deferred travel/navigation path), never an action taken
// here. Every helper degrades safely on malformed input and never throws.

import { buildConsentRequest, evaluateConsent, summariseConsent } from '../consent/consentGate.js';
import { safeProfileUrl, shortPubkey } from '../nostr/profileRead.js';
import { validateRelayUrl } from '../nostr/relayRead.js';
import { looksLikeNpub } from './travelIntent.js';

// The single consent action this intent routes through.
export const TRAVEL_ACTION = 'gateway:travel';

// Caps so a hostile / oversized destination string can never bloat the intent.
const MAX_ID_LEN = 128;
const MAX_TITLE_LEN = 128;
const HEX64 = /^[0-9a-f]{64}$/;
// Control chars (C0 + DEL) and HTML angle brackets — stripped from destination text.
// Escapes (not raw bytes) keep the source safe to edit.
const UNSAFE_TEXT = /[\x00-\x1f\x7f<>]/g;
// The zoneType vocabulary mirrors travelIntent §4 (nap/arena/shop/gallery).
const ZONE_TYPES = Object.freeze(['nap', 'arena', 'shop', 'gallery']);

function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// _safeText(raw, maxLen) → a trimmed, control/markup-stripped, length-capped string,
// or null. Pure, never throws. Destination fields are attacker-controlled (anyone can
// publish a gateway record), so we strip control chars + `<`/`>` and cap length rather
// than trusting the input. Spaces and digits are preserved.
function _safeText(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(UNSAFE_TEXT, '').trim();
  if (cleaned === '') return null;
  return cleaned.length > maxLen ? cleaned.slice(0, maxLen) : cleaned;
}

// _safeRelays(raw) → a deduped array of validated ws/wss relay urls (capped), or [].
// Pure, never throws. Each candidate is run through relayRead.validateRelayUrl so a
// hostile relay string (credentials, non-ws scheme, relative) can never enter the intent.
function _safeRelays(raw) {
  const list = Array.isArray(raw) ? raw : (typeof raw === 'string' ? [raw] : []);
  const out = [];
  for (const r of list) {
    const { valid, url } = validateRelayUrl(r);
    if (valid && url && !out.includes(url)) out.push(url);
    if (out.length >= 16) break;
  }
  return out;
}

// _safeZoneType(raw) → a known zone type, or null. Pure.
function _safeZoneType(raw) {
  return typeof raw === 'string' && ZONE_TYPES.includes(raw) ? raw : null;
}

// sanitizeDestination(input) → { ok, destination?|errors? }. Pure, never throws.
// Accepts a v0.2.164 `gatewayRead` preview model OR a plain destination descriptor
// (re-sanitising an already-clean model is idempotent and safe). Produces the canonical
// inert destination `{ zoneId, title, zoneType, npub, pubkey, shortPubkey, website,
// relays }`. A destination with no usable zone id is REJECTED (`ok:false`) — we never
// build a travel intent toward an unidentifiable target. Every URL is https-only, every
// relay ws/wss-only, all text control/markup-stripped.
export function sanitizeDestination(input = {}) {
  const d = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const zoneId = _safeText(d.zoneId != null ? String(d.zoneId) : null, MAX_ID_LEN);
  if (zoneId == null) {
    return { ok: false, errors: ['destination must have a zone id'] };
  }
  const pubkey = _isHex64(d.pubkey) ? d.pubkey : null;
  const destination = {
    zoneId,
    title: _safeText(d.title != null ? d.title : d.name, MAX_TITLE_LEN),
    zoneType: _safeZoneType(d.zoneType),
    npub: looksLikeNpub(d.npub) ? d.npub : null,
    pubkey,
    shortPubkey: pubkey ? shortPubkey(pubkey) : '',
    website: safeProfileUrl(d.website),
    relays: _safeRelays(d.relays),
  };
  return { ok: true, destination };
}

// _resolveInput(input) → the raw destination descriptor + audit origin from any
// accepted input shape. Accepts `{ destination, origin? }` or a bare descriptor. Pure.
function _resolveInput(input) {
  const raw = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const descriptor = (raw.destination && typeof raw.destination === 'object' && !Array.isArray(raw.destination))
    ? raw.destination
    : raw;
  const origin = typeof raw.origin === 'string' && raw.origin !== '' ? raw.origin : null;
  return { descriptor, origin };
}

// summariseTravelConfirm(input) → a single stable, human-readable line for a confirm
// prompt / HUD row / audit log. Pure, never throws. Reflects the consent summary plus
// the destination headline so the stakes (leaving this world) are never hidden.
export function summariseTravelConfirm(input = {}) {
  const { descriptor } = _resolveInput(input);
  const built = sanitizeDestination(descriptor);
  const consentLine = summariseConsent(TRAVEL_ACTION);
  if (!built.ok) return `${consentLine} — no valid destination (blocked).`;
  const dst = built.destination;
  const label = dst.title || dst.zoneId;
  const type = dst.zoneType ? ` [${dst.zoneType}]` : '';
  return `${consentLine} — to ${label}${type} (preview only, not travelled).`;
}

// prepareTravelIntent(input, grant) → an INERT travel-confirmation report. Pure, never
// throws, NEVER navigates/performs/signs/publishes/sends/connects.
//
//   {
//     ok:         boolean,        // host MAY proceed = destination valid AND consent allowed
//     action:     'gateway:travel',
//     destination:{…}|null,        // the sanitised inert destination (null if invalid)
//     consent:    {…},             // the inert consentGate decision (allowed/blocked + reason)
//     summary:    string,          // stable one-line headline
//     navigated:  false,           // ALWAYS — this flow never navigates
//     performed:  false,           // ALWAYS — this flow never performs the travel
//     signed:     false,           // ALWAYS
//     published:  false,           // ALWAYS
//     readOnly:   true,
//     errors:     [string],
//   }
//
// `input` is a `gatewayRead` preview model, a plain destination descriptor, or
// `{ destination, origin? }`. `grant` is the consent grant (boolean `true` for this
// single action, or a scoped `{ granted:true, action?, token? }`). With a matching grant
// the report marks consent allowed — but it STILL only prepares what a host could later
// execute; it never navigates. A malformed/unidentifiable destination OR a
// missing/mismatched grant yields ok:false (the host must not proceed).
export function prepareTravelIntent(input = {}, grant = null) {
  const { descriptor, origin } = _resolveInput(input);
  const built = sanitizeDestination(descriptor);

  // Route the intent through the consent gate regardless of destination validity, so
  // the report always carries an auditable decision. The request `detail` carries the
  // (sanitised) destination so an audit log records where a host WOULD travel.
  const request = buildConsentRequest({
    action: TRAVEL_ACTION,
    detail: built.ok ? built.destination : null,
    origin,
  });
  const consent = evaluateConsent(request.ok ? request.request : TRAVEL_ACTION, grant);

  return {
    ok: built.ok && consent.allowed,
    action: TRAVEL_ACTION,
    destination: built.ok ? built.destination : null,
    consent,
    summary: summariseTravelConfirm(input),
    navigated: false,
    performed: false,
    signed: false,
    published: false,
    readOnly: true,
    errors: built.ok ? [] : (built.errors || []),
  };
}

// DEMO_TRAVEL_INPUT — deterministic sample destination for the debug shell ONLY. Not
// used by gameplay; lets the foundation map show a representative intent + decision.
export const DEMO_TRAVEL_INPUT = Object.freeze({
  destination: Object.freeze({
    zoneId: 'nap-garden',
    title: 'The Nap Garden',
    zoneType: 'nap',
    npub: 'npub1demo000000000000000000000000000000000000000000000000000',
    website: 'https://torii-quest.pplx.app/nap-garden',
    relays: Object.freeze(['wss://relay.example.com']),
  }),
  origin: 'debug-shell',
});
