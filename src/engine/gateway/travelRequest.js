// engine/gateway/travelRequest.js — signed travel-request handshake (P1, v0.2.252).
// The n2n handshake protocol: a traveller builds + signs a kind-30078
// travel-REQUEST addressed to a host's pubkey; the host builds + signs an
// ACCEPT/DENY response that references the request. This module builds the
// UNSIGNED event templates and sanitises inbound ones — it never signs, never
// opens a socket, never navigates. All live I/O (sign via NIP-07, publish via
// relays) is injected by the host (main.js). See GATEWAY_PROTOCOL.md §6.
//
// Reuses the §4 travel-intent payload from travelIntent.js (buildTravelIntent /
// validateTravelIntent / looksLikeNpub) and the kind/topic constants from
// gatewayRead.js, so a request/response is the same kind-30078 / `torii-gateway`
// record shape the presence + read layers already speak.
//
// Event shape:
//   REQUEST  (traveller signs, pubkey = traveller):
//     tags: ['d', requestId] ['t', TOPIC] ['state','request']
//           ['p', hostPubkey] ['to', toZone] ['from', fromZone]
//           (['player', playerNpub] when present)
//     content: JSON { to, from, player, relays, spawn, stateRef, version }
//   RESPONSE (host signs, pubkey = host):
//     tags: ['d', responseId] ['t', TOPIC] ['state','accepted'|'denied']
//           ['e', requestEventId] ['p', travellerPubkey] ['to', toZone]
//     content: JSON { accepted, spawn, relays, message, requestId, version }

import { GATEWAY_KIND, GATEWAY_TOPIC } from './gatewayRead.js';
import { buildTravelIntent, validateTravelIntent, looksLikeNpub } from './travelIntent.js';

export const TRAVEL_REQUEST_VERSION = 1;
export const TRAVEL_STATE = Object.freeze({
  REQUEST: 'request',
  ACCEPTED: 'accepted',
  DENIED: 'denied',
});

const HEX64 = /^[0-9a-f]{64}$/;
function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

function _safeRelays(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (typeof r !== 'string') continue;
    let u;
    try { u = new URL(r); } catch { continue; }
    if ((u.protocol === 'ws:' || u.protocol === 'wss:') && u.hostname && !u.username && !u.password) {
      const href = u.href;
      if (!out.includes(href) && out.length < 8) out.push(href);
    }
  }
  return out;
}

function _safeHttps(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  return u.protocol === 'https:' ? u.href : null;
}

function _safeText(raw, maxLen) {
  if (typeof raw !== 'string') return null;
  const clean = raw.replace(/[\x00-\x1f\x7f<>]/g, '').trim();
  if (clean === '') return null;
  return clean.length > maxLen ? clean.slice(0, maxLen) : clean;
}

function _tagValue(tags, name) {
  if (!Array.isArray(tags)) return undefined;
  for (const t of tags) { if (Array.isArray(t) && t[0] === name) return t[1]; }
  return undefined;
}

function _newId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

// buildTravelRequest(input) → an UNSIGNED kind-30078 travel-REQUEST event
// template ready for NIP-07 signEvent. `travellerPubkey` (hex64, the signer) and
// `toHostPubkey` (hex64, the world we want to enter) and `toZone` are required.
// Returns { ok, event, errors, requestId }. Pure; never throws.
export function buildTravelRequest(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const errors = [];
  const travellerPubkey = typeof i.travellerPubkey === 'string' ? i.travellerPubkey.trim() : '';
  if (!_isHex64(travellerPubkey)) errors.push('travellerPubkey must be a 64-char hex string (signer)');
  const toHostPubkey = typeof i.toHostPubkey === 'string' ? i.toHostPubkey.trim() : '';
  if (!_isHex64(toHostPubkey)) errors.push('toHostPubkey must be a 64-char hex string (destination host)');
  const toZone = _safeText(i.toZone, 128);
  if (!toZone) errors.push('toZone is required (destination zone id)');
  if (errors.length) return { ok: false, event: null, errors, requestId: null };

  const fromZone = _safeText(i.fromZone, 128);
  const playerNpub = looksLikeNpub(i.playerNpub) ? i.playerNpub : null;
  const relays = _safeRelays(i.relays);
  const spawn = _safeHttps(i.spawn);
  const stateRef = _safeText(i.stateRef, 128);
  const requestId = _safeText(i.requestId, 128) || _newId('req');

  // The §4 travel-intent payload (normalised + validated) rides in content.
  const intent = buildTravelIntent({
    to: toZone,
    from: fromZone || undefined,
    player: playerNpub || undefined,
    relays: relays.length ? relays : undefined,
    spawn: spawn || undefined,
    state: stateRef || undefined,
  });
  const intentCheck = validateTravelIntent(intent);
  if (!intentCheck.valid) errors.push(...intentCheck.errors);
  if (errors.length) return { ok: false, event: null, errors, requestId: null };

  const content = { ...intent, version: TRAVEL_REQUEST_VERSION };
  const tags = [
    ['d', requestId],
    ['t', GATEWAY_TOPIC],
    ['state', TRAVEL_STATE.REQUEST],
    ['p', toHostPubkey],
    ['to', toZone],
  ];
  if (fromZone) tags.push(['from', fromZone]);
  if (playerNpub) tags.push(['player', playerNpub]);

  const event = {
    kind: GATEWAY_KIND,
    pubkey: travellerPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };
  return { ok: true, event, errors: [], requestId };
}

