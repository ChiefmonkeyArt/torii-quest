// world/handoff.js — NAP-to-NAP travel handoff (SKELETON, v0.2.110; SEC-2 crypto
// gate landed v0.2.356).
//
// Goal (eventual): hop from my NAP zone into someone else's online NAP zone.
// This module implements ONLY the pure, local pieces of that flow — the signed
// event SHAPE plus serialize / deserialize / structural-verify, a crypto-verify
// gate (BIP-340 schnorr over a NIP-01-canonical envelope), and a local
// "apply handoff to spawn" helper. There is NO online jump here: no relay
// publish, no remote fetch, no presence side effects. The relay-mediated and
// node-to-node transports are deliberately deferred (see presence.js).
//
// Trade-off recorded for later: relay-mediated handoff is easier and more
// nostrich-native than direct node-to-node; start relay-mediated, keep the
// event shape transport-agnostic so node-to-node can be added without a format
// change.
//
// SEC-2 (v0.2.356): before this module hands a caller a spawn descriptor from a
// handoff envelope, the envelope MUST clear a real BIP-340 schnorr verify under
// the traveller's hex64 pubkey. Structural checks (schema/namespace/freshness)
// stay as a fast pre-flight; the crypto check is the gate. `resolveHandoffSpawn`
// now REQUIRES a hex64 `expectedPlayerPubkey` and refuses any unsigned or
// wrong-key envelope. This closes the earlier bypass where any structurally-
// valid JSON blob passed through `deserializeHandoff` → `resolveHandoffSpawn`
// could arm a spawn without any authenticity check. The debug SDK
// (window.toriiDebug.handoff) inherits this hardening.

import { nostrEventId } from '../engine/crypto/nostrSig.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { hexToBytes } from '@noble/hashes/utils.js';

export const HANDOFF_KIND = 30079;            // app-specific, sibling of NAP_ZONE_KIND
export const HANDOFF_NAMESPACE = 'torii.handoff';
export const HANDOFF_SCHEMA_VERSION = 1;

// Handoff freshness ceiling. A handoff older than 5 min is stale — the traveller
// is expected to have arrived by then, and re-signing a fresh envelope is cheap.
const HANDOFF_MAX_AGE_S = 300;

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
function _isHex64(v) { return typeof v === 'string' && HEX64.test(v); }
function _isHex128(v) { return typeof v === 'string' && HEX128.test(v); }

// Minimum player state carried between zones. Kept intentionally small —
// position is the destination's concern (we spawn at its entry point), so we
// carry identity + display + a loadout pointer, not absolute coordinates.
//
// {
//   v:        1,
//   kind:     'torii.handoff',
//   player:   'npub1...' | hex64, // travelling identity (hex64 required to crypto-verify)
//   from:     'cm-home',           // source zone id
//   to:       'banker-bazaar',     // destination zone id
//   display:  { character, name }, // how to render the arrival
//   carry:    { },                 // optional inventory/state pointer (opaque)
//   ts:       <unix seconds>,
//   id?:      hex64,               // NIP-01 event id (populated by signer)
//   sig?:     hex128,              // BIP-340 schnorr sig over `id` by `player`
// }
export function createHandoffEvent({
  player,
  from,
  to,
  display = {},
  carry = {},
  ts,
} = {}) {
  return {
    v: HANDOFF_SCHEMA_VERSION,
    kind: HANDOFF_NAMESPACE,
    player: String(player || ''),
    from: String(from || ''),
    to: String(to || ''),
    display: display && typeof display === 'object' ? display : {},
    carry: carry && typeof carry === 'object' ? carry : {},
    ts: Number.isFinite(ts) ? ts : Math.floor(Date.now() / 1000),
  };
}

// Structural verification only — checks the shape + a freshness window. Does
// NOT verify a cryptographic signature (that is `verifyHandoffCrypto`'s job).
// Returns { ok:true } | { ok:false, error }. Preserved unchanged so any pure
// consumer that only cares about shape (a UI preview, a router log) can still
// use it without pulling the crypto layer.
export function verifyHandoffEvent(h, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (!h || typeof h !== 'object') return { ok: false, error: 'not an object' };
  if (h.v !== HANDOFF_SCHEMA_VERSION) return { ok: false, error: 'bad schema version' };
  if (h.kind !== HANDOFF_NAMESPACE) return { ok: false, error: 'bad namespace' };
  if (!h.player) return { ok: false, error: 'missing player npub' };
  if (!h.to) return { ok: false, error: 'missing destination zone' };
  if (typeof h.ts !== 'number') return { ok: false, error: 'missing timestamp' };
  if (now - h.ts > HANDOFF_MAX_AGE_S) return { ok: false, error: 'stale handoff' };
  return { ok: true };
}

