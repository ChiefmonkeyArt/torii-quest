// engine/gateway/handoffArrival.js — P2 cross-host arrival / seating gate (v0.2.399).
// The HOST side of the n2n hop. A traveller on host A jumps to host B's spawn URL
// carrying their npub (`?torii-traveller=<hex64>`, appended by urlHarden.appendTraveller
// after a SEC-2 crypto-verified accept). This module is what host B uses on arrival to
// decide WHO is arriving — and, in restricted modes, WHETHER they may enter.
//
// The threat: the `torii-traveller` query param alone is unforgeable-attribution-FREE —
// anyone can craft `?torii-traveller=<victim>` and load host B. So the param is only a
// HINT. Seating the arriving player as that npub is gated by a real BIP-340 schnorr
// proof: host B must hold the traveller's SIGNED travel REQUEST (kind-30078, addressed
// to host B, authored by the arriving pubkey). The traveller signed that request with
// their key, so verifying it proves they (a) control the arriving npub and (b) actually
// asked to travel to THIS host. No valid signed request → seat as anon in public mode,
// or ACCESS DENIED in restricted mode.
//
// PURE + node-safe: NO DOM, NO socket construction, NO navigation, NO key handling.
// Relay I/O is injected as a request function (nostr.js fanoutReq in live code).

import { verifyNostrEventSig } from '../crypto/nostrSig.js';

const HEX64 = /^[0-9a-f]{64}$/;
const KIND_FOLLOWS = 3;
const FOLLOW_GRAPH_CACHE_TTL_MS = 5000;
const FOLLOW_GRAPH_CACHE = new Map();

function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
function _plainObject(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }
function _normaliseRelays(relays) {
  const list = Array.isArray(relays) ? relays : (typeof relays === 'string' ? [relays] : []);
  return [...new Set(list.filter((r) => typeof r === 'string' && r.trim()).map((r) => r.trim()))].sort();
}
function _cacheKey({ visitorPubkey, ownerPubkey, subjectPubkey, relays, mode }) {
  return JSON.stringify([visitorPubkey, ownerPubkey, subjectPubkey, _normaliseRelays(relays), mode]);
}
function _unverifiedVerdict(error) {
  return { ok: true, seated: false, trust: 'unverified', npub: null, errors: error ? [error] : [] };
}
function _denyArrival(verdict, error, extra = {}) {
  const v = _plainObject(verdict);
  return {
    ok: true,
    seated: false,
    npub: null,
    trust: typeof v.trust === 'string' ? v.trust : 'unverified',
    anon: false,
    denied: true,
    error: error || (Array.isArray(v.errors) && v.errors[0]) || 'access-denied',
    ...extra,
  };
}

export const ARRIVAL_MODE_PUBLIC = 'public';
export const ARRIVAL_MODE_FOLLOWS_ONLY = 'follows-only';
export const FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER = 'visitor-follows-owner';
export const FOLLOW_POLICY_MUTUAL = 'mutual';
export const FOLLOW_POLICY_OWNER_FOLLOWS_VISITOR = 'owner-follows-visitor';

// The query param appendTraveller writes. Single source of truth so the writer
// (urlHarden) and the reader (here) cannot drift.
export const TRAVELLER_PARAM = 'torii-traveller';

// normaliseArrivalMode(raw) → { ok, mode, error }. Missing defaults to public.
// Any explicit non-supported value is unreadable and therefore denied in restricted
// admission paths (fail closed).
export function normaliseArrivalMode(raw) {
  if (raw == null || raw === '') return { ok: true, mode: ARRIVAL_MODE_PUBLIC, error: null };
  const mode = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (mode === ARRIVAL_MODE_PUBLIC || mode === ARRIVAL_MODE_FOLLOWS_ONLY) {
    return { ok: true, mode, error: null };
  }
  return { ok: false, mode: null, error: 'arrival-mode-unreadable' };
}

