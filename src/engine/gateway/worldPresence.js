// engine/gateway/worldPresence.js — n2n world-presence layer (v0.2.251, P0).
// The live "who's online" surface for the gateway hop. Builds our own
// world-presence event (kind 30078 / topic `torii-gateway`, the same record
// shape `gatewayRead.js` reads), fetches other worlds' presence from relays via
// an injected read transport, and publishes ours via an injected sign+publish
// pair. Pure + node-safe: NO WebSocket, NO setTimeout, NO DOM, NO NIP-07 reach.
// All live I/O is injected by the host (main.js wires nostr.js relayReq /
// signEvent / fanoutPublish), so this module is fully unit-testable with fakes.
//
// Constrained by construction:
//   - READ: fetchOnlineWorlds({request, relays}) calls the injected request
//     (a fanoutReq-shaped `(relays, filters, opts) => {events,used,failed}`),
//     feeds the raw events to readGateways, and returns the sanitised list.
//     It never opens a socket itself.
//   - PUBLISH: publishOurPresence({unsigned, sign, publish, relays}) signs via
//     the injected NIP-07 wrapper and fanout-publishes via the injected publish.
//     No key handling here; a missing signer blocks cleanly.
//   - BUILD: buildPresenceEvent produces an UNSIGNED event template. The host's
//     NIP-07 signEvent adds id+sig. Never forges a signature.

import {
  GATEWAY_KIND, GATEWAY_TOPIC, buildGatewayFilter, readGateways,
} from './gatewayRead.js';
import { looksLikeNpub } from './travelIntent.js';

export const WORLD_PRESENCE_VERSION = 1;

const HEX64 = /^[0-9a-f]{64}$/;
function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }

// _safeRelays(raw) → a deduped array of ws/wss strings (capped at 8). Pure.
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

// _safeWss(raw) → a wss URL string or null. Pure, never throws.
// Used for the MP-1 `["ws", "wss://.../mp"]` gateway endpoint tag.
export function _safeWss(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  // wss ONLY — no plaintext ws:// on the public gateway surface.
  if (u.protocol !== 'wss:') return null;
  if (!u.hostname || u.username || u.password) return null;
  return u.href;
}

// _safeHttps(raw) → an https URL string or null. Pure, never throws.
function _safeHttps(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  let u;
  try { u = new URL(raw); } catch { return null; }
  return u.protocol === 'https:' ? u.href : null;
}

// buildPresenceEvent(input) → an UNSIGNED kind-30078 world-presence event
// template ready for NIP-07 signEvent. `input.pubkey` (hex64) is required so the
// signed event carries the operator identity; everything else degrades. Returns
// { ok, event, errors }. Pure; never throws.
export function buildPresenceEvent(input = {}) {
  const i = (input && typeof input === 'object' && !Array.isArray(input)) ? input : {};
  const errors = [];
  const pubkey = typeof i.pubkey === 'string' ? i.pubkey.trim() : '';
  if (!_isHex64(pubkey)) errors.push('pubkey must be a 64-char hex string (operator npub)');
  const zoneId = typeof i.zoneId === 'string' && i.zoneId.trim() !== ''
    ? i.zoneId.trim().slice(0, 128) : null;
  if (!zoneId) errors.push('zoneId is required');
  if (errors.length) return { ok: false, event: null, errors };

  const title = typeof i.title === 'string' ? i.title.trim().slice(0, 128) : '';
  const description = typeof i.description === 'string' ? i.description.trim().slice(0, 512) : '';
  const zoneType = typeof i.zoneType === 'string' && ['nap', 'arena', 'shop', 'gallery'].includes(i.zoneType)
    ? i.zoneType : 'arena';
  const website = _safeHttps(i.website);
  const relays = _safeRelays(i.relays);
  const npub = looksLikeNpub(i.npub) ? i.npub : null;
  const topics = Array.isArray(i.topics)
    ? i.topics.filter((t) => typeof t === 'string').map((t) => t.slice(0, 64)).slice(0, 8)
    : [];
  // MP-1: optional `ws` endpoint — the operator's arena WebSocket URL. When
  // present, a traveller can jump straight into shared gameplay on arrival.
  // Missing = single-player-only world (backwards-compatible with pre-MP-1 events).
  const wsEndpoint = _safeWss(i.wsEndpoint);

  const content = {
    zoneId, title, description, zoneType, website, relays, topics,
    version: WORLD_PRESENCE_VERSION,
  };
  if (npub) content.npub = npub;
  if (wsEndpoint) content.wsEndpoint = wsEndpoint;

  const tags = [
    ['d', zoneId],
    ['t', GATEWAY_TOPIC],
    ['zoneType', zoneType],
  ];
  if (title) tags.push(['title', title]);
  if (npub) tags.push(['npub', npub]);
  for (const r of relays) tags.push(['relay', r]);
  if (wsEndpoint) tags.push(['ws', wsEndpoint]);

  const event = {
    kind: GATEWAY_KIND,
    pubkey,
    created_at: Math.floor(Date.now() / 1000),
    tags,
    content: JSON.stringify(content),
  };
  return { ok: true, event, errors: [] };
}

