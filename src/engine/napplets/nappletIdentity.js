// engine/napplets/nappletIdentity.js — napplet identity keying for the Torii Quest
// shell (ADR-0057). PURE + node-safe: no DOM, no Nostr relay, no crypto.
//
// Per NIP-5D, a napplet's identity is the (dTag, aggregateHash) tuple from its
// NIP-5A manifest (kind 35129). The shell binds that tuple to the iframe's
// contentWindow (MessageEvent.source) so a napplet can never spoof another's
// identity. This module only normalizes + keys that tuple; it does not resolve
// manifests from relays (deferred to a future manifest resolver).

// normalizeIdentity({ dTag, aggregateHash }) → frozen { dTag, aggregateHash, key }.
// Throws if either field is missing or not a non-empty string.
export function normalizeIdentity({ dTag, aggregateHash }) {
  if (typeof dTag !== 'string' || dTag.length === 0)
    throw new Error('nappletIdentity: dTag must be a non-empty string');
  if (typeof aggregateHash !== 'string' || aggregateHash.length === 0)
    throw new Error('nappletIdentity: aggregateHash must be a non-empty string');
  return Object.freeze({ dTag, aggregateHash, key: `${dTag}::${aggregateHash}` });
}

// identityKey({ dTag, aggregateHash }) → the stable string key, or null if invalid.
// Non-throwing variant for filtering/guards.
export function identityKey({ dTag, aggregateHash } = {}) {
  if (typeof dTag !== 'string' || typeof aggregateHash !== 'string') return null;
  if (dTag.length === 0 || aggregateHash.length === 0) return null;
  return `${dTag}::${aggregateHash}`;
}

// sameIdentity(a, b) → true iff two identity tuples are byte-for-byte equal.
export function sameIdentity(a, b) {
  if (!a || !b) return false;
  return a.dTag === b.dTag && a.aggregateHash === b.aggregateHash;
}
