// engine/crypto/nostrSig.js — NIP-01 event id + BIP-340 schnorr verify (S1, v0.2.263;
// moved to shared crypto/ in v0.2.277 so gateway AND leaderboard import one verifier).
// The crypto floor under the n2n handshake AND the SEC-1 leaderboard publish gate.
// A nostr event is signed by its author over the event ID — the sha256 of the
// NIP-01 canonical serialization `[0, pubkey, created_at, kind, tags, content]` —
// and `sig` is a BIP-340 schnorr signature over those 32 id bytes by the author's
// X-only pubkey. A nostr pubkey (hex64) IS the 32-byte X-only schnorr key, so it
// feeds schnorr.verify directly.
//
// PURE + node-safe: NO DOM, NO socket, NO key handling, NO `three`. @noble/curves +
// @noble/hashes are the project's first runtime crypto dependency (S1). Both run
// identically in node and the browser, so this module lives in the shell-safe graph
// and is safe to import from the pure verify seam, from leaderboard, and from tests.

import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from '@noble/hashes/utils.js';

const HEX64 = /^[0-9a-f]{64}$/;
const HEX128 = /^[0-9a-f]{128}$/;
const _enc = new TextEncoder();

// serializeForId(evt) → the exact NIP-01 string the event id hashes. Throws only
// if JSON.stringify chokes (cyclic content) — callers guard with try/catch.
function serializeForId(evt) {
  return JSON.stringify([
    0,
    evt.pubkey,
    evt.created_at,
    evt.kind,
    Array.isArray(evt.tags) ? evt.tags : [],
    typeof evt.content === 'string' ? evt.content : '',
  ]);
}

// nostrEventId(evt) → the lowercase-hex sha256 event id for {pubkey, created_at,
// kind, tags, content}, or null if the canonical inputs are unusable. Pure.
export function nostrEventId(evt) {
  if (!evt || typeof evt !== 'object') return null;
  if (!HEX64.test(evt.pubkey) || !Number.isInteger(evt.created_at) || !Number.isInteger(evt.kind)) {
    return null;
  }
  let serialized;
  try { serialized = serializeForId(evt); } catch { return null; }
  let hex = '';
  const bytes = sha256(_enc.encode(serialized));
  for (let i = 0; i < bytes.length; i++) hex += bytes[i].toString(16).padStart(2, '0');
  return hex;
}

// verifyNostrEventSig(evt) → boolean. Recomputes the id from the canonical fields,
// confirms it matches the claimed evt.id (so the signature is bound to THIS
// content, not a replayed id), then runs the real BIP-340 schnorr verify of
// evt.sig over the id bytes under evt.pubkey. Pure; never throws (a malformed
// input is simply false — fail closed).
export function verifyNostrEventSig(evt) {
  if (!evt || typeof evt !== 'object') return false;
  if (!HEX64.test(evt.pubkey) || !HEX128.test(evt.sig) || !HEX64.test(evt.id)) return false;
  const computedId = nostrEventId(evt);
  if (computedId !== evt.id) return false; // claimed id must bind the actual content
  // v0.2.911 (ADR-0140 stage 2): memoise ONLY the schnorr step. The id is always
  // recomputed from the content above, so a cached verdict can never vouch for
  // altered content; (id, pubkey, sig) fully determines the schnorr result.
  const key = evt.id + evt.pubkey + evt.sig;
  const hit = _sigCache.get(key);
  if (hit !== undefined) return hit;
  let ok = false;
  try {
    ok = schnorr.verify(hexToBytes(evt.sig), hexToBytes(evt.id), hexToBytes(evt.pubkey));
  } catch {
    ok = false;
  }
  if (_sigCache.size >= SIG_CACHE_MAX) _sigCache.delete(_sigCache.keys().next().value);
  _sigCache.set(key, ok);
  return ok;
}

// Bounded FIFO of schnorr verdicts (≈1 KB per 4 entries; 1024 entries max).
export const SIG_CACHE_MAX = 1024;
const _sigCache = new Map();
/** Test seam. */
export function _sigCacheSize() { return _sigCache.size; }
