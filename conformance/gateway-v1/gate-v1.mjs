// Torii Gate Protocol v1: reference reader + writer check (GATEWAY_PROTOCOL.md).
// Engine-free and Torii-free on purpose: copy this file into any world. Only
// dependency: @noble/curves + @noble/hashes (BIP-340 schnorr, sha256).
// Every function is pure and never throws.
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

export const KIND = 30078;
export const TOPIC = 'torii-gateway';
export const VERSION = 1;
export const GRACE_SEC = 3600;
export const TTL_MIN = 60, TTL_MAX = 3600, TTL_DEFAULT = 1200;
export const ZONE_TYPES = ['nap', 'arena', 'shop', 'gallery'];
export const TRAVELLER_PARAM = 'torii-traveller';
export const FILTER = { kinds: [KIND], '#t': [TOPIC] };

const HEX64 = /^[0-9a-f]{64}$/, HEX128 = /^[0-9a-f]{128}$/;
const UNSAFE = /[\x00-\x1f\x7f<>]/g;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PRIVATE = /^(localhost$|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|::1$|fe80:|fc00:|fd)/i;
const enc = new TextEncoder();

const tag = (ev, n) => { for (const t of ev.tags || []) if (Array.isArray(t) && t[0] === n && t[1] != null) return t[1]; return null; };
const tags = (ev, n) => (ev.tags || []).filter((t) => Array.isArray(t) && t[0] === n && t[1] != null).map((t) => t[1]);
const text = (v, max) => { if (typeof v !== 'string') return null; const c = v.replace(UNSAFE, '').trim(); return c ? c.slice(0, max) : null; };
const url = (v, protos) => { if (typeof v !== 'string' || v.length > 2048) return null; try { const u = new URL(v); return protos.includes(u.protocol) && u.hostname && !u.username && !u.password ? u.href : null; } catch { return null; } };
const https = (v) => url(v, ['https:']);
const isInt = (n) => Number.isInteger(n) && n >= 0;

/** NIP-01 event id. */
export function eventId(ev) {
  return bytesToHex(sha256(enc.encode(JSON.stringify([0, ev.pubkey, ev.created_at, ev.kind, ev.tags, ev.content]))));
}

/** §3.1: id binds the content and the BIP-340 signature verifies. */
export function verifySignature(ev) {
  try {
    if (!HEX64.test(ev.pubkey) || !HEX64.test(ev.id) || !HEX128.test(ev.sig)) return false;
    if (eventId(ev) !== ev.id) return false;
    return schnorr.verify(hexToBytes(ev.sig), hexToBytes(ev.id), hexToBytes(ev.pubkey));
  } catch { return false; }
}

/** Sign a heartbeat template with a hex secret key (tests / reference world). */
export function signEvent(template, secretHex) {
  const sk = hexToBytes(secretHex);
  const ev = { ...template, pubkey: bytesToHex(schnorr.getPublicKey(sk)) };
  ev.id = eventId(ev);
  ev.sig = bytesToHex(schnorr.sign(hexToBytes(ev.id), sk, new Uint8Array(32)));
  return ev;
}

function structural(ev) {
  return !!ev && typeof ev === 'object' && HEX64.test(ev.id || '') && HEX64.test(ev.pubkey || '')
    && isInt(ev.kind) && isInt(ev.created_at) && typeof ev.content === 'string'
    && Array.isArray(ev.tags) && ev.tags.every((t) => Array.isArray(t) && t.every((x) => typeof x === 'string'));
}

/** §3.2 */
export function isLive(ev, nowSec) {
  if ((ev.tags || []).some((t) => Array.isArray(t) && t[0] === 'state')) return false;
  const exp = Number(tag(ev, 'expiration'));
  if (tag(ev, 'expiration') != null && Number.isFinite(exp) && exp >= nowSec) return true;
  return ev.created_at >= nowSec - GRACE_SEC;
}

/**
 * Reader view of ONE event (§3). → { ok, world|null, reason|null }
 * reason ∈ not-an-event | wrong-kind | bad-signature | no-zone | stale
 */
export function readHeartbeat(ev, { nowSec = Math.floor(Date.now() / 1000), verify = true } = {}) {
  if (!structural(ev)) return { ok: false, world: null, reason: 'not-an-event' };
  if (ev.kind !== KIND) return { ok: false, world: null, reason: 'wrong-kind' };
  if (verify && !verifySignature(ev)) return { ok: false, world: null, reason: 'bad-signature' };
  let c = {};
  try { const p = JSON.parse(ev.content); if (p && typeof p === 'object' && !Array.isArray(p)) c = p; } catch { /* tags only */ }
  const zoneId = text(c.zoneId != null && c.zoneId !== '' ? String(c.zoneId) : tag(ev, 'd'), 128);
  if (!zoneId) return { ok: false, world: null, reason: 'no-zone' };
  if (!isLive(ev, nowSec)) return { ok: false, world: null, reason: 'stale' };
  const zt = c.zoneType != null ? c.zoneType : tag(ev, 'zoneType');
  const owner = tags(ev, 'p').find((v) => HEX64.test(v)) || ev.pubkey;
  const website = https(c.website);
  return {
    ok: true, reason: null,
    world: {
      zoneId, owner, pubkey: ev.pubkey, created_at: ev.created_at,
      title: text(c.title != null ? c.title : (c.name != null ? c.name : tag(ev, 'title')), 128),
      description: text(c.description != null ? c.description : c.about, 512),
      zoneType: typeof zt === 'string' && ZONE_TYPES.includes(zt) ? zt : null,
      website, travellable: !!website,
      avatar: https(c.avatar),
      displayName: text(c.displayName, 128),
      ws: url(tag(ev, 'ws'), ['wss:']) || url(c.wsEndpoint, ['wss:']),
    },
  };
}