// Stub seam for future ACC-2b/3 policy-direction settings. Missing defaults to the
// shipped semantics: visitor follows owner. Unknown values fail closed.
export function normaliseFollowPolicy(raw) {
  if (raw == null || raw === '') return { ok: true, policy: FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER, error: null };
  const policy = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (
    policy === FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER
    || policy === FOLLOW_POLICY_MUTUAL
    || policy === FOLLOW_POLICY_OWNER_FOLLOWS_VISITOR
  ) {
    return { ok: true, policy, error: null };
  }
  return { ok: false, policy: null, error: 'follow-policy-unreadable' };
}

// readArrivingTraveller(url) → { ok, pubkey, error }. Pure; never throws. Parses the
// `torii-traveller` query param from an inbound URL string and validates it is a hex64
// nostr pubkey. A missing/invalid param is ok:false (no arrival), not a throw.
export function readArrivingTraveller(url) {
  if (typeof url !== 'string' || url.length === 0) return { ok: false, pubkey: null, error: 'url-required' };
  let u;
  try { u = new URL(url); } catch { return { ok: false, pubkey: null, error: 'url-unparseable' }; }
  const raw = u.searchParams.get(TRAVELLER_PARAM);
  if (raw == null || raw === '') return { ok: false, pubkey: null, error: 'no-traveller' };
  if (!_isHex64(raw)) return { ok: false, pubkey: null, error: 'bad-pubkey' };
  return { ok: true, pubkey: raw, error: null };
}

// verifyArrival({ arrivingPubkey, request, expectedHostPubkey }) →
//   { ok, seated, trust, npub, errors }. Pure; never throws.
//
//   ok      — inputs were well-formed enough to evaluate (false = malformed)
//   seated  — the arrival is crypto-verified and may be seated as `npub`
//   trust   — 'crypto-verified' (full pass) | 'unverified' (not seatable)
//   npub    — the verified arriving pubkey (only when seated:true; else null)
//   errors  — human-readable reasons (empty when seated)
//
// Checks (ALL must pass for seated:true):
//   1. request carries a signed envelope + sig (request.signed + request.sig)
//   2. the signed event's author === arrivingPubkey (the request was signed by the
//      arriving identity — not merely tagged with it)
//   3. request.travellerPubkey === arrivingPubkey (sanitised model agrees)
//   4. request.hostPubkey === expectedHostPubkey (addressed to THIS host)
//   5. the BIP-340 schnorr signature verifies under arrivingPubkey over the NIP-01
//      event id (S1 crypto floor) — a forged/tampered/absent sig fails closed
export function verifyArrival(opts = {}) {
  const o = _plainObject(opts);
  const arrivingPubkey = typeof o.arrivingPubkey === 'string' ? o.arrivingPubkey.trim() : '';
  const expectedHostPubkey = typeof o.expectedHostPubkey === 'string' ? o.expectedHostPubkey.trim() : '';
  const request = o.request && typeof o.request === 'object' && !Array.isArray(o.request) ? o.request : null;

  const fail = (errors) => ({ ok: true, seated: false, trust: 'unverified', npub: null, errors });

  if (!_isHex64(arrivingPubkey)) return { ok: false, seated: false, trust: 'unverified', npub: null, errors: ['arrivingPubkey must be hex64'] };
  if (!_isHex64(expectedHostPubkey)) return { ok: false, seated: false, trust: 'unverified', npub: null, errors: ['expectedHostPubkey must be hex64'] };
  if (!request) return { ok: false, seated: false, trust: 'unverified', npub: null, errors: ['request model is required'] };

  const errors = [];

  // 1. signed envelope present
  if (typeof request.sig !== 'string' || !request.signed || typeof request.signed !== 'object') {
    return fail(['arriving request is not crypto-signed']);
  }
  // 2. the signed envelope's author must BE the arriving identity
  if (request.signed.pubkey !== arrivingPubkey) {
    errors.push('signed request author is not the arriving traveller');
  }
  // 3. sanitised model agrees on the traveller
  if (request.travellerPubkey !== arrivingPubkey) {
    errors.push('request traveller pubkey does not match the arriving npub');
  }
  // 4. addressed to THIS host
  if (request.hostPubkey !== expectedHostPubkey) {
    errors.push('request was not addressed to this host');
  }
  // 5. real BIP-340 schnorr verification (S1 crypto floor)
  if (!verifyNostrEventSig({
    pubkey: request.signed.pubkey,
    created_at: request.signed.created_at,
    kind: request.signed.kind,
    tags: request.signed.tags,
    content: request.signed.content,
    id: request.id,
    sig: request.sig,
  })) {
    errors.push('schnorr signature verification failed');
  }

  if (errors.length) return fail(errors);
  return { ok: true, seated: true, trust: 'crypto-verified', npub: arrivingPubkey, errors: [] };
}