// extractTravelRequest(event) → { ok, request?|errors? }. Pure, never throws.
// Reconstructs a sanitised request model from a NORMALISED kind-30078 event.
// Rejects non-request states, wrong kind/topic, missing host/traveller pubkey.
export function extractTravelRequest(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: ['event must be an object'] };
  }
  if (event.kind !== GATEWAY_KIND) return { ok: false, errors: [`event kind must be ${GATEWAY_KIND}`] };
  const tags = Array.isArray(event.tags) ? event.tags : [];
  if (_tagValue(tags, 't') !== GATEWAY_TOPIC) return { ok: false, errors: ['missing/wrong topic tag'] };
  if (_tagValue(tags, 'state') !== TRAVEL_STATE.REQUEST) return { ok: false, errors: ['not a request state'] };

  const requestId = _safeText(_tagValue(tags, 'd'), 128);
  const hostPubkey = _tagValue(tags, 'p');
  const travellerPubkey = _isHex64(event.pubkey) ? event.pubkey : null;
  if (!_isHex64(hostPubkey)) return { ok: false, errors: ['missing/invalid host pubkey (p tag)'] };
  if (!travellerPubkey) return { ok: false, errors: ['missing/invalid traveller pubkey'] };
  if (!requestId) return { ok: false, errors: ['missing request id (d tag)'] };

  let content = {};
  if (typeof event.content === 'string' && event.content !== '') {
    try {
      const p = JSON.parse(event.content);
      if (p && typeof p === 'object' && !Array.isArray(p)) content = p;
    } catch { /* fall back to tags */ }
  }
  const toZone = _safeText(content.to != null ? content.to : _tagValue(tags, 'to'), 128);
  const fromZone = _safeText(content.from != null ? content.from : _tagValue(tags, 'from'), 128);
  const playerNpub = looksLikeNpub(content.player != null ? content.player : _tagValue(tags, 'player'))
    ? (content.player != null ? content.player : _tagValue(tags, 'player')) : null;
  const relays = _safeRelays(content.relays);
  const spawn = _safeHttps(content.spawn);
  const stateRef = _safeText(content.state, 128);

  return {
    ok: true,
    request: {
      requestId, eventId: typeof event.id === 'string' ? event.id : null,
      travellerPubkey, hostPubkey, toZone, fromZone, playerNpub, relays, spawn, stateRef,
      created_at: Number.isInteger(event.created_at) ? event.created_at : null,
    },
  };
}

// readTravelRequests(events) → { ok, requests, count, skipped }. Pure. Runs
// extractTravelRequest over a raw event array, dropping malformed ones.
export function readTravelRequests(events) {
  const list = Array.isArray(events) ? events : [];
  const requests = [];
  const skipped = [];
  for (const ev of list) {
    const r = extractTravelRequest(ev);
    if (r.ok && r.request) requests.push(r.request);
    else skipped.push({ event: ev, errors: r.errors });
  }
  return { ok: true, requests, count: requests.length, skipped };
}