// fetchOnlineWorlds({ request, relays, timeoutMs, filter }) → a sanitised
// online-worlds report. `request` is injected (a fanoutReq-shaped function
// `(relays, filters, opts) => Promise<{events, used, failed}>`). Returns
// { ok, count, worlds, used, failed, errors }. Never throws; a missing/failed
// request degrades to an empty list with errors, never a throw into the loop.
export async function fetchOnlineWorlds(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const request = typeof o.request === 'function' ? o.request : null;
  const relays = _safeRelays(o.relays);
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 5000;
  const graceMs = Number.isFinite(o.graceMs) && o.graceMs > 0 ? Math.floor(o.graceMs) : 0;
  const retries = Number.isFinite(o.retries) && o.retries > 0 ? Math.floor(o.retries) : 0;
  const out = { ok: false, count: 0, worlds: [], used: [], failed: [], errors: [] };
  if (!request) { out.errors.push('request transport is required'); return out; }
  if (!relays.length) { out.errors.push('at least one relay is required'); return out; }

  const filter = buildGatewayFilter({ limit: 200 });
  let raw;
  try {
    raw = await request(relays, [filter], { timeoutMs, graceMs, retries });
  } catch (e) {
    out.errors.push('request threw');
    return out;
  }
  const events = raw && Array.isArray(raw.events) ? raw.events : [];
  out.used = Array.isArray(raw.used) ? raw.used : [];
  out.failed = Array.isArray(raw.failed) ? raw.failed : [];

  const report = readGateways(events);
  if (!report.ok) {
    out.errors.push(...(report.errors || []));
    return out;
  }
  // Drop our own world from the list (the host should not list itself as a
  // travel destination). Match by pubkey when the caller supplies ours.
  const ourPubkey = typeof o.ourPubkey === 'string' ? o.ourPubkey.trim() : '';
  let worlds = report.gateways || [];
  if (_isHex64(ourPubkey)) {
    worlds = worlds.filter((w) => (w.pubkey || '') !== ourPubkey);
  }
  out.worlds = worlds;
  out.count = worlds.length;
  out.ok = true;
  return out;
}

// publishOurPresence({ unsigned, sign, publish, relays, timeoutMs }) → signs
// the unsigned event via the injected NIP-07 `sign` and fanout-publishes via the
// injected `publish`. Returns { ok, accepted, used, failed, error }. Never
// throws; a missing signer blocks cleanly with error 'nip-07-unavailable'.
export async function publishOurPresence(opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const unsigned = o.unsigned && typeof o.unsigned === 'object' ? o.unsigned : null;
  const sign = typeof o.sign === 'function' ? o.sign : null;
  const publish = typeof o.publish === 'function' ? o.publish : null;
  const relays = _safeRelays(o.relays);
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? o.timeoutMs : 5000;
  const out = { ok: false, accepted: 0, used: [], failed: [], error: null };
  if (!unsigned) { out.error = 'unsigned-event-required'; return out; }
  if (!sign) { out.error = 'nip-07-unavailable'; return out; }
  if (!publish) { out.error = 'publish-transport-required'; return out; }
  if (!relays.length) { out.error = 'at-least-one-relay-required'; return out; }

  let signed;
  try { signed = await sign(unsigned); }
  catch (e) { out.error = 'nip-07-threw'; return out; }
  if (!signed || !signed.ok || !signed.event) {
    out.error = (signed && signed.error) || 'nip-07-failed';
    return out;
  }
  let res;
  try { res = await publish(relays, signed.event, { timeoutMs }); }
  catch (e) { out.error = 'publish-threw'; return out; }
  out.accepted = (res && res.accepted) || 0;
  out.used = Array.isArray(res && res.used) ? res.used : [];
  out.failed = Array.isArray(res && res.failed) ? res.failed : [];
  out.ok = out.accepted > 0;
  if (!out.ok) out.error = 'no-relay-accepted';
  return out;
}