// seatArrivalDecision(verdict) → { identity, anon }. Pure. Maps a verifyArrival verdict
// onto the host's public-mode seating decision: a crypto-verified arrival seats AS that
// npub; every other outcome (no proof / tampered / wrong host) fails CLOSED to anon.
export function seatArrivalDecision(verdict) {
  if (verdict && verdict.seated === true && _isHex64(verdict.npub)) {
    return { identity: verdict.npub, anon: false };
  }
  return { identity: null, anon: true };
}

// extractFollowedPubkeys(event, expectedAuthor?) → { ok, followedPubkeys, error }.
// Reads a kind:3 event's `p` tags into a Set of followed pubkeys. Missing event or a
// mismatched author is treated as a missing list (fail closed in restricted mode).
export function extractFollowedPubkeys(event, expectedAuthor = '') {
  const author = typeof expectedAuthor === 'string' ? expectedAuthor.trim() : '';
  if (!event || event.kind !== KIND_FOLLOWS) {
    return { ok: false, followedPubkeys: new Set(), error: 'missing-follow-list' };
  }
  if (_isHex64(author) && event.pubkey !== author) {
    return { ok: false, followedPubkeys: new Set(), error: 'missing-follow-list' };
  }
  const followedPubkeys = new Set();
  const tags = Array.isArray(event.tags) ? event.tags : [];
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag[0] !== 'p') continue;
    if (_isHex64(tag[1])) followedPubkeys.add(tag[1]);
  }
  return { ok: true, followedPubkeys, error: null };
}