// buildTravelResponse(input) → an UNSIGNED kind-30078 ACCEPT/DENY response event
// template. `hostPubkey` (hex64, the host signer), `request` (the sanitised
// request model from extractTravelRequest) and `accepted` (boolean) are
// required. Returns { ok, event, errors, responseId }. Pure; never throws.
export function buildTravelResponse(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const errors = [];
  const hostPubkey = typeof i.hostPubkey === 'string' ? i.hostPubkey.trim() : '';
  if (!_isHex64(hostPubkey)) errors.push('hostPubkey must be a 64-char hex string (signer)');
  const request = i.request && typeof i.request === 'object' ? i.request : null;
  if (!request) errors.push('request is required (the sanitised request model)');
  const accepted = i.accepted === true;
  if (errors.length) return { ok: false, event: null, errors, responseId: null };
  if (!_isHex64(request.travellerPubkey)) errors.push('request.travellerPubkey must be hex64');
  if (!request.eventId) errors.push('request.eventId is required to reference the request');
  if (errors.length) return { ok: false, event: null, errors, responseId: null };

  const toZone = _safeText(request.toZone, 128) || 'unknown';
  const spawn = accepted ? _safeHttps(i.spawn) : null;
  const relays = _safeRelays(i.relays);
  const message = _safeText(i.message, 256);
  const responseId = _safeText(i.responseId, 128) || _newId('res');

  const content = {
    accepted, requestId: request.requestId, to: toZone,
    spawn, relays, message, version: TRAVEL_REQUEST_VERSION,
  };
  const tags = [
    ['d', responseId],
    ['t', GATEWAY_TOPIC],
    ['state', accepted ? TRAVEL_STATE.ACCEPTED : TRAVEL_STATE.DENIED],
    ['e', request.eventId],
    ['p', request.travellerPubkey],
    ['to', toZone],
  ];
  if (spawn) tags.push(['spawn', spawn]);

  const event = {
    kind: GATEWAY_KIND,
    pubkey: hostPubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };
  return { ok: true, event, errors: [], responseId };
}

// extractTravelResponse(event) → { ok, response?|errors? }. Pure, never throws.
// Reconstructs a sanitised ACCEPT/DENY model from a normalised kind-30078 event.
export function extractTravelResponse(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return { ok: false, errors: ['event must be an object'] };
  }
  if (event.kind !== GATEWAY_KIND) return { ok: false, errors: [`event kind must be ${GATEWAY_KIND}`] };
  const tags = Array.isArray(event.tags) ? event.tags : [];
  if (_tagValue(tags, 't') !== GATEWAY_TOPIC) return { ok: false, errors: ['missing/wrong topic tag'] };
  const state = _tagValue(tags, 'state');
  if (state !== TRAVEL_STATE.ACCEPTED && state !== TRAVEL_STATE.DENIED) {
    return { ok: false, errors: ['not a response state (accepted/denied)'] };
  }
  const responseId = _safeText(_tagValue(tags, 'd'), 128);
  const referencesRequestId = _tagValue(tags, 'e');
  const travellerPubkey = _tagValue(tags, 'p');
  const hostPubkey = _isHex64(event.pubkey) ? event.pubkey : null;
  if (!responseId) return { ok: false, errors: ['missing response id (d tag)'] };
  if (!_isHex64(referencesRequestId)) {
    // `e` references the request's EVENT id (hex64). A non-hex value is malformed.
    if (typeof referencesRequestId === 'string' && referencesRequestId.length > 0) {
      return { ok: false, errors: ['response must reference the request event id (e tag)'] };
    }
    return { ok: false, errors: ['missing request reference (e tag)'] };
  }
  if (!_isHex64(travellerPubkey)) return { ok: false, errors: ['missing/invalid traveller pubkey (p tag)'] };
  if (!hostPubkey) return { ok: false, errors: ['missing/invalid host pubkey (signer)'] };

  let content = {};
  if (typeof event.content === 'string' && event.content !== '') {
    try {
      const p = JSON.parse(event.content);
      if (p && typeof p === 'object' && !Array.isArray(p)) content = p;
    } catch { /* fall back to tags */ }
  }
  const accepted = state === TRAVEL_STATE.ACCEPTED;
  const spawn = accepted ? _safeHttps(content.spawn != null ? content.spawn : _tagValue(tags, 'spawn')) : null;
  const relays = _safeRelays(content.relays);
  const message = _safeText(content.message, 256);

  return {
    ok: true,
    response: {
      responseId, eventId: typeof event.id === 'string' ? event.id : null,
      hostPubkey, travellerPubkey, referencesRequestId, accepted,
      toZone: _safeText(content.to != null ? content.to : _tagValue(tags, 'to'), 128),
      spawn, relays, message,
      created_at: Number.isInteger(event.created_at) ? event.created_at : null,
    },
  };
}

// readTravelResponses(events) → { ok, responses, count, skipped }. Pure.
export function readTravelResponses(events) {
  const list = Array.isArray(events) ? events : [];
  const responses = [];
  const skipped = [];
  for (const ev of list) {
    const r = extractTravelResponse(ev);
    if (r.ok && r.response) responses.push(r.response);
    else skipped.push({ event: ev, errors: r.errors });
  }
  return { ok: true, responses, count: responses.length, skipped };
}