// toNostrEventTemplate(h) — map a handoff envelope to the NIP-01 fields the
// event id + schnorr sig cover. Pure. The mapping is stable so a re-derived id
// from `h` matches the id an authoring signer computed at sign time.
//
//   pubkey     = h.player                        (hex64 required; treated as the schnorr x-only pubkey)
//   created_at = h.ts                            (unix seconds)
//   kind       = HANDOFF_KIND (30079, integer)   (NIP-01 requires an integer kind)
//   tags       = [['t','torii-handoff'], ['d', h.to]] (topic + zone tag)
//   content    = JSON canonical body ({v,kind,player,from,to,display,carry,ts})
//
// This is what verifyHandoffCrypto re-derives to check the signature; a
// tampered field anywhere in the body flips the id and fails verification.
function _toNostrEventTemplate(h) {
  return {
    pubkey: h.player,
    created_at: h.ts,
    kind: HANDOFF_KIND,
    tags: [
      ['t', 'torii-handoff'],
      ['d', String(h.to || '')],
    ],
    content: JSON.stringify({
      v: h.v,
      kind: h.kind,
      player: h.player,
      from: h.from,
      to: h.to,
      display: h.display,
      carry: h.carry,
      ts: h.ts,
    }),
  };
}

// deriveHandoffId(h) → the hex64 NIP-01 event id for the handoff envelope, or
// null if the required signable fields are missing/malformed. Pure; used by
// both signers and verifiers so both sides agree on what the sig commits to.
export function deriveHandoffId(h) {
  if (!h || typeof h !== 'object') return null;
  if (!_isHex64(h.player)) return null;
  if (!Number.isInteger(h.ts) || h.ts <= 0) return null;
  return nostrEventId(_toNostrEventTemplate(h));
}

// signHandoffEvent(h, sk) → a { ...h, id, sig } envelope. Pure convenience for
// tests + local demos; production callers should route through an injected
// signer (NIP-07 / the traveller's key manager) rather than passing raw sk.
// `sk` may be a 32-byte Uint8Array or a hex64 string. Throws if the envelope
// is malformed enough that no id can be derived.
export function signHandoffEvent(h, sk) {
  const id = deriveHandoffId(h);
  if (!id) throw new Error('cannot derive handoff id (player must be hex64 and ts must be a positive integer)');
  const skBytes = sk instanceof Uint8Array ? sk : hexToBytes(String(sk || ''));
  const sigBytes = schnorr.sign(hexToBytes(id), skBytes);
  let sig = '';
  for (let i = 0; i < sigBytes.length; i++) sig += sigBytes[i].toString(16).padStart(2, '0');
  return { ...h, id, sig };
}