// readLatestFollowSet({ request, relays, subjectPubkey, visitorPubkey, ownerPubkey, mode, ... }) →
//   { ok, followedPubkeys, cached, error, used, failed }.
// Reads the SUBJECT's latest kind:3 via the injected relay pool helper, with a short TTL
// cache keyed by (visitor pubkey, owner pubkey, relay set, mode). Relay error / timeout /
// missing kind:3 all fail closed so restricted admission can DENY rather than silently seat.
export async function readLatestFollowSet(opts = {}) {
  const o = _plainObject(opts);
  const request = typeof o.request === 'function' ? o.request : null;
  const subjectPubkey = typeof o.subjectPubkey === 'string' ? o.subjectPubkey.trim() : '';
  const visitorPubkey = typeof o.visitorPubkey === 'string' ? o.visitorPubkey.trim() : '';
  const ownerPubkey = typeof o.ownerPubkey === 'string' ? o.ownerPubkey.trim() : '';
  const mode = typeof o.mode === 'string' ? o.mode : ARRIVAL_MODE_PUBLIC;
  const relays = _normaliseRelays(o.relays);
  const nowMs = Number.isFinite(o.nowMs) ? Math.floor(o.nowMs) : Date.now();
  const timeoutMs = Number.isFinite(o.timeoutMs) && o.timeoutMs > 0 ? Math.floor(o.timeoutMs) : 5000;
  const graceMs = Number.isFinite(o.graceMs) && o.graceMs >= 0 ? Math.floor(o.graceMs) : 250;
  const retries = Number.isFinite(o.retries) && o.retries >= 0 ? Math.floor(o.retries) : 1;
  const cacheTtlMs = Number.isFinite(o.cacheTtlMs) && o.cacheTtlMs >= 0 ? Math.floor(o.cacheTtlMs) : FOLLOW_GRAPH_CACHE_TTL_MS;

  if (!_isHex64(subjectPubkey) || !_isHex64(visitorPubkey) || !_isHex64(ownerPubkey)) {
    return { ok: false, followedPubkeys: new Set(), cached: false, error: 'bad-follow-query', used: [], failed: relays };
  }

  const key = _cacheKey({ visitorPubkey, ownerPubkey, subjectPubkey, relays, mode });
  const cached = FOLLOW_GRAPH_CACHE.get(key);
  if (cached && cached.expiresAt > nowMs) {
    return {
      ok: true,
      followedPubkeys: new Set(cached.followedPubkeys),
      cached: true,
      error: null,
      used: cached.used.slice(),
      failed: cached.failed.slice(),
    };
  }

  if (!request || relays.length === 0) {
    return { ok: false, followedPubkeys: new Set(), cached: false, error: 'follow-graph-unavailable', used: [], failed: relays };
  }

  let raw;
  try {
    raw = await request(relays, [{ kinds: [KIND_FOLLOWS], authors: [subjectPubkey], limit: 20 }], { timeoutMs, graceMs, retries });
  } catch {
    return { ok: false, followedPubkeys: new Set(), cached: false, error: 'follow-graph-unavailable', used: [], failed: relays };
  }

  const events = raw && Array.isArray(raw.events) ? raw.events : [];
  const used = raw && Array.isArray(raw.used) ? raw.used.slice() : [];
  const failed = raw && Array.isArray(raw.failed) ? raw.failed.slice() : [];

  let latest = null;
  for (const event of events) {
    if (!event || event.kind !== KIND_FOLLOWS || event.pubkey !== subjectPubkey) continue;
    const createdAt = Number.isFinite(event.created_at) ? event.created_at : -Infinity;
    const latestCreatedAt = latest && Number.isFinite(latest.created_at) ? latest.created_at : -Infinity;
    if (!latest || createdAt > latestCreatedAt) latest = event;
  }

  const parsed = extractFollowedPubkeys(latest, subjectPubkey);
  if (!parsed.ok) {
    const error = failed.length && used.length === 0 ? 'follow-graph-unavailable' : 'missing-follow-list';
    return { ok: false, followedPubkeys: new Set(), cached: false, error, used, failed };
  }

  const followedPubkeys = [...parsed.followedPubkeys];
  FOLLOW_GRAPH_CACHE.set(key, {
    followedPubkeys,
    used,
    failed,
    expiresAt: nowMs + cacheTtlMs,
  });
  return { ok: true, followedPubkeys: new Set(followedPubkeys), cached: false, error: null, used, failed };
}

async function _checkFollowPolicy(opts) {
  const o = _plainObject(opts);
  const visitorPubkey = typeof o.visitorPubkey === 'string' ? o.visitorPubkey.trim() : '';
  const ownerPubkey = typeof o.ownerPubkey === 'string' ? o.ownerPubkey.trim() : '';
  const request = typeof o.request === 'function' ? o.request : null;
  const relays = o.relays;
  const mode = typeof o.mode === 'string' ? o.mode : ARRIVAL_MODE_PUBLIC;
  const followPolicy = normaliseFollowPolicy(o.followPolicy);
  if (!followPolicy.ok) return { ok: false, allowed: false, error: followPolicy.error };

  const readSet = (subjectPubkey) => readLatestFollowSet({
    request,
    relays,
    subjectPubkey,
    visitorPubkey,
    ownerPubkey,
    mode,
    timeoutMs: o.timeoutMs,
    graceMs: o.graceMs,
    retries: o.retries,
    cacheTtlMs: o.cacheTtlMs,
    nowMs: o.nowMs,
  });

  if (followPolicy.policy === FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER) {
    const visitorSet = await readSet(visitorPubkey);
    return visitorSet.ok
      ? { ok: true, allowed: visitorSet.followedPubkeys.has(ownerPubkey), error: null, followPolicy: followPolicy.policy }
      : { ok: false, allowed: false, error: visitorSet.error, followPolicy: followPolicy.policy };
  }
  if (followPolicy.policy === FOLLOW_POLICY_OWNER_FOLLOWS_VISITOR) {
    const ownerSet = await readSet(ownerPubkey);
    return ownerSet.ok
      ? { ok: true, allowed: ownerSet.followedPubkeys.has(visitorPubkey), error: null, followPolicy: followPolicy.policy }
      : { ok: false, allowed: false, error: ownerSet.error, followPolicy: followPolicy.policy };
  }
  const visitorSet = await readSet(visitorPubkey);
  if (!visitorSet.ok) return { ok: false, allowed: false, error: visitorSet.error, followPolicy: followPolicy.policy };
  const ownerSet = await readSet(ownerPubkey);
  if (!ownerSet.ok) return { ok: false, allowed: false, error: ownerSet.error, followPolicy: followPolicy.policy };
  return {
    ok: true,
    allowed: visitorSet.followedPubkeys.has(ownerPubkey) && ownerSet.followedPubkeys.has(visitorPubkey),
    error: null,
    followPolicy: followPolicy.policy,
  };
}