/** §3 over many events: verified, live, newest per (pubkey, zone). */
export function readWorlds(events, { nowSec, verify = true, self = '' } = {}) {
  const best = new Map();
  for (const ev of Array.isArray(events) ? events : []) {
    const r = readHeartbeat(ev, { nowSec, verify });
    if (!r.ok) continue;
    const k = r.world.pubkey + ':' + r.world.zoneId;
    const prev = best.get(k);
    if (!prev || r.world.created_at > prev.created_at) best.set(k, r.world);
  }
  return [...best.values()].filter((w) => !self || w.owner !== self);
}

/**
 * Writer conformance (§2), stricter than the reader: what YOUR heartbeat must
 * look like. → { ok, errors[] }
 */
export function checkHeartbeat(ev, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const e = [];
  if (!structural(ev)) return { ok: false, errors: ['not a NIP-01 event (id/pubkey/kind/created_at/tags/content)'] };
  if (ev.kind !== KIND) e.push(`kind must be ${KIND}`);
  if (!verifySignature(ev)) e.push('id/signature do not verify');
  const d = tag(ev, 'd');
  if (!d || d.length > 128) e.push('["d", zoneId] tag required (1-128 chars)');
  if (!tags(ev, 't').includes(TOPIC)) e.push(`["t", "${TOPIC}"] tag required`);
  const exp = Number(tag(ev, 'expiration'));
  if (!Number.isFinite(exp)) e.push('["expiration", unix] tag required (NIP-40)');
  else if (exp < ev.created_at + TTL_MIN || exp > ev.created_at + TTL_MAX) e.push(`expiration must be created_at + ${TTL_MIN}..${TTL_MAX}`);
  else if (exp < nowSec) e.push('heartbeat already expired');
  if (ev.content.length > 4096) e.push('content larger than 4 KB');
  let c = null;
  try { c = JSON.parse(ev.content); } catch { /* reported below */ }
  if (!c || typeof c !== 'object' || Array.isArray(c)) e.push('content must be a JSON object');
  else {
    if (c.zoneId !== d) e.push('content.zoneId must equal the d tag');
    if (!https(c.website)) e.push('content.website must be an https URL');
    else {
      const h = new URL(c.website);
      if (h.port || PRIVATE.test(h.hostname)) e.push('content.website must be a public host on the default port');
    }
    if (c.version !== VERSION) e.push(`content.version must be ${VERSION}`);
    if (c.zoneType != null && !ZONE_TYPES.includes(c.zoneType)) e.push('content.zoneType unknown');
    if (c.relays != null && (!Array.isArray(c.relays) || c.relays.length > 8 || c.relays.some((r) => !url(r, ['ws:', 'wss:'])))) e.push('content.relays: ≤8 ws/wss URLs');
  }
  const own = tags(ev, 'p').find((v) => HEX64.test(v));
  if (tag(ev, 'p') != null && !own) e.push('["p", owner] must be 64-char hex');
  return { ok: e.length === 0, errors: e };
}

/** §4: the hop URL, or { ok:false, error }. */
export function visitUrl(website, { traveller = '', zone = '', allowPrivate = false } = {}) {
  if (typeof website !== 'string' || !website) return { ok: false, url: null, error: 'website-required' };
  let u;
  try { u = new URL(website); } catch { return { ok: false, url: null, error: 'url-unparseable' }; }
  if (u.protocol !== 'https:') return { ok: false, url: null, error: 'scheme-must-be-https' };
  if (u.username || u.password) return { ok: false, url: null, error: 'no-credentials-in-url' };
  if (u.port) return { ok: false, url: null, error: 'non-default-port-rejected' };
  if (!allowPrivate && PRIVATE.test(u.hostname)) return { ok: false, url: null, error: 'private-host-rejected' };
  if (traveller) {
    if (!HEX64.test(traveller)) return { ok: false, url: null, error: 'bad-pubkey' };
    u.searchParams.set(TRAVELLER_PARAM, traveller);
  }
  if (typeof zone === 'string' && zone.length <= 64 && SLUG.test(zone)) u.hash = '/zone/' + zone;
  return { ok: true, url: u.href, error: null };
}

/** §5: the arriving traveller CLAIM (not authentication). */
export function readTraveller(href) {
  let u;
  try { u = new URL(href); } catch { return { ok: false, pubkey: null, error: 'url-unparseable' }; }
  const v = u.searchParams.get(TRAVELLER_PARAM);
  if (!v) return { ok: false, pubkey: null, error: 'no-traveller' };
  if (!HEX64.test(v)) return { ok: false, pubkey: null, error: 'bad-pubkey' };
  const m = /^#\/zone\/([a-z0-9-]{1,64})$/.exec(u.hash);
  return { ok: true, pubkey: v, zone: m && SLUG.test(m[1]) ? m[1] : null, claim: true, error: null };
}