// verifyHandoffCrypto(h, { expectedPlayerPubkey, now, requireFresh }) →
//   { ok, trusted, trust, errors }. Pure; never throws.
//
// SEC-2 gate. A handoff arms a spawn ONLY when every check passes:
//   1. Structural: schema/namespace/player/to/ts present + not stale (unless
//      requireFresh:false — used by round-trip serializers where freshness is
//      the destination's concern).
//   2. `h.player` is hex64 (nostrich x-only pubkey) AND === expectedPlayerPubkey
//      — the envelope names the traveller we're actually accepting.
//   3. `h.id` is present, hex64, and re-derives from the envelope body (a
//      tampered body flips the id and fails here before the crypto step).
//   4. `h.sig` is present + hex128 and schnorr-verifies over `h.id` under
//      `h.player`. Fail closed on any mismatch.
//
// `trust: 'crypto-verified'` ONLY on a full pass; 'unverified' otherwise. This
// mirrors verifyPublishGate (SEC-1) and gateway/handoffVerify (SEC-2 for the
// host-accept path) — one consistent verdict shape across the security floor.
export function verifyHandoffCrypto(h, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const expectedPlayerPubkey = typeof o.expectedPlayerPubkey === 'string' ? o.expectedPlayerPubkey.trim() : '';
  const now = Number.isFinite(o.now) ? o.now : Math.floor(Date.now() / 1000);
  const requireFresh = o.requireFresh !== false; // default true

  if (!h || typeof h !== 'object' || Array.isArray(h)) {
    return { ok: false, trusted: false, trust: 'unverified', errors: ['handoff event is required'] };
  }
  if (!_isHex64(expectedPlayerPubkey)) {
    return { ok: false, trusted: false, trust: 'unverified', errors: ['expectedPlayerPubkey must be hex64'] };
  }

  const errors = [];

  // 1. structural pre-flight (reuse the pure shape/freshness check)
  const structural = verifyHandoffEvent(h, { now });
  if (!structural.ok) {
    // stale is allowed to be waived (round-trip through serialize/deserialize)
    if (structural.error !== 'stale handoff' || requireFresh) errors.push(structural.error);
  }

  // 2. player identity match (anti-impersonation)
  if (!_isHex64(h.player)) {
    errors.push('event player must be hex64 (the traveller\'s x-only nostrich pubkey)');
  } else if (h.player !== expectedPlayerPubkey) {
    errors.push('event player does not match expected traveller pubkey');
  }

  // 3. id present + hex64 + re-derives from the envelope body
  if (!_isHex64(h.id)) {
    errors.push('event id must be a hex64 string');
  } else {
    const derived = deriveHandoffId(h);
    if (!derived) {
      errors.push('event id cannot be re-derived (malformed signable fields)');
    } else if (derived !== h.id) {
      errors.push('event id does not match the envelope body (tampered)');
    }
  }

  // 4. sig shape + BIP-340 schnorr verify under player pubkey.
  if (!_isHex128(h.sig)) {
    errors.push('event sig must be a hex128 schnorr signature');
  } else if (_isHex64(h.id) && _isHex64(h.player)) {
    try {
      const ok = schnorr.verify(hexToBytes(h.sig), hexToBytes(h.id), hexToBytes(h.player));
      if (!ok) errors.push('schnorr signature verification failed');
    } catch {
      errors.push('schnorr signature verification failed');
    }
  }

  if (errors.length) return { ok: true, trusted: false, trust: 'unverified', errors };
  return { ok: true, trusted: true, trust: 'crypto-verified', errors: [] };
}

// Local serialization for a same-browser/local jump demo: encode to a string a
// destination instance can read back. No network — just a transport-agnostic
// envelope. Returns a string, or throws if the handoff is malformed.
export function serializeHandoff(h) {
  const v = verifyHandoffEvent(h, { now: h?.ts ?? 0 }); // shape-only (skip freshness for round-trip)
  if (!v.ok && v.error !== 'stale handoff') throw new Error(`invalid handoff: ${v.error}`);
  return JSON.stringify(h);
}

export function deserializeHandoff(str) {
  if (typeof str !== 'string') return null;
  try { return JSON.parse(str); } catch { return null; }
}

// Resolve where an arriving player should spawn, given a handoff envelope and
// the destination zone's metadata (from napZone.js). Pure: returns the spawn
// descriptor; the caller is responsible for actually moving the player object.
// Returns null when SEC-2 verification fails.
//
// SEC-2 (v0.2.356): this is the choke-point. It REQUIRES a hex64
// `expectedPlayerPubkey` opt and runs `verifyHandoffCrypto` — an unsigned,
// tampered, wrong-key, or wrong-traveller envelope returns null and the caller
// never learns a spawn. The prior structural-only path was a bypass: any JSON
// blob with the right shape armed a spawn. That is closed here.
export function resolveHandoffSpawn(h, destZoneMeta, opts = {}) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const expectedPlayerPubkey = typeof o.expectedPlayerPubkey === 'string' ? o.expectedPlayerPubkey.trim() : '';
  if (!_isHex64(expectedPlayerPubkey)) return null;                 // SEC-2: no crypto identity → refuse
  const verdict = verifyHandoffCrypto(h, {
    expectedPlayerPubkey,
    now: Number.isFinite(o.now) ? o.now : undefined,
    requireFresh: o.requireFresh !== false,
  });
  if (!verdict.trusted) return null;                                // SEC-2: fail closed
  if (!destZoneMeta || !destZoneMeta.spawn) return null;
  if (destZoneMeta.id && h.to && destZoneMeta.id !== h.to) return null;
  return {
    zone: destZoneMeta.id,
    spawn: destZoneMeta.spawn,
    player: h.player,
    display: h.display || {},
  };
}