// decideArrivalAdmission({ verdict, ownerPubkey, arrivalMode, followPolicy, request, relays, ... }) →
//   { ok, seated, npub, trust, anon, denied, error, arrivalMode, followPolicy }.
// Public mode preserves the existing SEC-2 seating rule: crypto-verified → identity,
// everything else → anon. Restricted mode is additive: it FIRST requires SEC-2's
// crypto-verified verdict, THEN checks the follow policy, and any miss/error DENIES.
export async function decideArrivalAdmission(opts = {}) {
  const o = _plainObject(opts);
  const mode = normaliseArrivalMode(o.arrivalMode);
  const verdict = o.verdict && typeof o.verdict === 'object' ? o.verdict : _unverifiedVerdict('unverified');

  if (!mode.ok) {
    return _denyArrival(verdict, mode.error, { arrivalMode: null, followPolicy: null });
  }

  if (mode.mode === ARRIVAL_MODE_PUBLIC) {
    const decision = seatArrivalDecision(verdict);
    return {
      ok: true,
      seated: verdict.seated === true,
      npub: decision.identity,
      trust: verdict.trust,
      anon: decision.anon,
      denied: false,
      error: verdict.seated ? null : (verdict.errors[0] || 'unverified'),
      arrivalMode: mode.mode,
      followPolicy: FOLLOW_POLICY_VISITOR_FOLLOWS_OWNER,
    };
  }

  const ownerPubkey = typeof o.ownerPubkey === 'string' ? o.ownerPubkey.trim() : '';
  if (!_isHex64(ownerPubkey)) {
    return _denyArrival(verdict, 'no-host-identity', { arrivalMode: mode.mode, followPolicy: null });
  }

  if (!(verdict.seated === true && verdict.trust === 'crypto-verified' && _isHex64(verdict.npub))) {
    return _denyArrival(verdict, (Array.isArray(verdict.errors) && verdict.errors[0]) || 'access-denied', {
      arrivalMode: mode.mode,
      followPolicy: null,
    });
  }

  const followCheck = await _checkFollowPolicy({
    request: o.request,
    relays: o.relays,
    visitorPubkey: verdict.npub,
    ownerPubkey,
    mode: mode.mode,
    followPolicy: o.followPolicy,
    timeoutMs: o.timeoutMs,
    graceMs: o.graceMs,
    retries: o.retries,
    cacheTtlMs: o.cacheTtlMs,
    nowMs: o.nowMs,
  });
  if (!followCheck.ok) {
    return _denyArrival(verdict, followCheck.error || 'follow-graph-unavailable', {
      arrivalMode: mode.mode,
      followPolicy: followCheck.followPolicy || null,
    });
  }
  if (!followCheck.allowed) {
    return _denyArrival(verdict, 'access-denied', {
      arrivalMode: mode.mode,
      followPolicy: followCheck.followPolicy,
    });
  }
  return {
    ok: true,
    seated: true,
    npub: verdict.npub,
    trust: verdict.trust,
    anon: false,
    denied: false,
    error: null,
    arrivalMode: mode.mode,
    followPolicy: followCheck.followPolicy,
  };
}

export function __resetFollowGraphCache() {
  FOLLOW_GRAPH_CACHE.clear();
}
